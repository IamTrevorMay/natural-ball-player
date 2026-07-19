/* ============================================================================
   hittingEngine.js — "Barrel Path" hitting diagnostic + roadmap engine.

   Dependency-free JS port of the vanilla-JS logic in
   "NBP Systems Development/hitting-development-engine.html" (the DOM render
   functions are NOT ported — the UI is rebuilt in src/HittingGenerator.js).

   Grades ~19 Blast / HitTrax / biomech metrics against level benchmarks,
   produces root-cause-branched findings ranked by leverage × severity, allocates
   a phased mesocycle (or annual macrocycle), and emits a weekly roadmap.

   Empirical basis for weighting contact quality over raw speed: analysis of
   Driveline's open OBP hitter data found bat speed alone explained ~10% of
   exit-velocity variance; adding stride/lead-leg mechanics tripled it. Hence the
   smash-factor + lead-leg-block logic. Coaching decision support, not medical advice.
   ========================================================================== */

export const LEVELS = ['youth', 'middleschool', 'hs_jv', 'hs_varsity', 'college', 'pro'];
export const LEVEL_NAME = {
  youth: 'Youth (8–12)', middleschool: 'Middle school (13–14)', hs_jv: 'HS JV',
  hs_varsity: 'HS Varsity', college: 'College', pro: 'Pro / MiLB',
};

// Level-graded benchmarks: bat speed (Blast), exit velo (HitTrax), rot accel (g), etc.
export const BM = {
  batspeed: { dir: 'up', unit: 'mph', by: {
    youth: { dev: [40, 48], good: 48 }, middleschool: { dev: [46, 54], good: 54 }, hs_jv: { dev: [53, 60], good: 60 },
    hs_varsity: { dev: [57, 64], good: 64 }, college: { dev: [61, 67], good: 67 }, pro: { dev: [66, 71], good: 71 } } },
  evmax: { dir: 'up', unit: 'mph', by: {
    youth: { dev: [50, 60], good: 60 }, middleschool: { dev: [60, 70], good: 70 }, hs_jv: { dev: [70, 78], good: 78 },
    hs_varsity: { dev: [82, 90], good: 90 }, college: { dev: [90, 98], good: 98 }, pro: { dev: [98, 105], good: 105 } } },
  evavg: { dir: 'up', unit: 'mph', by: {
    youth: { dev: [42, 50], good: 50 }, middleschool: { dev: [52, 60], good: 60 }, hs_jv: { dev: [60, 68], good: 68 },
    hs_varsity: { dev: [70, 78], good: 78 }, college: { dev: [80, 88], good: 88 }, pro: { dev: [88, 95], good: 95 } } },
  rotaccel: { dir: 'up', unit: 'g', by: {
    youth: { dev: [5, 8], good: 8 }, middleschool: { dev: [7, 10], good: 10 }, hs_jv: { dev: [8, 11], good: 11 },
    hs_varsity: { dev: [10, 13], good: 13 }, college: { dev: [12, 15], good: 15 }, pro: { dev: [14, 17], good: 17 } } },
  handspeed: { dir: 'up', unit: 'mph', by: {
    youth: { dev: [13, 16], good: 16 }, middleschool: { dev: [15, 18], good: 18 }, hs_jv: { dev: [17, 20], good: 20 },
    hs_varsity: { dev: [18, 21], good: 21 }, college: { dev: [20, 23], good: 23 }, pro: { dev: [22, 25], good: 25 } } },
  xfactor: { dir: 'up', unit: '°', by: {
    youth: { dev: [20, 30], good: 30 }, middleschool: { dev: [22, 32], good: 32 }, hs_jv: { dev: [25, 35], good: 35 },
    hs_varsity: { dev: [28, 40], good: 40 }, college: { dev: [32, 42], good: 42 }, pro: { dev: [35, 45], good: 45 } } },
  pelvis: { dir: 'up', unit: '°/s', by: {
    youth: { dev: [350, 500], good: 500 }, middleschool: { dev: [400, 550], good: 550 }, hs_jv: { dev: [450, 600], good: 600 },
    hs_varsity: { dev: [500, 650], good: 650 }, college: { dev: [600, 750], good: 750 }, pro: { dev: [700, 850], good: 850 } } },
  mbthrow: { dir: 'up', unit: 'mph', by: {
    youth: { dev: [12, 16], good: 16 }, middleschool: { dev: [15, 19], good: 19 }, hs_jv: { dev: [18, 22], good: 22 },
    hs_varsity: { dev: [20, 24], good: 24 }, college: { dev: [23, 27], good: 27 }, pro: { dev: [26, 30], good: 30 } } },
  cmj: { dir: 'up', unit: 'in', by: {
    youth: { dev: [12, 16], good: 16 }, middleschool: { dev: [14, 18], good: 18 }, hs_jv: { dev: [17, 21], good: 21 },
    hs_varsity: { dev: [19, 24], good: 24 }, college: { dev: [22, 27], good: 27 }, pro: { dev: [24, 30], good: 30 } } },
  dl: { dir: 'up', unit: '× BW', by: {
    youth: { dev: [0.5, 1.0], good: 1.0 }, middleschool: { dev: [0.8, 1.3], good: 1.3 }, hs_jv: { dev: [1.1, 1.6], good: 1.6 },
    hs_varsity: { dev: [1.4, 1.9], good: 1.9 }, college: { dev: [1.8, 2.3], good: 2.3 }, pro: { dev: [2.0, 2.5], good: 2.5 } } },
};

