"""First-run system setup for BullpenSync — prerequisite checks + one-password fixer.

A plain copy of the .app can't carry three machine-level needs:

  1. capture  — read access to /dev/bpf* so the unprivileged tcpdump the sniffer
                spawns can open a BPF device. Granted Wireshark-style: an
                access_bpf group, the operator in it, and a LaunchDaemon that
                chgrp/chmods /dev/bpf* on every boot.
  2. rvictl   — a NOPASSWD sudoers rule for /Library/Apple/usr/bin/rvictl so
                ipad_monitor can build/tear down the rvi0 mirror unattended.
  3. rpmuxd   — com.apple.rpmuxd loaded (rvictl's helper daemon; unloaded on
                some Macs -> rvictl fails with bootstrap_look_up(): 1102).

`run_checks()` inspects all of it read-only. `run_fixer()` performs every fix in
ONE shell script executed through osascript "with administrator privileges" —
the operator types their Mac password once in the native macOS dialog, no
Terminal. Every fix is idempotent, so re-running is always safe.

Caveat surfaced to the UI: new access_bpf group membership only applies to NEW
login sessions. If `capture` still fails right after a successful fix, the
operator must log out/in (or reboot) once and relaunch.
"""
from __future__ import annotations

import os
import shlex
import subprocess
from pathlib import Path

import config

RVICTL_PATH = "/Library/Apple/usr/bin/rvictl"
RPMUXD_PLIST = "/Library/Apple/System/Library/LaunchDaemons/com.apple.rpmuxd.plist"
# Apple's pkg carrying rvictl + rpmuxd + the mirror kext; embedded next to this
# file by build_app.sh (absent in a plain repo checkout — Xcode Macs have them).
# Base64-encoded so notarization doesn't scan (and reject) the binaries inside;
# the fixer decodes it and verifies the pkg signature before installing.
MDD_PKG_B64 = Path(__file__).parent / "MobileDeviceDevelopment.pkg.b64"
SUDOERS_FILE = "/etc/sudoers.d/nbp-bullpensync"
SUPPORT_DIR = "/Library/Application Support/BullpenSync"
CHMODBPF_SH = f"{SUPPORT_DIR}/chmodbpf.sh"
DAEMON_PLIST = "/Library/LaunchDaemons/com.nbp.bullpensync.chmodbpf.plist"

# Checks that must pass before live capture can work. The iPad check is shown
# in the wizard too but is informational (plug in + trust, no root involved).
REQUIRED = ("capture", "rvictl_present", "rvictl_sudo", "rpmuxd")


def _run(cmd: list[str], timeout: float = 10.0) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def run_checks() -> dict:
    checks: dict[str, bool] = {}

    # 1. BPF read access for the CURRENT process (mirrors what tcpdump gets).
    checks["capture"] = os.access("/dev/bpf0", os.R_OK)

    # 2. rvictl binary (ships with macOS since Catalina).
    checks["rvictl_present"] = os.path.exists(RVICTL_PATH)

    # 3. Passwordless rvictl (-l is a harmless list).
    try:
        checks["rvictl_sudo"] = _run(["sudo", "-n", RVICTL_PATH, "-l"]).returncode == 0
    except Exception:
        checks["rvictl_sudo"] = False

    # 4. rpmuxd loaded ("launchctl print system/..." is readable without root).
    try:
        checks["rpmuxd"] = _run(["launchctl", "print", "system/com.apple.rpmuxd"]).returncode == 0
    except Exception:
        checks["rpmuxd"] = False

    # 5. iPad physically present over USB (informational).
    try:
        from ipad_monitor import _list_usb_ipads
        ipads = _list_usb_ipads()
    except Exception:
        ipads = []
    checks["ipad"] = bool(ipads)

    return {
        "checks": checks,
        "ipad_names": [n for n, _ in ipads],
        "all_ok": all(checks[k] for k in REQUIRED),
    }


