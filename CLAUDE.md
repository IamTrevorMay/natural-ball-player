# NBP Portal - Project Context

## Stack
- **Frontend:** React (CRA) + Tailwind CSS
- **Backend:** Supabase (Postgres + Auth + Storage + Edge Functions)
- **Deploy:** Vercel via Git integration (auto-deploys on push to main)

## Key IDs
- Supabase project: `cjilkqzifyhssbsiqgfu` (NBP Portal)
- Vercel project: `prj_esGXWgj1jyLoC45LO4jAwX7u7jW8`
- Vercel team: `team_rqOUvfWKVJT8gPTJpLfUMzlx`

## User Roles
Stored as lowercase text in `users.role`: `admin`, `coach`, `player`

## Supabase RLS Rules (CRITICAL)
When creating new tables:
1. **Always GRANT permissions:** `GRANT ALL ON <table> TO authenticated;` — Supabase does NOT auto-grant. Missing grants cause "permission denied" even with correct RLS policies.
2. **Always use `public.get_user_role()`** (SECURITY DEFINER function) in RLS policies — NOT inline `EXISTS (SELECT FROM users ...)` subqueries. The subquery approach causes RLS recursion failures since the `users` table also has RLS.
3. **Use separate policies** for SELECT/INSERT/UPDATE/DELETE — INSERT requires `WITH CHECK`, not `USING`. Avoid `FOR ALL`.

