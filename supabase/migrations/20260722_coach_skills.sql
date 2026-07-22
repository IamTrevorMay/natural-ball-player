-- #245: coaches' skill specialties surfaced in the session booking flow.
-- Per-coach list of skills they can cover for lessons / skills sessions.
-- No new RLS/grants needed — `skills` is just another column on `users`
-- (readable by anyone who can read the users row; editable by admins the same
-- way `title` is today).

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS skills text[] NOT NULL DEFAULT '{}';

-- Seed from the coach list provided on the issue (matched by user id).
UPDATE public.users SET skills = v.skills FROM (VALUES
  ('7461fdf1-724f-48f1-8b0b-6ad2b41df468'::uuid, ARRAY['Pitching','Throwing','Hitting','Fielding']),           -- Aaron Newton
  ('d6d193e5-bc04-4144-830e-eb8d38134ff4'::uuid, ARRAY['Pitching']),                                            -- Adam Cimber
  ('eb3a3f67-5c48-4347-82e0-01a05b514335'::uuid, ARRAY['Pitching','Throwing','Hitting','Fielding']),           -- Caden Kubosh
  ('a43263b1-206f-40f2-bb8b-7c000512fcae'::uuid, ARRAY['Hitting','Fielding','Throwing']),                       -- Charlie Lydum
  ('23134d5d-0729-4ce2-84f4-1f19692304a9'::uuid, ARRAY['Pitching','Throwing','Hitting','Fielding']),           -- Cooper Hancock
  ('cd8037ca-6c08-4462-9910-41db96f2a311'::uuid, ARRAY['Pitching','Throwing','Hitting','Fielding','Catching']),-- Dylan Matsuoka
  ('87803f50-2715-4b4b-9706-dc56d98eda87'::uuid, ARRAY['Hitting','Fielding','Throwing','Pitching']),           -- Ethan Keene
  ('8e276669-328e-463f-8f5e-768114319258'::uuid, ARRAY['Pitching','Throwing','Hitting','Fielding']),           -- Evan Massie
  ('0d697669-6c4e-45e7-98c5-05d8a05bdde7'::uuid, ARRAY['Hitting','Fielding','Throwing']),                       -- Joshua Sale
  ('5c884c4b-1c25-4979-af85-fb17e2a092e0'::uuid, ARRAY['Hitting','Catching','Fielding','Throwing']),           -- Kai Perala
  ('43d5e6db-3cc9-4175-9cc8-327ea1c436bc'::uuid, ARRAY['Catching','Hitting','Fielding']),                       -- Micah Yonamine
  ('acf973bb-f6fe-4a4e-a608-739470d80c70'::uuid, ARRAY['Pitching','Throwing','Fielding','Base Running']),       -- Peter Allegro
  ('3f09e543-d0fa-4fd5-951b-21d668f366e0'::uuid, ARRAY['Pitching','Throwing','Fielding','Hitting']),           -- Quentin O'Connor
  ('59525a07-893e-40ce-b587-78f6fbdaf0ca'::uuid, ARRAY['Pitching','Throwing','Fielding','Hitting']),           -- Taylo Derouin
  ('a54ed4a5-88ec-45fb-bfbf-844b1bca467b'::uuid, ARRAY['Pitching','Throwing']),                                 -- Trevor May
  ('fc87fe57-66f0-48d4-8db8-5e0c11f93383'::uuid, ARRAY['Pitching','Throwing','Fielding','Hitting','Catching']),-- Zach Robman
  ('9b2af61a-5c07-4156-92ea-23ecc93edc34'::uuid, ARRAY['Pitching','Throwing','Fielding','Hitting'])            -- Zaid Flynn
) AS v(id, skills)
WHERE public.users.id = v.id;