// Level-independent metrics.
export const UNIV = {
  ope: { dir: 'up', unit: '%', dev: [60, 70], good: 70 },
  seq: { dir: 'up', unit: '%', dev: [40, 70], good: 70 },
  ttc: { dir: 'down', unit: 's', dev: [0.15, 0.18], good: 0.15 },
  attack: { dir: 'band', unit: '°', band: [5, 15], soft: [0, 20] },
  earlyconn: { dir: 'band', unit: '°', band: [80, 100], soft: [70, 110], center: 90 },
  impconn: { dir: 'band', unit: '°', band: [80, 100], soft: [70, 110], center: 90 },
  hipir: { dir: 'up', unit: '°', dev: [20, 35], good: 35 },
  tspine: { dir: 'up', unit: '°', dev: [30, 45], good: 45 },
  ankle: { dir: 'up', unit: 'cm', dev: [5, 10], good: 10 },
};

// Metric input catalog (key, label, group) for the UI.
export const METRICS = [
  { key: 'batspeed', label: 'Bat speed', group: 'Swing output' },
  { key: 'rotaccel', label: 'Rotational acceleration', group: 'Swing output' },
  { key: 'ope', label: 'On-plane efficiency', group: 'Swing output' },
  { key: 'attack', label: 'Attack angle', group: 'Swing output' },
  { key: 'earlyconn', label: 'Early connection', group: 'Swing output' },
  { key: 'impconn', label: 'Connection @ impact', group: 'Swing output' },
  { key: 'ttc', label: 'Time to contact', group: 'Swing output' },
  { key: 'handspeed', label: 'Peak hand speed', group: 'Swing output' },
  { key: 'evmax', label: 'Exit velo — max', group: 'Ball flight, sequence & engine' },
  { key: 'evavg', label: 'Exit velo — average', group: 'Ball flight, sequence & engine' },
  { key: 'xfactor', label: 'Hip–shoulder separation', group: 'Ball flight, sequence & engine' },
  { key: 'seq', label: 'Kinematic sequence %', group: 'Ball flight, sequence & engine' },
  { key: 'pelvis', label: 'Peak pelvis velocity', group: 'Ball flight, sequence & engine' },
  { key: 'mbthrow', label: 'Rotational med-ball', group: 'Ball flight, sequence & engine' },
  { key: 'cmj', label: 'Counter-movement jump', group: 'Ball flight, sequence & engine' },
  { key: 'dl', label: 'Trap-bar deadlift (× BW)', group: 'Ball flight, sequence & engine' },
  { key: 'hipir', label: 'Hip internal rotation', group: 'Mobility' },
  { key: 'tspine', label: 'T-spine rotation', group: 'Mobility' },
  { key: 'ankle', label: 'Ankle dorsiflexion', group: 'Mobility' },
  { key: 'grip', label: 'Grip strength', group: 'Mobility' },
];

/* ---------- intervention library ---------- */
export const RX = {
  hipir: ['90/90 hip switches', 'Adductor rock-backs', 'Standing hip-airplane', 'Split-stance hip IR with band', 'Loaded 90/90 lift-offs'],
  tspine: ['Open-book rotations', 'Quadruped thoracic rotation reach-through', 'Bench t-spine extension', 'Half-kneel windmill', 'Bretzel stretch'],
  ankle: ['Knee-to-wall banded mobs', 'Weighted deep-squat holds', 'Calf raises through full ROM', 'Slant-board ankle rocks'],
  seq: ['Step-behind (walk-through) swings', "Hip-turn / 'back pocket down the line' drill", 'Fence-behind separation drill', 'Med-ball hip-fire throws', 'Constraint: pause-at-launch swings'],
  xfactor: ['Torque / separation drill (hips lead, shoulders hold)', 'Med-ball step-behind rotational throw', 'Band-resisted hip rotations', 'Coil-and-hold load drills', 'Dead-legs drill'],
  rotpower: ['Rotational scoop toss (max intent)', 'Standing side / shotput med-ball throw', 'Cable / landmine rotations', 'Med-ball rotational chest pass', 'Rotational slams'],
  strength: ['Trap-bar deadlift', 'Rear-foot elevated split squat', 'Hip thrust', 'Goblet / front squat', 'Single-leg RDL'],
  batspeed_speed: ['Overload/underload bat protocol (constraint)', "Turn / 'launch and go' drills", 'Speed-bat A-B swings', 'Heavy-ball into net for intent', 'Progressive intent ladders'],
  ope: ['PVC / on-plane trainer path drills', 'High-tee & low-tee plane matching', 'Top-hand & bottom-hand isolations', 'Tee at multiple heights (plane consistency)', 'Hitting through two tees (path gate)'],
  attack_low: ['Low-tee & down-and-away tee work', 'Uppercut path w/ high back-tee gate', 'Launch-angle intent on line drives', 'Attack-angle feedback swings on Blast'],
  attack_high: ['High-back-tee to flatten path', 'Level barrel-path drill', 'Line-drive intent (limit steepness)', 'Oppo-gap tee work'],
  connection: ['Connection-ball (towel/glove under lead arm) drill', 'Pause-and-hold at launch', 'Walk-through with connection cue', 'Med-ball connection throws', 'Barrel-to-shoulder tilt check swings'],
  casting: ['Inside-the-ball / stay-connected drills', 'Top-hand-only isolations', 'Connection-ball drill', 'Slow-mo turn to feel body-first sequence', 'Fence drill (no cast)'],
  contact: ['Small-ball / colored-dot BP', 'Two-strike short-bat contact rounds', 'Variable tee locations (barrel accuracy)', 'Vision + timing machine work', 'Bunt-to-barrel progressions'],
  handspeed: ['Wrist / forearm loading (rice bucket, wrist roller)', 'Speed-bat hand-path drills', 'Grip-strength work', 'Quick-hands ladder drills'],
};

