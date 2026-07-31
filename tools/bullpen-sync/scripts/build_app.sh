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
# Requires: macOS. The TARGET Mac needs Homebrew python@3.11 (brew install
# python@3.11) — the launcher checks and prompts if it's missing.
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
SUPPORT="$HOME/Library/Application Support/BullpenSync"
VENV="$SUPPORT/venv"
PY="$VENV/bin/python"
PORT="${BULLPEN_PORT:-8787}"
URL="http://127.0.0.1:${PORT}/"
LOG="$SUPPORT/server.log"
mkdir -p "$SUPPORT"

notify() { /usr/bin/osascript -e "display notification \"$1\" with title \"BullpenSync\"" >/dev/null 2>&1 || true; }
alert()  { /usr/bin/osascript -e "display dialog \"$1\" with title \"BullpenSync\" buttons {\"OK\"} default button 1 with icon caution" >/dev/null 2>&1 || true; }

# Already running? Just bring the UI forward.
if /usr/bin/curl -sf "http://127.0.0.1:${PORT}/api/settings" >/dev/null 2>&1; then
  /usr/bin/open "$URL"; exit 0
fi

pick_base() {
  for c in /opt/homebrew/bin/python3.11 /opt/homebrew/bin/python3 \
           /usr/local/bin/python3.11 /usr/local/bin/python3 python3; do
    if command -v "$c" >/dev/null 2>&1 && \
       "$c" -c 'import sys;assert sys.version_info[:2]>=(3,10)' >/dev/null 2>&1; then
      command -v "$c"; return 0
    fi
  done
  return 1
}

if [ ! -x "$PY" ]; then
  notify "First-time setup — this can take a minute…"
  BASE="$(pick_base)" || { alert "Python 3.10+ is required. Install it with Homebrew:  brew install python@3.11"; exit 1; }
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
# first launch still needs right-click -> Open (documented in the README). Swap
# the '-' identity for a Developer ID to notarize later.
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || echo "   (codesign skipped)"

echo "==> Built: $APP"

if [ "${1:-}" = "--zip" ]; then
  ZIP="$DIST/BullpenSync.zip"
  echo "==> Zipping to $ZIP"
  ( cd "$DIST" && /usr/bin/ditto -c -k --keepParent "BullpenSync.app" "BullpenSync.zip" )
  echo "==> Shareable: $ZIP"
fi

echo "Done. Double-click $APP (first time: right-click -> Open to clear Gatekeeper)."
