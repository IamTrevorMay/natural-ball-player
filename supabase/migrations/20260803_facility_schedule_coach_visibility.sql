-- #260: let staff hide/show coaches on the facility calendar Staff Schedule
-- rows (e.g. coaches heading back to school) WITHOUT changing their role or
-- permissions. Defaults to visible so every existing coach keeps appearing.
alter table public.users
  add column if not exists show_on_facility_schedule boolean not null default true;
