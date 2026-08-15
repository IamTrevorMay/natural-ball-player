-- =============================================================================
-- Athlete privacy lockdown — RLS tightening
-- =============================================================================
--
-- WHY
-- The business owner reported: "any athlete on the same team can look at other
-- athletes profiles and assessment numbers / programming. I would like that to
-- not be possible for any athlete to see another's full account details."
--
-- The front end has been fixed in the same commit (athletes can no longer open
-- another user's profile at all). This migration closes the same hole at the
-- database level, so the data is unreachable even by hand-rolled API calls.
--
-- WHAT THIS CHANGES, IN PLAIN ENGLISH
--   1. assessment_submissions — today ANY logged-in user can read EVERY
--      assessment row. After this, a player can read only their own; admins
--      and coaches keep full read access.
--   2. training_program_assignments — today ANY logged-in user can read EVERY
--      assignment. After this, a player can read assignments made to them
--      personally plus assignments made to a team they belong to (team
--      programming must stay visible to that team); staff keep full access.
--   3. meal_plan_assignments — today two separate "true" SELECT policies make
--      every meal assignment world-readable to logged-in users. Postgres ORs
--      permissive policies together, so BOTH must go. They are replaced by a
--      single staff policy; the existing correct
--      "Players can view own meal_plan_assignments" policy is left untouched,
--      and a team-scoped policy is added so team meal plans still resolve.
--   4. event_attendance — today ANY logged-in user can read EVERY attendance
--      row. After this, a player can read only their own; staff keep full
--      access. (Verified: the only reader in the app,
--      src/Profile.js fetchAttendanceData, always filters .eq('player_id', ...)
--      for the profile being viewed, so nothing needs other players' rows.)
--   5. Adds public.assessment_age_group_averages(uuid) — a SECURITY DEFINER
--      function returning ONLY aggregated age-group averages (never per-player
--      rows), so athletes keep the "compare me to my age group" numbers on
--      their own assessment tab after (1) removes their raw cohort read.
--
-- WHAT COULD BREAK
--   * Any staff screen keeps working: every new policy has an
--     admin/coach escape hatch via public.get_user_role().
--   * Athlete "Schedule" tab programming list (src/Profile.js
--     fetchProgrammingData) reads training_program_assignments by player_id AND
--     by their own team_ids — both are still allowed. If a program is assigned
--     to a team the athlete is NOT a member of, they will now correctly stop
--     seeing it.
--   * Athlete assessment age-group comparison (src/Profile.js
--     fetchAgeGroupAverages) used to read the whole cohort's raw submissions
--     client-side. It now calls the RPC in (5) for players. Staff keep the old
--     client-side path. If this migration is applied WITHOUT the matching
--     front-end commit, players lose the "Avg <bracket>" annotations (the
--     query returns only their own row, so the n>=2 threshold is never met) —
--     nothing errors, the comparison line just disappears.
--   * Anything outside src/ that reads these tables with the anon/authenticated
--     key and expects to see all rows (reports, exports, scripts) will now see
--     less. Service-role callers are unaffected — they bypass RLS.
--
-- NOT APPLIED. Review, then run against staging before production.
-- public.get_user_role() already exists and is used by neighbouring policies;
-- it is intentionally NOT redefined here.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. assessment_submissions — the "assessment numbers" in the complaint.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can view assessment submissions" ON public.assessment_submissions;
DROP POLICY IF EXISTS "Players and staff can view assessment submissions" ON public.assessment_submissions;
CREATE POLICY "Players and staff can view assessment submissions" ON public.assessment_submissions
  FOR SELECT USING (
    player_id = auth.uid()
    OR public.get_user_role() IN ('admin', 'coach')
  );


-- -----------------------------------------------------------------------------
-- 2. training_program_assignments — the "programming" in the complaint.
--    Team-assigned programs must stay visible to that team's own players.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Enable read for authenticated users" ON public.training_program_assignments;
DROP POLICY IF EXISTS "Players and staff can view program assignments" ON public.training_program_assignments;
CREATE POLICY "Players and staff can view program assignments" ON public.training_program_assignments
  FOR SELECT USING (
    player_id = auth.uid()
    OR team_id IN (SELECT team_id FROM public.team_members WHERE user_id = auth.uid())
    OR public.get_user_role() IN ('admin', 'coach')
  );


-- -----------------------------------------------------------------------------
-- 3. meal_plan_assignments — THREE SELECT policies exist, two of them USING
--    (true). Permissive policies are ORed, so both "true" ones must be dropped
--    or the tightening is a no-op. "Players can view own meal_plan_assignments"
--    is already correct and is deliberately left in place.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Coaches can select meal assignments" ON public.meal_plan_assignments;
DROP POLICY IF EXISTS "Enable read for authenticated users" ON public.meal_plan_assignments;
DROP POLICY IF EXISTS "Staff can view meal assignments" ON public.meal_plan_assignments;
CREATE POLICY "Staff can view meal assignments" ON public.meal_plan_assignments
  FOR SELECT USING (
    public.get_user_role() IN ('admin', 'coach')
  );

-- Team-assigned meal plans must stay visible to that team's own players
-- (src/Profile.js fetchProgrammingData queries them by team_id).
DROP POLICY IF EXISTS "Players can view own team meal assignments" ON public.meal_plan_assignments;
CREATE POLICY "Players can view own team meal assignments" ON public.meal_plan_assignments
  FOR SELECT USING (
    team_id IN (SELECT team_id FROM public.team_members WHERE user_id = auth.uid())
  );


-- -----------------------------------------------------------------------------
-- 4. event_attendance
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view attendance" ON public.event_attendance;
DROP POLICY IF EXISTS "Players and staff can view attendance" ON public.event_attendance;
CREATE POLICY "Players and staff can view attendance" ON public.event_attendance
  FOR SELECT USING (
    player_id = auth.uid()
    OR public.get_user_role() IN ('admin', 'coach')
  );


-- -----------------------------------------------------------------------------
-- 5. Age-group assessment averages for athletes.
--
--    src/Profile.js used to pull every submission for a template and every
--    matching users.date_of_birth into the browser to compute an age-bracket
--    average. Policy (1) correctly kills that for players, so the aggregation
--    moves server-side. The function returns ONLY averages — no player ids, no
--    per-player rows — and mirrors the JS implementation exactly:
--      * latest submission per player for the template
--      * cohort = same age bracket as the CALLER (auth.uid()), never a
--        caller-supplied bracket
--      * null unless the cohort has >= 2 members
--      * per value: mean of every number found in the answer text, and a value
--        is only published when >= 2 cohort members answered it
--    One harmless difference: the JS version reads the template schema and skips
--    `combo_box` / `date` elements. The function has no schema, so it may return
--    extra keys for those. SubmissionView only looks up averages for text and
--    table elements, so the extra keys are never rendered.
-- -----------------------------------------------------------------------------

-- Age bracket labels, identical to getAgeBracket() in src/Profile.js.
CREATE OR REPLACE FUNCTION public.assessment_age_bracket(p_dob date)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_dob IS NULL THEN NULL
    WHEN floor(extract(epoch FROM (now() - p_dob::timestamp)) / (365.25 * 86400)) < 10 THEN 'Under 10'
    WHEN floor(extract(epoch FROM (now() - p_dob::timestamp)) / (365.25 * 86400)) <= 12 THEN '10-12'
    WHEN floor(extract(epoch FROM (now() - p_dob::timestamp)) / (365.25 * 86400)) <= 14 THEN '13-14'
    WHEN floor(extract(epoch FROM (now() - p_dob::timestamp)) / (365.25 * 86400)) <= 16 THEN '15-16'
    WHEN floor(extract(epoch FROM (now() - p_dob::timestamp)) / (365.25 * 86400)) <= 18 THEN '17-18'
    ELSE '19+'
  END;
$$;

CREATE OR REPLACE FUNCTION public.assessment_age_group_averages(p_template_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bracket text;
  v_sample  int;
  v_result  jsonb;
BEGIN
  IF auth.uid() IS NULL OR p_template_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT public.assessment_age_bracket(u.date_of_birth)
    INTO v_bracket
    FROM public.users u
   WHERE u.id = auth.uid();

  IF v_bracket IS NULL THEN
    RETURN NULL;
  END IF;

  WITH latest AS (
    SELECT DISTINCT ON (s.player_id) s.player_id, s.responses
      FROM public.assessment_submissions s
     WHERE s.template_id = p_template_id
     ORDER BY s.player_id, s.created_at DESC
  ),
  cohort AS (
    SELECT l.player_id, l.responses
      FROM latest l
      JOIN public.users u ON u.id = l.player_id
     WHERE public.assessment_age_bracket(u.date_of_birth) = v_bracket
  )
  SELECT count(*) INTO v_sample FROM cohort;

  -- Mirrors `if (inBracket.length < 2) return null;`
  IF v_sample IS NULL OR v_sample < 2 THEN
    RETURN NULL;
  END IF;

  WITH latest AS (
    SELECT DISTINCT ON (s.player_id) s.player_id, s.responses
      FROM public.assessment_submissions s
     WHERE s.template_id = p_template_id
     ORDER BY s.player_id, s.created_at DESC
  ),
  cohort AS (
    SELECT l.responses
      FROM latest l
      JOIN public.users u ON u.id = l.player_id
     WHERE public.assessment_age_bracket(u.date_of_birth) = v_bracket
  ),
  -- Flatten every answer to (element, row, column, text). `row`/`column` are
  -- NULL for plain answers and set for the `table` element type, which stores
  -- responses[el.id][row][col].
  flat AS (
    SELECT
      el.key AS el_id,
      CASE WHEN jsonb_typeof(el.value) = 'object' THEN rw.key END AS row_key,
      CASE WHEN jsonb_typeof(el.value) = 'object' THEN cl.key END AS col_key,
      CASE
        WHEN jsonb_typeof(el.value) = 'object' THEN cl.value #>> '{}'
        ELSE el.value #>> '{}'
      END AS raw
    FROM cohort c
    CROSS JOIN LATERAL jsonb_each(c.responses) el
    LEFT JOIN LATERAL jsonb_each(
      CASE WHEN jsonb_typeof(el.value) = 'object' THEN el.value ELSE '{}'::jsonb END
    ) rw ON true
    LEFT JOIN LATERAL jsonb_each(
      CASE WHEN rw.value IS NOT NULL AND jsonb_typeof(rw.value) = 'object' THEN rw.value ELSE '{}'::jsonb END
    ) cl ON true
    WHERE jsonb_typeof(el.value) <> 'object' OR cl.key IS NOT NULL
  ),
  -- extractNumericAverage(): mean of every number in the answer text.
  vals AS (
    SELECT f.el_id, f.row_key, f.col_key,
           (SELECT avg(m.parts[1]::numeric)
              FROM regexp_matches(coalesce(f.raw, ''), '-?\d+\.?\d*', 'g') AS m(parts)) AS v
      FROM flat f
  ),
  agg AS (
    SELECT el_id, row_key, col_key, avg(v) AS avg_v, count(v) AS n
      FROM vals
     GROUP BY el_id, row_key, col_key
  ),
  -- Mirrors `if (vals.length >= 2)` per answer / per table cell.
  kept AS (
    SELECT * FROM agg WHERE n >= 2
  ),
  scalars AS (
    SELECT coalesce(jsonb_object_agg(el_id, to_jsonb(round(avg_v, 1)::float8)), '{}'::jsonb) AS obj
      FROM kept WHERE row_key IS NULL
  ),
  table_rows AS (
    SELECT el_id, row_key, jsonb_object_agg(col_key, to_jsonb(round(avg_v, 1)::float8)) AS cols
      FROM kept WHERE row_key IS NOT NULL
     GROUP BY el_id, row_key
  ),
  tables AS (
    SELECT coalesce(jsonb_object_agg(el_id, rows_obj), '{}'::jsonb) AS obj
      FROM (
        SELECT el_id, jsonb_object_agg(row_key, cols) AS rows_obj
          FROM table_rows
         GROUP BY el_id
      ) t
  )
  SELECT s.obj || tb.obj INTO v_result FROM scalars s, tables tb;

  RETURN jsonb_build_object(
    'bracket', v_bracket,
    'sampleSize', v_sample,
    'averages', coalesce(v_result, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.assessment_age_group_averages(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assessment_age_group_averages(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.assessment_age_group_averages(uuid) TO authenticated;


-- =============================================================================
-- REMAINING EXPOSURE — DELIBERATELY OUT OF SCOPE FOR THIS MIGRATION
-- =============================================================================
--
-- public.users, public.player_profiles and public.team_members all still have
-- a SELECT policy of USING (true): every logged-in user can read every row.
--
-- Concretely, `users` exposes to ANY logged-in athlete, for EVERY other user in
-- the system: email, phone, address, date_of_birth, organization, instagram,
-- twitter, parent1_name, parent1_email, parent2_name, parent2_email — i.e. the
-- contact details of every other athlete AND of every other athlete's parents.
-- `player_profiles` similarly exposes jersey/position/grade/bats/throws/
-- trainer_id, and `team_members` exposes the full membership graph.
--
-- These were NOT tightened here because the roster (src/MyTeam.js), the
-- calendar (src/Schedule.js), messaging (src/Messages.js) and a large number of
-- other screens join through these tables to display other users' names and
-- avatars. A blanket tightening would break production immediately.
--
-- PROPER FIX (follow-up ticket, do not attempt inline):
--   1. CREATE VIEW public.user_directory AS
--        SELECT id, full_name, avatar_url, role FROM public.users;
--      (or a SECURITY DEFINER RPC returning the same shape) — no email, no
--      phone, no address, no DOB, no parent contact details.
--   2. GRANT SELECT ON public.user_directory TO authenticated, and make the
--      view security_invoker = off so it is readable regardless of the
--      underlying users policy.
--   3. Repoint every "show me other people's names" query in the app at
--      user_directory: MyTeam roster + coach cards, Schedule attendee lists,
--      Messages participant lists, Profile TeamsList, notification senders.
--      Leave self-reads and staff reads pointing at public.users.
--   4. Only once (3) is complete, replace the users SELECT policy with
--        id = auth.uid() OR public.get_user_role() IN ('admin','coach')
--      and do the equivalent for player_profiles; team_members likely needs
--      "rows for a team I am on, or staff".
--   5. As an interim mitigation the front end now avoids SELECTing email/phone
--      for teammates (src/MyTeam.js), which stops the data reaching the
--      browser, but it does NOT stop a determined athlete calling PostgREST
--      directly. Step (4) is the real fix.
-- =============================================================================
