# Kokoro Roadmap

This roadmap focuses on changes that fit the current desktop app: a local speech playground with saved WAV files, a Tauri sidecar, and a React UI.

## Recommended Next Move: Timestamped Playback

Expose the timestamp support that already exists in the Tauri command layer.

The backend response already includes:

- `timestamps`
- `savedTimestampsPath`
- `sampleRate`

The UI currently sends `timestamps: false`, so users cannot see word-level timing even though the sidecar path is wired.

### User-Facing Shape

- Add a "Word timings" toggle near the existing "Save WAV to disk" switch.
- When enabled, request timestamps during generation.
- Render a compact transcript panel under the audio player.
- Highlight the active word while playback advances.
- Let users click a word to seek the audio to that word's start time.
- For saved audio, show when a timestamp sidecar exists and load it with the WAV.

### Implementation Notes

- Keep timestamp state separate from the text input state so replaying saved audio does not mutate the current script.
- Use the existing `audioRef` and `timeupdate` events to drive the active word index.
- Build an indexed lookup for the active timestamp instead of scanning the full list on every render.
- Add a Tauri command for loading a saved `.tsv` sidecar by WAV path if saved audio transcript playback is included.
- Keep the transcript view lightweight: a bordered panel, wrapping word buttons, and current-word styling using existing `primary`, `muted`, and `border` tokens.

### Acceptance Criteria

- Generating with word timings enabled returns and displays timestamp rows.
- Audio playback highlights the current word.
- Clicking a word seeks playback to its timestamp.
- Deleting a saved WAV still deletes the matching timestamp file.
- `bun run typecheck`, targeted Biome checks, and the relevant Rust checks pass.

## Short-Term Improvements

### Custom Audio Player Polish

- Keep the player as a separate component.
- Use the shared `Slider` component for scrubbing.
- Support keyboard-accessible play, restart, mute, and seek behavior.
- Avoid decorative waveform UI; keep it predictable and native-feeling.

### Saved Audio Details

- Add an active saved-file state that clearly ties the player to the selected file.
- Show saved timestamp availability.
- Add "Reveal in Finder" or "Open containing folder" for generated files.
- Consider rename support for saved clips.

### Voice Controls

- Expand the hard-coded voice list or load available voices from the sidecar.
- Add speed control with a small slider or stepper.
- Consider initial silence and mono output as advanced controls.

## Medium-Term Improvements

### Generation Queue

- Let users queue multiple scripts or paragraphs.
- Show per-item status: queued, generating, ready, failed.
- Preserve generated outputs in the saved audio list.

### Better Long-Text Workflow

- Split long text into chunks before synthesis.
- Preview chunk boundaries.
- Generate one combined output or separate chapter/section files.

### App Documentation Cleanup

- Replace `app/README.md`, which still reads like a starter template.
- Document `dev:tauri`, sidecar builds, model paths, and release scripts.
- Add troubleshooting for missing model files and sidecar failures.

## Quality Bar

- Keep UI additions consistent with the existing card, button, switch, select, and slider primitives.
- Prefer small components over expanding `routes/index.tsx`.
- Do not add new state libraries unless the feature outgrows local component state.
- Keep Tauri filesystem access constrained to the saved audio directory.
- Add focused tests for pure helpers, parsing, timestamp indexing, and formatting logic.
