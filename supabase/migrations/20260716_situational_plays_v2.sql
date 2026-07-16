-- #240: Situational Library Update. Expands the flat 5-per-position seed into a
-- full defensive-responsibilities reference, grouped by base state within each
-- position. Adds `group_label` so situations nest under sub-headers (Bases
-- Empty, Runner on 1st, ...). The universal charts (cutoff/relay, backups,
-- fly-ball priority, depths) and special team plays (rundown, 1st & 3rd, infield
-- fly, tag-ups) are rendered as static content in SituationalView (KnowledgeBase.js),
-- NOT stored here -- they're canonical and never edited.
--
-- DB was verified as the untouched original #225 seed (single timestamp, no
-- staff edits) before this full replace.

alter table situational_plays add column if not exists group_label text;

-- Full replace: drop the old flat seed, insert the grouped #240 content.
delete from situational_plays;

insert into situational_plays (position_code, position_label, position_order, group_label, situation, responsibility, sort_order)
values
  -- ============================ PITCHER ============================
  ('P','Pitcher',1,'Bases Empty','Ground ball to you','Field it, set your feet, throw firm and chest-high to first. Do not rush -- you have more time than you think.',1),
  ('P','Pitcher',1,'Bases Empty','Ground ball to the 1B/2B side','COVER FIRST. Break on contact, run a banana route to a spot up the line, then turn parallel to the baseline. Catch first, then find the bag; tag the inside edge.',2),
  ('P','Pitcher',1,'Bases Empty','Ball hit into the outfield','Back up the base the throw is most likely going to. Get deep -- 30+ feet behind the base, toward the fence.',3),
  ('P','Pitcher',1,'Bases Empty','Pop-up on the infield','Get out of the way. Point, direct traffic, do not call for it.',4),
  ('P','Pitcher',1,'Bases Empty','Bunt','Field anything you can get to. Listen for the catcher''s call or make it yourself. Glove-side pivot -- do not spin blindly.',5),
  ('P','Pitcher',1,'Runner on 1st','Comebacker','Turn glove side. Look the runner back if he''s gone, else lead the SS/2B to the bag chest-high and firm. 1-6-3 or 1-4-3.',6),
  ('P','Pitcher',1,'Runner on 1st','Ground ball right side','Cover first. Look for the trail runner.',7),
  ('P','Pitcher',1,'Runner on 1st','Base hit to the outfield','Back up third base. Get deep, stay in foul territory.',8),
  ('P','Pitcher',1,'Runner on 1st','Holding the runner','Vary looks and hold times. Slide-step, throw over. Predictable = giving away the base.',9),
  ('P','Pitcher',1,'Runner on 2nd','Base hit to the outfield','Read the play: clear score -> back up home; possible play at third -> back up third. If you can''t tell, sprint halfway up the 3B line in foul ground, then commit to one. Never straddle.',10),
  ('P','Pitcher',1,'Runner on 2nd','Comebacker, nobody out','Look him back to 2nd, then take the sure out at first.',11),
  ('P','Pitcher',1,'Runner on 3rd','Wild pitch / passed ball','SPRINT TO COVER HOME. Straddle the front edge or set up 3B-side, give the catcher a low target, catch it, sweep tag.',12),
  ('P','Pitcher',1,'Runner on 3rd','Comebacker, infield in','Check the runner. If he broke, throw home. If frozen, take the out at first.',13),
  ('P','Pitcher',1,'Runner on 3rd','Fly ball / sac fly','Get in position to back up home behind the catcher.',14),
  ('P','Pitcher',1,'Runner on 3rd','Squeeze bunt','Field it and flip underhand to the catcher, or dive-tag if he''s on top of you. Suicide squeeze bunted well -> take the out at first.',15),
  ('P','Pitcher',1,'Runners on 1st & 3rd','Hold the run','Step off, hold the ball, check the runner at third. Do not let him steal the run while everyone panics about first. Follow the called defense.',16),
  ('P','Pitcher',1,'Bases Loaded','Comebacker','Look home first. Runner close -> throw home for the force (1-2-3 DP is there). Else take the sure out.',17),
  ('P','Pitcher',1,'Rundowns','Trailer','Sprint hard at the runner from behind, run him back to the base he came from. One throw, one tag.',18),

  -- ============================ CATCHER ============================
  ('C','Catcher',2,'Every Pitch','Run the game','Give the sign, set a target, receive/frame, block anything in the dirt with runners on. Remind the infield of the outs and where the play is.',1),
  ('C','Catcher',2,'Bases Empty','Ground ball to the infield','Sprint down the line in foul territory to back up first. Every time.',2),
  ('C','Catcher',2,'Bases Empty','Dropped third strike (1B open or 2 outs)','Batter can run. Tag him or throw to first. Do not stand there.',3),
  ('C','Catcher',2,'Bases Empty','Pop-up','Turn your back to the infield -- backspin pulls it toward the infield. Mask off, hold it until you find the ball, then throw the mask clear of the play.',4),
  ('C','Catcher',2,'Bunt','Quarterback the play','You see the whole diamond. Can''t reach it -> loudly call the base: "ONE!" / "TWO!" / "THREE!". Can reach it -> field, plant, throw. Runner on 2nd, ball toward 3rd -> default is the sure out at first unless he''s slow.',5),
  ('C','Catcher',2,'Runner on 1st (Steal)','Get rid of it','Quick transition, short arm circle, throw through the bag chest-high on a line. RHH in the box -> step around him, don''t throw through him.',6),
  ('C','Catcher',2,'Runner on 1st (Steal)','Ball in the dirt','BLOCK IT. Body in front, chest over the ball, chin down, ball dies in front.',7),
  ('C','Catcher',2,'Runner on 2nd','Steal of 3rd','Clear your lane of the pitcher and hitter, come over the top, shuffle around a RHH if needed.',8),
  ('C','Catcher',2,'Runner on 2nd','Signs','Change / use multiple signs -- the runner is stealing them.',9),
  ('C','Catcher',2,'Runner on 3rd','Ball in the dirt is a run','Block everything, keep it in front and close.',10),
  ('C','Catcher',2,'Runner on 3rd','Wild pitch','Sprint to the ball, retrieve bare-hand or glove, turn glove side, firm underhand/short-arm feed to the pitcher covering. Don''t throw it into his face.',11),
  ('C','Catcher',2,'Ball to OF, runner scoring','Line up the play','Get to the front edge of the plate, line up the cutoff verbally. Make the call the instant the OF releases: "CUT!" / "CUT TWO/THREE/FOUR!" or say nothing. Catch first, sweep tag, check trailers.',12),
  ('C','Catcher',2,'Bases Loaded','Ground ball, force at home','Foot on the 1B-side corner of the plate, take the throw, then throw to first for the 2-3 DP. Foot off the plate before you throw to avoid the collision.',13),
  ('C','Catcher',2,'Rundowns (3rd-Home)','Lead it','Run the runner back toward third. Do not let him gain ground toward the plate. One throw if possible.',14),

  -- ============================ FIRST BASE ============================
  ('1B','First Base',3,'Every Pitch','Know your position','Know if you''re holding the runner or playing behind him, and how far you can roam for this hitter.',1),
  ('1B','First Base',3,'Bases Empty','Ground ball to you','Near the bag -> take it yourself, step on the base. Deep or off the line -> throw to the covering pitcher, lead him chest-high while he''s still 5-10 feet from the bag.',2),
  ('1B','First Base',3,'Bases Empty','Ground ball to another infielder','Get to the bag, find the corner with your foot, stretch to the throw -- but only after you know where it''s going.',3),
  ('1B','First Base',3,'Bases Empty','Bad throw','Come off the bag to catch it. The out is not worth an error and two bases.',4),
  ('1B','First Base',3,'Bases Empty','Short hop','Glove down early, let it come to you. Don''t stab.',5),
  ('1B','First Base',3,'Bases Empty','Pop-up in foul territory','Yours. Communicate with the catcher and pitcher.',6),
  ('1B','First Base',3,'Runner on 1st','Hold the runner','Right foot on the bag, low target, clear pickoff lane for the pitcher.',7),
  ('1B','First Base',3,'Runner on 1st','Pickoff throw','Catch and apply a low sweep tag toward the back edge of the bag.',8),
  ('1B','First Base',3,'Runner on 1st','Ground ball to you','3-6-3 (throw to SS at 2nd, sprint back for the return), 3-6 if you can''t get back, or take the sure out at first if unsure.',9),
  ('1B','First Base',3,'Runner on 1st','Ground ball elsewhere','Cover the bag, be a target for the DP relay.',10),
  ('1B','First Base',3,'Runner on 1st','Base hit to right field','Hustle toward RF as the trail/backup on the throw in, then get back to the bag.',11),
  ('1B','First Base',3,'Runner on 2nd/3rd, ball to OF','Cutoff to home','From CF and RF (and LF if your system uses "1B cuts all throws home"). Line up between the OF and the plate ~45-60 ft out, hands up, yell. Cut and hold, cut and throw, or let it pass -- never guess.',12),
  ('1B','First Base',3,'Bunt (Runner on 1st)','Charge','Charge hard on contact, field anything on the 1B side -- the pitcher covers first behind you. Wheel play (1st & 2nd): you and 3B charge, SS covers 3rd, 2B covers 1st.',13),
  ('1B','First Base',3,'Bases Loaded, infield in','Check the runner','Ground ball to you -> check the runner at home, throw home for the force, or take the sure out at first with two outs.',14),
  ('1B','First Base',3,'Rundowns (1st-2nd)','Take the back end','Chase the runner back toward first. You take the back end; 2B/SS takes the front.',15),

  -- ============================ SECOND BASE ============================
  ('2B','Second Base',4,'Every Pitch','You-me sign','Confirm with the SS who covers 2nd on a steal, comebacker, and pickoff. Cover your mouth, give it every pitch. General rule: SS covers on a RHH, 2B on a LHH -- but the sign is final.',1),
  ('2B','Second Base',4,'Bases Empty','Ground ball to you','Field, shuffle, throw firm to first across your body.',2),
  ('2B','Second Base',4,'Bases Empty','Ground ball to 1B','Break toward first immediately as the backup/outlet if the pitcher is late or 1B can''t get there.',3),
  ('2B','Second Base',4,'Bases Empty','Any throw from the left side to first','BACK IT UP. Get behind the first baseman in foul territory.',4),
  ('2B','Second Base',4,'Bases Empty','Pop-up in shallow right','Communicate with RF and 1B. The outfielder has priority -- if he calls it, get out.',5),
  ('2B','Second Base',4,'Runner on 1st (Double Play)','Ball hit to you (4-6-3)','Feed the SS on his left side chest-high. Close to the bag -> underhand toss, glove out of the way, follow your throw. Deep in the hole -> quick pivot, firm throw.',6),
  ('2B','Second Base',4,'Runner on 1st (Double Play)','Ball to SS or 3B (the pivot)','Get to the bag early, then read the throw. Across-the-bag or rock-back pivot -- whatever keeps you alive. Get the out at 2nd first, always.',7),
  ('2B','Second Base',4,'Runner on 1st (Double Play)','Steal of 2nd (if covering)','Get to the bag, set up on the 1B side, catch, drop the tag straight down at the front corner.',8),
  ('2B','Second Base',4,'Runner on 1st (Double Play)','Base hit to right field','Go out as the relay if it''s in the gap or off the wall; otherwise cover 2nd.',9),
  ('2B','Second Base',4,'Runner on 2nd','Hold him close','Fake toward the bag, communicate with the SS.',10),
  ('2B','Second Base',4,'Runner on 2nd','Ground ball, runner breaking','Check him. If running, look him back before you throw to first.',11),
  ('2B','Second Base',4,'Runner on 3rd, infield in','Play in','On the grass. Field cleanly, throw home chest-high on a line. Two outs -> take the easy out at first.',12),
  ('2B','Second Base',4,'Extra-base hit R / RC','Relay man','Sprint out on the line to your target base, glove side toward the infield to spin and throw, hands up, yell. SS trails you ~20 ft as the second relay.',13),
  ('2B','Second Base',4,'First & Third defense','Know the call','Take the throw at 2nd and step back at the runner on 3rd, or cut it short, or fake. Know the call before the pitch.',14),
  ('2B','Second Base',4,'Rundowns','1st-2nd','Run the runner back toward first.',15),

  -- ============================ SHORTSTOP ============================
  ('SS','Shortstop',5,'Every Pitch','You-me sign','Confirm with the 2B who covers on a steal / comebacker / pickoff.',1),
  ('SS','Shortstop',5,'Bases Empty','Ground ball to you','Field, crow-hop, throw across on a line. In the hole -> set your feet or take the extra step; you have more time than it feels.',2),
  ('SS','Shortstop',5,'Bases Empty','Slow roller','Charge, field out front on the run, throw on the run.',3),
  ('SS','Shortstop',5,'Bases Empty','Any throw from the right side to third','Back it up.',4),
  ('SS','Shortstop',5,'Bases Empty','Pop-up','You have priority over 3B, 2B, and P. Call it loud.',5),
  ('SS','Shortstop',5,'Runner on 1st (Double Play)','Ball hit to you (6-4-3)','Feed the 2B on his throwing-hand side chest-high, leading him to the bag. At the bag -> underhand flip. In the hole -> pivot and throw firm. Ranging left near the bag -> step on 2nd yourself, throw to first.',6),
  ('SS','Shortstop',5,'Runner on 1st (Double Play)','Ball to 1B or 2B (the pivot)','Get to the bag under control. Catch first, then find the bag. Hit the back edge with your left foot, push off toward left field to clear the runner.',7),
  ('SS','Shortstop',5,'Runner on 1st (Double Play)','Steal of 2nd (if covering)','Break late so the hitter doesn''t see it. Set up on the 3B side, catch, tag down, hold on.',8),
  ('SS','Shortstop',5,'Runner on 1st, base hit to OF','Cutoff for the throw to third','From any outfielder. Third base stays home. Line up between the OF and the bag, hands up, yell -- 3B makes the call.',9),
  ('SS','Shortstop',5,'Runner on 2nd','Hold him close','Bluff back to the bag. Every foot off his lead is a run you save.',10),
  ('SS','Shortstop',5,'Runner on 2nd','Ground ball to you','If he broke for 3rd, look him back or get him. Else take the out at first.',11),
  ('SS','Shortstop',5,'Bunt (1st & 2nd -- Wheel)','Cover third','3B is charging. Get there early, be a stationary target. Throw comes -> it''s a force, step on the bag.',12),
  ('SS','Shortstop',5,'Extra-base hit L / LC','Relay man','Sprint out on the line, hands up, glove side to the infield. 2B trails you ~20 ft. Listen for the trailer and infield calling the base.',13),
  ('SS','Shortstop',5,'Runner on 3rd, infield in','Charge','Field it, check the runner, throw home on a line chest-high.',14),
  ('SS','Shortstop',5,'Rundowns','2nd-3rd + trailer','Between 2nd and 3rd, and a trailer on everything else.',15),

  -- ============================ THIRD BASE ============================
  ('3B','Third Base',6,'Every Pitch','Know your depth','In (runner on 3rd, <2 out), normal, DP depth, guarding the line (late, protecting a lead), or bunt depth (in on the grass).',1),
  ('3B','Third Base',6,'Bases Empty','Ground ball / line drive','Field it, take your time, throw firm to first. Hard-hit ball -> you have more time than your adrenaline says.',2),
  ('3B','Third Base',6,'Bases Empty','Slow roller / swinging bunt','Charge, bare-hand it, throw on the run. Get the ball out of your hand before you''re standing straight up.',3),
  ('3B','Third Base',6,'Bases Empty','Pop-up in foul territory','Yours unless the SS calls you off. Watch the fence, dugout, tarp.',4),
  ('3B','Third Base',6,'Bases Empty','Any throw from the right side to second','Back it up if you can get there.',5),
  ('3B','Third Base',6,'Bunt (Runner on 1st)','Charge','Charge hard, field anything you reach -- catcher calls your base, default is the sure out at first. Wheel play (1st & 2nd): you charge, SS rotates to cover 3rd; force the lead out only if the bunt is hard and you''re moving to the bag, else take first.',6),
  ('3B','Third Base',6,'Runner on 1st','Ball hit to you','5-4-3 (feed 2B chest-high on his glove side) or 5-2-3 with a runner on 3rd. Close to the bag -> step on 3rd first, then throw.',7),
  ('3B','Third Base',6,'Runner on 2nd','Hold him','Bluff. The runner on 2nd is stealing signs. Ground ball -> if he''s moving to 3rd run him back or tag, else out at first.',8),
  ('3B','Third Base',6,'Runner on 3rd','Infield in / squeeze','Infield in: play on the grass, field, check the runner, throw home. Squeeze: charge, field, flip to the catcher -- or if popped up, catch it and double off the runner.',9),
  ('3B','Third Base',6,'Runner scoring, base hit to LF','Cutoff to home','Classic system: sprint to the line between LF and the plate ~45-60 ft out, hands up, yell, listen for the catcher. SS covers 3rd behind you. (If "1B cuts all throws home," stay at 3rd -- know your system.)',10),
  ('3B','Third Base',6,'Runner going 1st to 3rd','Stay at the bag','SS is the cutoff. You''re the receiver: straddle or set up outfield side, catch first, tag second, make the call -- "Cut!" or let it go.',11),
  ('3B','Third Base',6,'Rundowns','2nd-3rd / 3rd-home','Chase him back to the base he came from.',12),

  -- ============================ LEFT FIELD ============================
  ('LF','Left Field',7,'Every Pitch','Read the situation','Know the hitter, count, wind, sun, and fence behind you. Get moving on contact -- the first two steps decide the play.',1),
  ('LF','Left Field',7,'Any Ball Hit to You','Charge and throw to the cutoff','Charge every ground ball under control, field on the throwing-hand side, crow-hop. Throw chest-high on a line with one long hop -- a bouncing throw to the cutoff beats a rainbow to the base. Nobody on -> keep the hitter at first.',2),
  ('LF','Left Field',7,'Fly Balls','CF has priority','If he calls it, get out of the way but keep coming and back him up.',3),
  ('LF','Left Field',7,'Fly Balls','Sac fly (runner on 3rd, <2 out)','Get behind the ball so you''re moving toward the plate, catch over your throwing shoulder, crow-hop, fire to the cutoff.',4),
  ('LF','Left Field',7,'Fly Balls','Off the wall / in the gap','Get to it fast, find the relay man (SS), hit him chest-high. Don''t try to throw the runner out yourself.',5),
  ('LF','Left Field',7,'Runner on 1st, base hit to you','Throw to the cutoff (SS) at third','Runner is going 1st to 3rd. Charge, throw to the SS lined up with third. Get it in fast even if you can''t get him -- it keeps the batter at first.',6),
  ('LF','Left Field',7,'Runner on 2nd, base hit to you','Throw through the cutoff (3B) home','He''s scoring unless you''re perfect. Charge, crow-hop, throw through the cutoff toward home chest-high on a line. Let the infield decide whether to cut it.',7),
  ('LF','Left Field',7,'Backup Responsibilities','Where most of your outs come from','Back up third on every throw to third. Back up CF on anything to left-center. Back up 2nd on throws from the right side. Never stand still while the ball is in play.',8),
  ('LF','Left Field',7,'Situational Depth','Adjust to the game','No-doubles (late, protecting a lead): deep and toward the line -- give up the single, take away the double. Winning run at 2nd, tie game: shallow enough to have a chance at the plate.',9),

  -- ============================ CENTER FIELD ============================
  ('CF','Center Field',8,'Every Pitch','Captain of the outfield','Position the corner outfielders -- you see the whole field and the infield. Move with the count and the hitter. Take charge; nobody else will.',1),
  ('CF','Center Field',8,'Fly Balls','Anything you can reach is yours','Call it early, loud, three times. Runner on 3rd, <2 out -> get behind the ball, catch moving toward home, crow-hop, throw through the cutoff (1B).',2),
  ('CF','Center Field',8,'Ground Balls / Base Hits','Charge and get rid of it','Field on your throwing side. Nobody on -> keep the hitter at first. Ball in the gap -> find the relay man (SS for left-center, 2B for right-center), hit him chest-high.',3),
  ('CF','Center Field',8,'Backup Responsibilities','Your most valuable habit','Back up 2nd on EVERY catcher throw (steals) and every pickoff to 2nd -- an overthrow with no backup is a run. Back up LF and RF in the gaps -- both are yours. Back up 2nd on infield throws.',4),
  ('CF','Center Field',8,'Situational Depth','Adjust to the game','No-doubles: deep, and make the corner guys go deep with you. Late, winning run at 2nd: play in enough to make a play at the plate.',5),

  -- ============================ RIGHT FIELD ============================
  ('RF','Right Field',9,'Every Pitch','Get moving on contact','Often the strongest arm and the longest throw in the game (RF to 3rd). Know the hitter''s pull tendency and the count.',1),
  ('RF','Right Field',9,'Any Ball Hit to You','Charge the single','Runner on 1st is going 1st to 3rd -> charge hard, throw to the cutoff (SS) lined up with third. A hard, accurate throw keeps runners at second.',2),
  ('RF','Right Field',9,'Any Ball Hit to You','Throw behind runners','A runner who rounds a base too far is an out -- throw behind him to first or second. A right fielder''s specialty.',3),
  ('RF','Right Field',9,'Any Ball Hit to You','Runner on 2nd, base hit to you','He''s scoring. Charge, crow-hop, throw through the 1B (your cutoff) on a line to the plate.',4),
  ('RF','Right Field',9,'Fly Balls','CF has priority','Yield, then back him up.',5),
  ('RF','Right Field',9,'Fly Balls','Sac fly / gap / down the line','Sac fly -> get behind it, catch moving toward the plate, throw to the cutoff (1B). Right-center gap -> find the 2B as relay, hit chest-high. Down the line -> cut it off before the corner or it''s a triple.',6),
  ('RF','Right Field',9,'Backup Responsibilities','The most under-appreciated job in baseball','BACK UP FIRST ON EVERY THROW TO FIRST -- every infield grounder, every pickoff. An overthrow at first with no backup is worth two bases. Back up 2nd on throws from the left side. Back up CF in right-center.',7);

-- The General and Team Plays pseudo-positions (universal charts, prose, special
-- team plays) are appended in the picker and rendered as static content in
-- SituationalView -- they are not stored in this table.