/* ---------- grading ---------- */
function gradeUp(v, dev, good) { if (v >= good) return 'good'; if (v >= dev[0]) return 'dev'; return 'def'; }
function gradeDown(v, dev, good) { if (v <= good) return 'good'; if (v <= dev[1]) return 'dev'; return 'def'; }
function gradeBand(v, band, soft) { if (v >= band[0] && v <= band[1]) return 'good'; if (v >= soft[0] && v <= soft[1]) return 'dev'; return 'def'; }

export function statusOf(key, v, level) {
  if (v === null || Number.isNaN(v)) return null;
  if (BM[key]) { const b = BM[key].by[level]; return { status: gradeUp(v, b.dev, b.good), dev: b.dev, good: b.good, dir: 'up', unit: BM[key].unit }; }
  const u = UNIV[key];
  if (!u) return null;
  if (u.dir === 'up') return { status: gradeUp(v, u.dev, u.good), dev: u.dev, good: u.good, dir: 'up', unit: u.unit };
  if (u.dir === 'down') return { status: gradeDown(v, u.dev, u.good), dev: u.dev, good: u.good, dir: 'down', unit: u.unit };
  if (u.dir === 'band') return { status: gradeBand(v, u.band, u.soft), band: u.band, soft: u.soft, center: u.center, dir: 'band', unit: u.unit };
  return null;
}

export function gradeAll(V, level) {
  const S = {};
  for (const k in V) { const s = statusOf(k, V[k], level); if (s) { s.value = V[k]; S[k] = s; } }
  return S;
}

/* ============================================================
   DIAGNOSTIC ENGINE — root-cause-branched findings
   ============================================================ */
