# NBP BullpenSync

A lightweight macOS companion tool that captures **Trackman B1** pitch data live
during a bullpen and pushes it straight into an athlete's NBP profile.

An admin runs it on their laptop, picks an athlete, clicks **Start Session**, and
watches pitches populate a live table as they're thrown. On **End Session** the
data is saved to a CSV on the laptop and uploaded into NBP's existing
`trackman_sessions` / `trackman_pitches` tables — so it appears in the athlete's
Trackman tab alongside the nightly FTP imports.

## How it works

```
Trackman B1 ──ws──► iPad (Trackman app) ──USB──► Admin Mac
                                                   │
   rvictl → rvi0 (mirror)  ─►  tcpdump + scapy  ─►  WS parser  ─►  session store
                                                   │                 │
                                          live table (browser)   CSV on disk
                                                   │                 │
                                          End Session ──► Supabase (admin JWT, staff RLS)
```

The tool passively **sniffs** the unencrypted WebSocket between the B1 and its
iPad app (same technique as Triton-Vision). It sends nothing to the B1 or iPad.

**Design decisions** (agreed during design):
- **Capture:** B1 + iPad, sniffed via `rvictl` + `tcpdump` + `scapy` (reused from Triton).
- **Stack:** Python + a local FastAPI server + a single-page browser UI. No Electron, no PyQt.
- **Auth:** admin logs in with their **NBP account**; all writes use their JWT under existing staff RLS. No service key on the laptop.
- **Data landing:** existing `trackman_sessions` / `trackman_pitches`, tagged `source='live'`.
- **Athlete:** searched from NBP's `users` (role `player`); sets `pitcher_user_id` directly.
- **Live table:** key metrics on screen (#, Type, Velo, Spin, IVB, HB, Plate H/S); the CSV + DB keep the full field set (+ the raw WS payload in `raw`).
- **Pitch type:** the live B1 stream carries **no** pitch type (Trackman's cloud adds `AutoPitchType` later). So the coach sets a **current pitch type** that auto-tags incoming pitches; if none is selected, a **physics heuristic** (`classifier.py`) guesses. Every row is editable.
- **Upload:** batched at End Session; the CSV is written to disk first, so a failed upload never loses data — failures go to a local retry queue with a "pending upload" badge.

## Requirements

Machine setup is automated: on first launch the UI shows a **one-time Mac setup**
wizard that checks everything below and fixes it with a single click + one Mac
admin password entry (`setup_check.py`, native macOS dialog — no Terminal).

What the wizard manages:
- **Packet capture access** — an `access_bpf` group + a boot-time LaunchDaemon
  that makes `/dev/bpf*` group-readable (Wireshark's ChmodBPF pattern), so the
  sniffer's unprivileged `tcpdump` can open a capture device. Group membership
  applies at next login, so the wizard may ask for one log-out/log-in.
- **Passwordless `rvictl`** — installs `/etc/sudoers.d/nbp-bullpensync`
  (`%admin ALL=(root) NOPASSWD: /Library/Apple/usr/bin/rvictl`, `visudo`-validated).
- **`rpmuxd`** — loads Apple's remote-virtual-interface helper daemon (unloaded
  on some Macs; without it `rvictl` fails with `bootstrap_look_up(): 1102`).

Not needed (anymore): Xcode (iPad detection reads the USB registry via `ioreg`)
and Homebrew (the .app bundles its own Python; `run.sh` from a repo checkout
still wants python ≥3.10 on PATH).

`rvictl` + `rpmuxd` are NOT part of stock macOS — they come from Apple's
**MobileDeviceDevelopment.pkg** (installed by Xcode; universal binaries, min
macOS 11). The .app build embeds that pkg and the wizard's Fix button installs
it when missing. Repo checkouts don't carry it — on a no-Xcode Mac, copy the
176 KB pkg from any Xcode Mac
(`/Applications/Xcode.app/Contents/Resources/Packages/MobileDeviceDevelopment.pkg`),
double-click to install, then **Re-check**.

Still manual:
- The iPad running the Trackman app, USB-tethered and **trusted** by this Mac
  (plug in, tap **Trust** on the iPad — per Mac).
- The DB migration `supabase/migrations/20260731_trackman_live_source.sql` applied
  (adds the `source` column). Until it's applied, uploads will fail on the missing column.

### If the mirror wedges

If pitches stop arriving and `rvictl -l` shows the iPad `with interface (null)`,
the tap is wedged: unplug the iPad, wait 5 s, replug (the app rebuilds the
mirror itself). Stubborn cases: remove every entry with `sudo rvictl -x <UDID>`
(repeat until the list is empty), restart the helper with
`sudo launchctl kickstart -k system/com.apple.rpmuxd`, then replug.

## Run

```
cd tools/bullpen-sync
./run.sh
```

First run bootstraps `.venv` and installs deps, then opens
`http://127.0.0.1:8787`. Sign in with your NBP admin/coach account, set your CSV
save folder once, search an athlete, and Start Session.

## Double-clickable app (for admins)

For non-technical admins, package the tool as a standalone `BullpenSync.app` — no
terminal, no repo checkout:

```
./scripts/build_app.sh                    # builds dist/BullpenSync.app
./scripts/build_app.sh --zip              # also makes dist/BullpenSync.zip to share
./scripts/build_app.sh --notarize --zip   # + Apple notarization (the real release)
```

The bundle is **universal**: both Python architectures embedded (the launcher
picks by `uname -m`), plus Apple's `MobileDeviceDevelopment.pkg` so the wizard
can install `rvictl` itself. Signing uses the first "Developer ID Application"
identity in the Keychain (override: `BULLPEN_SIGN_ID`); `--notarize` needs a
one-time `xcrun notarytool store-credentials nbp-notary --apple-id <id> --team-id <team>`
(profile name override: `BULLPEN_NOTARY_PROFILE`).

The .app bundles its own standalone CPython 3.11 (astral-sh/python-build-standalone,
downloaded once at build time into `dist/cache`; `BULLPEN_PY_ARCH=x86_64` to
build for Intel). Drop `BullpenSync.app` in `/Applications` (or anywhere).
Double-clicking it bootstraps a private venv under
`~/Library/Application Support/BullpenSync` on first run, starts the local
server, and opens the UI in the browser. A **Quit** button in the UI stops it
cleanly.

Install on a new Mac, in full:
1. Copy `BullpenSync.zip` over, unzip, drop the app in `/Applications`.
2. **Notarized build** (`--notarize`): double-click, confirm the standard
   "downloaded from the internet" prompt. Done — no other Gatekeeper steps on
   any macOS version.

   **Un-notarized build**: Gatekeeper blocks the first launch, and the escape
   depends on the macOS version — macOS 14 or earlier: right-click → **Open** →
   **Open**; macOS 15+: double-click, **Done**, then **System Settings →
   Privacy & Security** → **Open Anyway**. If macOS instead calls the app
   "damaged" (quarantined + signed-but-not-notarized — no Open escape on that
   dialog): `xattr -cr /Applications/BullpenSync.app` in Terminal, or carry the
   unzipped app over on a USB drive so quarantine never attaches.
3. In the setup wizard that appears, click **Fix permissions…** and enter the
   Mac admin password. Log out/in once if the wizard asks.
4. Plug in the iPad, tap **Trust**, sign in with an NBP staff account.

To fully remove the Gatekeeper step, notarize with a Developer ID cert (swap
the `-` identity in `build_app.sh`) — the same pending step as Triton-Vision's
distribution.

### Demo / dev without hardware

Replay a recorded WebSocket capture (e.g. one of Triton's fixtures) — no iPad,
no root, no tcpdump:

```
BULLPEN_REPLAY_JSONL=../../../Triton-Vision/tests/fixtures/sessions/canned_3p/trackman_ws.jsonl ./run.sh
```

## Files

| File | Role |
|------|------|
| `app.py` | FastAPI server: routes, websocket fan-out, wiring |
| `sniffer.py` | B1 WS sniffer (ported from Triton, callback-based) |
| `ipad_monitor.py` | iPad detect + `rvictl` lifecycle (ported from Triton) |
| `mapper.py` | B1 WS Measurement → NBP `trackman_pitches` columns + units |
| `classifier.py` | Physics-heuristic pitch-type fallback |
| `session.py` | Live session state: frames → typed rows → CSV |
| `csv_writer.py` | Crash-safe CSV (atomic rewrite per pitch) |
| `nbp_client.py` | Supabase auth + insert + upload retry queue |
| `setup_check.py` | First-run system checks + one-password admin fixer |
| `config.py` | Supabase public config + local settings |
| `static/index.html` | The single-page UI |

## Notes / limits

- The **heuristic classifier is an approximation** and doesn't know pitcher
  handedness reliably from the stream — prefer the coach's current-pitch buttons
  for accurate labels. Rows stay editable regardless.
- Sniffing depends on the B1↔iPad link being **unencrypted** (`ws://`). If
  Trackman ever moves it to TLS, live capture stops working.
- `mapper.py` field names were verified against Triton's real capture fixtures.
  Validate once against a live NBP B1 before relying on it in production.
