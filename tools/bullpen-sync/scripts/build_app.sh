#!/usr/bin/env bash
# Package BullpenSync into a self-contained, double-clickable BullpenSync.app.
#
# The .app bundles the Python source under Contents/Resources. On first launch it
# builds a venv in ~/Library/Application Support/BullpenSync (outside the bundle,
# so the app itself stays read-only / signable), installs deps, starts the local
# server, and opens the UI in the browser. Subsequent launches just reopen it.
#
#   ./scripts/build_app.sh            # build dist/BullpenSync.app
#   ./scripts/build_app.sh --zip      # also produce dist/BullpenSync.zip to share
#
# Requires: macOS + network (build machine only — downloads a standalone
# CPython into the bundle, cached under dist/cache). The TARGET Mac needs
# nothing preinstalled: the in-app setup wizard handles system permissions.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/dist"
APP="$DIST/BullpenSync.app"
CONTENTS="$APP/Contents"
VERSION="1.0.0"

echo "==> Cleaning $APP"
rm -rf "$APP"
mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources/bullpen-sync"

echo "==> Copying source into the bundle"
rsync -a --delete \
  --exclude ".venv" --exclude "__pycache__" --exclude "dist" \
  --exclude "*.pyc" --exclude ".gitignore" \
  "$ROOT/app.py" "$ROOT"/*.py "$ROOT/requirements.txt" "$ROOT/static" \
  "$CONTENTS/Resources/bullpen-sync/"

# ── Bundle a standalone Python so the target Mac needs no Homebrew/Xcode. ──
# Downloads astral-sh/python-build-standalone (install_only, CPython 3.11) once
# into dist/cache and unpacks it at Contents/Resources/python. Arch defaults to
# the build machine's; override with BULLPEN_PY_ARCH=x86_64 for Intel targets.
ARCH="${BULLPEN_PY_ARCH:-$(uname -m)}"
case "$ARCH" in
  arm64|aarch64) PBS_ARCH="aarch64-apple-darwin" ;;
  x86_64)        PBS_ARCH="x86_64-apple-darwin" ;;
  *) echo "error: unsupported arch $ARCH" >&2; exit 1 ;;
esac
CACHE="$DIST/cache"
TARBALL="$CACHE/cpython-3.11-$PBS_ARCH-install_only.tar.gz"
mkdir -p "$CACHE"
if [ ! -f "$TARBALL" ]; then
  echo "==> Downloading standalone CPython 3.11 ($PBS_ARCH)"
  API="https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest"
  # NB: the "+" in the version is percent-encoded (%2B) in download URLs.
  URL="$(curl -fsSL "$API" \
    | grep -o '"browser_download_url": *"[^"]*cpython-3\.11\.[0-9.]*\(%2B\|+\)[0-9]*-'"$PBS_ARCH"'-install_only\.tar\.gz"' \
    | head -1 | sed 's/.*"\(https[^"]*\)"/\1/')"
  [ -n "$URL" ] || { echo "error: could not resolve python-build-standalone download URL" >&2; exit 1; }
  curl -fL --progress-bar -o "$TARBALL" "$URL"
fi
echo "==> Unpacking bundled Python"
mkdir -p "$CONTENTS/Resources/python"
tar -xzf "$TARBALL" -C "$CONTENTS/Resources/python" --strip-components 1

echo "==> Writing Info.plist"
cat > "$CONTENTS/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>BullpenSync</string>
  <key>CFBundleDisplayName</key><string>NBP BullpenSync</string>
  <key>CFBundleIdentifier</key><string>com.naturalballplayer.bullpensync</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>BullpenSync</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <!-- Server + browser UI; no native window of its own. -->
  <key>LSBackgroundOnly</key><false/>
</dict>
</plist>
PLIST

echo "==> Writing launcher"
cat > "$CONTENTS/MacOS/BullpenSync" <<'LAUNCH'
#!/bin/bash
# BullpenSync .app launcher — bootstraps a venv, runs the server, opens the UI.
set -uo pipefail

RES="$(cd "$(dirname "$0")/../Resources/bullpen-sync" && pwd)"
APP_ROOT="$(cd "$RES/../../.." && pwd)"
SUPPORT="$HOME/Library/Application Support/BullpenSync"
VENV="$SUPPORT/venv"
PY="$VENV/bin/python"
PORT="${BULLPEN_PORT:-8787}"
URL="http://127.0.0.1:${PORT}/"
LOG="$SUPPORT/server.log"
mkdir -p "$SUPPORT"

# Clear quarantine on the bundle contents so the bundled python (and its dylibs)
# run cleanly after the user clears Gatekeeper once (Privacy & Security ->
# Open Anyway; modern macOS removed the right-click -> Open bypass).
/usr/bin/xattr -dr com.apple.quarantine "$APP_ROOT" >/dev/null 2>&1 || true

notify() { /usr/bin/osascript -e "display notification \"$1\" with title \"BullpenSync\"" >/dev/null 2>&1 || true; }
alert()  { /usr/bin/osascript -e "display dialog \"$1\" with title \"BullpenSync\" buttons {\"OK\"} default button 1 with icon caution" >/dev/null 2>&1 || true; }

# Already running? Just bring the UI forward.
if /usr/bin/curl -sf "http://127.0.0.1:${PORT}/api/settings" >/dev/null 2>&1; then
  /usr/bin/open "$URL"; exit 0
fi

pick_base() {
  # Bundled standalone Python first; Homebrew/system only as fallback.
  for c in "$RES/../python/bin/python3.11" \
           /opt/homebrew/bin/python3.11 /opt/homebrew/bin/python3 \
           /usr/local/bin/python3.11 /usr/local/bin/python3 python3; do
    if command -v "$c" >/dev/null 2>&1 && \
       "$c" -c 'import sys;assert sys.version_info[:2]>=(3,10)' >/dev/null 2>&1; then
      command -v "$c"; return 0
    fi
  done
  return 1
}

# The venv hardcodes the base interpreter's path — rebuild it if it went stale
# (e.g. the .app was moved after first launch).
if [ -x "$PY" ] && ! "$PY" -c 1 >/dev/null 2>&1; then
  rm -rf "$VENV"
fi

if [ ! -x "$PY" ]; then
  notify "First-time setup — this can take a minute…"
  BASE="$(pick_base)" || { alert "No usable Python found in the app bundle. Re-download BullpenSync."; exit 1; }
  "$BASE" -m venv "$VENV" || { alert "Could not create the Python environment. See $LOG"; exit 1; }
  "$PY" -m pip install --quiet --upgrade pip >>"$LOG" 2>&1
  if ! "$PY" -m pip install --quiet -r "$RES/requirements.txt" >>"$LOG" 2>&1; then
    alert "Dependency install failed. See $LOG"; exit 1
  fi
  notify "Setup complete — starting…"
fi

# Open the browser once the server is answering.
( for _ in $(seq 1 80); do
    if /usr/bin/curl -sf "http://127.0.0.1:${PORT}/api/settings" >/dev/null 2>&1; then
      /usr/bin/open "$URL"; break
    fi
    sleep 0.25
  done ) &

cd "$RES"
exec "$PY" app.py >>"$LOG" 2>&1
LAUNCH
chmod +x "$CONTENTS/MacOS/BullpenSync"

echo "==> Ad-hoc code-signing"
# Ad-hoc signature so the bundle has a stable identity. It is NOT notarized, so
# first launch still needs Privacy & Security -> Open Anyway (see README). Swap
# the '-' identity for a Developer ID to notarize later.
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || echo "   (codesign skipped)"

echo "==> Built: $APP"

if [ "${1:-}" = "--zip" ]; then
  ZIP="$DIST/BullpenSync.zip"
  echo "==> Zipping to $ZIP"
  ( cd "$DIST" && /usr/bin/ditto -c -k --keepParent "BullpenSync.app" "BullpenSync.zip" )
  echo "==> Shareable: $ZIP"
fi

echo "Done. First launch on a Mac: double-click $APP, then System Settings -> Privacy & Security -> Open Anyway."
