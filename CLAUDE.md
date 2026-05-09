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

## Workflow
- Trevor prefers batched feature requests and "commit push deploy" as a single flow
- Build must pass (`npx react-scripts build`) before committing
- Vercel auto-deploys from main branch on push

## Database Tables (notable)
- `users` — core user table (id, email, full_name, role, phone, height, weight, avatar_url)
- `player_profiles` — player-specific data (sport, jersey_number, position, grade, bats, throws)
- `teams` / `team_members` — team organization
- `prospects` / `team_prospects` — prospect management (added 2026-03-28)
- `recruitment_teams` — recruitment tracking per athlete profile (added 2026-03-28)
- `training_programs` / `training_days` / `training_exercises` — workout system
- `workout_templates` — saved workout templates (exercises stored as JSONB with name, sets, reps, rest, load, link, category, superSet)
- `equipment_sizes` — player equipment sizes
- `assessment_templates` / `assessment_submissions` — assessment system
- `custom_status_options` — custom status dropdowns for Manage Athletes/Coaches
- `facility_events` — facility calendar events with lane reservations
- `event_signups` — player sign-ups for facility events (per occurrence: `event_id` + `event_date` + `user_id` unique). RLS: own-only insert/update/delete + staff-read-all + admin-delete-any. Surfaced in `FacilityEventDetail` (Schedule.js): players see a Yes/No + notes prompt, staff see a sign-ups list. MonthView/WeekView take an `allowEventClick` prop so players can open the modal without manage rights
- `schedule_events.team_ids uuid[]` — multi-team events. Backfilled from `team_id`; existing `team_id` is kept as the primary/legacy team (set to first selected team on insert). Filter team-scoped queries with `.contains('team_ids', [teamId])` (or `.overlaps('team_ids', teamIds)` for multi-team scopes). One row per shared event — do NOT create one row per team
- `users.is_intern boolean default false` — flips a coach into the Manage Interns view (`<ManageCoaches mode="interns" />`). Interns are still `role='coach'` for permissions; only the management list is partitioned
- `users.secondary_role text` (CHECK in admin/coach/player) — when set, MainApp adds a "View as <role>" toggle to the sidebar; `effectiveRole` flows to every child component instead of the primary `userRole`. Permissions in RLS still use the actual `role` — this is UI scoping only

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

Notification/cross-portal pattern: `src/useNotifications.js` exposes `useMainPortalCounts` and `useWorkPortalCounts` hooks; `src/NotificationBell.js` is the shared bell rendered in both shells. Items from the other portal carry a portal tag and clicking jumps across via the `onJump(portal, view)` callback (Work Portal's `currentView` is lifted to `App.js` so cross-portal jumps can target a specific Work view).