export function buildFindings(V, S, level) {
  const F = [];
  const is = (k, st) => S[k] && S[k].status === st;
  const bad = (k) => S[k] && (S[k].status === 'def' || S[k].status === 'dev');
  const def = (k) => S[k] && S[k].status === 'def';
  const sev = (k) => (!S[k] ? 1 : (S[k].status === 'def' ? 3 : (S[k].status === 'dev' ? 1 : 0)));
  const push = (o) => F.push(o);

  /* ---- MOBILITY (highest leverage) ---- */
  if (bad('hipir')) push({ cat: 'Mobility', tag: 'red', title: 'Restricted hip internal rotation', leverage: 5, sev: sev('hipir'),
    measured: `Hip IR ${V.hipir}° (target ≥${UNIV.hipir.good}°). Limited IR caps how far the pelvis can rotate and decelerate.`,
    root: 'Range-of-motion restriction at the hip. This physically limits pelvic rotational velocity, which sits at the base of the kinetic chain — so it silently caps bat speed and rotational acceleration no matter how the swing is coached.',
    why: 'Pelvis speed is the first domino in the pelvis→torso→arm→hand sequence. Free the hips and you raise the ceiling on everything downstream.',
    targets: ['Pelvis velocity', 'Bat speed', 'Rotational acceleration'], rx: RX.hipir });
  if (bad('tspine')) push({ cat: 'Mobility', tag: 'red', title: 'Limited thoracic-spine rotation', leverage: 5, sev: sev('tspine'),
    measured: `T-spine rotation ${V.tspine}° (target ≥${UNIV.tspine.good}°). Restricts hip–shoulder separation.`,
    root: "Thoracic mobility restriction. Without upper-back rotation the athlete can't create or hold hip–shoulder separation, so the 'stretch' that slingshots the barrel never loads.",
    why: 'X-factor separation is where barrel acceleration is stored. Restore t-spine rotation before trying to train separation as a skill.',
    targets: ['Hip–shoulder separation', 'Rotational acceleration'], rx: RX.tspine });
  if (bad('ankle')) push({ cat: 'Mobility', tag: 'amber', title: 'Limited ankle dorsiflexion', leverage: 3, sev: sev('ankle'),
    measured: `Knee-to-wall ${V.ankle}cm (target ≥${UNIV.ankle.good}cm). Affects lead-leg block and ground force.`,
    root: 'Ankle mobility restriction compromises the lead-leg block — the athlete leaks force forward instead of converting linear momentum into rotation against a firm front side.',
    why: 'A firm lead-leg block is how ground force becomes rotational speed. Weak block = energy leak = lost exit velocity.',
    targets: ['Lead-leg block', 'Exit velocity'], rx: RX.ankle });

  /* ---- SEQUENCING / SEPARATION ---- */
  if (bad('seq')) push({ cat: 'Sequencing', tag: 'red', title: 'Inconsistent kinematic sequence', leverage: 5, sev: sev('seq'),
    measured: `Correct pelvis→torso→arm→hand order on ${V.seq}% of swings (target ≥${UNIV.seq.good}%).`,
    root: "The chain is firing out of order — often hands/arms before torso. Energy leaks instead of transferring up the chain, which shows up as low rotational acceleration and a swing that's 'all arms'.",
    why: 'Proper sequencing is the single biggest driver of efficient bat speed and rotational acceleration. Fixing order raises output without needing more raw strength.',
    targets: ['Rotational acceleration', 'Bat speed', 'Time to contact'], rx: RX.seq });
  if (bad('xfactor')) push({ cat: 'Sequencing', tag: 'amber', title: 'Low hip–shoulder separation', leverage: 4, sev: sev('xfactor'),
    measured: `Peak separation ${V.xfactor}° (target ≥${BM.xfactor.by[level].good}° for ${LEVEL_NAME[level]}).`,
    root: (bad('tspine') ? 'Downstream of the t-spine restriction above — mobility first, then train the pattern.' : 'Movement-pattern issue: hips and shoulders are turning together instead of the hips leading and the shoulders holding to build stretch.'),
    why: 'Separation stores elastic energy that slingshots the barrel. More usable separation = more rotational acceleration for free.',
    targets: ['Rotational acceleration', 'Bat speed'], rx: RX.xfactor });

  /* ---- ROTATIONAL ACCELERATION (with casting red-flag) ---- */
  if (bad('rotaccel')) {
    const seqBad = bad('seq') || bad('xfactor');
    push({ cat: 'Rotational accel', tag: 'amber', title: 'Low rotational acceleration', leverage: 4, sev: sev('rotaccel'),
      measured: `${V.rotaccel}g (target ≥${BM.rotaccel.by[level].good}g; MLB avg ~17g). This is your barrel's 0-to-60.`,
      root: seqBad ? "Root cause is upstream sequencing/separation, not the barrel itself — the body isn't slingshotting the bat, so the athlete is left pulling it with the hands. Fix the sequence and this number rises with it."
        : "The bat isn't being launched explosively out of the load. With sequence intact, this is a rate-of-force / rotational-power gap — train explosive rotation at the source.",
      why: 'Higher rotational acceleration means the barrel gets to speed earlier — more consistent power AND more time to decide at the plate (later, better swing decisions).',
      targets: ['Bat speed', 'Time to contact', 'Swing decisions'], rx: seqBad ? RX.seq : RX.rotpower });
  }
  if (is('rotaccel', 'good') && (def('ope') || (S.earlyconn && S.earlyconn.status === 'def'))) {
    push({ cat: 'Pattern flag', tag: 'violet', title: 'Casting pattern — fast hands, poor path', leverage: 5, sev: 2, flag: true,
      measured: `Rotational accel is strong (${V.rotaccel}g) but on-plane efficiency${V.ope != null ? ` is ${V.ope}%` : ''}${S.earlyconn ? ` / early connection is off (${V.earlyconn}°)` : ''}.`,
      root: "The high g-number is coming from the hands firing before the torso — the sensor reads that pull-and-push as fast acceleration, but it's a cast. Speed without a good path produces fast misses, not barrels.",
      why: 'Chasing the g-number here makes contact worse. Re-sequence so the body drives the barrel, then the speed converts into squared-up contact.',
      targets: ['On-plane efficiency', 'Contact quality', 'Exit velocity'], rx: RX.casting });
  }

  /* ---- ON-PLANE / PATH / CONNECTION ---- */
  if (bad('ope')) push({ cat: 'Bat-to-ball', tag: 'red', title: 'Low on-plane efficiency', leverage: 4, sev: sev('ope'),
    measured: `OPE ${V.ope}% (target ≥70%; MLB avg ~68.6%). The barrel isn't matching the pitch plane long enough.`,
    root: 'The barrel spends too little of the swing on the pitch plane — usually a path issue (steep in/out of the zone) or a connection breakdown. This is the metric most tied to consistent barrels.',
    why: "On-plane time is what turns bat speed into flush contact. It's the strongest lever on batting average and hard-hit rate for a hitter who already has speed.",
    targets: ['Barrel-to-ball contact', 'Exit velocity', 'Batting average'], rx: RX.ope });
  ['earlyconn', 'impconn'].forEach((k) => {
    if (S[k] && S[k].status !== 'good') {
      const label = k === 'earlyconn' ? 'Early connection off' : 'Connection-at-impact off';
      push({ cat: 'Bat-to-ball', tag: 'amber', title: `${label} (${V[k]}° vs ~90°)`, leverage: 3, sev: sev(k),
        measured: `${V[k]}° — target ~90° (acceptable ~80–105°). Body tilt and bat angle aren't matched ${k === 'earlyconn' ? 'at the start of the downswing' : 'at impact'}.`,
        root: 'Body–bat relationship is out of sync, which shrinks plate coverage and hurts adjustability to different pitch locations.',
        why: 'Good connection (~90°) is what lets a hitter cover the whole zone and adjust — it feeds directly into on-plane efficiency and all-fields contact.',
        targets: ['Plate coverage', 'On-plane efficiency', 'Adjustability'], rx: RX.connection });
    }
  });
  if (S.attack && S.attack.status !== 'good') {
    const low = V.attack < UNIV.attack.band[0];
    push({ cat: 'Bat-to-ball', tag: 'amber', title: low ? 'Attack angle too flat / negative' : 'Attack angle too steep', leverage: 3, sev: sev('attack'),
      measured: `Attack angle ${V.attack}° (ideal ~+5° to +15°).`,
      root: low ? "A flat or downward path produces ground balls and mishits under the ball's plane — the barrel isn't matching the slight upward flight of the pitch."
        : 'An overly steep upswing narrows the margin for square contact and adds swing-and-miss, especially up in the zone.',
      why: 'An attack angle in the +5–15° window matches the pitch plane and maximizes flush, hard-hit contact — the batted balls that fall for hits.',
      targets: ['Launch angle', 'Exit velocity', 'Contact quality'], rx: low ? RX.attack_low : RX.attack_high });
  }

  /* ---- BAT SPEED (root-cause branching) ---- */
  if (bad('batspeed')) {
    let root; let rx; let tag = 'amber';
    const powerGap = bad('mbthrow') || bad('cmj') || bad('dl');
    const seqGap = bad('seq') || bad('xfactor') || bad('rotaccel');
    if (powerGap && !seqGap) { root = 'Bat speed is capped by a physical-power gap — the rotational-power and/or lower-body strength tests are below level. The mechanics can transfer force, but there isn\'t enough force to transfer yet.'; rx = RX.rotpower.concat(RX.strength.slice(0, 2)); }
    else if (seqGap && !powerGap) { root = 'The athlete has the physical tools but is leaking them through inefficient sequencing/separation — this is a movement-transfer problem, not a strength problem. Chasing more weight-room strength won\'t fix it.'; rx = RX.batspeed_speed.concat(RX.seq.slice(0, 2)); tag = 'red'; }
    else if (seqGap && powerGap) { root = 'Both engine and transfer are limiting bat speed — the athlete needs rotational power built AND a cleaner sequence to express it. Sequence work first so new strength has somewhere to go.'; rx = RX.seq.slice(0, 2).concat(RX.rotpower.slice(0, 3)); tag = 'red'; }
    else { root = 'Neither strength nor sequence tested clearly deficient, so the gap is likely rate-of-force / intent: the athlete can move fast but isn\'t training the swing at high intent. Use a constraint (over/underload) protocol to teach speed.'; rx = RX.batspeed_speed; }
    push({ cat: 'Power output', tag, title: 'Bat speed below level', leverage: 4, sev: sev('batspeed'),
      measured: `${V.batspeed} mph (target ≥${BM.batspeed.by[level].good} mph for ${LEVEL_NAME[level]}).`,
      root, why: 'Bat speed is the floor for exit velocity and hard-hit rate. It\'s a prerequisite for the level — but only useful when paired with on-plane efficiency.',
      targets: ['Exit velocity', 'Bat speed'], rx });
  }

  /* ---- EXIT VELO vs BAT SPEED = SMASH FACTOR ---- */
  if (V.evmax != null && V.batspeed != null) {
    const smash = V.evmax / V.batspeed;
    const batOK = S.batspeed && S.batspeed.status !== 'def';
    if (bad('evmax') && batOK) {
      push({ cat: 'Contact quality', tag: 'red', title: 'Exit velo trails bat speed (contact-quality gap)', leverage: 4, sev: 3,
        measured: `Bat speed is ${S.batspeed.status === 'good' ? 'on-level' : 'developing'} (${V.batspeed} mph) but max EV is only ${V.evmax} mph — smash factor ≈ ${smash.toFixed(2)}. Speed isn't converting to ball flight.`,
        root: 'The athlete is fast but not squaring the ball up. Off-center contact bleeds exit velocity even on a fast swing — the fix is barrel accuracy and on-plane time, not more speed.',
        why: 'Smash factor is where average bat speed becomes elite exit velocity. Closing this gap is the fastest path to a higher hard-hit rate and batting average for a fast swinger.',
        targets: ['Exit velocity', 'Barrel-to-ball contact', 'Batting average'], rx: RX.contact.concat(RX.ope.slice(0, 2)) });
    }
  } else if (bad('evmax')) {
    const contactGap = bad('ope') || (S.impconn && S.impconn.status !== 'good');
    push({ cat: 'Power output', tag: 'amber', title: 'Max exit velocity below level', leverage: 3, sev: sev('evmax'),
      measured: `Max EV ${V.evmax} mph (target ≥${BM.evmax.by[level].good} mph for ${LEVEL_NAME[level]}).`,
      root: contactGap ? 'Driven by contact quality — the path/connection findings above are bleeding energy before it reaches the ball.'
        : 'General power output — build bat speed at the source (rotational power + strength) and the ceiling on EV rises with it.',
      why: 'Max EV is the strongest single correlate of extra-base power and, at the top end, batting average on balls in play.',
      targets: ['Exit velocity', 'Batting average', 'Power'], rx: contactGap ? RX.contact : RX.rotpower });
  }
  if (bad('evavg') && !bad('evmax')) {
    push({ cat: 'Contact quality', tag: 'amber', title: 'Average exit velo trails peak', leverage: 3, sev: sev('evavg'),
      measured: `Avg EV ${V.evavg} mph vs a higher peak — the athlete flashes power but doesn't repeat it.`,
      root: 'Consistency of contact, not ceiling. The barrel finds the ball sometimes but not repeatably — a barrel-accuracy and timing issue.',
      why: 'College and pro evaluators weight AVERAGE exit velo over max, because it reflects repeatable hard contact — which is what drives batting average and OBP.',
      targets: ['Barrel-to-ball contact', 'Batting average', 'On-base %'], rx: RX.contact });
  }

  /* ---- SUPPORTING strength/power tests ---- */
  if (bad('mbthrow') && !F.some((f) => f.title === 'Bat speed below level')) {
    push({ cat: 'Power', tag: 'amber', title: 'Low rotational power (med-ball)', leverage: 3, sev: sev('mbthrow'),
      measured: `Rotational throw ${V.mbthrow} mph (target ≥${BM.mbthrow.by[level].good} mph).`,
      root: 'Rotational power at the source is below level — this is the engine that feeds bat speed. Building it raises the ceiling the swing can express.',
      why: 'Rotational power correlates strongly with bat speed and exit velocity. It\'s the transferable weight-room number for hitters.',
      targets: ['Bat speed', 'Exit velocity'], rx: RX.rotpower });
  }
  if (bad('dl') && !F.some((f) => f.cat === 'Power output')) {
    push({ cat: 'Strength', tag: 'amber', title: 'Below-level lower-body strength', leverage: 2, sev: sev('dl'),
      measured: `Trap-bar deadlift ${V.dl}× bodyweight (target ≥${BM.dl.by[level].good}×).`,
      root: 'Foundational strength gap. Not a swing problem per se, but strength is the base rotational power is built on — a low ceiling here caps power development.',
      why: 'Relative strength underpins force production and durability. It\'s a slow, foundational lever rather than a quick win.',
      targets: ['Rotational power', 'Durability'], rx: RX.strength });
  }
  if (bad('handspeed')) {
    push({ cat: 'Bat-to-ball', tag: 'amber', title: 'Low peak hand speed', leverage: 2, sev: sev('handspeed'),
      measured: `Peak hand speed ${V.handspeed} mph (target ≥${BM.handspeed.by[level].good} mph).`,
      root: 'Hand/forearm quickness and grip contribute to how fast the barrel is delivered and to time-to-contact. Often a supporting driver rather than the primary limiter.',
      why: 'Supports quicker time-to-contact and barrel delivery — a useful secondary target once sequence and connection are sound.',
      targets: ['Time to contact', 'Bat speed'], rx: RX.handspeed });
  }
  if (bad('ttc') && !F.some((f) => f.title.indexOf('rotational acceleration') > -1)) {
    push({ cat: 'Bat-to-ball', tag: 'amber', title: 'Slow time to contact', leverage: 3, sev: sev('ttc'),
      measured: `${V.ttc}s from launch to impact (quicker is better; elite ≤0.15s).`,
      root: 'The swing is long to the ball — usually tied to low rotational acceleration or a hand-heavy path. A quicker swing buys later, better swing decisions.',
      why: 'A quicker swing lets the hitter wait longer and gather more information — improving swing decisions, which drives on-base percentage.',
      targets: ['Swing decisions', 'On-base %'], rx: RX.seq.slice(0, 3).concat(RX.handspeed.slice(0, 2)) });
  }

  return F;
}

