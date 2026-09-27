# Synodal Bible

iOS/macOS Shortcut that looks up Russian Synodal verses from a local clone of
[tigran123/russian-synodal-bible](https://github.com/tigran123/russian-synodal-bible).

Runs invisibly: copies the passage to the clipboard (no result alert).

## Setup (iPhone)

1. Put the bible repo somewhere in Files (default assumed path below).
2. Sign and import the shortcut (see below).
3. If your folder is not `Downloads/russian-synodal-bible`, open the shortcut
   and edit the **BibleRoot** Text action near the top (then Set Variable).

Default `BibleRoot`:

```text
Downloads/russian-synodal-bible
```

The shortcut reads `{BibleRoot}/tex/Joh.tex` (etc.).

## Input (priority order)

1. **Shortcut Input** — selected text shared into the shortcut, or text passed when running it
2. **Clipboard** — if there was no Shortcut Input
3. **Ask** — only if both are empty

## Output

Copies `Ин 3:16 (От Иоанна)\n\n3:16 …` to the clipboard. Errors are also copied
(no dialog).

## Examples

| Input | Clipboard result |
|-------|------------------|
| `Ин 3:16` | John 3:16 (Synodal Russian) |
| `Ин 3:16-17` | Two verses |
| `1 Ин 4:8` | 1 John 4:8 |
| `Мф 5:3` | Matthew 5:3 |

## Sign locally (required)

The committed `.shortcut` is **unsigned**. On a Mac:

```bash
shortcuts sign --mode anyone \
  --input "shortcuts/synodal-bible/Synodal Bible.shortcut" \
  --output "~/Downloads/Synodal Bible.shortcut"
```

Open the signed file to import it into Shortcuts, then sync to your iPhone.

## Rebuild after editing lookup logic

```bash
cd shortcuts/synodal-bible
python3 build.py
```

`build.py` embeds `lookup.js` plus `abbr-map.json` into the shortcut (same
data-URI JS pattern as `pdf-to-audio`). Do not put `#` characters in `lookup.js`.

To refresh abbreviations from an updated bible clone:

```bash
# expects /tmp/russian-synodal-bible or set TEX_DIR
python3 refresh-abbr-map.py
python3 build.py
```

## Permission note

The upstream bible README asks you to email the maintainer for permission before
redistributing the text. This shortcut only reads a copy you already placed on
device; it does not vendor the bible corpus.
