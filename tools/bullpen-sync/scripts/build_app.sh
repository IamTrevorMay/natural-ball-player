#!/usr/bin/env bash
# Package BullpenSync into a self-contained, double-clickable BullpenSync.app.
#
# The .app bundles the Python source under Contents/Resources. On first launch it
# builds a venv in ~/Library/Application Support/BullpenSync (outside the bundle,
# so the app itself stays read-only / signable), installs deps, starts the local
# server, and opens the UI in the browser. Subsequent launches just reopen it.
#
#   ./scripts/build_app.sh                    # build dist/BullpenSync.app
#   ./scripts/build_app.sh --zip              # also produce dist/BullpenSync.zip
#   ./scripts/build_app.sh --notarize --zip   # sign + notarize + staple + zip
#
# One UNIVERSAL bundle: both Python arches embedded (launcher picks by uname -m)
# plus Apple's MobileDeviceDevelopment.pkg for the wizard to install.
# Requires: macOS + network (build machine only — downloads standalone CPython
# into the bundle, cached under dist/cache; pkg copied from local Xcode). The
# TARGET Mac needs nothing preinstalled: the setup wizard handles the rest.
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

# ── Bundle standalone Pythons (BOTH arches) so one zip covers every Mac. ──
# Downloads astral-sh/python-build-standalone (install_only, CPython 3.11) once
# per arch into dist/cache; the launcher picks python-arm64/ or python-x86_64/
# by `uname -m` at runtime.
CACHE="$DIST/cache"
mkdir -p "$CACHE"
for PBS_ARCH in aarch64-apple-darwin x86_64-apple-darwin; do
  TARBALL="$CACHE/cpython-3.11-$PBS_ARCH-install_only.tar.gz"
  if [ ! -f "$TARBALL" ]; then
    echo "==> Downloading standalone CPython 3.11 ($PBS_ARCH)"
    API="https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest"
    # NB: the "+" in the version is percent-encoded (%2B) in download URLs.
    URL="$(curl -fsSL "$API" \
      | grep -o '"browser_download_url": *"[^"]*cpython-3\.11\.[0-9.]*\(%2B\|+\)[0-9]*-'"$PBS_ARCH"'-install_only\.tar\.gz"' \
      | head -1 | sed 's/.*"\(https[^"]*\)"/\1/')"
    [ -n "$URL" ] || { echo "error: could not resolve python-build-standalone download URL" >&2; exit 1; }
    curl -fL -sS -o "$TARBALL" "$URL"
  fi
  case "$PBS_ARCH" in
    aarch64-*) PYDIR="python-arm64" ;;
    *)         PYDIR="python-x86_64" ;;
  esac
  echo "==> Unpacking bundled Python -> Resources/$PYDIR"
  mkdir -p "$CONTENTS/Resources/$PYDIR"
  tar -xzf "$TARBALL" -C "$CONTENTS/Resources/$PYDIR" --strip-components 1
done

# ── Embed Apple's MobileDeviceDevelopment.pkg (rvictl + rpmuxd + kext) so the
# setup wizard's Fix button can install it on Macs that never had Xcode.
# Stored BASE64-ENCODED: the notary service unpacks a raw .pkg and rejects
# Apple's own binaries inside it ("executable does not have the hardened
# runtime enabled") — binaries we cannot re-sign. As text it passes the scan;
# the fixer decodes the byte-identical, still Apple-signed pkg at install time. ──
MDD_PKG="/Applications/Xcode.app/Contents/Resources/Packages/MobileDeviceDevelopment.pkg"
if [ -f "$MDD_PKG" ]; then
  echo "==> Embedding MobileDeviceDevelopment.pkg (base64)"
  base64 -i "$MDD_PKG" -o "$CONTENTS/Resources/bullpen-sync/MobileDeviceDevelopment.pkg.b64"
else
  echo "   WARNING: $MDD_PKG not found (no Xcode on build Mac?) — wizard can't auto-install rvictl" >&2
fi

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
  # Bundled standalone Python for this machine's arch first; Homebrew/system
  # only as fallback.
  case "$(uname -m)" in
    arm64) PYDIR="python-arm64" ;;
    *)     PYDIR="python-x86_64" ;;
  esac
  for c in "$RES/../$PYDIR/bin/python3.11" \
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

# ── Signing & notarization ──
# With a Developer ID identity in the Keychain (auto-detected; override with
# BULLPEN_SIGN_ID) every Mach-O in the bundle gets hardened-runtime + timestamp
# signing, and --notarize submits to Apple (keychain profile
# BULLPEN_NOTARY_PROFILE, default nbp-notary; create it once with
# `xcrun notarytool store-credentials`) and staples the ticket — after which
# every Mac opens the app with a plain double-click. Without an identity the
# bundle is ad-hoc signed; a quarantined ad-hoc app shows as "damaged" on other
# Macs (escape: xattr -cr, or carry it over on USB so quarantine never attaches).
SIGN_ID="${BULLPEN_SIGN_ID:-$(security find-identity -v -p codesigning 2>/dev/null \
  | grep -o '"Developer ID Application: [^"]*"' | head -1 | tr -d '"')}"
NOTARIZE=0
for a in "$@"; do [ "$a" = "--notarize" ] && NOTARIZE=1; done

ENTITLEMENTS="$DIST/entitlements.plist"
cat > "$ENTITLEMENTS" <<'ENT'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <!-- The bundled interpreter loads pip-installed (unsigned) C extensions. -->
  <key>com.apple.security.cs.disable-library-validation</key><true/>
</dict>
</plist>
ENT

if [ -n "$SIGN_ID" ]; then
  echo "==> Signing with: $SIGN_ID"
  # Inside-out: every dylib/.so first, then the interpreters, then the bundle.
  find "$CONTENTS/Resources" -type f \( -name "*.dylib" -o -name "*.so" \) -print0 \
    | xargs -0 codesign --force --timestamp --options runtime --sign "$SIGN_ID"
  find "$CONTENTS/Resources"/python-*/bin -type f -perm +111 -print0 \
    | xargs -0 codesign --force --timestamp --options runtime \
        --entitlements "$ENTITLEMENTS" --sign "$SIGN_ID"
  codesign --force --timestamp --options runtime \
    --entitlements "$ENTITLEMENTS" --sign "$SIGN_ID" "$APP"
else
  echo "==> No Developer ID found — ad-hoc signing (see README for Gatekeeper caveats)"
  codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
fi

if [ "$NOTARIZE" = 1 ]; then
  [ -n "$SIGN_ID" ] || { echo "error: --notarize needs a Developer ID identity" >&2; exit 1; }
  PROFILE="${BULLPEN_NOTARY_PROFILE:-nbp-notary}"
  NZIP="$DIST/notarize-upload.zip"
  echo "==> Notarizing (profile: $PROFILE) — usually a few minutes"
  ( cd "$DIST" && /usr/bin/ditto -c -k --sequesterRsrc --keepParent "BullpenSync.app" "$NZIP" )
  xcrun notarytool submit "$NZIP" --keychain-profile "$PROFILE" --wait
  rm -f "$NZIP"
  echo "==> Stapling ticket"
  xcrun stapler staple "$APP"
fi

echo "==> Built: $APP"

for a in "$@"; do
  if [ "$a" = "--zip" ]; then
    ZIP="$DIST/BullpenSync.zip"
    echo "==> Zipping to $ZIP"
    ( cd "$DIST" && /usr/bin/ditto -c -k --sequesterRsrc --keepParent "BullpenSync.app" "BullpenSync.zip" )
    echo "==> Shareable: $ZIP"
  fi
done

echo "Done."
