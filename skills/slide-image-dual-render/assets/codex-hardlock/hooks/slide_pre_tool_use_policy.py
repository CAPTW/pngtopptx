#!/usr/bin/env python3
import json
import os
import re
import sys

PROTECTED = [
    r"scripts[/\\]build\.js$",
    r"scripts[/\\]lib[/\\]atoms_pptx\.js$",
    r"scripts[/\\]lib[/\\]atoms_html\.js$",
    r"scripts[/\\]lib[/\\]kit\.js$",
    r"scripts[/\\]lib[/\\]profile\.js$",
    r"styles[/\\].+\.json$",
]


def load_event():
    try:
        return json.load(sys.stdin)
    except Exception:
        return {}


def deny(reason, alternative):
    payload = {
        "decision": "deny",
        "reason": reason,
        "systemMessage": f"slide-image-dual-render hardlock blocked this action: {reason}\nApproved alternative: {alternative}",
        "hookSpecificOutput": {
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        },
    }
    print(json.dumps(payload))
    sys.exit(0)


def tool_name(event):
    return str(event.get("tool") or event.get("tool_name") or event.get("name") or "")


def tool_input(event):
    return event.get("tool_input") or event.get("input") or event.get("arguments") or {}


def command_from(inp):
    if isinstance(inp, dict):
        return str(inp.get("command") or inp.get("cmd") or inp.get("script") or "")
    return str(inp or "")


def paths_from(value):
    out = []
    if isinstance(value, dict):
        for k, v in value.items():
            if k.lower() in {"path", "file", "file_path", "filepath", "target", "target_file"} and isinstance(v, str):
                out.append(v)
            else:
                out.extend(paths_from(v))
    elif isinstance(value, list):
        for v in value:
            out.extend(paths_from(v))
    return out


def check_bash(command):
    c = command.lower()
    if re.search(r"python-pptx", c):
        deny("python-pptx is not an approved renderer", "author lib/slides.js and run node scripts/slide_pipeline.js --target both")
    if re.search(r"html\s*[-_ ]?to\s*[-_ ]?pptx|html-to-pptx", c):
        deny("HTML-to-PPTX converters bypass the shared renderer", "render PPTX and HTML from the same slide functions via slide_pipeline.js")
    if re.search(r"soffice[^\n;]*--convert-to\s+pptx", c):
        deny("LibreOffice may be used for QA export checks, not to create the deliverable PPTX", "run node scripts/slide_pipeline.js --target both")
    if re.search(r"\b(cp|copy|copy-item)\b[^\n;]*src[/\\]slide\d+\.(png|jpg|jpeg)[^\n;]*out[/\\].+\.pptx", c):
        deny("copying source slide images into a PPTX is a full-slide raster shortcut", "use crops only for unrecreatable regions and render through lib/slides.js")
    if re.search(r"\bnpm\s+(install|i|add)\b[^\n;]*pptxgenjs", c) and not re.search(r"sharp[^\n;]*react[^\n;]*react-icons|react[^\n;]*react-dom[^\n;]*react-icons", c):
        deny("installing PPTX generation tooling outside the approved setup is blocked", "use the Skill setup dependencies and build.js only")
    if re.search(r"\.pptx\b", c) and not re.search(r"slide_pipeline\.js|build\.js|final_gate\.js|enforce_contract\.js|fixtures?[/\\]", c):
        if re.search(r"\b(node|python|python3|soffice|libreoffice|pandoc|cp|copy|copy-item)\b", c):
            deny("command appears to create or manipulate a PPTX outside the approved pipeline", "run node scripts/slide_pipeline.js --target both and node scripts/final_gate.js before delivery")


def check_write_paths(name, inp):
    if os.environ.get("SLIDE_SKILL_DEV") == "1":
        return
    if not re.search(r"apply_patch|edit|write", name, re.I):
        return
    for p in paths_from(inp):
        pp = p.replace("/", "\\")
        for pat in PROTECTED:
            if re.search(pat, pp, re.I):
                deny(f"protected renderer/style file cannot be edited during conversion: {p}", "write per-slide artifacts under work/slideXX/ and merge centrally")


def main():
    event = load_event()
    name = tool_name(event)
    inp = tool_input(event)
    if re.search(r"bash|shell|powershell", name, re.I):
        check_bash(command_from(inp))
    check_write_paths(name, inp)
    print(json.dumps({}))


if __name__ == "__main__":
    main()
