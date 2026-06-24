#!/usr/bin/env python3
"""Validate PPTX OPC package integrity without using Office/LibreOffice."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET

CRITICAL = {
    '[Content_Types].xml',
    '_rels/.rels',
    'ppt/presentation.xml',
    'ppt/_rels/presentation.xml.rels',
}
XML_CONTROL_RE = re.compile(r'[\x00-\x08\x0B\x0C\x0E-\x1F]')
BAD_TOKEN_RE = re.compile(r'(?i)\b(?:nan|infinity|undefined)\b')
NULL_RE = re.compile(r'(?i)\bnull\b')
REL_NS = '{http://schemas.openxmlformats.org/package/2006/relationships}'
CT_NS = '{http://schemas.openxmlformats.org/package/2006/content-types}'
EMU_EXTREME = 1_000_000_000


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def add(report, level, msg, **extra):
    item = {'level': level, 'message': msg}
    item.update(extra)
    report[level + 's'].append(item)


def norm_zip_path(p):
    p = str(p).replace('\\', '/')
    p = posixpath.normpath(p)
    if p == '.':
        return ''
    return p.lstrip('/')


def rel_owner_base(rels_name):
    rels_name = norm_zip_path(rels_name)
    if rels_name == '_rels/.rels':
        return ''
    if '/_rels/' not in rels_name or not rels_name.endswith('.rels'):
        return ''
    left, right = rels_name.split('/_rels/', 1)
    owner = posixpath.join(left, right[:-5])
    return posixpath.dirname(owner)


def resolve_target(rels_name, target):
    target = str(target or '').replace('\\', '/')
    target = target.split('#', 1)[0]
    if not target:
        return ''
    if target.startswith('/'):
        return norm_zip_path(target)
    return norm_zip_path(posixpath.join(rel_owner_base(rels_name), target))


def parse_xml_from_bytes(data, name, report):
    try:
        text = data.decode('utf-8')
    except UnicodeDecodeError as e:
        add(report, 'error', f'{name}: not valid UTF-8: {e}')
        return None, ''
    m = XML_CONTROL_RE.search(text)
    if m:
        add(report, 'error', f'{name}: invalid XML control character U+{ord(m.group(0)):04X}', offset=m.start())
    try:
        return ET.fromstring(text), text
    except ET.ParseError as e:
        pos = getattr(e, 'position', None)
        extra = {'line': pos[0], 'column': pos[1]} if pos else {}
        add(report, 'error', f'{name}: XML parse error: {e}', **extra)
        return None, text


def local(tag):
    return tag.rsplit('}', 1)[-1]


def has_ancestor(parent_map, elem, local_names):
    cur = parent_map.get(elem)
    while cur is not None:
        if local(cur.tag) in local_names:
            return True
        cur = parent_map.get(cur)
    return False


def validate_slide_numeric(name, root, text, report):
    for m in BAD_TOKEN_RE.finditer(text):
        add(report, 'error', f'{name}: invalid numeric/XML token {m.group(0)!r}', offset=m.start())
    for m in NULL_RE.finditer(text):
        start = max(0, m.start() - 24)
        end = min(len(text), m.end() + 24)
        ctx = text[start:end]
        if re.search(r'(?:x|y|cx|cy|w|h|rot|sz|val|pos|off|ext)\s*=\s*["\'][^"\']*null', ctx, re.I):
            add(report, 'error', f'{name}: null appears in numeric context', offset=m.start())
    if root is None:
        return
    parent_map = {child: parent for parent in root.iter() for child in parent}
    for elem in root.iter():
        lname = local(elem.tag)
        attrs = elem.attrib
        if lname == 'ext':
            if has_ancestor(parent_map, elem, {'grpSpPr'}):
                continue
            for attr in ('cx', 'cy'):
                if attr in attrs:
                    try:
                        value = int(attrs[attr])
                    except ValueError:
                        add(report, 'error', f'{name}: a:ext {attr} is not an integer: {attrs[attr]!r}')
                        continue
                    if value <= 0:
                        add(report, 'error', f'{name}: a:ext {attr} must be positive, got {value}')
                    elif value > EMU_EXTREME:
                        add(report, 'warning', f'{name}: a:ext {attr} is extremely large: {value}')
        for attr in ('x', 'y', 'cx', 'cy', 'w', 'h'):
            if attr in attrs:
                raw = attrs[attr]
                if BAD_TOKEN_RE.search(raw) or raw.lower() == 'undefined':
                    add(report, 'error', f'{name}: non-finite coordinate {attr}={raw!r}')
                try:
                    value = int(raw)
                except ValueError:
                    continue
                if attr in ('cx', 'cy', 'w', 'h') and value < 0:
                    add(report, 'warning', f'{name}: negative size-like value {attr}={value}')
                if abs(value) > EMU_EXTREME:
                    add(report, 'warning', f'{name}: extremely large coordinate/dimension {attr}={value}')


def load_content_types(root, report):
    defaults = set()
    overrides = set()
    if root is None:
        return defaults, overrides
    for child in root:
        lname = local(child.tag)
        if lname == 'Default' and child.attrib.get('Extension'):
            defaults.add(child.attrib['Extension'].lower())
        elif lname == 'Override' and child.attrib.get('PartName'):
            overrides.add(norm_zip_path(child.attrib['PartName']))
    return defaults, overrides


def validate_package(pptx, project, out_dir, strict):
    pptx = Path(pptx).resolve()
    out_dir = Path(out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    report = {
        'pptx': str(pptx),
        'project': str(Path(project).resolve()) if project else '',
        'sha256': sha256(pptx) if pptx.exists() else '',
        'strict': bool(strict),
        'passed': False,
        'errors': [],
        'warnings': [],
        'summary': {},
    }
    names = []
    roots = {}
    texts = {}
    try:
        with zipfile.ZipFile(pptx, 'r') as z:
            bad = z.testzip()
            if bad:
                add(report, 'error', f'ZIP CRC/test failed at {bad}')
            infos = z.infolist()
            names = [i.filename for i in infos]
            counts = {}
            for n in names:
                counts[n] = counts.get(n, 0) + 1
            for n, c in counts.items():
                if c > 1:
                    add(report, 'error', f'duplicate ZIP entry: {n}', count=c)
            name_set = set(names)
            for part in sorted(CRITICAL):
                if part not in name_set:
                    add(report, 'error', f'missing required package part: {part}')
                else:
                    info = z.getinfo(part)
                    if info.file_size == 0:
                        add(report, 'error', f'zero-byte critical XML part: {part}')
            slide_parts = sorted(n for n in names if re.match(r'ppt/slides/slide\d+\.xml$', n))
            if not slide_parts:
                add(report, 'error', 'no ppt/slides/slide*.xml parts found')
            for n in slide_parts:
                if z.getinfo(n).file_size == 0:
                    add(report, 'error', f'zero-byte slide XML: {n}')
            for n in names:
                if n.endswith('/'):
                    continue
                if n.endswith('.xml') or n.endswith('.rels'):
                    data = z.read(n)
                    if len(data) == 0:
                        add(report, 'error', f'zero-byte XML/rels part: {n}')
                        continue
                    root, text = parse_xml_from_bytes(data, n, report)
                    roots[n] = root
                    texts[n] = text
                    if n.startswith('ppt/slides/slide') and n.endswith('.xml'):
                        validate_slide_numeric(n, root, text, report)
            content_root = roots.get('[Content_Types].xml')
            defaults, overrides = load_content_types(content_root, report)
            for ext in ('xml', 'rels'):
                if ext not in defaults:
                    add(report, 'error', f'[Content_Types].xml missing Default for .{ext}')
            used_exts = set()
            for n in names:
                if n.endswith('/'):
                    continue
                ext = PurePosixPath(n).suffix.lower().lstrip('.')
                if ext:
                    used_exts.add(ext)
                    part_name = norm_zip_path('/' + n)
                    if ext not in defaults and part_name not in overrides:
                        level = 'error' if ext in {'xml', 'rels', 'png', 'jpg', 'jpeg', 'svg'} else 'warning'
                        add(report, level, f'no content type default/override for {n}')
            for ext in ('png', 'jpg', 'jpeg', 'svg'):
                if ext in used_exts and ext not in defaults:
                    add(report, 'error', f'[Content_Types].xml missing Default for used media extension .{ext}')
            for rels_name, root in roots.items():
                if not rels_name.endswith('.rels') or root is None:
                    continue
                ids = set()
                for rel in root:
                    if local(rel.tag) != 'Relationship':
                        continue
                    rid = rel.attrib.get('Id', '')
                    if rid in ids:
                        add(report, 'error', f'{rels_name}: duplicate relationship Id {rid}')
                    ids.add(rid)
                    target = rel.attrib.get('Target', '')
                    mode = rel.attrib.get('TargetMode', '')
                    if mode == 'External':
                        continue
                    resolved = resolve_target(rels_name, target)
                    if not resolved:
                        add(report, 'error', f'{rels_name}: empty internal relationship target for {rid}')
                        continue
                    if resolved not in name_set:
                        add(report, 'error', f'{rels_name}: missing relationship target {target!r} resolved to {resolved}', relId=rid)
            for n in names:
                if n.startswith('ppt/media/') and not n.endswith('/'):
                    info = z.getinfo(n)
                    if info.file_size == 0:
                        add(report, 'error', f'zero-byte media file: {n}')
    except zipfile.BadZipFile as e:
        add(report, 'error', f'not a valid ZIP/PPTX package: {e}')
    except FileNotFoundError:
        add(report, 'error', f'PPTX not found: {pptx}')
    except Exception as e:
        add(report, 'error', f'unexpected validation error: {type(e).__name__}: {e}')
    report['summary'] = {
        'zipEntries': len(names),
        'xmlPartsParsed': len([n for n in roots if n.endswith('.xml')]),
        'relsParsed': len([n for n in roots if n.endswith('.rels')]),
        'errorCount': len(report['errors']),
        'warningCount': len(report['warnings']),
    }
    report['passed'] = len(report['errors']) == 0
    json_path = out_dir / 'pptx_package_validation.json'
    md_path = out_dir / 'pptx_package_validation.md'
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    lines = [
        '# PPTX Package Validation',
        '',
        f'- PPTX: `{pptx}`',
        f'- SHA256: `{report["sha256"]}`',
        f'- Strict: `{strict}`',
        f'- Passed: `{report["passed"]}`',
        f'- Errors: `{len(report["errors"])}`',
        f'- Warnings: `{len(report["warnings"])}`',
        '',
        '## Errors',
    ]
    if report['errors']:
        lines.extend([f'- {e["message"]}' for e in report['errors']])
    else:
        lines.append('- none')
    lines += ['', '## Warnings']
    if report['warnings']:
        lines.extend([f'- {w["message"]}' for w in report['warnings']])
    else:
        lines.append('- none')
    with open(md_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    print(f'wrote {json_path}')
    print(f'wrote {md_path}')
    if strict and not report['passed']:
        return 1
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description='Validate PPTX package integrity/openability preflight.')
    ap.add_argument('--pptx', required=True)
    ap.add_argument('--project', default='.')
    ap.add_argument('--out', required=True)
    ap.add_argument('--strict', action='store_true')
    args = ap.parse_args(argv)
    return validate_package(args.pptx, args.project, args.out, args.strict)


if __name__ == '__main__':
    sys.exit(main())


