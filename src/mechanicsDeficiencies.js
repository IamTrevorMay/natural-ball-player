// #418 — the Mechanics note areas and their deficiency checklists.
//
// Cordell: "instead of hitting and pitching buttons ... have mechanics with
// a drop down menu for base running, hitting, pitching / throwing, catching
// and fielding. This is where each of those 5 sections will have the
// deficiencies list I emailed you for coaches to accurately diagnose and
// prescribe drills."
//
// The lists below are GENERATED from Cordell's
// "NBP Baseball Mechanical Deficiencies & Corrective Drills" PDF
// (prepared September 2026, loaded 2026-09-24). Each area is split into the
// PDF's sub-headings; every deficiency carries its corrective drill(s) and
// the source link from the PDF. player_notes.deficiencies stores the
// deficiency NAME only (plain string, exactly as it appears in `name`) —
// drills and links are looked up at render time via mechanicsDeficiencyInfo()
// so nothing is duplicated into the database. Coaches can still type a
// deficiency that isn't in the list; it's stored the same way.
//
// `value` is written to player_notes.area and is CHECK-constrained in
// 20260918_player_notes_mechanics.sql — do not rename without a migration.
// `pitchLog` turns on the pitch-by-pitch table for that area.

const AREAS = [
  {
    value: "base_running",
    label: "Base Running",
    groups: [
      {
        name: "Leads / secondary lead",
        items: [
          { name: "Lead too short or too long", drills: "Lead-off drill, aggressive lead with dive back", link: { label: "Baseball drills (Coach Baseball Right)", url: "https://coachbaseballright.com/baseball-drills/" } },
          { name: "Weight on heels / not athletic in lead", drills: "Lead-off drill (left, right, shuffle, shuffle)", link: { label: "Pro baserunning drills (Baseball Tutorials)", url: "https://www.baseball-tutorials.com/pro-baserunning-drills/2406/" } },
          { name: "Crossing feet on lead", drills: "Shuffle-lead drill", link: { label: "Pro baserunning drills (Baseball Tutorials)", url: "https://www.baseball-tutorials.com/pro-baserunning-drills/2406/" } },
          { name: "No secondary lead off the pitch", drills: "Two-shuffle secondary lead drill", link: { label: "Secondary lead drill (Little League)", url: "https://www.littleleague.org/university/articles/backyard-tip-secondary-lead-base-running-drill/" } },
          { name: "Secondary lead unbalanced when ball hits glove", drills: "Lead-after drill with pitcher and catcher", link: { label: "Baseball drills (Coach Baseball Right)", url: "https://coachbaseballright.com/baseball-drills/" } },
          { name: "Watching pitcher's face instead of trigger", drills: "Put-a-pitcher-out-there read drill", link: { label: "Baseball drills (Coach Baseball Right)", url: "https://coachbaseballright.com/baseball-drills/" } },
          { name: "Not reading pickoff tendencies", drills: "Lead-off tips and pickoff reads", link: { label: "Leading off first and second (Pro Baseball Insider)", url: "https://probaseballinsider.com/baseball-instruction/base-running/how-to-take-a-lead-at-1st-and-2nd-base/" } },
        ],
      },
      {
        name: "Start / acceleration",
        items: [
          { name: "False step backward", drills: "First-step drill on coach's bat clap", link: { label: "Base running drills (Veo)", url: "https://www.veo.com/en-us/article/baseball-base-running-drills" } },
          { name: "Standing tall in first steps", drills: "First-step drill with low drive cue", link: { label: "Base running drills (Veo)", url: "https://www.veo.com/en-us/article/baseball-base-running-drills" } },
          { name: "Crossover step slow or high", drills: "Stealing step-and-react drill", link: { label: "Baseball drills (Coach Baseball Right)", url: "https://coachbaseballright.com/baseball-drills/" } },
          { name: "Not driving arms", drills: "Run-throughs (tuck glove, pump arms)", link: { label: "Baseball drills (Coach Baseball Right)", url: "https://coachbaseballright.com/baseball-drills/" } },
          { name: "Turning head before feet move", drills: "Stealing drill (drop right foot, see the play, go)", link: { label: "Pro baserunning drills (Baseball Tutorials)", url: "https://www.baseball-tutorials.com/pro-baserunning-drills/2406/" } },
        ],
      },
      {
        name: "Running form",
        items: [
          { name: "Overstriding / heel striking", drills: "Run-through drills timed home to first", link: { label: "Baseball drills (Coach Baseball Right)", url: "https://coachbaseballright.com/baseball-drills/" } },
          { name: "Arms crossing body / head bobbing", drills: "Run-throughs with video review", link: { label: "Base running drills (Veo)", url: "https://www.veo.com/en-us/article/baseball-base-running-drills" } },
          { name: "Running with tension", drills: "Four-corner bat-clap relay", link: { label: "Baserunning drills (Oswego BSA)", url: "https://www.oswegobsa.org/Default.aspx?tabid=945638" } },
        ],
      },
      {
        name: "Base to base / turns",
        items: [
          { name: "Rounding first too wide or too tight", drills: "Round-first-and-dive-back drill", link: { label: "Baserunning drills (Oswego BSA)", url: "https://www.oswegobsa.org/Default.aspx?tabid=945638" } },
          { name: "Not tagging inside corner of base", drills: "Turns drill (competitive)", link: { label: "Baserunning drills (Baseball Tutorials)", url: "https://www.baseball-tutorials.com/dir/drills/baserunning/" } },
          { name: "Slowing before the base", drills: "Run-throughs, four-corner relay", link: { label: "Baserunning drills (Oswego BSA)", url: "https://www.oswegobsa.org/Default.aspx?tabid=945638" } },
          { name: "Not looking right after running through first", drills: "Run-through then look-right drill", link: { label: "Pro baserunning drills (Baseball Tutorials)", url: "https://www.baseball-tutorials.com/pro-baserunning-drills/2406/" } },
          { name: "Wrong angle out of the box (straight vs round)", drills: "Round-or-run-through decision drill", link: { label: "Baserunning drills (Baseball Tutorials)", url: "https://www.baseball-tutorials.com/dir/drills/baserunning/" } },
          { name: "Watching the ball instead of the coach", drills: "Base coach read drill with cones", link: { label: "Base running drills (Veo)", url: "https://www.veo.com/en-us/article/baseball-base-running-drills" } },
        ],
      },
      {
        name: "Sliding",
        items: [
          { name: "Sliding too late or too early", drills: "Sliding under defensive pressure drill", link: { label: "Baserunning drills (Baseball Tutorials)", url: "https://www.baseball-tutorials.com/dir/drills/baserunning/" } },
          { name: "Wrong leg / straight-leg slide", drills: "Square stand-up/sit-down slide drill", link: { label: "Baserunning drills (Baseball Tutorials)", url: "https://www.baseball-tutorials.com/dir/drills/baserunning/" } },
          { name: "Slow pop-up", drills: "Pop-up slide progression", link: { label: "Baserunning drills (Baseball Tutorials)", url: "https://www.baseball-tutorials.com/dir/drills/baserunning/" } },
          { name: "Head-first hands unprotected / not sliding at all", drills: "Fundamental sliding drill (feet-first for youth)", link: { label: "Baserunning drills (Baseball Tutorials)", url: "https://www.baseball-tutorials.com/dir/drills/baserunning/" } },
        ],
      },
      {
        name: "Situational / reads",
        items: [
          { name: "Slow reaction to pickoffs / diving late", drills: "Back-to-bag drill", link: { label: "Baseball drills (Coach Baseball Right)", url: "https://coachbaseballright.com/baseball-drills/" } },
          { name: "Tagging up early or late", drills: "Tag-up drill", link: { label: "Baserunning drills (Baseball Tutorials)", url: "https://www.baseball-tutorials.com/dir/drills/baserunning/" } },
          { name: "Not reading balls in the dirt", drills: "Ball-in-dirt advance drill (net behind plate)", link: { label: "Baserunning progressions (HS Baseball Web)", url: "https://community.hsbaseballweb.com/topic/base-running-progressions-drills" } },
          { name: "Not reading outfielder's angle on fly balls", drills: "First-to-third read drill (outfielder moves one step)", link: { label: "Baserunning drills (Human Kinetics)", url: "https://us.humankinetics.com/blogs/excerpt/baserunning-drills" } },
          { name: "Freezing or misreading line drives", drills: "Coach-call read drill (go / freeze / back)", link: { label: "Baserunning drills (Oswego BSA)", url: "https://www.oswegobsa.org/Default.aspx?tabid=945638" } },
        ],
      },
    ],
  },
  {
    value: "hitting",
    label: "Hitting",
    pitchLog: "hitting",
    groups: [
      {
        name: "Stance / setup",
        items: [
          { name: "Feet too wide or too narrow", drills: "Board drill (stand on a board through the swing)", link: { label: "Hitting drills list PDF", url: "https://cdn1.sportngin.com/attachments/document/0038/0579/Drills_List.pdf" } },
          { name: "Weight too far forward or on heels", drills: "Rear-eye test, board drill", link: { label: "Drills to fix lunging (Building Rome)", url: "https://www.buildingromeseries.com/hitting-drills/" } },
          { name: "Standing too tall or crouched excessively", drills: "K-posture drill on slant board", link: { label: "Power drills (Hitting Vault)", url: "https://thehittingvault.com/baseball-hitting-drills-power-2/" } },
          { name: "Bat wrapped too far behind head", drills: "Anti-wrap string drill", link: { label: "Youth hitting drills (GoRout)", url: "https://gorout.com/youth-baseball-hitting-drills/" } },
          { name: "Hands too high, low, or far from body", drills: "Mirror dry swings, fence drill", link: { label: "Tee work & BP routines (Batting Leadoff)", url: "https://battingleadoff.com/baseball-hitting-drills-tee-work-bp-routines/" } },
          { name: "Grip too tight / bat in palms", drills: "Skinny bat drill, one-hand drills", link: { label: "Youth hitting drills (GoRout)", url: "https://gorout.com/youth-baseball-hitting-drills/" } },
          { name: "Head not level / both eyes not on pitcher", drills: "Mirror dry swings, noodle drill", link: { label: "Drills to fix lunging (Building Rome)", url: "https://www.buildingromeseries.com/hitting-drills/" } },
          { name: "Bat angle too flat or too vertical", drills: "Flashlight barrel angle drill", link: { label: "Barrel angle drill (Hitting Performance Lab)", url: "https://hittingperformancelab.com/how-to-use-the-flashlight-barrel-angle-drill-to-boost-barreling-the-ball/" } },
        ],
      },
      {
        name: "Load / stride",
        items: [
          { name: "Doesn't load into back leg / no coil", drills: "Step-back drill, flamingo drill", link: { label: "Power drills (Hitting Vault)", url: "https://thehittingvault.com/baseball-hitting-drills-power-2/" } },
          { name: "Loads too early or too late", drills: "Pause-at-launch drill, soft toss fake drill", link: { label: "18 hitting drills (StriveOn)", url: "https://joinstriveon.com/blog/baseball-hitting-drills" } },
          { name: "Hands drop during load", drills: "High tee drill, Babe Ruth (scap pinch) drill", link: { label: "Babe Ruth drill (MLB Reds video)", url: "https://www.mlb.com/reds/video/babe-ruth-drill" } },
          { name: "Hands push back too far (hitch)", drills: "Anti-wrap string drill, pause-at-launch", link: { label: "Youth hitting drills (GoRout)", url: "https://gorout.com/youth-baseball-hitting-drills/" } },
          { name: "Stands up too tall in stride", drills: "K-posture drill, PVC-behind-back load drill", link: { label: "Indoor drills (WIN Reality)", url: "https://winreality.com/blog/indoor-baseball-drills/" } },
          { name: "Lunging / weight to front foot early", drills: "Noodle drill, rear-eye test, front foot platform drill", link: { label: "Drills to fix lunging (Building Rome)", url: "https://www.buildingromeseries.com/hitting-drills/" } },
          { name: "Front foot lands open or closed", drills: "Front foot platform drill, stride to cone", link: { label: "Hitting drills (WRSSBA)", url: "https://wrssba.com/coaches/skills-and-drills/hitting-drills/" } },
          { name: "Stride too long, short, or high", drills: "Heel-tap stride, bat-down over-stride check", link: { label: "Fix common hitting mistakes (Baseball Tutorials)", url: "https://www.baseball-tutorials.com/fix-hitting-mistakes/1752/" } },
          { name: "Head moves forward/up during stride", drills: "Noodle drill, kneeling swings", link: { label: "3 drills to stop lunging (Tanner Tees)", url: "https://blog.tannertees.com/drills/3-hitting-drills-to-stop-lunging.html" } },
          { name: "Front shoulder opens early (bailing)", drills: "Oppo-gap tee work, track ball to opposite gap", link: { label: "Fix pulling off the ball (Hit Lasers)", url: "https://hitlasers.com/baseball-hitting-drills-front-shoulder/" } },
          { name: "Front hip flies open before foot lands", drills: "Step-through drill, knob-to-knee drill", link: { label: "Youth hitting problems PDF (Colonial)", url: "https://colonialbaseballinstruction.com/wp-content/uploads/Top-5-Youth-Hitting-Problems-and-Drills-to-Fix-Them.pdf" } },
          { name: "No hip-hand separation at foot strike", drills: "PVC-behind-back load drill, step-through drill", link: { label: "Step through drill (PBI Academy)", url: "https://academy.probaseballinsider.com/courses/351917/lectures/5551814" } },
          { name: "Back knee collapses inward too early", drills: "Knee-down-to-pad drill (preload version)", link: { label: "3 hitting drills (ISNation)", url: "https://www.isnation.com/articles/3-baseball-hitting-drills-to-improve-your-swing" } },
        ],
      },
      {
        name: "Swing",
        items: [
          { name: "Casting / bar arm", drills: "Fence drill, knob-to-ball inside tee, front-hand only", link: { label: "7 slump drills (Mind & Muscle)", url: "https://mindandmuscle.ai/blog/swing-mechanics/baseball-swing-drills" } },
          { name: "Hands go around the ball", drills: "Inside tee to oppo, fence drill", link: { label: "7 slump drills (Mind & Muscle)", url: "https://mindandmuscle.ai/blog/swing-mechanics/baseball-swing-drills" } },
          { name: "Rolling top hand over early", drills: "Split-grip drill, top-hand palm-up soft toss", link: { label: "Fix head pulling & rollover (Baseball Skills Hub)", url: "https://www.baseballskillshub.com/video-feeds/fix-head-pulling-stop-rolling-over-in-baseball/" } },
          { name: "Bat drag (back elbow drags)", drills: "Flashlight barrel angle drill, ball-under-back-arm", link: { label: "Barrel angle drill (Hitting Performance Lab)", url: "https://hittingperformancelab.com/how-to-use-the-flashlight-barrel-angle-drill-to-boost-barreling-the-ball/" } },
          { name: "Chicken-wing front elbow", drills: "Front-hand only drill, fence drill", link: { label: "7 slump drills (Mind & Muscle)", url: "https://mindandmuscle.ai/blog/swing-mechanics/baseball-swing-drills" } },
          { name: "Attack angle too steep (chopping)", drills: "Double tee (front/back), low tee slight uppercut", link: { label: "Youth hitting problems PDF (Colonial)", url: "https://colonialbaseballinstruction.com/wp-content/uploads/Top-5-Youth-Hitting-Problems-and-Drills-to-Fix-Them.pdf" } },
          { name: "Attack angle too uppercut", drills: "High tee drill, high/low tee ladder", link: { label: "Batting drills for extreme uppercut (HPL)", url: "https://hittingperformancelab.com/baseball-batting-drills/" } },
          { name: "Arms-only swing / no hip rotation", drills: "Knee-down-to-pad drill, flamingo drill", link: { label: "3 hitting drills (ISNation)", url: "https://www.isnation.com/articles/3-baseball-hitting-drills-to-improve-your-swing" } },
          { name: "Spinning off / no firm front side", drills: "Knee-down-to-pad (front leg brace), oppo tee work", link: { label: "3 hitting drills (ISNation)", url: "https://www.isnation.com/articles/3-baseball-hitting-drills-to-improve-your-swing" } },
          { name: "Back foot not pivoting / stuck on backside", drills: "Step-through drill", link: { label: "Step through drill (PBI Academy)", url: "https://academy.probaseballinsider.com/courses/351917/lectures/5551814" } },
          { name: "Lifting back foot off ground", drills: "Board drill, knee-down-to-pad", link: { label: "Hitting drills list PDF", url: "https://cdn1.sportngin.com/attachments/document/0038/0579/Drills_List.pdf" } },
          { name: "Front knee doesn't firm up", drills: "Front foot platform drill, noodle drill", link: { label: "Hitting drills (WRSSBA)", url: "https://wrssba.com/coaches/skills-and-drills/hitting-drills/" } },
          { name: "Hips slide instead of rotate", drills: "Knee-down-to-pad, board drill", link: { label: "3 hitting drills (ISNation)", url: "https://www.isnation.com/articles/3-baseball-hitting-drills-to-improve-your-swing" } },
          { name: "Rear shoulder dips excessively", drills: "High tee drill", link: { label: "Hitting drills (WRSSBA)", url: "https://wrssba.com/coaches/skills-and-drills/hitting-drills/" } },
          { name: "Barrel drops below hands early (loop)", drills: "High tee, sock/heavy-bag path drill", link: { label: "Tee work & BP routines (Batting Leadoff)", url: "https://battingleadoff.com/baseball-hitting-drills-tee-work-bp-routines/" } },
          { name: "Late barrel", drills: "Bat-slot kneeling drill (bat lag), rapid-fire soft toss", link: { label: "Hitting drills list PDF", url: "https://cdn1.sportngin.com/attachments/document/0038/0579/Drills_List.pdf" } },
          { name: "Cutting swing off / no extension", drills: "Second tee in extension path, split-grip drill", link: { label: "Fix head pulling & rollover (Baseball Skills Hub)", url: "https://www.baseballskillshub.com/video-feeds/fix-head-pulling-stop-rolling-over-in-baseball/" } },
          { name: "Stopping rotation at contact", drills: "Flamingo drill, step-through drill", link: { label: "Power drills (Hitting Vault)", url: "https://thehittingvault.com/baseball-hitting-drills-power-2/" } },
        ],
      },
      {
        name: "Contact / finish",
        items: [
          { name: "Head pulls out at contact", drills: "Head-still tee drill, oppo focal point", link: { label: "Fix head pulling & rollover (Baseball Skills Hub)", url: "https://www.baseballskillshub.com/video-feeds/fix-head-pulling-stop-rolling-over-in-baseball/" } },
          { name: "Eyes come off ball", drills: "Bounce tennis ball drill, tracking to oppo gap", link: { label: "Tee work & BP routines (Batting Leadoff)", url: "https://battingleadoff.com/baseball-hitting-drills-tee-work-bp-routines/" } },
          { name: "Pulling off the ball (front side leaves)", drills: "Seven drills listed", link: { label: "Fix pulling off the ball (Hit Lasers)", url: "https://hitlasers.com/baseball-hitting-drills-front-shoulder/" } },
          { name: "Contact point too deep / too far out front", drills: "In/out call tee drill, inside-outside tee", link: { label: "18 hitting drills (StriveOn)", url: "https://joinstriveon.com/blog/baseball-hitting-drills" } },
          { name: "Top hand releases before contact", drills: "Top-hand only drill, split-grip drill", link: { label: "7 slump drills (Mind & Muscle)", url: "https://mindandmuscle.ai/blog/swing-mechanics/baseball-swing-drills" } },
          { name: "No balance at finish", drills: "Board drill, finish-and-hold with back knee drop", link: { label: "Youth hitting problems PDF (Colonial)", url: "https://colonialbaseballinstruction.com/wp-content/uploads/Top-5-Youth-Hitting-Problems-and-Drills-to-Fix-Them.pdf" } },
          { name: "Over-swinging / max effort", drills: "Skinny bat drill, 70% tee rounds", link: { label: "Youth hitting drills (GoRout)", url: "https://gorout.com/youth-baseball-hitting-drills/" } },
        ],
      },
      {
        name: "Timing / approach",
        items: [
          { name: "Consistently late or early", drills: "Soft toss fake drill, front toss with speed changes", link: { label: "Youth hitting problems PDF (Colonial)", url: "https://colonialbaseballinstruction.com/wp-content/uploads/Top-5-Youth-Hitting-Problems-and-Drills-to-Fix-Them.pdf" } },
          { name: "Different swing for every location", drills: "High/low tee ladder, in/out call drill", link: { label: "Tee work & BP routines (Batting Leadoff)", url: "https://battingleadoff.com/baseball-hitting-drills-tee-work-bp-routines/" } },
        ],
      },
    ],
  },
  {
    value: "pitching_throwing",
    label: "Pitching / Throwing",
    pitchLog: "pitching",
    groups: [
      {
        name: "Setup / balance",
        items: [
          { name: "Poor posture at set (rounded back, weight on heels)", drills: "Balance point hold, wall drill", link: { label: "17 pitching drills (StriveOn)", url: "https://joinstriveon.com/blog/baseball-pitching-drills" } },
          { name: "Head/eyes drift off target during leg lift", drills: "Mirror drill, balance point hold with ball handoff", link: { label: "17 pitching drills (StriveOn)", url: "https://joinstriveon.com/blog/baseball-pitching-drills" } },
          { name: "Leg lift too high or rushed; no balance at peak", drills: "Balance point hold, rocker-pivot-lift", link: { label: "Flying open drills (BaseballTips)", url: "https://baseballtips.com/flying-open-a-common-mechanical-pitching-fault/" } },
          { name: "Front hip drifts to plate before leg lift completes", drills: "Rocker-pivot-lift, lead with front hip bone", link: { label: "Flying open drills (BaseballTips)", url: "https://baseballtips.com/flying-open-a-common-mechanical-pitching-fault/" } },
          { name: "Rocking back too far behind rubber", drills: "Step-back / rocker drill", link: { label: "Lower half mechanics (Tread)", url: "https://treadathletics.com/back-leg-mechanics/" } },
        ],
      },
      {
        name: "Stride / lower half",
        items: [
          { name: "Back leg collapses early (knee caves, hips sink)", drills: "Step-back drills, split-stance throws, bucket drill", link: { label: "Lower half mechanics (Tread)", url: "https://treadathletics.com/back-leg-mechanics/" } },
          { name: "Drifting/falling down the mound instead of driving", drills: "Rocker drill, stride & explode", link: { label: "10 pitching drills (GoRout)", url: "https://gorout.com/baseball-pitching-drills/" } },
          { name: "Stride too short or too long", drills: "Stride & lean drill, stride drill with landing marker", link: { label: "Flying open drills (BaseballTips)", url: "https://baseballtips.com/flying-open-a-common-mechanical-pitching-fault/" } },
          { name: "Stride direction closed or open", drills: "Cone/barrier stride drill", link: { label: "Fix stride direction (Dugout Captain)", url: "https://www.dugoutcaptain.com/drill/fix-stride-direction/" } },
          { name: "Front knee not braced at foot strike (soft landing)", drills: "Rocker throws (front leg strength), Marshalls", link: { label: "Plyo drill guide (RPP)", url: "https://rocklandpeakperformance.com/plyo-balls-pitching-drills-for-you/" } },
          { name: "Front foot lands open or on the heel", drills: "Down-and-out stride drill, cone drill", link: { label: "Fix stride direction (Dugout Captain)", url: "https://www.dugoutcaptain.com/drill/fix-stride-direction/" } },
          { name: "Landing on a locked front leg too early", drills: "Rocker drill (feel load then brace)", link: { label: "Driveline plyo routine", url: "https://www.drivelinebaseball.com/2017/12/plyo-velocity-weighted-balls-replication/" } },
          { name: "Hips open early (before foot strike)", drills: "Roll-in throws (rear foot stays to target)", link: { label: "Plyoball routine (C2 Baseball)", url: "https://c2-baseball.com/training-en/plyoball-exercises-a-practical-baseball-throwing-routine/?lang=en" } },
          { name: "Hips never fully rotate (all arm)", drills: "Split-stance throws, stride & lean (turn back foot)", link: { label: "Fixing broken mechanics (The Right Spot)", url: "https://therightspot.substack.com/p/fixing-broken-pitching-mechanics" } },
          { name: "Back foot pulls off rubber early", drills: "Stride & lean (laces down finish)", link: { label: "40 pitching drills PDF", url: "https://media.hometeamsonline.com/photos/baseball/HUMBOLDTMINORBASEBALL/Pitching_Drills.pdf" } },
          { name: "Poor hip-shoulder separation", drills: "Roll-ins, pivot pickoffs, wall tap rotation", link: { label: "Plyoball routine (C2 Baseball)", url: "https://c2-baseball.com/training-en/plyoball-exercises-a-practical-baseball-throwing-routine/?lang=en" } },
        ],
      },
      {
        name: "Arm action",
        items: [
          { name: "Not equal-and-opposite at foot strike (arm late/early)", drills: "Hand break & lead arm action drill, cocked position drill", link: { label: "Flying open drills (BaseballTips)", url: "https://baseballtips.com/flying-open-a-common-mechanical-pitching-fault/" } },
          { name: "Elbow above shoulder line (inverted W)", drills: "Pivot pickoffs, reverse throws", link: { label: "Plyoball routine (C2 Baseball)", url: "https://c2-baseball.com/training-en/plyoball-exercises-a-practical-baseball-throwing-routine/?lang=en" } },
          { name: "Arm too short or too long in the back", drills: "Pivot pickoffs, Marshalls", link: { label: "Plyo drill guide (RPP)", url: "https://rocklandpeakperformance.com/plyo-balls-pitching-drills-for-you/" } },
          { name: "Palm up / pie throwing in cocking phase", drills: "Pivot pickoffs (hand inside elbow)", link: { label: "Plyoball routine (C2 Baseball)", url: "https://c2-baseball.com/training-en/plyoball-exercises-a-practical-baseball-throwing-routine/?lang=en" } },
          { name: "Wrapping ball behind head or body", drills: "Reverse throws, one-knee drill with chest-high target", link: { label: "17 pitching drills (StriveOn)", url: "https://joinstriveon.com/blog/baseball-pitching-drills" } },
          { name: "Short-arming / cutting off arm circle", drills: "Figure-eight arm drill, long toss", link: { label: "10 pitching drills (GoRout)", url: "https://gorout.com/baseball-pitching-drills/" } },
          { name: "Pushing the ball (elbow leads, no whip)", drills: "See 7 causes and fixes", link: { label: "Fix a pushing arm action (Tread)", url: "https://treadathletics.com/7-causes-of-pushing/" } },
          { name: "Elbow drops below shoulder at release", drills: "One-knee drill, partner glove at chest height", link: { label: "17 pitching drills (StriveOn)", url: "https://joinstriveon.com/blog/baseball-pitching-drills" } },
          { name: "Forearm flyout / elbow flares at release", drills: "Pivot pickoffs (late extension and pronation)", link: { label: "Plyoball routine (C2 Baseball)", url: "https://c2-baseball.com/training-en/plyoball-exercises-a-practical-baseball-throwing-routine/?lang=en" } },
          { name: "Wrist stiff / not behind the ball", drills: "Wrist flicks, 3 o'clock drill", link: { label: "Pitching drills PDF (WSSA)", url: "https://www.wssa.ca/wp-content/uploads/sites/135/2025/05/Pitching-Drills.pdf" } },
          { name: "Grip too deep in palm or too tight", drills: "Wrist flicks, fingertip release drill", link: { label: "Pitching drills PDF (WSSA)", url: "https://www.wssa.ca/wp-content/uploads/sites/135/2025/05/Pitching-Drills.pdf" } },
          { name: "Late arm (upper body races ahead)", drills: "Marshalls, pivot pickoffs, walking windups", link: { label: "Plyo drill guide (RPP)", url: "https://rocklandpeakperformance.com/plyo-balls-pitching-drills-for-you/" } },
        ],
      },
      {
        name: "Glove side / upper body",
        items: [
          { name: "Glove side flies open too early", drills: "Stay-closed drill (lead elbow to body), mirror & abdominal drill", link: { label: "Youth pitching drills (TeamGenius)", url: "https://teamgenius.com/baseball-pitching-drills/" } },
          { name: "Glove swings out and down instead of tucking", drills: "Glove tuck / fulcrum drill", link: { label: "Glove side mechanics (TopVelocity)", url: "https://www.topvelocity.net/2011/05/13/pitching-speed-and-the-glove/" } },
          { name: "Front shoulder pulls out early", drills: "Roll-ins, stay-closed drill", link: { label: "Flying open drills (BaseballTips)", url: "https://baseballtips.com/flying-open-a-common-mechanical-pitching-fault/" } },
          { name: "Lead arm drops and takes chest with it", drills: "Marshalls (glove-side integrity)", link: { label: "Plyo drill guide (RPP)", url: "https://rocklandpeakperformance.com/plyo-balls-pitching-drills-for-you/" } },
          { name: "Shoulders tilted excessively or too flat", drills: "One-knee drill, wall drill", link: { label: "17 pitching drills (StriveOn)", url: "https://joinstriveon.com/blog/baseball-pitching-drills" } },
          { name: "No forward trunk tilt over front leg at release", drills: "Towel drill (with rotation cue), stride & lean", link: { label: "Towel drill cautions (BetterPitching)", url: "https://betterpitching.com/more-pitching-drills-i-dont-like-the-towel-drill/" } },
          { name: "Trunk flexes before rotating", drills: "Pivot pickoffs, rotate back shoulder through target", link: { label: "Fix a pushing arm action (Tread)", url: "https://treadathletics.com/7-causes-of-pushing/" } },
          { name: "Head pulls off target / falls glove side", drills: "Mirror drill, balance point hold", link: { label: "17 pitching drills (StriveOn)", url: "https://joinstriveon.com/blog/baseball-pitching-drills" } },
          { name: "Torso leans back at release", drills: "Stride & lean, rocker throws", link: { label: "40 pitching drills PDF", url: "https://media.hometeamsonline.com/photos/baseball/HUMBOLDTMINORBASEBALL/Pitching_Drills.pdf" } },
        ],
      },
      {
        name: "Release / finish",
        items: [
          { name: "Release too early (sails) or too late (yanks)", drills: "Towel drill target, one-knee release drill", link: { label: "17 pitching drills (StriveOn)", url: "https://joinstriveon.com/blog/baseball-pitching-drills" } },
          { name: "No pronation through release", drills: "Pivot pickoffs, reverse throws", link: { label: "Plyoball routine (C2 Baseball)", url: "https://c2-baseball.com/training-en/plyoball-exercises-a-practical-baseball-throwing-routine/?lang=en" } },
          { name: "Recoiling / stopping arm abruptly", drills: "Follow-through drill, long toss", link: { label: "10 pitching drills (GoRout)", url: "https://gorout.com/baseball-pitching-drills/" } },
          { name: "Not finishing over front leg; standing up", drills: "Follow-through drill, one-knee finish", link: { label: "10 pitching drills (GoRout)", url: "https://gorout.com/baseball-pitching-drills/" } },
          { name: "Back leg doesn't come through to fielding position", drills: "Follow-through drill, walking windups", link: { label: "Driveline plyo routine", url: "https://www.drivelinebaseball.com/2017/12/plyo-velocity-weighted-balls-replication/" } },
          { name: "Falling off mound laterally", drills: "Cone stride drill, balanced finish hold", link: { label: "Fix stride direction (Dugout Captain)", url: "https://www.dugoutcaptain.com/drill/fix-stride-direction/" } },
        ],
      },
      {
        name: "Position-player throwing",
        items: [
          { name: "Throwing flat-footed / feet not under body", drills: "Rocker drill, crow-hop long toss", link: { label: "10 pitching drills (GoRout)", url: "https://gorout.com/baseball-pitching-drills/" } },
          { name: "Crow hop too big, too small, or absent", drills: "Long-toss crow hop progression", link: { label: "40 pitching drills PDF", url: "https://media.hometeamsonline.com/photos/baseball/HUMBOLDTMINORBASEBALL/Pitching_Drills.pdf" } },
          { name: "Shoulder not aligned to target", drills: "One-knee drill, stride & lean", link: { label: "40 pitching drills PDF", url: "https://media.hometeamsonline.com/photos/baseball/HUMBOLDTMINORBASEBALL/Pitching_Drills.pdf" } },
          { name: "Arm circle too long on quick throws", drills: "Pivot pickoffs, quick-transfer catch play", link: { label: "Driveline plyo routine", url: "https://www.drivelinebaseball.com/2017/12/plyo-velocity-weighted-balls-replication/" } },
          { name: "Throwing across the body", drills: "Cone stride drill, step-behind long toss", link: { label: "Fix stride direction (Dugout Captain)", url: "https://www.dugoutcaptain.com/drill/fix-stride-direction/" } },
        ],
      },
    ],
  },
  {
    value: "catching",
    label: "Catching",
    groups: [
      {
        name: "Stance / receiving",
        items: [
          { name: "Stance too wide or too narrow", drills: "Stool/bucket receiving drill, then rebuild stance", link: { label: "Catcher drill progression (Little League)", url: "https://www.littleleague.org/university/articles/catcher-drill-progression/" } },
          { name: "Sitting too high or too deep", drills: "Wall-sit framing, receiving progression", link: { label: "14 catching drills (StriveOn)", url: "https://joinstriveon.com/blog/softball-catching-drills" } },
          { name: "Weight on heels", drills: "Pre-pitch loosen-and-stick drill", link: { label: "Catcher drill progression (Little League)", url: "https://www.littleleague.org/university/articles/catcher-drill-progression/" } },
          { name: "Glove arm rigid / elbow locked", drills: "Bare-hand soft catches (IncrediBalls)", link: { label: "Catcher drill progression (Weik)", url: "https://www.weikfitness.com/top-catcher-drills/" } },
          { name: "Stabbing / glove presented early", drills: "Bare-hand receiving, stool drill", link: { label: "Catcher drill progression (Little League)", url: "https://www.littleleague.org/university/articles/catcher-drill-progression/" } },
          { name: "Reaching for pitches instead of moving", drills: "Move-your-body receiving drill", link: { label: "Youth catcher drills (Concord)", url: "https://www.concordsports.com/catcher-drills-for-youth-baseball/" } },
          { name: "Receiving late / ball beats the glove", drills: "Machine receiving reps at mound distance", link: { label: "Catcher drill progression (Little League)", url: "https://www.littleleague.org/university/articles/catcher-drill-progression/" } },
          { name: "Pulling pitches into the zone", drills: "Stick-on-catch drill (bare hand then glove)", link: { label: "Catcher drill progression (Little League)", url: "https://www.littleleague.org/university/articles/catcher-drill-progression/" } },
          { name: "Dropping glove on low pitches (no thumb-down turn)", drills: "Low-pitch bare-hand receiving", link: { label: "Catcher drill progression (Weik)", url: "https://www.weikfitness.com/top-catcher-drills/" } },
          { name: "Wrong glove turn on in/away pitches", drills: "Stool drill by pitch quadrant", link: { label: "Catcher drill progression (Little League)", url: "https://www.littleleague.org/university/articles/catcher-drill-progression/" } },
          { name: "Head pulls off ball at contact", drills: "Machine receiving reps", link: { label: "Catcher drill progression (Weik)", url: "https://www.weikfitness.com/top-catcher-drills/" } },
          { name: "Bare hand exposed", drills: "Receiving progression with hand-position checks", link: { label: "Catcher drills PDF (Baseball Sask)", url: "https://www.baseballsask.ca/assets/Drill-3-Catcher-Drills-Mark-Marianchuk.pdf" } },
          { name: "Set up too far from hitter / not shifting to pitch", drills: "Stance and set-up review in receiving stage", link: { label: "Catcher drill progression (Weik)", url: "https://www.weikfitness.com/top-catcher-drills/" } },
        ],
      },
      {
        name: "Blocking",
        items: [
          { name: "Late reaction / no anticipation", drills: "Rapid-fire side-to-side blocking", link: { label: "Top 5 blocking drills (Catching Made Simple)", url: "https://www.catchingmadesimple.com/blog/top-5-blocking-drills" } },
          { name: "Knees don't drop in time / five-hole open", drills: "Static drop from stance, glove-in-five-hole reps", link: { label: "Top 5 blocking drills (Catching Made Simple)", url: "https://www.catchingmadesimple.com/blog/top-5-blocking-drills" } },
          { name: "Chin up / not tucking", drills: "Blocking progression with chin-tuck cue", link: { label: "Catcher drill progression (Weik)", url: "https://www.weikfitness.com/top-catcher-drills/" } },
          { name: "Body not rounded / shoulders back", drills: "Blocking progression (chest over ball)", link: { label: "Catcher drill progression (Weik)", url: "https://www.weikfitness.com/top-catcher-drills/" } },
          { name: "Falling backward on impact", drills: "Static block-and-hold drill", link: { label: "Top 5 blocking drills (Catching Made Simple)", url: "https://www.catchingmadesimple.com/blog/top-5-blocking-drills" } },
          { name: "Not squaring to pitcher on lateral blocks", drills: "Lateral shuffle-then-block drill", link: { label: "Catcher drill progression (Weik)", url: "https://www.weikfitness.com/top-catcher-drills/" } },
          { name: "Kicking legs out instead of dropping", drills: "Shin-guard slide drill", link: { label: "Top 5 blocking drills (Catching Made Simple)", url: "https://www.catchingmadesimple.com/blog/top-5-blocking-drills" } },
          { name: "Slow recovery after block", drills: "Block-recover-reset drill", link: { label: "Catcher drill progression (Weik)", url: "https://www.weikfitness.com/top-catcher-drills/" } },
        ],
      },
      {
        name: "Throwing / footwork",
        items: [
          { name: "Slow transfer (catching too deep)", drills: "Feed-the-hand transfer drill, standing transfer off machine", link: { label: "Oregon State catching drills PDF", url: "https://jugssports.com/content/Casey/Oregon%20St.%20Catching%20Drill.pdf" } },
          { name: "Standing all the way up before throwing", drills: "Footwork/throw drill in block-throw stance", link: { label: "Oregon State catching drills PDF", url: "https://jugssports.com/content/Casey/Oregon%20St.%20Catching%20Drill.pdf" } },
          { name: "Footwork too slow or too big", drills: "T-drill, tic-tac-toe footwork board", link: { label: "5 transfer drills (KGS Baseball)", url: "https://kgsbaseball.com/blogs/kgs-baseball-blog/5-drills-to-improve-your-catchers-footwork" } },
          { name: "Not gaining ground toward second", drills: "Tic-tac-toe board footwork", link: { label: "Catcher drills PDF (Baseball Sask)", url: "https://www.baseballsask.ca/assets/Drill-3-Catcher-Drills-Mark-Marianchuk.pdf" } },
          { name: "Throwing from a narrow base", drills: "T-drill (land parallel to second)", link: { label: "5 transfer drills (KGS Baseball)", url: "https://kgsbaseball.com/blogs/kgs-baseball-blog/5-drills-to-improve-your-catchers-footwork" } },
          { name: "Throwing arm wraps / long takeaway", drills: "Takeaway drill (hand not behind elbow)", link: { label: "Catcher drills PDF (Baseball Sask)", url: "https://www.baseballsask.ca/assets/Drill-3-Catcher-Drills-Mark-Marianchuk.pdf" } },
          { name: "Shoulders not aligned to target", drills: "T-drill, imaginary-pitch replace-feet drill", link: { label: "Youth catcher drills (Concord)", url: "https://www.concordsports.com/catcher-drills-for-youth-baseball/" } },
          { name: "Popping up instead of forward / falling away", drills: "Footwork drill off machine, quick footwork six-ball drill", link: { label: "Oregon State catching drills PDF", url: "https://jugssports.com/content/Casey/Oregon%20St.%20Catching%20Drill.pdf" } },
          { name: "Elbow drops (sidearm tail)", drills: "Standing transfer drill, then one-knee throws", link: { label: "Fix 5 pop-time mistakes (Pro Baseball Insider)", url: "https://probaseballinsider.com/catchers-how-to-improve-pop-time-fix-these-5-killer-mistakes/" } },
        ],
      },
      {
        name: "Other",
        items: [
          { name: "Pop-ups: glove not up, back not to infield", drills: "Pop-up reading drill", link: { label: "14 catching drills (StriveOn)", url: "https://joinstriveon.com/blog/softball-catching-drills" } },
          { name: "Poor tag technique at plate", drills: "Plays-at-the-plate progression", link: { label: "Fix 5 pop-time mistakes (Pro Baseball Insider)", url: "https://probaseballinsider.com/catchers-how-to-improve-pop-time-fix-these-5-killer-mistakes/" } },
          { name: "Slow to bunts", drills: "Follow-your-throw bunt drill", link: { label: "Oregon State catching drills PDF", url: "https://jugssports.com/content/Casey/Oregon%20St.%20Catching%20Drill.pdf" } },
        ],
      },
    ],
  },
  {
    value: "fielding",
    label: "Fielding",
    groups: [
      {
        name: "Pre-pitch / ready position",
        items: [
          { name: "Standing tall, flat-footed at pitch", drills: "Wide-base ready position drill", link: { label: "16 fielding drills (StriveOn)", url: "https://joinstriveon.com/blog/baseball-fielding-drills" } },
          { name: "No pre-pitch hop or creep step", drills: "100% ready circle / creep step drill", link: { label: "Infield drills (Lincoln SE)", url: "https://home.lps.org/lsebaseball/home/fielding-philosophydrills/infield-drills/" } },
          { name: "Weight on heels", drills: "Wide-base ready position, tennis ball reaction drill", link: { label: "16 fielding drills (StriveOn)", url: "https://joinstriveon.com/blog/baseball-fielding-drills" } },
          { name: "Hands not out front / glove down", drills: "Knees-down hands drill (triangle)", link: { label: "Infield drill progression (Little League)", url: "https://www.littleleague.org/university/articles/infield-drill-progression/" } },
        ],
      },
      {
        name: "Approach to the ball",
        items: [
          { name: "Waiting on the ball instead of moving through", drills: "Cone approach drill, easy-balls tempo drill", link: { label: "Infield drills (Baseball Zone)", url: "http://www.baseballzone.com/infield-drills" } },
          { name: "Charging too aggressively on hard-hit balls", drills: "Three-cone random zone drill", link: { label: "How to field ground balls (Batting Leadoff)", url: "https://battingleadoff.com/how-to-field-ground-balls/" } },
          { name: "Not getting around the ball", drills: "Bucket/cone rounding drill", link: { label: "Infield drills (Baseball Zone)", url: "http://www.baseballzone.com/infield-drills" } },
          { name: "Poor angle (straight line, no banana route)", drills: "Bucket/cone rounding drill, four-cone range drill", link: { label: "Infield skills & drills PDF", url: "https://cdn4.sportngin.com/attachments/document/0116/9536/Infield_Skills_and_Drills.pdf" } },
          { name: "Feet stop before ball arrives", drills: "Choppy-feet approach, right-left-field drill", link: { label: "Infield drills (Lincoln SE)", url: "https://home.lps.org/lsebaseball/home/fielding-philosophydrills/infield-drills/" } },
          { name: "Outfielder drifts instead of sprinting to spot", drills: "Drop-step tracking, zig-zag cone drill", link: { label: "Outfield drills (Bruce Bolt)", url: "https://brucebolt.us/blogs/news/bruce-bolt-s-favorite-baseball-outfield-drills" } },
          { name: "Wrong first step (in on deep, back on shallow)", drills: "Coach-point drop step drill, reverse drop step", link: { label: "Fun outfield drills (Baseball Made Fun)", url: "https://baseballmadefun.com/fun-youth-baseball-outfield-drills/" } },
          { name: "Drop step too shallow or wrong direction", drills: "Drop step / crossover drill", link: { label: "Outfield drills (Clarksburg)", url: "https://www.clarksburgbaseball.com/outfield-drills/" } },
          { name: "Not reading hops", drills: "Wall-ball short hop drill, short-hop ladder", link: { label: "How to field ground balls (Batting Leadoff)", url: "https://battingleadoff.com/how-to-field-ground-balls/" } },
        ],
      },
      {
        name: "Fielding position",
        items: [
          { name: "Rear end too high / bending at waist only", drills: "Knees-down then wide-base progression", link: { label: "Infield drill progression (Little League)", url: "https://www.littleleague.org/university/articles/infield-drill-progression/" } },
          { name: "Glove not out front / fielding underneath", drills: "Triangle drill on knees", link: { label: "Infield drill progression (Little League)", url: "https://www.littleleague.org/university/articles/infield-drill-progression/" } },
          { name: "Glove flips palm-down late", drills: "Knees-down hands drill (glove catches raindrops)", link: { label: "16 fielding drills (StriveOn)", url: "https://joinstriveon.com/blog/baseball-fielding-drills" } },
          { name: "Stabbing at the ball", drills: "Soft-hands egg drill, flat training glove", link: { label: "How to field ground balls (Batting Leadoff)", url: "https://battingleadoff.com/how-to-field-ground-balls/" } },
          { name: "Stiff glove arm", drills: "Knees-down hands drill, flat glove reps", link: { label: "16 fielding drills (StriveOn)", url: "https://joinstriveon.com/blog/baseball-fielding-drills" } },
          { name: "Throwing hand not near glove (no funnel)", drills: "Funnel-to-belt drill", link: { label: "16 fielding drills (StriveOn)", url: "https://joinstriveon.com/blog/baseball-fielding-drills" } },
          { name: "Eyes leave ball before it enters glove", drills: "Knees-down hands drill, wall-ball", link: { label: "Ground ball drill (Kbands)", url: "http://kbandstraining.com/baseball-ground-ball-drill-footwork-and-hands/" } },
          { name: "Feet too narrow (no base)", drills: "Wide-base ready position drill", link: { label: "16 fielding drills (StriveOn)", url: "https://joinstriveon.com/blog/baseball-fielding-drills" } },
          { name: "Right-left-throw footwork missing", drills: "Right-left-field cone drill", link: { label: "Infield skills & drills PDF", url: "https://cdn4.sportngin.com/attachments/document/0116/9536/Infield_Skills_and_Drills.pdf" } },
          { name: "Glove closed / not open to ball", drills: "Throwing-side foot backhand drill (wrist relaxed)", link: { label: "Infield practice & drills (Clarksburg)", url: "https://clarksburgbaseball.teamsnapsites.com/infield-practice-drills/" } },
          { name: "Backhand: wrong foot forward, wrong glove angle", drills: "Throwing-side foot backhand, two-ball backhand drill", link: { label: "Infield practice & drills (Clarksburg)", url: "https://clarksburgbaseball.teamsnapsites.com/infield-practice-drills/" } },
          { name: "Forehand: not staying low", drills: "Forehand knee-down partner drill", link: { label: "Infield drill basics (WRSSBA)", url: "https://wrssba.com/coaches/skills-and-drills/infield-drill-basics/" } },
          { name: "Outfield: catching to side, flat-footed, not moving through", drills: "Two-hands-over-head drop step drill, tag-up throw drill", link: { label: "Outfield drills (GoRout)", url: "https://gorout.com/outfield-drills-for-youth-baseball/" } },
        ],
      },
      {
        name: "Transfer / throw",
        items: [
          { name: "Slow or fumbled transfer", drills: "Funnel-to-center then quick transfer, square drill", link: { label: "Infield drill basics (WRSSBA)", url: "https://wrssba.com/coaches/skills-and-drills/infield-drill-basics/" } },
          { name: "Long arm before throwing", drills: "Shuffle-and-throw cone drill", link: { label: "Infield practice & drills (Clarksburg)", url: "https://clarksburgbaseball.teamsnapsites.com/infield-practice-drills/" } },
          { name: "Not shuffling feet to target", drills: "Shuffle-and-throw cone drill, target contest", link: { label: "Infield practice & drills (Clarksburg)", url: "https://clarksburgbaseball.teamsnapsites.com/infield-practice-drills/" } },
          { name: "Throwing off wrong foot", drills: "Right-left-field footwork drill", link: { label: "Infield skills & drills PDF", url: "https://cdn4.sportngin.com/attachments/document/0116/9536/Infield_Skills_and_Drills.pdf" } },
          { name: "Standing up tall before throwing", drills: "Stay-low shuffle-and-throw drill", link: { label: "Infield practice & drills (Clarksburg)", url: "https://clarksburgbaseball.teamsnapsites.com/infield-practice-drills/" } },
          { name: "Momentum away from target", drills: "Shuffle vs crow-hop selection drill", link: { label: "Fielding drills (GoRout)", url: "https://gorout.com/baseball-fielding-drills/" } },
          { name: "Outfielder no crow hop / stationary throw", drills: "Crow hop partner drill, long toss progression", link: { label: "Outfield drills (Veo)", url: "https://www.veo.com/en-us/article/baseball-outfield-drills" } },
          { name: "Throw airmailed or bounced", drills: "Cutoff drill (throw at cutoff head), target contest", link: { label: "Outfield drills (GoRout)", url: "https://gorout.com/outfield-drills-for-youth-baseball/" } },
          { name: "Double play: far from base, poor pivot", drills: "Force-out footwork drill, double-play feed drill", link: { label: "Infield drills (Baseball Zone)", url: "http://www.baseballzone.com/infield-drills" } },
        ],
      },
    ],
  },
];

// `deficiencies` (flat list of names, in PDF order) is what NoteEditor's
// chip list and the "is this a custom deficiency?" check read.
export const MECHANICS_AREAS = AREAS.map(a => ({
  ...a,
  deficiencies: a.groups.flatMap(g => g.items.map(i => i.name)),
}));

export const mechanicsArea = (value) => MECHANICS_AREAS.find(a => a.value === value) || null;
export const mechanicsAreaLabel = (value) => mechanicsArea(value)?.label || value || '';

/**
 * Drills + source link for a flagged deficiency, or null when the name isn't
 * in the area's list (a coach-typed custom deficiency). Matching is
 * case/whitespace-insensitive so a note saved with slightly different
 * spacing still resolves.
 */
export const mechanicsDeficiencyInfo = (areaValue, name) => {
  const area = mechanicsArea(areaValue);
  if (!area || !name) return null;
  const key = String(name).replace(/\s+/g, ' ').trim().toLowerCase();
  for (const g of area.groups) {
    const hit = g.items.find(i => i.name.toLowerCase() === key);
    if (hit) return { ...hit, group: g.name };
  }
  return null;
};
