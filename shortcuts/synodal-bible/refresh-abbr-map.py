#!/usr/bin/env python3
"""Refresh abbr-map.json from a local russian-synodal-bible tex/ tree."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_TEX = Path('/tmp/russian-synodal-bible/tex')
OUT = ROOT / 'abbr-map.json'

ABBR_RE = re.compile(
    r'\\bibbookdescr\{([^}]+)\}\{.*?abbr=\{([^}]+)\}',
    re.DOTALL,
)


def main() -> None:
    tex_dir = Path(os.environ.get('TEX_DIR', DEFAULT_TEX))
    if not tex_dir.is_dir():
        raise SystemExit(f'tex dir not found: {tex_dir}')

    books: dict[str, dict[str, str]] = {}
    for path in sorted(tex_dir.glob('*.tex')):
        text = path.read_text(encoding='utf-8', errors='replace')
        match = ABBR_RE.search(text)
        if not match:
            continue
        code = match.group(1)
        abbr = re.sub(
            r'\s+',
            ' ',
            match.group(2).replace('~', ' ').replace('\\,', ' ').strip(),
        )
        header_m = re.search(r'header=\{([^}]*)\}', text[:800])
        header = header_m.group(1) if header_m else code
        meta = {'code': code, 'file': f'{code}.tex', 'title': header}
        books[abbr] = meta
        compact = abbr.replace(' ', '')
        if compact != abbr:
            books[compact] = meta

    OUT.write_text(json.dumps(books, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Wrote {OUT} with {len(books)} keys from {tex_dir}')


if __name__ == '__main__':
    main()