## Pending Manual Configuration
1. **Supabase Auth Redirect URLs (for forgot password #78, #139):** Go to Supabase Dashboard → Project Settings → Authentication → URL Configuration. Set **Site URL** to `https://nbp-portal.vercel.app`. Add `https://nbp-portal.vercel.app/**` to the **Redirect URLs** allowlist. (Production Vercel domain is `nbp-portal.vercel.app` — NOT `natural-ball-player.vercel.app`.)
2. **Enable leaked-password protection:** Supabase Dashboard → Authentication → Policies → toggle on "Leaked Password Protection" (checks HaveIBeenPwned).

## Workflow
- Trevor prefers batched feature requests and "commit push deploy" as a single flow
- Build must pass (`npx react-scripts build`) before committing
- **Never `git push` until Trevor explicitly says push (or pushes via "commit push", "push it", etc.). Commit freely, but the publish step is gated on his signal.**
- Vercel auto-deploys from main branch on push
- **Before implementing any suggested change**, ask clarifying questions using the AskUserQuestion multiple-choice selector before starting work

## Database Tables (notable)
- `users` — core user table (id, email, full_name, role, phone, height, weight, avatar_url)
- `player_profiles` — player-specific data (sport, jersey_number, position, grade, bats, throws)
- `teams` / `team_members` — team organization. `RosterTab` in `MyTeam.js` supports search/add/remove members (debounced search against `users` by name/email, role selector for player/coach)
- `prospects` / `team_prospects` — prospect management (added 2026-03-28)
- `fields` — shared venue directory (name, address, notes) for the Fields sidebar tab. RLS: read for all authenticated; insert/update/delete for admin + coach. Address rendered as a Google Maps link in `Fields.js`
- `recruitment_teams` — recruitment tracking per athlete profile (added 2026-03-28)
- `training_programs` / `training_days` / `training_exercises` — workout system
- `workout_templates` — saved workout templates (exercises stored as JSONB with name, sets, reps, rest, load, link, category, superSet). Dragging a template onto the schedule fetches exercises and serializes them into the `notes` field (pipe-delimited: `Name | 3x10 | rest | load | link` with `--- Exercises ---` delimiter)
- `training_slots` — coach availability slots. `repeat_weekly` + `repeat_end_date` for recurrence (NOT `is_recurring`). Virtual occurrences expanded client-side; first visible occurrence per master marked non-virtual for drag. `CreateSlotPanel` supports edit mode via `existingSlot` prop
- `slot_reservations` — player bookings against a `training_slots` occurrence (`slot_id` + `slot_date` + `player_id`). `status` (pending/confirmed/declined/cancelled). #233: players self-cancel a confirmed/pending session up to **12h before start** (enforced client-side in `EventDetailModal`'s `training_slot` branch in Schedule.js → sets `status='cancelled'` + `cancelled_at`, reopening the spot). Coaches mark `attendance` (`present`/`late`/`no_show`/`cancelled`, + `attendance_marked_at`/`attendance_marked_by`) per confirmed reservation from `CoachSlotsWeekView`. RLS UPDATE allows the player, the slot's coach, or admin
- `equipment_sizes` — player equipment sizes
- `assessment_templates` / `assessment_submissions` — assessment system
- `custom_status_options` — custom status dropdowns for Manage Athletes/Coaches
- `facility_events` — facility calendar events with lane reservations. `coach_ids uuid[]` supports multi-coach assignment (mirrors `team_ids` pattern); `coach_id` is kept as primary/legacy (set to first selected coach). UI uses multi-select checkboxes in `AddFacilityEventPanel`; `FacilityEventDetail` resolves names client-side from the `coaches` state
- `event_signups` — player sign-ups for facility events (per occurrence: `event_id` + `event_date` + `user_id` unique). RLS: own-only insert/update/delete + staff-read-all + admin-delete-any. Surfaced in `FacilityEventDetail` (Schedule.js): players see a Yes/No + notes prompt, staff see a sign-ups list. MonthView/WeekView take an `allowEventClick` prop so players can open the modal without manage rights
- `public_bookings` — public-facing facility booking (#229). Outside customers (NO account) book & pay via a no-login `/book` route (`src/PublicBookingPage.js`, rendered in `App.js` before the auth gate). Inventory = existing `facility_events` / `training_slots` toggled `is_public=true` with `public_price_cents` (facility events also have `public_capacity`; sessions use `max_players`). A booking references `(source_type, source_id, occurrence_date)` — the per-occurrence pattern like `event_signups`. RLS is **staff-only**; guests never touch the table — ALL writes go through service_role edge functions: `public-availability` (lists open occurrences), `public-book-checkout` (creates pending booking + Square payment link), `public-booking-refund` (staff cancel & refund). `square-webhook` flips `pending_payment`→`confirmed` on payment by matching `square_order_id`. Recurrence expansion is shared with the calendar via `supabase/functions/_shared/availability.ts` (a Deno port of `scheduleUtils.js` — keep in sync). Staff manage bookings in `FacilityEventDetail`; the public toggle lives on `AddFacilityEventPanel`/`FacilityEventDetail`/`CreateSlotPanel`. Public edge functions need `verify_jwt=false`
- **`public` user role + Leads (#229 follow-up)** — an outside customer who signs up through `/book` to book & pay for sessions (a lead). `users.role='public'` (plain text, no CHECK); `users.lead_status` (`new`/`contacted`/`converted`/`lost`, null for non-public). The `/book` welcome popup (once-per-browser via `localStorage.nbp_book_welcome_seen`, shown only when no session) links to `/` for login and `/?signup=public` (opens the LoginPage signup form pre-set to the booking-only "Public" account type — no DOB/intent). The `signup` edge function branches on `account_type='public'` (default stays `player`): creates role `public` + `lead_status='new'`, skips DOB/intent/team/age-sort. App.js routes `role='public'` to `src/PublicPortal.js` (a stripped shell: **Book a Session** = `<PublicBookingPage embedded prefill={...}/>`; **My Bookings** = own `public_bookings` by email). Public self-read RLS on `public_bookings`: `lower(guest_email)=lower(auth.jwt()->>'email')`. Staff manage leads in `src/Leads.js` (sidebar tab, admin+coach): role=public users with contact info, editable `lead_status`, booking counts
- `schedule_events.team_ids uuid[]` — multi-team events. Backfilled from `team_id`; existing `team_id` is kept as the primary/legacy team (set to first selected team on insert). Filter team-scoped queries with `.contains('team_ids', [teamId])` (or `.overlaps('team_ids', teamIds)` for multi-team scopes). One row per shared event — do NOT create one row per team
- `users.is_intern boolean default false` — flips a coach into the Manage Interns view (`<ManageCoaches mode="interns" />`). Interns are still `role='coach'` for permissions; only the management list is partitioned
- `users.secondary_role text` (CHECK in admin/coach/player) — when set, MainApp adds a "View as <role>" toggle to the sidebar; `effectiveRole` flows to every child component instead of the primary `userRole`. Permissions in RLS still use the actual `role` — this is UI scoping only
- `player_profiles.trainer_id uuid` (FK → users) — explicit trainer assignment; ManageAthletes Trainer dropdown writes here. UI falls back to team-coach derivation (`teamCoachMap`) when null
- `player_notes.context text` + `player_notes.pitches jsonb` — pitch-by-pitch logs for `hitting`/`pitching` note categories. Pitches array entries: `{ pitch_type, location, result, notes }`. `context` is one of `game/lives/scrimmage/bullpen/practice`. The `NoteEditor` sub-component in Profile.js renders the structured table only when category is hitting or pitching
- `player_profiles.pt_status text` — Physical Therapy status (Active / Pending Eval / In Treatment / Maintenance / Discharged)
- `trackman_sessions` / `trackman_pitches` / `trackman_player_map` — Trackman integration (#44). Session CSVs are pulled from Trackman's FTP (`practice/YYYY/MM/DD/<Type>_<ts>_verified.csv`, Trackman V3, one row per pitch, 73 cols with BOTH pitching + batted-ball metrics) by the Vercel serverless function **`api/trackman-sync.js`** (Node, `basic-ftp` + `csv-parse`, service_role). Runs nightly via a Vercel Cron (`vercel.json` → `0 8 * * *`) and on demand via the admin **"Sync now"** button (Admin Settings → Trackman); the function auth accepts the `CRON_SECRET` bearer OR a staff Supabase JWT. Trackman names are `"Last, First"` and don't match `users.full_name`, so `trackman_player_map` (staff-managed) maps name → athlete; imports resolve `pitcher_user_id`/`batter_user_id` from it and staff assignments backfill existing rows. RLS: athletes read `trackman_pitches` where they're the pitcher or batter; staff read all; imports write via service_role. Admin mapping UI uses the `trackman_name_directory()` staff-gated RPC (distinct names + counts). Athlete view is `src/TrackmanTab.js` (profile Trackman tab): sessions → pitch-by-pitch + summaries. **Vercel env secrets required:** `TRACKMAN_FTP_HOST`/`TRACKMAN_FTP_USER`/`TRACKMAN_FTP_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`. Sync only runs on the deployed site (no `/api` on local `react-scripts` dev)
- `store_products` / `store_purchases` — Square store (#142). `store_purchases.remaining_qty` = sessions left; `expires_at` (#235/#238) = time-sensitive package expiry. `store_session_usage` (purchase_id, user_id, used_on, source_type, source_id, note, created_by) logs each session consumed. Marking a slot reservation **Present/Late** auto-consumes one session from the player's soonest-expiring counted package/bundle (`syncReservationSessionUsage` in Schedule.js, `source_type='training_slot'`, `source_id`=reservation id); No-show/Cancelled/unmark releases it. Monthly packages (`remaining_qty` null) are never decremented. Staff can also log/edit manually. Player-profile package history is `src/PackagesModal.js` (opened by clicking the subscription-status pill; staff can log used sessions / edit remaining / set expiry). Admin per-package overview = `PackagesTab` in `WorkStore.js` (grouped by product). RLS: purchases readable by owner + admin/coach, updatable by admin/coach; `store_session_usage` staff-write, owner+staff read
- `pt_visits` — PT visit log per player. RLS: own-read for players + full CRUD for admin/coach. Columns: `visit_date`, `visit_type`, `body_area`, `pain_level` (0-10), `content`, `exercises` (jsonb: `{name, sets, reps, notes}`), `follow_up_at`. Surfaced in Profile.js "Physical Therapy" tab; LW PT spec is pending so the schema is intentionally flexible (exercises is jsonb, all session fields nullable)

### Work Portal tables (added 2026-05-03, coach + admin only)
The Work Portal is a separate shell at the same URL (toggled via the bottom of the sidebar) for staff-only HR/ops. Players cannot access these. The shell lives in `src/WorkPortal.js`; per-feature pages are `src/Work*.js`.

- `staff_announcements` — admin-posted feed shown on Work Portal Home
- `staff_documents` + `staff-documents` Storage bucket — handbook / SOPs (admin write, staff read)
- `staff_pay_documents` + `staff-pay-docs` Storage bucket — paystubs / W-2 / 1099. Files are namespaced under `{user_id}/...` so storage RLS double-enforces own-only reads
- `staff_hour_entries` — coach-submitted hours, admin-reviewed (status workflow: pending → approved/rejected). Coaches can only edit their own pending entries
- `staff_time_off_requests` — same workflow as hours, plus a `cancelled` status coaches can self-set
- `work_portal_settings` (key/value) — generic config; currently holds `time_off_primary_approver_id`. Update this row to swap the primary approver without a code push
- `staff_schedule_events` + `staff_schedule_assignments` — staff shifts/meetings rendered as a week agenda alongside `facility_events`. Recurrence helpers extracted to `src/scheduleUtils.js` for reuse
- `work_channels` (audience: `all`/`coaches`/`admin`/`custom`), `work_channel_members`, `work_dm_threads` (canonical `user_a < user_b`), `work_messages` (channel XOR DM, optional attachment), `work_message_reads` (with generated `target_kind` + `target_id` columns so a single regular unique index supports `ON CONFLICT` upserts — partial indexes do NOT work with PostgREST upsert)
- `work-attachments` Storage bucket — paths are `channel/{channel_id}/...` or `dm/{thread_id}/...`; storage RLS uses `storage.foldername(name)` to defer to channel access / thread membership
- `public.user_can_access_channel(channel_id, user_id)` SECURITY DEFINER function — used by every channel/message/storage policy. Reuse it for any future channel-scoped feature instead of inlining the access logic
- `work_roadmap_items` — V2 placeholder; UI is "Coming soon"

### Scheduling drag & drop
- Custom MIME types: `application/x-event-id` (move events), `application/x-program-item` (copy from Program Library), `application/x-slot-id` (move slots)
- `ProgramLibrarySidebar` sets `effectAllowed = 'copy'`; MonthView/WeekView check `e.dataTransfer.types` to set correct `dropEffect` (copy for program items, move for events/slots)
- `RecurrenceDecisionModal` offers deletion modes: one/future/all (with `allowOne` prop; slots pass `allowOne: false` since they lack per-occurrence exceptions)

### Contract page
- `ContractPage.js` fetches an uploaded document from `staff_documents` where title matches `Naturals Player Contract%` and displays it in an iframe. Hard-coded contract sections (conduct, violations, medical release, payment) were removed — the uploaded document is the sole contract content. The signing form retains: player info, parent info, equipment sizing, consent to treat minor, and signatures

Notification/cross-portal pattern: `src/useNotifications.js` exposes `useMainPortalCounts` and `useWorkPortalCounts` hooks; `src/NotificationBell.js` is the shared bell rendered in both shells. Items from the other portal carry a portal tag and clicking jumps across via the `onJump(portal, view)` callback (Work Portal's `currentView` is lifted to `App.js` so cross-portal jumps can target a specific Work view).
