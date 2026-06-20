-- Round-4 audit: the users UPDATE policy is `auth.uid() = id OR get_user_role()
-- IN ('admin','coach')` for both USING and WITH CHECK. That lets a player
-- update their own users.role to 'admin' via a direct PostgREST call, and lets
-- a coach promote anyone (or themselves) to admin.
--
-- Tighten with a BEFORE UPDATE trigger that rejects role / is_intern /
-- secondary_role changes from anyone except an admin. The trigger runs
-- SECURITY DEFINER and re-checks via get_user_role() so it's not bypassed by
-- the caller's RLS context.

CREATE OR REPLACE FUNCTION public.prevent_role_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.is_intern IS DISTINCT FROM OLD.is_intern
     OR NEW.secondary_role IS DISTINCT FROM OLD.secondary_role
  THEN
    IF public.get_user_role() <> 'admin' THEN
      RAISE EXCEPTION 'Only admins can change role, is_intern, or secondary_role'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_role_escalation() FROM PUBLIC;

DROP TRIGGER IF EXISTS prevent_role_escalation_trg ON public.users;
CREATE TRIGGER prevent_role_escalation_trg
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_role_escalation();
