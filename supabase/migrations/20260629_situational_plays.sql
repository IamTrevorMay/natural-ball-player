-- #225: Situational knowledge base. Athletes pick their position and see a
-- breakdown of common in-game situations and where to go / what to do, next to
-- the AI Coach Assistant. Seeded with standard baseball situational content;
-- staff can edit/extend the rows later.
create table if not exists situational_plays (
  id uuid primary key default gen_random_uuid(),
  position_code text not null,      -- P, C, 1B, 2B, 3B, SS, LF, CF, RF
  position_label text not null,     -- Pitcher, Catcher, ...
  position_order int not null default 0,  -- ordering of positions in the picker
  situation text not null,          -- the scenario
  responsibility text not null,     -- what to do / where to go
  sort_order int not null default 0,      -- ordering within a position
  created_at timestamptz default now()
);

create index if not exists situational_plays_position_idx on situational_plays (position_code);

alter table situational_plays enable row level security;

-- CRITICAL (per project RLS rules): GRANT explicitly + use get_user_role().
grant all on situational_plays to authenticated;

drop policy if exists "Authenticated can read situational plays" on situational_plays;
create policy "Authenticated can read situational plays"
  on situational_plays for select
  to authenticated
  using (true);

drop policy if exists "Staff can insert situational plays" on situational_plays;
create policy "Staff can insert situational plays"
  on situational_plays for insert
  to authenticated
  with check (public.get_user_role() = any (array['admin','coach']));

drop policy if exists "Staff can update situational plays" on situational_plays;
create policy "Staff can update situational plays"
  on situational_plays for update
  to authenticated
  using (public.get_user_role() = any (array['admin','coach']))
  with check (public.get_user_role() = any (array['admin','coach']));

drop policy if exists "Staff can delete situational plays" on situational_plays;
create policy "Staff can delete situational plays"
  on situational_plays for delete
  to authenticated
  using (public.get_user_role() = any (array['admin','coach']));

