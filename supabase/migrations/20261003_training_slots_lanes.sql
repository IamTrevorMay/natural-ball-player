-- #434: coach lessons (training_slots) can reserve facility lanes so they
-- render in the Lanes grid as well as the Staff Schedule band. Optional —
-- an empty array keeps the slot in the staff band only. Values are the
-- LANES names in Schedule.js, same convention as facility_events.lanes.
alter table training_slots add column if not exists lanes text[] not null default '{}';
