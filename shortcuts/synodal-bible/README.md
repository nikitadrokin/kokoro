# Synodal Bible

iOS/macOS Shortcut that looks up Russian Synodal verses from a local clone of
[tigran123/russian-synodal-bible](https://github.com/tigran123/russian-synodal-bible).

## Setup (iPhone)

1. Clone or download the bible repo into the Files app:
   `On My iPhone/Downloads/russian-synodal-bible`
   The `tex/` folder with files like `Joh.tex` must be present.
2. On a Mac, sign and AirDrop/import the shortcut (see below).
3. Run **Synodal Bible**, enter a reference like `Ин 3:16`.

The passage is shown and copied to the clipboard.

## Examples

| Input | Result |
|-------|--------|
| `Ин 3:16` | John 3:16 (Synodal Russian) |
| `Ин 3:16-17` | Two verses |
| `1 Ин 4:8` | 1 John 4:8 |
| `Мф 5:3` | Matthew 5:3 |

Abbreviations come from each book’s `abbr={…}` in the TeX sources (Ин, Мф, 1 Кор, …).

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
