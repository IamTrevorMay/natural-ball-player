#!/usr/bin/env bash
# Launch NBP BullpenSync: bootstraps a local venv, starts the server, opens the UI.
#
#   ./run.sh                 # live capture (needs a tethered iPad + rvictl)
#   BULLPEN_REPLAY_JSONL=/path/to/trackman_ws.jsonl ./run.sh   # replay/demo, no iPad
#
# rvictl needs root. Either add a sudoers NOPASSWD rule (see ipad_monitor.py) or
# run this from a shell with cached sudo creds. Requires Homebrew python@3.11:
#   brew install python@3.11
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$ROOT/.venv"
PY="$VENV/bin/python"
PORT="${BULLPEN_PORT:-8787}"

pick_base() {
  for c in /opt/homebrew/bin/python3.11 /opt/homebrew/bin/python3 python3.11 python3; do
    if command -v "$c" >/dev/null 2>&1 && "$c" -c "import sys;assert sys.version_info[:2]>=(3,10)" >/dev/null 2>&1; then
      command -v "$c"; return 0
    fi
  done
  echo "error: need python >=3.10 (brew install python@3.11)" >&2; return 1
}

if [ ! -x "$PY" ]; then
  echo "==> Creating venv at $VENV"
  BASE="$(pick_base)"
  "$BASE" -m venv "$VENV"
  "$PY" -m pip install --quiet --upgrade pip
  echo "==> Installing dependencies"
  "$PY" -m pip install --quiet -r "$ROOT/requirements.txt"
fi

# Open the UI once the server is up.
( for _ in $(seq 1 40); do
    if curl -sf "http://127.0.0.1:${PORT}/api/settings" >/dev/null 2>&1; then
      open "http://127.0.0.1:${PORT}/"; break
    fi; sleep 0.25
  done ) &

echo "==> BullpenSync on http://127.0.0.1:${PORT}"
exec "$PY" "$ROOT/app.py"
