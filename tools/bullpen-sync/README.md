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

- macOS with **Homebrew python@3.11** (`brew install python@3.11`).
- A **passwordless `rvictl`** so the tool can mirror the iPad without a prompt:
  ```
  sudo visudo
  <your-user> ALL=(root) NOPASSWD: /Library/Apple/usr/bin/rvictl
  ```
- The iPad running the Trackman app, USB-tethered and **trusted** by this Mac.
- The DB migration `supabase/migrations/20260731_trackman_live_source.sql` applied
  (adds the `source` column). Until it's applied, uploads will fail on the missing column.

## Run

```
cd tools/bullpen-sync
./run.sh
```

First run bootstraps `.venv` and installs deps, then opens
`http://127.0.0.1:8787`. Sign in with your NBP admin/coach account, set your CSV
save folder once, search an athlete, and Start Session.

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
