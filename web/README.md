# Kokoro website

The standalone Vite landing page for the Kokoro macOS app.

```bash
bun install
bun run dev
```

Create a production build with `bun run build`. The output is written to
`web/dist/` and contains only static website assets.

## Desktop boundary

This package is independent from `app/` and `cli/`. It does not import Tauri,
the Rust sidecar, model weights, or desktop application routes. Download links
send visitors to the separately published macOS release on GitHub.

The theme in `src/index.css` and the files in `src/components/ui/` are copied
from the desktop app so the two products share the same design language.