-- Seed standard situational content. Idempotent guard so re-running the
-- migration doesn't duplicate the seed.
insert into situational_plays (position_code, position_label, position_order, situation, responsibility, sort_order)
select * from (values
  -- Pitcher
  ('P','Pitcher',1,'Ground ball hit to the right side (1B/2B fielding it)','Break hard toward first base to cover the bag. Run to a spot just inside the line, give a target, and take the feed on the move.',1),
  ('P','Pitcher',1,'Wild pitch or passed ball with a runner on third','Sprint to cover home plate. Give the catcher a clear target, take the toss, and apply the tag toward the runner.',2),
  ('P','Pitcher',1,'Base hit to the outfield with runners on','Read where the throw is going and back up that base (home or third) about 25–30 feet behind it.',3),
  ('P','Pitcher',1,'Bunt in front of the plate','Field it only if you can get there cleanly. Call who takes it loudly, set your feet, and throw to the lead base you can get.',4),
  ('P','Pitcher',1,'After every pitch','Be ready to field — assume the ball is coming back at you and know the situation before you deliver.',5),
  -- Catcher
  ('C','Catcher',2,'Wild pitch / passed ball with a runner on third','Find the ball fast, get to it, and flip or shovel to the pitcher covering home with a clear target.',1),
  ('C','Catcher',2,'Bunt in front of the plate','Pop out, field with two hands, and call the base. Listen for the infielders telling you where the lead runner is.',2),
  ('C','Catcher',2,'Runner stealing second','Catch, transfer quickly, and throw through the bag — low and accurate to the tag side.',3),
  ('C','Catcher',2,'Play at the plate','Give the runner the plate, catch the ball first, then apply a swipe tag. Do not block without the ball.',4),
  ('C','Catcher',2,'Pop-up behind the plate','Turn your back to the infield, find the ball, and let it drift back toward the field as you settle under it.',5),
  -- First Base
  ('1B','First Base',3,'Ground ball hit to your right','Field it and either lead the covering pitcher to the bag or beat the runner there yourself.',1),
  ('1B','First Base',3,'Throw coming from an infielder','Stretch toward the throw, keep your foot on the inside corner, and adjust to scoop short hops.',2),
  ('1B','First Base',3,'Bunt situation','Charge on the pitch, field cleanly, and throw to the lead base — or take the sure out at first.',3),
  ('1B','First Base',3,'Extra-base hit down the right-field line','Be the cutoff/relay for throws coming toward home from right field.',4),
  ('1B','First Base',3,'Runner on first, pickoff throw','Hold the runner, give a low target, and apply a quick sweep tag.',5),
  -- Second Base
  ('2B','Second Base',4,'Ground ball with a runner on first (double play)','Get to the bag, take the feed, touch second, and turn the throw to first. Use footwork to clear the slide.',1),
  ('2B','Second Base',4,'Runner stealing second (right-handed batter)','Cover the bag per your team coverage, take the catcher''s throw, and apply the tag.',2),
  ('2B','Second Base',4,'Base hit to right field, runner advancing','Be the cutoff/relay for throws to third or home from right-center.',3),
  ('2B','Second Base',4,'Pop-up in shallow right','Call it early and loudly — you have priority over the first baseman drifting back.',4),
  ('2B','Second Base',4,'Pickoff or bunt at first','Back up throws to first when the first baseman is charging or holding the runner.',5),
  -- Third Base
  ('3B','Third Base',5,'Bunt down the third-base line','Charge, field barehanded or with the glove, and make a strong throw to first or the lead base.',1),
  ('3B','Third Base',5,'Hard ground ball or line drive','Knock it down and keep it in front — you''re the last line on the line. Recover and throw.',2),
  ('3B','Third Base',5,'Runner stealing third','Cover the bag and apply the tag on the catcher''s throw.',3),
  ('3B','Third Base',5,'Slow roller','Charge, field on the run, and throw across your body to first.',4),
  ('3B','Third Base',5,'Throw coming home from left field','Line up as the cutoff for throws to the plate from the left side.',5),
  -- Shortstop
  ('SS','Shortstop',6,'Ground ball with a runner on first (double play)','Cover second, take the feed, touch and turn to first, and clear the runner''s slide.',1),
  ('SS','Shortstop',6,'Runner stealing second (left-handed batter)','Cover the bag per your team coverage, take the throw, and apply the tag.',2),
  ('SS','Shortstop',6,'Extra-base hit to left or center','Go out as the relay man, line up with the target base, and redirect the throw quickly.',3),
  ('SS','Shortstop',6,'Pop-up in shallow left-center','You have priority over the third baseman and left fielder coming in — call it.',4),
  ('SS','Shortstop',6,'Relay communication','Be the voice on relays — tell the cutoff man where to go (cut, cut-2, cut-3, or let it through).',5),
  -- Left Field
  ('LF','Left Field',7,'Base hit to you with a runner on first','Charge the ball, field cleanly, and hit the cutoff (shortstop) on a line to hold the runner.',1),
  ('LF','Left Field',7,'Ball in the left-center gap','Communicate with center field — call who takes it, and back up if it isn''t yours.',2),
  ('LF','Left Field',7,'Fly ball with a runner tagging from third','Get behind the ball, catch with momentum toward home, and throw through the cutoff.',3),
  ('LF','Left Field',7,'Ground ball through the infield','Charge under control and field it to prevent extra bases.',4),
  ('LF','Left Field',7,'Backup duties','Back up third base on throws from the right side and on bunts.',5),
  -- Center Field
  ('CF','Center Field',8,'Any ball you can reach in the gaps','You''re the captain of the outfield — call off the corner outfielders on anything you can get.',1),
  ('CF','Center Field',8,'Base hit up the middle','Charge and hit the cutoff to hold runners.',2),
  ('CF','Center Field',8,'Fly ball with a tagging runner','Catch moving toward the target base and throw through the cutoff man.',3),
  ('CF','Center Field',8,'Backup duties','Back up second base on steals and throws, and back up the corner outfielders.',4),
  ('CF','Center Field',8,'Communication','Direct traffic — call the corner fielders off and signal the cutoffs.',5),
  -- Right Field
  ('RF','Right Field',9,'Base hit with a runner trying to score from second','Charge, field, and throw through the cutoff to the plate.',1),
  ('RF','Right Field',9,'Ground ball hit to you','Charge under control — a strong, accurate throw to third can stop the runner (you have the longest throw to third).',2),
  ('RF','Right Field',9,'Ball in the right-center gap','Communicate with center field — call it or back up.',3),
  ('RF','Right Field',9,'Backup duties','Back up first base on throws across the infield and pickoffs, and back up second on steals from the right side.',4),
  ('RF','Right Field',9,'Fly ball with a runner tagging','Catch with momentum and hit the cutoff.',5)
) as seed(position_code, position_label, position_order, situation, responsibility, sort_order)
where not exists (select 1 from situational_plays);
