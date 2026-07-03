-- Public booking "Type" (#229). Public bookings are now created via a dedicated
-- "Public Booking" menu (separate from Organization Events). The chosen Type
-- (Assessment / Hitting Session / Private Lesson / Strength & Conditioning)
-- drives the event color and is shown to customers on /book. Stored on the
-- facility_events row alongside the existing is_public / public_price_cents /
-- public_capacity columns.
alter table facility_events
  add column if not exists booking_type text;