/* ============================================================
   PHASING — allocate weeks, biased by where the leverage sits
   ============================================================ */
export const KIND_COLOR = {
  foundation: 'violet', strength: 'cyan', power: 'amber', integration: 'green', inseason: 'blue', transition: 'gray',
};

export function buildPhases(findings, weeks, age) {
  const bigMobility = findings.some((f) => f.cat === 'Mobility' && f.sev >= 3);
  const bigSkill = findings.some((f) => ['Bat-to-ball', 'Contact quality'].includes(f.cat) && f.sev >= 3);

  const P = {
    transition: { kind: 'transition', name: 'Transition & Re-assessment',
      focus: 'Active recovery after the season, then a full re-test. Restore general athleticism, unload accumulated fatigue, and rebuild movement quality before the developmental blocks begin.' },
    foundation: { kind: 'foundation', name: 'Foundation & Corrective',
      focus: 'Restore mobility, own the movement patterns, and groove the correct kinematic sequence at low intent. Build the platform the rest of the plan stands on.' },
    strength: { kind: 'strength', name: 'Strength & Stability',
      focus: 'Build the force base — lower-body strength, anti-rotation core, lead-leg stability — while reinforcing sequence and connection in the cage.' },
    power: { kind: 'power', name: 'Power & Velocity',
      focus: 'Convert strength to rotational power and barrel speed: max-intent med-ball work, over/underload bat protocols, and bat-speed training.' },
    integration: { kind: 'integration', name: 'Skill Integration & Transfer',
      focus: 'Turn new speed into barrels: on-plane and connection refinement, barrel-accuracy and contact-quality work, then transfer against live velocity and peak.' },
    inseason: { kind: 'inseason', name: 'In-Season Maintenance',
      focus: 'Compete. Protect the swing and hold the gains: minimal-volume heavy strength, short high-intent power priming, and heavy emphasis on approach, timing, and swing decisions. Deload around game density.' },
  };
  const clone = (o, span) => Object.assign({}, o, { span });

  // ---------- ANNUAL MACROCYCLE (year-round) ----------
  if (weeks >= 40) {
    const devFrac = bigMobility ? 0.44 : (bigSkill ? 0.40 : 0.42);
    const trans1 = 3;
    const devW = Math.round(weeks * devFrac);
    const reset = 2;
    const inW = weeks - trans1 - devW - reset;
    let dp = [0.22, 0.28, 0.26, 0.24];
    if (bigMobility) dp = [0.32, 0.26, 0.22, 0.20];
    if (bigSkill && !bigMobility) dp = [0.16, 0.24, 0.24, 0.36];
    if (age !== null && age < 13) dp = [0.32, 0.20, 0.16, 0.32];
    const dcut = []; let a = 0;
    for (let i = 0; i < 4; i++) { a += dp[i]; dcut.push(Math.round(a * devW)); }
    dcut[3] = devW;
    let w = 1; const out = [];
    out.push(clone(P.transition, [w, w + trans1 - 1])); w += trans1;
    const devStart = w;
    const devPhases = [P.foundation, P.strength, P.power, P.integration];
    let prev = 0;
    devPhases.forEach((ph, i) => { const s = devStart + prev; const e = devStart + dcut[i] - 1; out.push(clone(ph, [s, e])); prev = dcut[i]; });
    w = devStart + devW;
    out.push(clone(P.inseason, [w, w + inW - 1])); w += inW;
    out.push(Object.assign({}, P.transition, { span: [w, weeks], name: 'Off-Season Reset',
      focus: "Short deload and re-assessment that closes the annual loop — re-run the diagnostic and feed the new numbers back into next year's off-season block." }));
    return out;
  }

  // ---------- STANDARD MESOCYCLE (< 40 weeks) ----------
  let p = [0.20, 0.27, 0.28, 0.25];
  if (bigMobility) p = [0.30, 0.25, 0.23, 0.22];
  if (bigSkill && !bigMobility) p = [0.15, 0.22, 0.25, 0.38];
  if (age !== null && age < 13) p = [0.30, 0.20, 0.18, 0.32];
  const cut = []; let acc = 0;
  for (let i = 0; i < 4; i++) { acc += p[i]; cut.push(Math.round(acc * weeks)); }
  cut[3] = weeks;
  const spans = [[1, cut[0]], [cut[0] + 1, cut[1]], [cut[1] + 1, cut[2]], [cut[2] + 1, cut[3]]];
  return [clone(P.foundation, spans[0]), clone(P.strength, spans[1]), clone(P.power, spans[2]), clone(P.integration, spans[3])];
}

