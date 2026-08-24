#!/usr/bin/env python3
import json
import re
import sys


def load_event():
    try:
        return json.load(sys.stdin)
    except Exception:
        return {}


def tool_name(event):
    return str(event.get("tool") or event.get("tool_name") or event.get("name") or "")


def tool_input(event):
    return event.get("tool_input") or event.get("input") or event.get("arguments") or {}


def flatten(value):
    if isinstance(value, dict):
        return "\n".join(flatten(v) for v in value.values())
    if isinstance(value, list):
        return "\n".join(flatten(v) for v in value)
    return str(value or "")


def warn(message):
    print(json.dumps({
        "systemMessage": message,
        "warning": message,
    }))
    sys.exit(0)


def main():
    event = load_event()
    text = (tool_name(event) + "\n" + flatten(tool_input(event))).lower()
    patterns = [
        r"python-pptx",
        r"html\s*[-_ ]?to\s*[-_ ]?pptx",
        r"soffice[^\n;]*--convert-to\s+pptx",
        r"new\s+pptx\s*gen",
        r"src[/\\]slide\d+\.(png|jpg|jpeg)[^\n;]*\.pptx",
    ]
    for pat in patterns:
        if re.search(pat, text, re.I):
            warn("slide-image-dual-render hardlock warning: a forbidden conversion pattern appeared. Do not undo automatically; run node scripts/enforce_contract.js --phase final and inspect outputs before delivery.")
    print(json.dumps({}))


if __name__ == "__main__":
    main()
