-- Public user role + leads (#229 follow-up). A "public" user is an outside
-- customer who created an account (or was captured) via the /book page. They
-- get a booking-only mini portal and show up in the staff Leads tab. Role is
-- plain text 'public' (users.role has no CHECK); get_user_role() returns it.

-- Lead pipeline status for public users (null for non-public users).
alter table public.users
  add column if not exists lead_status text
    check (lead_status is null or lead_status in ('new','contacted','converted','lost'));

-- Let a logged-in public/authenticated user read their OWN public bookings
-- (matched by the email on their JWT) so the mini portal can show a booking /
-- payment history. Staff-read + service_role-write policies stay as-is.
drop policy if exists "Users can read own public bookings" on public.public_bookings;
create policy "Users can read own public bookings"
  on public.public_bookings for select
  to authenticated
  using (lower(guest_email) = lower(auth.jwt() ->> 'email'));