/* ============================================================
   WEEKLY ROADMAP
   ============================================================ */
export function phaseOfWeek(w, phases) {
  for (let i = 0; i < phases.length; i++) { if (w >= phases[i].span[0] && w <= phases[i].span[1]) return phases[i]; }
  return phases[phases.length - 1];
}
function pick(arr, n, offset) {
  if (!arr || !arr.length) return [];
  const r = [];
  for (let i = 0; i < n; i++) r.push(arr[(offset + i) % arr.length]);
  return [...new Set(r)];
}

export function buildWeeks(findings, phases, weeks, days, age) {
  const youth = age !== null && age < 13;
  const teen = age !== null && age >= 13 && age <= 15;
  const mob = findings.filter((f) => f.cat === 'Mobility');
  const seqF = findings.filter((f) => ['Sequencing', 'Rotational accel'].includes(f.cat));
  const skillF = findings.filter((f) => ['Bat-to-ball', 'Contact quality', 'Pattern flag'].includes(f.cat));
  const drills = (fs) => fs.flatMap((f) => f.rx);
  const mobDefault = ['90/90 hip switches', 'Open-book t-spine rotations', 'Ankle knee-to-wall mobs'];

  const focusMap = {
    transition: 'Recover · re-assess · rebuild movement',
    foundation: mob.length ? 'Free the restrictions · groove the sequence' : 'Movement quality · pattern the swing',
    strength: 'Build the force base · reinforce connection',
    power: 'Convert to power · train bat speed at intent',
    integration: 'Barrels · contact quality · live transfer & peak',
    inseason: 'Compete · maintain gains · win swing decisions',
  };

  const out = [];
  for (let w = 1; w <= weeks; w++) {
    const ph = phaseOfWeek(w, phases);
    const kind = ph.kind;
    const wkInPhase = w - ph.span[0];
    const blocks = [];
    const mobPick = mob.length ? pick(drills(mob), 3, wkInPhase) : mobDefault;

    if (kind === 'transition') {
      blocks.push({ t: 'Movement & mobility', vol: 'daily · restore range', items: mobPick });
      blocks.push({ t: 'General athleticism', vol: '3×/wk · low stress', items: ['Play / cross-train (light sprints, jumps, other sports)', 'Full-body circuit, submaximal', 'Aerobic base work for recovery'] });
      blocks.push({ t: 'Swing — de-load & feel', vol: '2×/wk · low volume', items: ['Easy tee & flips, no metric chasing', 'Light rotational med-ball to keep the pattern'] });
      blocks.push({ t: 'Re-assessment', vol: 'once this block', items: ['Full re-test: Blast, exit velo, mobility screen, power tests', 'Re-run this diagnostic and reset the plan on current numbers'] });
      blocks.push({ t: 'Recovery', vol: 'ongoing', items: ['Prioritize sleep and tissue recovery — this block is where adaptation banks'] });
    } else if (kind === 'inseason') {
      blocks.push({ t: 'Movement prep', vol: 'pre-game/practice daily', items: mobPick });
      blocks.push({ t: 'Strength — maintain', vol: youth ? '1×/wk · light' : '1–2×/wk · heavy, very low volume', items: ['Main lift 2–3 crisp reps at high load (keep, don\'t build)', 'Lead-leg & single-leg stability', 'Anti-rotation core'] });
      blocks.push({ t: 'Power priming', vol: '1–2×/wk · short & explosive', items: ['A few max-intent rotational throws pre-game', 'Low-volume CMJ/plyo to stay springy', 'No fatiguing power volume during game weeks'] });
      const inSkill = skillF.length ? pick(drills(skillF), 2, wkInPhase).map((d) => `Maintenance: ${d}`) : ['Tee/flips — hold plane & connection'];
      blocks.push({ t: 'Swing & approach', vol: 'around the game schedule', items: inSkill.concat(['Approach & swing-decision work (chase/zone discipline for OBP)', 'Timing vs live/machine velocity']) });
      blocks.push({ t: 'Load management', vol: 'ongoing', items: ['Cut training volume in dense game weeks — games are the stimulus', 'Deload fully around tournaments/heavy stretches', 'Track swing counts + soreness; protect the swing over the number'] });
    } else if (kind === 'foundation') {
      blocks.push({ t: 'Movement prep', vol: 'daily · 8–10 min', items: mobPick });
      blocks.push({ t: 'Strength — foundation', vol: youth ? '2×/wk · bodyweight & med-ball' : '2×/wk · technique @ moderate load',
        items: youth ? ['Bodyweight squat & hinge patterning', 'Med-ball chest pass & slams', 'Anti-rotation core (Pallof holds)']
          : ['Goblet/front squat — pattern & control', 'Trap-bar deadlift — light, crisp reps', 'Pallof press & dead-bug (anti-rotation)'] });
      blocks.push({ t: 'Rotational patterning', vol: '2×/wk · low intent', items: (seqF.length ? pick(drills(seqF), 2, wkInPhase) : ['Step-behind walk-through swings', "Hip-turn 'back pocket' drill"]).concat(['Light rotational med-ball — feel sequence, not max']) });
      blocks.push({ t: 'Swing skill', vol: '3–4×/wk · quality reps', items: (skillF.length ? pick(drills(skillF), 3, wkInPhase) : ['Tee — plane & connection', 'Front toss — barrel accuracy']).map((d) => `Tee/constraint: ${d}`) });
      blocks.push({ t: 'Recovery & monitoring', vol: 'ongoing', items: ['Sleep 8–9h; deload every 4th week', 'Re-test at each phase boundary', 'Log intent-swing counts'] });
    } else if (kind === 'strength') {
      blocks.push({ t: 'Movement prep', vol: 'daily · 8–10 min', items: mobPick });
      blocks.push({ t: 'Strength — build the base', vol: youth ? '2×/wk · light & explosive' : (teen ? '3×/wk · moderate load' : '3×/wk · progressive load'), items: pick(RX.strength, 3, wkInPhase).concat(['Anti-rotation core: Pallof / suitcase carries']) });
      blocks.push({ t: 'Rotational power — intro', vol: '2×/wk · moderate intent', items: pick(RX.rotpower, 2, wkInPhase).concat(seqF.length ? pick(drills(seqF), 1, wkInPhase) : ['Separation / torque drill']) });
      blocks.push({ t: 'Swing skill', vol: '3–4×/wk · quality reps', items: (skillF.length ? pick(drills(skillF), 3, wkInPhase + 1) : ['Tee — plane & connection', 'Front toss — barrel accuracy']).map((d) => `Tee/constraint: ${d}`) });
      blocks.push({ t: 'Recovery & monitoring', vol: 'ongoing', items: ['Sleep 8–9h; deload every 4th week', 'Re-test at each phase boundary', 'Log intent-swing counts'] });
    } else if (kind === 'power') {
      blocks.push({ t: 'Movement prep', vol: 'daily · 8–10 min', items: mobPick });
      blocks.push({ t: 'Strength — power maintenance', vol: '2×/wk · heavy but low volume', items: ['Trap-bar deadlift or squat — 3×3 heavy', 'Single-leg / RFE split squat', 'Trunk anti-rotation'] });
      blocks.push({ t: 'Power & bat speed', vol: youth ? '2×/wk · med-ball intent (no heavy overload bats)' : '3×/wk · MAX intent',
        items: youth ? ['Max-intent rotational scoop toss', 'Turn-and-go swings (game bat)', 'Jump/plyo for lower-body power'] : pick(RX.rotpower, 2, wkInPhase).concat(pick(RX.batspeed_speed, 2, wkInPhase)) });
      blocks.push({ t: 'Swing skill', vol: '4×/wk · quality → competitive', items: (skillF.length ? pick(drills(skillF), 3, wkInPhase + 2) : ['BP — barrel accuracy at game intent', 'Machine — timing']).map((d) => `Front-toss: ${d}`) });
      blocks.push({ t: 'Transfer & swing decisions', vol: '1–2×/wk', items: ['Timing machine / live velocity at + level', 'Two-strike & count-based approach rounds', 'Track-and-decide (take/hack) drills for OBP'] });
      blocks.push({ t: 'Recovery & monitoring', vol: 'ongoing', items: ['Sleep 8–9h; deload every 4th week', 'Re-test at each phase boundary', 'Log intent-swing counts'] });
    } else { // integration
      blocks.push({ t: 'Movement prep', vol: 'daily · 8–10 min', items: mobPick });
      blocks.push({ t: 'Strength — maintain', vol: '1–2×/wk · keep the base', items: ['Full-body lift, submaximal', 'Lead-leg stability (SL RDL, step-downs)'] });
      blocks.push({ t: 'Power — express & transfer', vol: '2×/wk', items: ['Max-intent rotational throws (short, crisp)', 'Bat-speed intent swings, then straight into BP', 'CMJ / broad jump to keep RFD'] });
      blocks.push({ t: 'Swing skill', vol: '4×/wk · quality → competitive', items: (skillF.length ? pick(drills(skillF), 3, wkInPhase + 3) : ['BP — barrel accuracy at game intent', 'Live — timing & swing decisions']).map((d) => `Live/BP transfer: ${d}`) });
      blocks.push({ t: 'Transfer & swing decisions', vol: '2×/wk', items: ['Timing machine / live velocity at + level', 'Two-strike & count-based approach rounds', 'Track-and-decide (take/hack) drills for OBP'] });
      blocks.push({ t: 'Recovery & monitoring', vol: 'ongoing', items: ['Sleep 8–9h; deload every 4th week', 'Re-test at each phase boundary', 'Log intent-swing counts'] });
    }

    out.push({ week: w, kind, phaseName: ph.name, focus: focusMap[kind], deload: (w % 4 === 0 && kind !== 'transition'), blocks });
  }
  return out;
}

/* ============================================================
   PUBLIC API + serializer
   ============================================================ */
export function generatePlan({ values, level, age, weeks, days }) {
  const S = gradeAll(values, level);
  const findings = buildFindings(values, S, level);
  findings.forEach((f) => { f.score = f.leverage * 10 + f.sev; });
  findings.sort((a, b) => b.score - a.score);
  const phases = buildPhases(findings, weeks, age);
  const plan = buildWeeks(findings, phases, weeks, days, age);
  return { S, findings, phases, plan };
}

/**
 * Per-phase serializer: one program day per phase, holding that phase's first
 * week's blocks. training_exercises.category='hitting' is a native enum value.
 */
export function planToProgramDays(phases, plan) {
  return phases.map((ph) => {
    const wk = plan.find((w) => w.week >= ph.span[0] && w.week <= ph.span[1]) || plan[0];
    const blocks = wk ? wk.blocks : [];
    return {
      title: `${ph.name} (wk ${ph.span[0]}–${ph.span[1]})`,
      notes: ph.focus,
      exercises: blocks.map((b, i) => ({
        category: 'hitting',
        name: b.t,
        description: b.items.join('; '),
        reps: b.vol,
        sort_order: i,
      })),
    };
  });
}
