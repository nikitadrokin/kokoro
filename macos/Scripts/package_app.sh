#!/usr/bin/env bash
set -euo pipefail

CONF=${1:-release}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
REPO_ROOT=$(cd "$ROOT/.." && pwd)
cd "$ROOT"

APP_NAME="Kokoro"
BUNDLE_ID="me.nkdr.kokoro"
MACOS_MIN_VERSION="14.0"
SIGNING_MODE=${SIGNING_MODE:-}
APP_IDENTITY=${APP_IDENTITY:-}

if [[ -f "$ROOT/version.env" ]]; then
  source "$ROOT/version.env"
else
  MARKETING_VERSION="0.0.1"
  BUILD_NUMBER="1"
fi

ARCH_LIST=( ${ARCHES:-} )
if [[ ${#ARCH_LIST[@]} -eq 0 ]]; then
  HOST_ARCH=$(uname -m)
  ARCH_LIST=("$HOST_ARCH")
fi

for ARCH in "${ARCH_LIST[@]}"; do
  swift build -c "$CONF" --arch "$ARCH"
done

APP="$ROOT/${APP_NAME}.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$APP/Contents/Frameworks"

BUILD_TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key><string>${APP_NAME}</string>
    <key>CFBundleDisplayName</key><string>${APP_NAME}</string>
    <key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
    <key>CFBundleExecutable</key><string>${APP_NAME}</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>${MARKETING_VERSION}</string>
    <key>CFBundleVersion</key><string>${BUILD_NUMBER}</string>
    <key>LSMinimumSystemVersion</key><string>${MACOS_MIN_VERSION}</string>
    <key>NSHighResolutionCapable</key><true/>
    <key>CFBundleIconFile</key><string>Icon</string>
    <key>BuildTimestamp</key><string>${BUILD_TIMESTAMP}</string>
    <key>GitCommit</key><string>${GIT_COMMIT}</string>
</dict>
</plist>
PLIST

build_product_path() {
  local name="$1" arch="$2"
  case "$arch" in
    arm64|x86_64) echo ".build/${arch}-apple-macosx/$CONF/$name" ;;
    *) echo ".build/$CONF/$name" ;;
  esac
}

install_binary() {
  local name="$1" dest="$2"
  local binaries=()
  for arch in "${ARCH_LIST[@]}"; do
    local src; src=$(build_product_path "$name" "$arch")
    [[ -f "$src" ]] || { echo "ERROR: Missing ${name} for ${arch} at ${src}" >&2; exit 1; }
    binaries+=("$src")
  done
  if [[ ${#ARCH_LIST[@]} -gt 1 ]]; then
    lipo -create "${binaries[@]}" -output "$dest"
  else
    cp "${binaries[0]}" "$dest"
  fi
  chmod +x "$dest"
}

install_binary "$APP_NAME" "$APP/Contents/MacOS/$APP_NAME"

# --- koko sidecar binary ---
HOST_ARCH=$(uname -m)
KOKO_ARCH="${HOST_ARCH}"
[[ "$HOST_ARCH" == "arm64" ]] && KOKO_ARCH="aarch64"
KOKO_SRC="$REPO_ROOT/app/src-tauri/binaries/koko-${KOKO_ARCH}-apple-darwin"
if [[ -f "$KOKO_SRC" ]]; then
  cp "$KOKO_SRC" "$APP/Contents/MacOS/koko"
  chmod +x "$APP/Contents/MacOS/koko"
  echo "Bundled koko from $KOKO_SRC"
else
  echo "WARN: koko binary not found at $KOKO_SRC — app will not synthesize audio" >&2
fi

# --- model files ---
MODEL_SRC="$REPO_ROOT/checkpoints/kokoro-v1.0.onnx"
VOICES_SRC="$REPO_ROOT/data/voices-v1.0.bin"
if [[ -f "$MODEL_SRC" ]]; then
  cp "$MODEL_SRC" "$APP/Contents/Resources/kokoro-v1.0.onnx"
  echo "Bundled model"
else
  echo "WARN: model not found at $MODEL_SRC" >&2
fi
if [[ -f "$VOICES_SRC" ]]; then
  cp "$VOICES_SRC" "$APP/Contents/Resources/voices-v1.0.bin"
  echo "Bundled voices"
else
  echo "WARN: voices not found at $VOICES_SRC" >&2
fi

# --- app icon (if present) ---
ICON_SOURCE="$ROOT/Icon.icon"
ICON_TARGET="$ROOT/Icon.icns"
if [[ -f "$ICON_SOURCE" ]]; then
  iconutil --convert icns --output "$ICON_TARGET" "$ICON_SOURCE"
fi
if [[ -f "$ICON_TARGET" ]]; then
  cp "$ICON_TARGET" "$APP/Contents/Resources/Icon.icns"
fi

chmod -R u+w "$APP"
xattr -cr "$APP"
find "$APP" -name '._*' -delete

ENTITLEMENTS_DIR="$ROOT/.build/entitlements"
mkdir -p "$ENTITLEMENTS_DIR"
APP_ENTITLEMENTS="$ENTITLEMENTS_DIR/${APP_NAME}.entitlements"

if [[ ! -f "$APP_ENTITLEMENTS" ]]; then
  cat > "$APP_ENTITLEMENTS" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
</dict>
</plist>
PLIST
fi

if [[ "$SIGNING_MODE" == "adhoc" || -z "$APP_IDENTITY" ]]; then
  CODESIGN_ARGS=(--force --sign "-")
else
  CODESIGN_ARGS=(--force --timestamp --options runtime --sign "$APP_IDENTITY")
fi

# Sign koko separately before the app bundle
if [[ -f "$APP/Contents/MacOS/koko" ]]; then
  codesign "${CODESIGN_ARGS[@]}" "$APP/Contents/MacOS/koko"
fi

codesign "${CODESIGN_ARGS[@]}" \
  --entitlements "$APP_ENTITLEMENTS" \
  "$APP"

echo "Created $APP"
