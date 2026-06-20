# NBP Portal — Planning

## Recently Completed

### Players can add games to schedule (2026)
- #177 — CHECK constraint + defensive nulls

### Program colors aligned (2026)
- #179 — Program colors aligned across all views

### Intern role option restored (2026)
- #182 — Intern role option restored in EditUserModal

### Status badge on user cards (2026)
- #183 — Status badge on user cards in admin settings

### Practice Stats tab (2026)
- #186 — Practice Stats tab on player profiles

### Game Changer tab (2026)
- #187 — Game Changer tab on team pages

### CORS fix (2026)
- #188 — CORS fix for legacy domain

### Cascade communication_logs (2026)
- #184 — Cascade communication_logs on user delete

### Player age in profile (2026)
- #181 — Player age shown in profile header

### Calendar improvements (2026)
- #176 — Show all events per day in month view

### Program library colors (2026)
- #175 — Color-code program library folders by category

### School/coach directory (2026)
- #162 — School/coach contact directory on Recruitment tab

### Player-added games (2026)
- #169 — Players can add own games to schedule

### Mobile layout (2026)
- #173 — Responsive mobile layout for ProgramViewerModal

## Planned

### Near-term
- **#196** — Team roster sort order (coaches on top)
- **#180** — Dom's profile fix (deploy local changes: `ensureProfile` auto-creation + bats/throws display)
- **#190** — Repeating events for games

### Mid-term
- **#185** — Program data backfill script (one-time migration to copy template data into training_exercises)
- **#178** — School directory data import (waiting on CSV from Matteo)
- **#142** — Square payment integration (unlocks #189 facility fines)
- **#48** — HitTrax API integration (needs credentials)
- **#44** — Trackman API integration (needs credentials)

### Long-term
- **#174** — AI-powered athlete programming (auto-generate training plans from assessments + Whoop data)
- **#170** — AI agent for exercise video discovery (auto-populate missing YouTube links)

## Known Issues

| # | Title | Priority | Status | What's Needed |
|---|-------|----------|--------|---------------|
| 196 | Team members formatted incorrectly | High | Not started | Coaches should sort to the top of team roster lists, players below. Fix sort order in `MyTeam.js` roster rendering |
| 178 | Recruitment tab doesn't auto-populate | Medium | Blocked | School directory tables are live but empty. Need Matteo's CSV/spreadsheet of college coach contacts to import |
| 185 | Players programs not showing data | Medium | Partial fix deployed | "Sets/reps not set" placeholder shows on mobile. Root cause: `training_exercises` rows missing sets/reps/load data. Either backfill manually in Coach Tools or write a one-time script to copy from `workout_templates` JSONB |
| 189 | Facility fine document + payment | Medium | Partial | Doc can be uploaded via existing Documents tab. Payment/fining blocked on #142 (Square integration) |
| 190 | Repeating games/events button | Medium | Not started | Add recurring event support for games in the schedule. PlayerAddGameModal and coach event creation need a "repeat" option |
| 180 | Dom's profile not showing correctly | High | Fix ready locally | `ensureProfile` auto-creation + bats/throws display fix in local branch, not yet deployed |
| 174 | AI Programming | Low | Research phase | AI agent that reads assessment results + Whoop data and auto-generates training programs from the existing program vault. Large feature — needs architecture design |
| 170 | AI Agent for video hyperlinks | Low | Research phase | AI agent to find YouTube videos for exercises missing hyperlinks in workout templates and auto-populate the link field |
| 142 | Square & Lesson / Monthly Packages | Medium | Not started | Connect Square payment platform. Build packages/lessons/rentals/subscriptions catalog with purchase flow. Blocks #189 (facility fines) |
| 48 | Hit-Trax API | Medium | Not started | Connect HitTrax API to pull session data into the Hittrax profile tab. Need API credentials and documentation |
| 44 | Trackman Integration | Medium | Not started | Connect Trackman API to pull pitch/hit data into the Trackman profile tab. Need API access and credentials |

## Architecture Notes

- Supabase Auth Redirect URLs — Set Site URL to `https://nbp-portal.vercel.app`, add `https://nbp-portal.vercel.app/**` to Redirect URLs allowlist
- Leaked password protection — Enable in Supabase Dashboard under Authentication > Policies

## Open Risks

