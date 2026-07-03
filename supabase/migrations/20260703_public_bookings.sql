-- Public-facing facility booking (#229). Outside customers (no portal account)
-- can book & pay for facility resources and coach sessions via a public /book
-- page. Staff publish inventory by toggling an existing facility_event or
-- training_slot "public" and setting a price; a paid guest booking then shows
-- on the staff Schedule calendar and can be cancelled/refunded there.
--
-- Design: guests never authenticate. ALL writes go through edge functions using
-- the service_role key (which bypasses RLS), mirroring the Square store flow.
-- So public_bookings has NO anon policies — only staff read/manage via RLS, and
-- the edge functions write server-side.

-- 1. Publish flags on the existing bookable inventory ------------------------

alter table facility_events
  add column if not exists is_public boolean not null default false,
  add column if not exists public_price_cents integer,
  add column if not exists public_capacity integer not null default 1;

alter table training_slots
  add column if not exists is_public boolean not null default false,
  add column if not exists public_price_cents integer;

-- The public edge functions read these older tables via service_role, which
-- needs explicit table GRANTs (it does NOT inherit them, and RLS bypass alone
-- is not enough). These tables predate the store and were only granted to
-- `authenticated`. Without this the functions return "permission denied".
grant all on facility_events to service_role;
grant all on training_slots to service_role;
grant all on slot_reservations to service_role;

-- 2. Guest bookings ----------------------------------------------------------

create table if not exists public_bookings (
  id uuid primary key default gen_random_uuid(),

  -- Which piece of inventory + which occurrence (recurring masters expand to
  -- many dates; a guest books exactly one). Mirrors the event_signups
  -- (event_id + event_date) per-occurrence pattern.
  source_type text not null check (source_type in ('facility_event','training_slot')),
  source_id uuid not null,
  occurrence_date date not null,
  start_time time,
  end_time time,

  -- Guest identity (no user account).
  guest_name text not null,
  guest_email text not null,
  guest_phone text,
  notes text,

  amount_cents integer not null,
  -- pending_payment -> confirmed (webhook on paid) | canceled | refunded
  status text not null default 'pending_payment'
    check (status in ('pending_payment','confirmed','canceled','refunded')),

  -- Square references (populated by the checkout fn + webhook + refund fn).
  square_order_id text,
  square_payment_id text,
  square_refund_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Capacity checks and calendar merges filter by (source, occurrence).
create index if not exists public_bookings_source_idx
  on public_bookings (source_type, source_id, occurrence_date);
create index if not exists public_bookings_status_idx
  on public_bookings (status);
create index if not exists public_bookings_square_order_idx
  on public_bookings (square_order_id);

alter table public_bookings enable row level security;

-- CRITICAL (per project RLS rules): GRANT explicitly. service_role is required
-- because the checkout / webhook / refund edge functions connect as that role.
grant all on public_bookings to authenticated;
grant all on public_bookings to service_role;

-- No anon policies: guests never touch this table directly. Staff-only RLS.
drop policy if exists "Staff can read public bookings" on public_bookings;
create policy "Staff can read public bookings"
  on public_bookings for select
  to authenticated
  using (public.get_user_role() = any (array['admin','coach']));

drop policy if exists "Staff can update public bookings" on public_bookings;
create policy "Staff can update public bookings"
  on public_bookings for update
  to authenticated
  using (public.get_user_role() = any (array['admin','coach']))
  with check (public.get_user_role() = any (array['admin','coach']));

drop policy if exists "Staff can delete public bookings" on public_bookings;
create policy "Staff can delete public bookings"
  on public_bookings for delete
  to authenticated
  using (public.get_user_role() = any (array['admin','coach']));

-- Keep updated_at fresh on status changes.
create or replace function public.touch_public_bookings_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_public_bookings_updated_at on public_bookings;
create trigger trg_public_bookings_updated_at
  before update on public_bookings
  for each row execute function public.touch_public_bookings_updated_at();
