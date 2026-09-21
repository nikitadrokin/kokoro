# PDF to Audio

Share Sheet shortcut that extracts text from a PDF, runs Kokoro’s speech text
optimizer (ported from `app/src/lib/tts-text.ts`), then builds spoken audio and
opens it in Quick Look so you can play or save the file.

## What changed vs the cloud-model version

| Step | Before | Now |
|------|--------|-----|
| Extract | Get Text from PDF + first item only | Get Text from PDF + join all pages |
| Prep | Cloud model prompt (unreliable) | Same `optimizePlainTextForSpeech` logic as the app |
| Speak | Make Spoken Audio | Make Spoken Audio |
| Output | Quick Look | Quick Look |

The optimizer rejoins soft-wrapped PDF lines, expands abbreviations, speaks
currency/percents, strips citation artifacts, and adds audible punctuation.

## Sign locally (required)

The committed `.shortcut` is **unsigned**. On a Mac:

```bash
shortcuts sign --mode anyone \
  --input "shortcuts/pdf-to-audio/PDF to Audio.shortcut" \
  --output "~/Downloads/PDF to Audio.shortcut"
```

Then open the signed file to import it into Shortcuts.

## Rebuild after editing the optimizer

Needs [Cherri](https://github.com/electrikmilk/cherri):

```bash
# from repo root, with cherri installed
cd shortcuts/pdf-to-audio
node build.cjs
# or: CHERRI=/path/to/cherri node build.cjs
```

Keep `optimize-for-speech.js` in sync with `app/src/lib/tts-text.ts` when speech
normalization changes. Do not put `#` characters in the JS file (iOS data-URI quirk).