- School directory data blocked on external CSV delivery from Matteo
- Square integration (#142) blocks facility fines (#189) — external dependency on payment platform setup
- AI features (#174, #170) are large-scope with no architecture design yet
- Multiple API integrations (#48, #44) blocked on third-party credentials

## Backend Audit — 2026-06-20

Findings from a 4-agent parallel review of `supabase/functions/` and `supabase/migrations/`. Severities follow CRITICAL → HIGH → MED → LOW. Commit `006effc8` ("Backend security + correctness pass") already shipped a prior round; the items below are still present in current code.

### CRITICAL

| # | Location | Bug | Fix |
|---|----------|-----|-----|
| C1 | `supabase/functions/square-webhook/index.ts:30` | HMAC signature compared with `===` — timing-attack vulnerable, attacker can forge Square webhooks and mark fake payments paid | Use `crypto.subtle.timingSafeEqual` (same pattern `whoop-callback` already uses) |
| C2 | `supabase/functions/update-user-email/index.ts:58` | Updates `auth.users.email` only; `public.users.email` stays stale, breaking next sign-in once rows diverge | Update both in the same handler |

### HIGH

| # | Location | Bug |
|---|----------|-----|
| H1 | `update-user-email/index.ts:58` | Email change does not call `auth.admin.signOut(uid, 'all')`; old sessions remain valid after change |
| H2 | `square-webhook/index.ts:99` | Square `payment.order_id` can be null; current query silently matches zero rows so the payment is never marked paid |
| H3 | `create-user/index.ts:66` | Email not lowercased/trimmed before auth create — bypasses orphan-recovery dedup |
| H4 | `signup/index.ts:46` | Same email-normalization gap on public signup; `Test@x` vs `test@x` register as two accounts |
| H5 | `signup/index.ts:28` | No rate limit on the signup endpoint — email enumeration + mass account creation possible |
| H6 | `whoop-callback/index.ts:75` | Legacy state parser splits on `:` but doesn't enforce exactly 2 parts; malformed states slip through |
| H7 | `whoop-callback/index.ts:148` | Error response inlines raw WHOOP API body (`${text}`), leaking third-party payload |
| H8 | `20260524_security_hardening.sql:64,70,76` | `ai_messages` SELECT/INSERT/DELETE policies use inline `EXISTS` into `ai_conversations` (which has RLS). Replace with `is_conversation_participant()` SECURITY DEFINER per the project's RLS rule |

### MED

| # | Location | Bug |
|---|----------|-----|
| M1 | `square-apply-discount/index.ts:164` | Metadata replaced wholesale — loses `idempotency_key` + `payment_link_id` from checkout. Merge with prior |
| M2 | `square-backfill-resolve/index.ts:166` | Update path drops prior metadata on reassignment; audit trail lost |
| M3 | `whoop/index.ts:131` | Suspected inverted comparison sign around `expiresAt - 60_000` boundary. Verify before patching — flag is plausible but easy to misread |
| M4 | `send-email/index.ts:96` | No validation of `recipientEmail` shape/domain — function could be abused as a relay |
| M5 | `20260605_game_changer_contacts.sql:25` | `team_game_changer_contacts` SELECT = `USING (true)`. Parent phone/email visible to every authenticated user, not just teammates. Scope to team membership |
| M6 | `20260606_facility_fine_signatures.sql:20-38` | No UPDATE policy. Re-collecting a signature collides with `UNIQUE(user_id, document_id)`. Add UPDATE or move to a soft-revoke pattern |

### LOW

| # | Location | Bug |
|---|----------|-----|
| L1 | Square handlers (general) | Same metadata-merge omission pattern elsewhere — sweep when M1/M2 are fixed |
| L2 | `whoop/index.ts:293` | `handleSync(userId, targetId)` first param unused — misleading signature |
| L3 | `whoop-callback/index.ts:155` | `refresh_token` is nullable but no guard when access token later expires |
| L4 | `whoop/index.ts:276` | `handleDisconnect` doesn't revoke at WHOOP — token valid until original expiry |
| L5 | `20260603_school_directory.sql:18-36` | Policies missing explicit `TO authenticated` |
| L6 | `20260616_rls_to_authenticated.sql:46-47` | `schools_delete` silently narrowed from admin+coach to admin-only. Confirm intent |
| L7 | `20260605_harden_signatures_storage_policies.sql:19-82` | Storage policies use inline `EXISTS` on `users` instead of SECURITY DEFINER. Safe today but violates project convention |

### Suggested fix order

1. C1, C2 — both 1-line fixes, high blast radius
2. H1, H2 — payment correctness + session invalidation (same PR as C2)
3. H3, H4, H5 — signup hardening, single PR
4. H6, H7 — Whoop callback hardening, single PR
5. H8 — RLS recursion fix in its own migration
6. MED batch as time allows; LOW sweep after

## Client Audit — 2026-06-20

Round-2 sweep across `src/*.js` (53 files, ~36k LOC) by 4 parallel reviewers: role enforcement, XSS / input safety, PII / secret exposure, data integrity / races.

### CRITICAL

| # | Location | Bug | Fix |
|---|----------|-----|-----|
| CC1 | `src/App.js:810` | `<AdminSettings>` rendered with `userRole` prop but the component never gates on it — any authenticated user who triggers `setCurrentView('settings')` (or sets `localStorage.nbp_current_view='settings'`) loads the admin shell | Gate at the call site AND inside `AdminSettings` |
| CC2 | `src/KnowledgeBase.js:333` | `<iframe src={article.video_url}>` renders DB-stored URL directly — anyone able to edit a knowledge article can plant `javascript:` / `data:text/html` for stored XSS against viewers | Validate URL scheme + host (https + YouTube/Vimeo allowlist) before render |

### HIGH

| # | Location | Bug |
|---|----------|-----|
| CH1 | `src/Profile.js:5248` | File upload path concatenates raw `draft.file.name` — attacker can name a file `../../other.pdf`. Supabase Storage likely blocks it server-side but the client shouldn't rely on that | Strip path with regex / `basename` before composing the storage key |
| CH2 | `src/Profile.js:259, 269, 277` | Three `useEffect` data fetches with no `cancelled` flag. Stale-promise writes after dependency changes — trainer/subscription/coach list state can flip back to the prior user's data |
| CH3 | `src/StatusSelect.js:47` | Same `useEffect.then()` race on custom-status fetch when `category` changes mid-flight |

### MED

| # | Location | Bug |
|---|----------|-----|
| CM1 | `src/MyTeam.js:187` | Filters with `.contains('team_ids', [teamId])` only — legacy rows with `team_id` set and `team_ids = null` become invisible. Use `.or('team_id.eq.X,team_ids.cs.{X}')` |
| CM2 | `src/AdminSettings.js:3245` | `mailto:` with full BCC list exposes every unsigned user's email in browser history + referrer. Switch to the `send-email` edge function |
| CM3 | `src/WorkAdminPayroll.js:231` | Unsanitized `file.name` stored in DB and reused for downloads |
| CM4 | `src/WorkAdminDocs.js:80` | Same unsanitized filename pattern |

### LOW

| # | Location | Bug |
|---|----------|-----|
| CL1 | `src/Schedule.js:3823–3865` | Debug `console.log` block dumps auth user object, role, DB error objects (with `.details`, `.hint`, `.code`) to the browser console. Strip |
| CL2 | `src/App.js:244, 368, 587` | `alert('Error: ' + error.message)` pattern — Supabase errors can include column names + RLS policy hints. Same anti-pattern repeats across most CRUD components — single shared `formatUserError()` helper would handle it |
| CL3 | Repo-wide | Several `useEffect` async fetches without abort flags. Lower-stakes than CH2 but worth a cleanup sweep |

### Suggested fix order

1. CC1 first — trivially exploitable. Gate `AdminSettings` server-side via the RLS already enforcing the underlying tables AND add a client-side `userRole !== 'admin'` guard so the shell never paints
2. CC2 — URL allowlist on `KnowledgeBase` iframe
3. CH1 + CH2 + CH3 — same PR, all small
4. CM1 — verify the data still in legacy `team_id`-only form before deciding (may already be backfilled)
5. CM2 — mailto rewrite
6. CM3 / CM4 / CL1 in a single hygiene PR
7. CL2 — shared error helper

### Not audited

- DB functions / triggers defined directly in Supabase dashboard (not in migration files)
- Storage bucket lifecycle configs
- Vercel env vars / secret config
- Realtime channel subscriptions for auth-bypass tricks (separate sweep would be needed)

## Infra Audit — 2026-06-20

Round-3 sweep of dashboard-defined DB objects, Supabase Storage configs, Realtime publications vs client subscriptions, and Vercel env.

### CRITICAL

| # | Location | Bug | Fix |
|---|----------|-----|-----|
| IC1 | `storage.objects` policy `"Allow Updates 1oj01fe_0"` | Avatars UPDATE policy is just `bucket_id = 'avatars'` — no `auth.uid()` / folder check. Any authenticated user can overwrite anyone else's avatar (deface, phishing, swap with NSFW) | Add `AND (storage.foldername(name))[1] = auth.uid()::text` and admin override |
| IC2 | `storage.objects` policy `"Allow Uploads 1oj01fe_0"` | Avatars INSERT mirrors IC1 — anyone can write to anyone's folder | Same fix |
| IC3 | `storage.buckets` row `signatures` | Bucket is `public = true`. URL is `https://<project>.supabase.co/storage/v1/object/public/signatures/<user-uuid>/<file>` and viewable anonymously. Waiver/contract/LOI/facility-fine signatures = PII | Flip bucket to `public = false`; switch clients to signed URLs via `createSignedUrl` |
| IC4 | `storage.objects` policy `"Anyone can view signatures"` | Pairs with IC3 — SELECT qual = bucket match only. Anonymous viewing path | Replace with own-only + staff override using `storage.foldername(name)` |

### HIGH

| # | Location | Bug |
|---|----------|-----|
| IH1 | `storage.buckets` row `message-attachments` | `public = true`. DM attachments anonymously viewable via public URL. Should be private + signed URLs |
| IH2 | `storage.objects` policies `"Authenticated users can upload signatures"` + `"Authenticated users can update signatures"` | INSERT/UPDATE allowed for any authenticated user with no folder check. Coexists with the strict per-user policy — the broader one wins (policies OR together). Drop the loose policies |
| IH3 | Realtime publication drift | Client subscribes to `messages`, `message_reads`, `slot_reservations`, `staff_hour_entries`, `staff_time_off_requests`, `staff_schedule_events`, `staff_schedule_assignments`, `staff_announcements` (8 tables). `pg_publication_tables` for `supabase_realtime` lists ONLY `work_dm_threads`, `work_message_reads`, `work_messages`. All 8 client subscriptions silently no-op. UI features that depend on push updates fall back to manual refresh | Add the missing tables to `supabase_realtime` publication OR remove the dead subscriptions |
| IH4 | Vercel env audit not possible via MCP | The `mcp__claude_ai_Vercel__*` toolset has no env-list endpoint. Manual check needed in dashboard: confirm no `SUPABASE_SERVICE_ROLE_KEY` / `SQUARE_ACCESS_TOKEN` is exposed via a `REACT_APP_*` prefix (CRA inlines REACT_APP_ vars into the browser bundle) |

### MED

| # | Location | Bug |
|---|----------|-----|
| IM1 | `storage.buckets` — most rows | No `file_size_limit` and no `allowed_mime_types`. Lets a user upload arbitrarily large files or HTML/EXE to a public bucket. Tighten per bucket (e.g. avatars: 5 MB images only — already partial; signatures: PDF/PNG only) |
| IM2 | `public.store_touch_updated_at` trigger function | INVOKER (fine) but has NO `search_path` set (`proconfig = null`). The other touch functions all set `search_path=public, pg_temp`. Cosmetic but worth aligning for consistency |
| IM3 | Storage bucket `avatars` has `public = true` | Standard pattern but combined with IC1/IC2 means avatar paths leak user UUIDs anonymously (URL contains the auth.uid). If user UUIDs are considered sensitive, switch to a short random ID prefix |

### LOW

| # | Location | Note |
|---|----------|------|
| IL1 | All SECURITY DEFINER functions (`get_user_role`, `is_conversation_participant`, `user_can_access_channel`) | Verified hardened with `search_path=public, pg_temp`. No findings — listed for the record |
| IL2 | All triggers | Read every public-schema trigger; all are `updated_at` touchers or a single thread-bump on `work_messages`. No surprise logic |

### Suggested fix order

1. IC1 + IC2 — single migration: tighten the avatars policies
2. IC3 + IC4 + IH2 — single migration: lock signatures bucket and policies; client switches to signed URLs
3. IH1 — same pattern as IC3 for `message-attachments`
4. IH3 — `ALTER PUBLICATION supabase_realtime ADD TABLE …` for the 8 missing tables, OR rip the dead client subscriptions
5. IH4 — manual: open Vercel dashboard, confirm no service-role/access-token in `REACT_APP_*` vars
6. MED sweep last

### What was checked

- `pg_proc` (12 functions in public schema) for SECURITY DEFINER + `search_path` + ownership
- `information_schema.triggers` (10 triggers) for unexpected behavior
- `storage.buckets` (8 buckets) for public flag, size limit, MIME allowlist
- `pg_policies` for `storage.objects` (25 policies) for missing folder/auth checks
- `pg_publication_tables` for `supabase_realtime` vs client `supabase.channel(...).on('postgres_changes', ...)` calls in `src/`
- Vercel project metadata via `get_project` (env vars not enumerable via current MCP)
