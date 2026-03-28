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