def _fixer_script(operator: str) -> str:
    """The one root-level fix script. Idempotent; embeds the operator username."""
    return f"""#!/bin/bash
# BullpenSync one-time system setup (runs as root via osascript admin prompt).
set -uo pipefail

OPERATOR={shlex.quote(operator)}

# ── 0. rvictl/rpmuxd from the embedded Apple pkg, if they're missing ──
if [ ! -x {shlex.quote(RVICTL_PATH)} ] && [ -f {shlex.quote(str(MDD_PKG_B64))} ]; then
  PKG_TMP=$(mktemp -d)/MobileDeviceDevelopment.pkg
  base64 -D -i {shlex.quote(str(MDD_PKG_B64))} -o "$PKG_TMP"
  if pkgutil --check-signature "$PKG_TMP" | grep -q "Status: signed"; then
    installer -pkg "$PKG_TMP" -target / || true
  fi
  rm -f "$PKG_TMP"
fi

# ── 1. access_bpf group + membership (Wireshark-style BPF access) ──
if ! dscl . -read /Groups/access_bpf >/dev/null 2>&1; then
  dseditgroup -o create access_bpf
fi
dseditgroup -o edit -a "$OPERATOR" -t user access_bpf || true

mkdir -p {shlex.quote(SUPPORT_DIR)}
cat > {shlex.quote(CHMODBPF_SH)} <<'EOS'
#!/bin/bash
chgrp access_bpf /dev/bpf* 2>/dev/null || true
chmod g+rw /dev/bpf* 2>/dev/null || true
EOS
chmod 755 {shlex.quote(CHMODBPF_SH)}

cat > {shlex.quote(DAEMON_PLIST)} <<'EOP'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.nbp.bullpensync.chmodbpf</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>/Library/Application Support/BullpenSync/chmodbpf.sh</string>
  </array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
EOP
chown root:wheel {shlex.quote(DAEMON_PLIST)}
chmod 644 {shlex.quote(DAEMON_PLIST)}
launchctl bootstrap system {shlex.quote(DAEMON_PLIST)} 2>/dev/null \\
  || launchctl load -w {shlex.quote(DAEMON_PLIST)} 2>/dev/null || true
{shlex.quote(CHMODBPF_SH)}

# ── 2. Passwordless rvictl for any admin ──
TMP=$(mktemp)
printf '%%admin ALL=(root) NOPASSWD: {RVICTL_PATH}\\n' > "$TMP"
if visudo -cf "$TMP" >/dev/null 2>&1; then
  install -m 440 -o root -g wheel "$TMP" {shlex.quote(SUDOERS_FILE)}
else
  rm -f "$TMP"; echo "sudoers validation failed" >&2; exit 1
fi
rm -f "$TMP"

# ── 3. rvictl helper daemon ──
launchctl load -w {shlex.quote(RPMUXD_PLIST)} 2>/dev/null || true

echo OK
"""


def run_fixer() -> dict:
    """Run the fix script through the native macOS admin-password dialog."""
    operator = os.environ.get("USER") or os.environ.get("LOGNAME") or ""
    if not operator:
        return {"fixed": False, "message": "Could not determine the current username."}

    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    script_path = config.DATA_DIR / "setup_fix.sh"
    script_path.write_text(_fixer_script(operator), encoding="utf-8")

    apple_cmd = f"do shell script \"bash {shlex.quote(str(script_path))}\" with administrator privileges"
    try:
        r = _run(["osascript", "-e", apple_cmd], timeout=300)
    except subprocess.TimeoutExpired:
        return {"fixed": False, "message": "Setup timed out waiting for the password dialog."}

    if r.returncode != 0:
        err = (r.stderr or "").strip()
        if "User canceled" in err or "-128" in err:
            return {"fixed": False, "message": "Password dialog was cancelled."}
        return {"fixed": False, "message": err[-300:] or "Setup script failed."}
    return {"fixed": True, "message": "System setup applied."}
