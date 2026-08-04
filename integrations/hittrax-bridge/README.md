# HitTrax Bridge (NBP Portal #48)

Small Windows console app that connects to the **HitTrax Public Real-time Data
Access** cloud queue and captures the messages HitTrax pushes (Play, Session,
User, …) as raw JSON files.

## Why this exists

HitTrax is not a pull-from-a-server integration like Trackman. Data is pushed
into a per-seat **Azure Service Bus queue** in the HitTrax cloud, and the **only**
supported client is HitTrax's **Windows / C# / .NET Framework** SDK. So a small
always-on Windows process has to drain that queue and forward the data on to
Supabase. This app is that process.

**Right now it is in "spike" mode:** it just proves the connection and writes each
message to `./captured/` so we can see real payloads and build the database
schema to match. A later version will POST each message to the Supabase
`hittrax-ingest` function instead of (or in addition to) writing files.

---

## ⚠️ Security — the license keys are secrets

Your `apiID` / `apiKey` are live per-seat credentials. Do **not** paste them into
source files, commit them, or share them further. This app reads them from
environment variables so they never touch git. Because the keys have already been
sent over email (and chat), it's worth asking HitTrax to **rotate them** once the
bridge is confirmed working.

---

## One-time setup

1. **Install** Visual Studio 2019 or 2022 (Community is fine) with the
   **".NET desktop development"** workload, and the **.NET Framework 4.6.2
   targeting pack** (Individual components → ".NET Framework 4.6.2 targeting pack").
2. **Unzip** the HitTrax SDK (`HitTrax-RealTime-API.zip`).
3. **Copy** `HitTraxPublicRealtimeDataAccessSDK.dll` — and any other `.dll` files
   shipped alongside it in the zip — into this folder's **`lib/`** directory.
   *(The `.csproj` references `lib\HitTraxPublicRealtimeDataAccessSDK.dll`.)*

## Build

From this folder:

```powershell
dotnet build -c Release
```

(or just open `HitTraxBridge.csproj` in Visual Studio and press Build.)

If the build can't find `Microsoft.Azure.ServiceBus`, run `dotnet restore` first —
it's pulled from NuGet automatically by the project file.

## Run the capture

Set the four credentials as environment variables (PowerShell example — values
are the ones HitTrax emailed you):

```powershell
$env:HITTRAX_URL    = "https://api.hittraxbaseball.com/"
$env:HITTRAX_APIID  = "<your apiID>"
$env:HITTRAX_APIKEY = "<your apiKey>"
$env:HITTRAX_SID    = "3637"

dotnet run -c Release
```

or, matching HitTrax's own sample, pass them as arguments:

```powershell
.\bin\Release\net462\HitTraxBridge.exe "https://api.hittraxbaseball.com/" "<apiID>" "<apiKey>" 3637
```

Then **take some swings at the cage** (or replay a recent session on the HitTrax
unit). You should see lines like:

```
[1] Session from unit 1 — 812 bytes
[2] Play from unit 1 — 1543 bytes
...
```

and matching `.json` files appearing in `captured/`.

Press any key to stop.

## Send me the payloads

Zip the `captured/` folder and send it over. Those real Play / Session / User
JSON files are what I use to finalize the Supabase tables, unit conversions
(HitTrax reports metric — m/s, meters — so exit velo → mph, distance → ft), and
the player-mapping logic. **A dozen or so swings across a couple of sessions is
plenty.**

> Tip: if you want to scrub names first, the `User` object holds player names —
> but for building the mapping I actually need to see how HitTrax identifies
> players (UUID / CustomId / first+last), so unscrubbed is more useful. Your call.

---

## What comes next (my side)

Once I have real payloads:

1. Supabase migration: `hittrax_sessions`, `hittrax_plays`, `hittrax_player_map`
   (RLS mirroring the Trackman tables — athlete reads own, staff read all).
2. `hittrax-ingest` edge function (service-role, secured by a shared secret this
   bridge will send).
3. Swap this app's file-writer for the HTTP forwarder + package it to run as a
   Windows Service on the always-on VM.
4. Admin player-mapping UI + `HitTraxTab.js` profile tab (mirrors Trackman).
