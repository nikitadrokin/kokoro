<div align="center">

<img src="app/src-tauri/icons/icon.png" alt="Kokoro app icon" width="96" height="96">

# Kokoro

Local Kokoro text-to-speech in a desktop playground, backed by a fast Rust sidecar.

[![Release](https://img.shields.io/github/v/release/nikitadrokin/kokoros?sort=semver)](https://github.com/nikitadrokin/kokoros/releases)
[![Tauri](https://img.shields.io/badge/Tauri-2.x-24c8db)](https://tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-2024-f46623)](https://www.rust-lang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb)](https://react.dev/)

</div>

Kokoro wraps the Kokoro ONNX text-to-speech model in two ways:

- A Tauri desktop app for writing text, choosing a voice, generating speech, and previewing the output immediately.
- A Rust CLI and library workspace for batch generation, streaming, word-level timestamp sidecars, and an OpenAI-compatible local speech endpoint.

The model runs locally. Downloaded model files live outside git in `checkpoints/` and `data/`.

## Features

- Local speech synthesis with the Kokoro v1.0 ONNX model.
- Desktop audio playground built with Tauri, React, TanStack Router, and Tailwind CSS.
- Rust `koko` sidecar built automatically for the desktop app.
- CLI text and file modes for WAV generation.
- Optional word-level timestamp TSV output.
- OpenAI-compatible `/v1/audio/speech` server mode.
- Streaming support for low-latency audio workflows.

## Quick Start

Install the basic toolchain first:

- [Bun](https://bun.sh/) for the desktop app frontend and scripts.
- [Rust](https://rustup.rs/) for the `koko` binary and Tauri sidecar.
- System audio dependencies for the Rust workspace.

On macOS:

```bash
brew install pkg-config opus
```

On Ubuntu or Debian:

```bash
sudo apt-get install pkg-config libopus-dev
```

Download the model and voices into the repository root:

```bash
mkdir -p checkpoints data

curl -L \
  "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx" \
  -o checkpoints/kokoro-v1.0.onnx

curl -L \
  "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin" \
  -o data/voices-v1.0.bin
```

Run the desktop app:

```bash
cd app
bun install
bun run dev:tauri
```

`dev:tauri` builds the Rust `koko` sidecar, copies it into `app/src-tauri/binaries/`, starts the Vite dev server, and launches the Tauri shell.

## CLI Usage

You can run the same engine directly from the Rust workspace. From the repository root:

```bash
cargo run --manifest-path cli/Cargo.toml --release -p koko -- \
  --model checkpoints/kokoro-v1.0.onnx \
  --data data/voices-v1.0.bin \
  text "Hello from Kokoro." \
  --output hello.wav
```

Generate timestamp sidecars:

```bash
cargo run --manifest-path cli/Cargo.toml --release -p koko -- \
  --model checkpoints/kokoro-v1.0.onnx \
  --data data/voices-v1.0.bin \
  --timestamps \
  text "Every word gets a timing row." \
  --output timed.wav
```

Start the OpenAI-compatible local server:

```bash
cargo run --manifest-path cli/Cargo.toml --release -p koko -- \
  --model checkpoints/kokoro-v1.0.onnx \
  --data data/voices-v1.0.bin \
  openai --port 3000
```

Then request speech:

```bash
curl -X POST http://localhost:3000/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{
    "model": "tts-1",
    "input": "Hello from the Kokoro speech endpoint.",
    "voice": "af_sky"
  }' \
  --output speech.wav
```

See [cli/README.md](cli/README.md) for the full CLI reference, Docker usage, streaming examples, and benchmark notes.

## Desktop Builds

Build a local production app bundle:

```bash
cd app
bun install
bun run build:tauri
```

Create a release build with the project release helper:

```bash
cd app
bun run release:tauri
```

If macOS blocks the app from opening, you may need to run this command:

```bash
xattr -cr /Applications/Kokoro.app
```

The Tauri bundle includes:

- `models/kokoro-v1.0.onnx`
- `models/voices-v1.0.bin`
- the platform-specific `koko` sidecar binary

## Project Layout

| Path | Purpose |
| --- | --- |
| `app/` | Tauri desktop app, React UI, release scripts, and app bundle config. |
| `app/src-tauri/` | Rust Tauri commands that invoke the `koko` sidecar and return generated WAV data to the UI. |
| `web/` | Standalone Vite landing page for the downloadable macOS app. |
| `cli/koko/` | `koko` command-line binary. |
| `cli/kokoros/` | Rust TTS library and ONNX runtime integration. |
| `cli/kokoros-openai/` | OpenAI-compatible speech API support. |
| `checkpoints/` | Local model files, ignored by git. |
| `data/` | Local voice data files, ignored by git. |

## Development Checks

Frontend checks:

```bash
cd app
bun run typecheck
bun run lint
bun run test
```

Rust checks:

```bash
cargo check --manifest-path cli/Cargo.toml
```

## Notes

- The desktop app currently exposes a focused speech playground rather than every CLI option.
- Model weights and voice data are intentionally not committed.
- If you distribute release builds, make sure the model files you bundle comply with their upstream licenses.

## Acknowledgements

Kokoro builds on the Kokoro TTS model ecosystem and the Rust Kokoro CLI/library work in `cli/`.
