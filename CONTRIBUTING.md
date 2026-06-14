# Contributing

## Desktop Development

Build a local production app bundle:

```bash
cd app
bun install
bun run build:tauri
```

## Releases

Create a release build with the project release helper:

```bash
cd app
bun run release:tauri
```

The release helper creates Tauri updater artifacts and signs them with the
Tauri updater key. This is separate from Apple code signing. Keep the private
updater key outside the repository and provide it with
`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PATH`, or generate the
default local key:

```bash
cd app
bunx tauri signer generate -w ~/.tauri/kokoro-updater.key
```

On macOS, the release helper lets Tauri handle Apple code signing during the
build. It automatically uses `KOKORO_CODESIGN_IDENTITY`,
`APPLE_SIGNING_IDENTITY`, an `APPLE_CERTIFICATE` CI setup, or the first valid
keychain code-signing identity it finds. To force a specific identity:

```bash
cd app
KOKORO_CODESIGN_IDENTITY="Apple Development: Your Name (TEAMID)" bun run release:tauri
```

To build unsigned:

```bash
cd app
bun run release:tauri -- --no-codesign
```
