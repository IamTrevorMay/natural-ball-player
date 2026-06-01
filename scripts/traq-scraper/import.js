#!/usr/bin/env node
/**
 * Import TRAQ assessment CSVs into NBP assessment_submissions table.
 *
 * Usage:
 *   node import.js              # Generate SQL to submissions.sql
 *   node import.js --dry-run    # Show mapping/matching info only
 *
 * Reads CSVs from /Users/trevor/Desktop/NBP Assessments/
 * Reads player list from ./players.json (exported via Supabase MCP)
 * Matches CSV columns to template element IDs via fuzzy label normalization.
 * Outputs INSERT SQL to submissions.sql for execution via Supabase.
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

// ── Config ──────────────────────────────────────────────────────────────────

const CSV_DIR = '/Users/trevor/Desktop/NBP Assessments';
const PLAYERS_FILE = path.join(__dirname, 'players.json');
const OUTPUT_FILE = path.join(__dirname, 'submissions.sql');
const ASSESSED_BY = 'a54ed4a5-88ec-45fb-bfbf-844b1bca467b'; // Trevor May
const ASSESSMENT_DATE = '2026-06-01';
const DRY_RUN = process.argv.includes('--dry-run');

// ── Template definitions ────────────────────────────────────────────────────
// CSV filename → { templateId, schema: [{ id, label }] }

const TEMPLATES = {
  'Strength & Conditioning.csv': {
    templateId: '9c9b0eb3-5307-4dee-96cb-0428716af0fa',
    schema: [
      { id: 'el_1773859265531_u63o', label: 'Height (in):' },
      { id: 'el_1773859322496_egtp', label: 'Weight (lbs):' },
      { id: 'el_1773859352488_mp2m', label: 'Glasses (Y/N):' },
      { id: 'el_1773859364832_bx8k', label: 'Previous Surgeries:' },
      { id: 'el_1773859395784_yt8n', label: 'Grip Strength (R/L):' },
      { id: 'el_1773859423241_tg13', label: 'Pushups to Failure:' },
      { id: 'el_1773859439220_deqv', label: 'Vertical Jump (in):' },
      { id: 'el_1773859465902_sqnz', label: 'Seated Vertical Jump (in):' },
      { id: 'el_1773859486167_16lr', label: 'Approach Vertical Jump (in):' },
      { id: 'el_1773859505027_k5ke', label: 'Depth Drop Jump (in):' },
      { id: 'el_1773859533334_qaap', label: 'Trap Bar Jump (in):' },
      { id: 'el_1773859548371_4gy1', label: 'Broad Jump (in):' },
      { id: 'el_1773859569168_5rdu', label: 'Rotational Med Ball Scoop Toss Velo (mph):' },
      { id: 'el_1773859628596_n9bz', label: 'SL Broad Jump R/L (in):' },
      { id: 'el_1773859674788_cb0t', label: 'Hip ER/IR R/L:' },
      { id: 'el_1773859693148_s16d', label: 'Shoulder ER/IR R/L:' },
      { id: 'el_1773859705347_5tyv', label: 'Ankle Mobility R/L:' },
      { id: 'el_1773859713246_nfre', label: 'Wrist Mobility R/L:' },
      { id: 'el_1773859721045_kyc4', label: 'T-Spine Flexion Extension ROM:' },
      { id: 'el_1773859733771_tx4d', label: '10 Yard Sprint (Sec):' },
      { id: 'el_1773859751026_6810', label: 'Lateral Bound To Stick:' },
      { id: 'el_1773859765009_0n2c', label: 'Palloff Press Iso Test:' },
      { id: 'el_1773859772914_hmke', label: 'Nordic Hamstring Strength Test:' },
      { id: 'el_1773859796511_cx3i', label: 'Lateral 5/10/5:' },
    ],
  },
  'Hitting Assessment.csv': {
    templateId: '98236ec2-dbd9-4e29-810e-6b261e5a2e86',
    schema: [
      { id: 'el_1773859910301_hisg', label: 'Mechanics Report:' },
      { id: 'el_1773859922321_5qxb', label: 'Bat Speed (MPH):' },
      { id: 'el_1773864748139_a65j', label: 'Time to Contact (Seconds)' },
      { id: 'el_1773859933776_tq67', label: 'Exit Velo Tee Outside (MPH):' },
      { id: 'el_1773859953394_u78l', label: 'Exit Velo Tee Middle (MPH):' },
      { id: 'el_1773859964330_ahjt', label: 'Exit Velo Tee Inside (MPH):' },
      { id: 'el_1773859975849_sapi', label: 'Bat Length (in)/ Weight (oz):' },
      { id: 'el_1773860110996_w7jt', label: 'Underload Exit Velo Tee Middle (MPH):' },
      { id: 'el_1773860145409_66qb', label: 'Overload Exit Velo Tee Middle (MPH):' },
      { id: 'el_1773860156926_520e', label: 'What do they do for warmups / duration of warmups:' },
      { id: 'el_1773860209799_ssl1', label: 'Bat Brand / Model:' },
      { id: 'el_1773860218064_zikn', label: 'T-Spine Mobility Grading:' },
      { id: 'el_1773860227785_ax6v', label: 'Front Toss EV (MPH):' },
      { id: 'el_1773860241558_ofp3', label: 'Machine EV (MPH):' },
    ],
  },
  'Pitching Assessment.csv': {
    templateId: 'a0b983cf-a9b6-46de-aeea-1b6e7b823462',
    schema: [
      { id: 'el_1773860448048_ts9m', label: 'What do they do for warmups / duration of warmup:' },
      { id: 'el_1773860457604_hcx2', label: '4 Seam FB Shape/Velo (MPH):' },
      { id: 'el_1773860484651_kz2b', label: '2 Seam FB (Sinker) Shape / Velo (MPH):' },
      { id: 'el_1773860499984_iqp6', label: '4 Seam Changeup Shape / Velo (MPH):' },
      { id: 'el_1773860569865_zr3z', label: '2 Seam Changeup Shape / Velo (MPH):' },
      { id: 'el_1773860583579_b9ny', label: '4 Seam Curveball Shape / Velo (MPH):' },
      { id: 'el_1773860656256_twra', label: '2 Seam Curveball Shape / Velo (MPH):' },
      { id: 'el_1773860669711_104q', label: '4 Seam Slider Shape / Velo (MPH):' },
      { id: 'el_1773860696848_e25k', label: '2 Seam Slider Shape / Velo (MPH):' },
      { id: 'el_1773860718430_p0ww', label: '4 Seam Splitter Shape / Velo (MPH):' },
      { id: 'el_1773860745233_icni', label: '2 Seam Splitter Shape / Velo (MPH):' },
      { id: 'el_1773860762625_hslx', label: 'Cutter Shape / Velo (MPH):' },
      { id: 'el_1773860782044_q2su', label: 'Knuckleball Shape/Velo (MPH):' },
      { id: 'el_1773861109162_cqdy', label: 'Shuffle Fire Velo 5 Ounce (MPH):' },
      { id: 'el_1773861117096_ymsh', label: 'Pulldown Velo 5 Ounce (MPH):' },
      { id: 'el_1773861135272_gxtc', label: 'Rockers Plyo Ball B/R/Y/G Velo (MPH):' },
      { id: 'el_1773861155492_r27a', label: 'Stepbacks Plyo Ball B/R/Y/G Velo (MPH):' },
      { id: 'el_1773861171278_iyqr', label: 'Rollins Plyo Ball B/R/Y/G Velo (MPH):' },
      { id: 'el_1773861183750_juk1', label: 'Dropsteps Plyo Ball B/R/Y/G Velo (MPH):' },
      { id: 'el_1774237741185_oa2i', label: 'How many warmup pitches off mound? Wind / Stretch total each?' },
    ],
  },
  'Movement Screening.csv': {
    templateId: 'db45e42c-0f47-4892-970c-866409bf01b1',
    schema: [
      { id: 'el_1773862394053_jlkl', label: 'Shoulder Strength R/L ER/IR (lbs):' },
      { id: 'el_1773862449025_k7it', label: 'Elbow Extension (degrees):' },
      { id: 'el_1773862504691_dhaq', label: 'Hip R/L ER/IR (degrees):' },
      { id: 'el_1773862587723_dhff', label: 'T-Spine ROM (degrees):' },
      { id: 'el_1773862696287_8vpz', label: 'Ankle Dorsiflexion:' },
    ],
  },
  'Catching Assessment.csv': {
    templateId: '2ea515cc-3cf5-49a2-8274-009085f32c83',
    schema: [
      { id: 'el_1773861318704_l7yd', label: 'Glasses (Y/N):' },
      { id: 'el_1773861323997_xei9', label: 'Receiving:' },
      { id: 'el_1773861345121_nzwj', label: 'Framing:' },
      { id: 'el_1773861358584_lcud', label: 'Blocking:' },
      { id: 'el_1773861376905_ui5m', label: 'Neutral Stance:' },
      { id: 'el_1773861387457_uow7', label: 'Runners on Stance:' },
      { id: 'el_1773861419646_fqzv', label: 'NV Finger Sign Calling:' },
      { id: 'el_1773861427794_9iv6', label: 'Night Signs Touches:' },
      { id: 'el_1773861435826_iatg', label: 'Throw Down 1st Base (Seconds/MPH):' },
      { id: 'el_1773861516636_cvol', label: 'Throw Down 2nd Base (Seconds/MPH):' },
      { id: 'el_1773861524994_78ks', label: 'Throw Down 3rd Base (Seconds/MPH):' },
      { id: 'el_1773861532703_q19l', label: 'Shuffle Fire (MPH):' },
      { id: 'el_1773861540737_ovtd', label: 'Pulldown (MPH):' },
    ],
  },
};

// Manual overrides for CSV columns that don't fuzzy-match cleanly
const MANUAL_OVERRIDES = {
  'Strength & Conditioning.csv': {
    'Pushup To Failure': 'el_1773859423241_tg13',
    'Rotational Med Ball Scoop Toss Velo & Distance': 'el_1773859569168_5rdu',
  },
};

// ── Normalization ───────────────────────────────────────────────────────────

function normalize(str) {
  return str
    // Strip known unit parentheticals
    .replace(/\s*\((in|mph|lbs|degrees|sec|seconds|oz)\)/gi, '')
    // Remove parentheses characters (keep content inside)
    .replace(/[()]/g, '')
    // Strip trailing colon
    .replace(/:\s*$/, '')
    // Strip trailing question mark
    .replace(/\?\s*$/, '')
    .toLowerCase()
    // Replace non-alphanumeric with space
    .replace(/[^a-z0-9 ]/g, ' ')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Column → Element ID mapping ─────────────────────────────────────────────

function buildColumnMapping(csvHeaders, templateSchema, csvFilename) {
  const overrides = MANUAL_OVERRIDES[csvFilename] || {};
  const mapping = {}; // csvHeader → elementId
  const unmatchedCsvCols = [];
  const matchedElementIds = new Set();

  // Build normalized template lookup: normalizedLabel → elementId
  const templateLookup = {};
  for (const field of templateSchema) {
    templateLookup[normalize(field.label)] = field.id;
  }

  for (const header of csvHeaders) {
    if (header === 'Full Name') continue;

    // Check manual override first
    if (overrides[header]) {
      mapping[header] = overrides[header];
      matchedElementIds.add(overrides[header]);
      continue;
    }

    const normHeader = normalize(header);
    if (templateLookup[normHeader]) {
      mapping[header] = templateLookup[normHeader];
      matchedElementIds.add(templateLookup[normHeader]);
    } else {
      unmatchedCsvCols.push(header);
    }
  }

  // Find unmatched template fields
  const unmatchedTemplateFields = templateSchema
    .filter((f) => !matchedElementIds.has(f.id))
    .map((f) => f.label);

  return { mapping, unmatchedCsvCols, unmatchedTemplateFields };
}

// ── SQL escaping ────────────────────────────────────────────────────────────

function escapeSql(str) {
  if (str === null || str === undefined) return 'NULL';
  return "'" + str.replace(/'/g, "''") + "'";
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  console.log('=== TRAQ → NBP Assessment Import ===\n');

  // 1. Load players from local JSON
  if (!fs.existsSync(PLAYERS_FILE)) {
    console.error(`ERROR: ${PLAYERS_FILE} not found.`);
    console.error('Export players via Supabase MCP first.');
    process.exit(1);
  }

  const players = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf-8'));
  const playerLookup = {};
  for (const p of players) {
    const key = p.full_name.toLowerCase().trim();
    playerLookup[key] = p.id;
  }
  console.log(`Loaded ${players.length} players from players.json\n`);

  // 2. Process each CSV
  const allUnmatchedNames = new Set();
  const allSubmissions = [];
  let totalSkipped = 0;

  for (const [csvFile, template] of Object.entries(TEMPLATES)) {
    const csvPath = path.join(CSV_DIR, csvFile);
    if (!fs.existsSync(csvPath)) {
      console.log(`SKIP: ${csvFile} not found`);
      continue;
    }

    console.log(`── ${csvFile} ──`);

    // Parse CSV
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    console.log(`  Rows in CSV: ${records.length}`);

    // Build column mapping
    const headers = Object.keys(records[0] || {});
    const { mapping, unmatchedCsvCols, unmatchedTemplateFields } =
      buildColumnMapping(headers, template.schema, csvFile);

    const mappedCount = Object.keys(mapping).length;
    console.log(`  Mapped columns: ${mappedCount} / ${headers.length - 1}`);

    if (unmatchedCsvCols.length) {
      console.log(`  Unmatched CSV columns (data not imported):`);
      for (const col of unmatchedCsvCols) {
        console.log(`    - "${col}"`);
      }
    }
    if (unmatchedTemplateFields.length) {
      console.log(`  Unmatched template fields (will be empty):`);
      for (const f of unmatchedTemplateFields) {
        console.log(`    - "${f}"`);
      }
    }

    // Build submissions
    const submissions = [];
    const skippedNames = [];

    for (const row of records) {
      const fullName = (row['Full Name'] || '').trim();
      if (!fullName) continue;

      const playerId = playerLookup[fullName.toLowerCase().trim()];
      if (!playerId) {
        skippedNames.push(fullName);
        allUnmatchedNames.add(fullName);
        continue;
      }

      // Build responses object: { elementId: value } for non-empty values
      const responses = {};
      for (const [csvCol, elementId] of Object.entries(mapping)) {
        const value = (row[csvCol] || '').trim();
        if (value && value !== '?!' && value !== 'n/a' && value !== 'N/A') {
          responses[elementId] = value;
        }
      }

      // Skip if no responses (all values empty)
      if (Object.keys(responses).length === 0) continue;

      submissions.push({
        template_id: template.templateId,
        player_id: playerId,
        assessed_by: ASSESSED_BY,
        assessment_date: ASSESSMENT_DATE,
        responses,
      });
    }

    console.log(`  Matched athletes: ${submissions.length}`);
    console.log(`  Skipped (no user match): ${skippedNames.length}`);
    if (skippedNames.length) {
      console.log(`    Names: ${skippedNames.join(', ')}`);
    }
    console.log();

    allSubmissions.push(...submissions);
    totalSkipped += skippedNames.length;
  }

  // 3. Summary
  console.log('=== SUMMARY ===');
  console.log(`Total submissions to insert: ${allSubmissions.length}`);
  console.log(`Total athletes skipped (no user match): ${totalSkipped}`);
  if (allUnmatchedNames.size) {
    console.log(`\nUnmatched athlete names (${allUnmatchedNames.size}):`);
    for (const name of [...allUnmatchedNames].sort()) {
      console.log(`  - ${name}`);
    }
  }

  if (DRY_RUN) {
    console.log('\n--dry-run: no SQL generated.');
    return;
  }

  // 4. Generate SQL
  const sqlLines = [
    '-- TRAQ assessment import',
    `-- Generated ${new Date().toISOString()}`,
    `-- ${allSubmissions.length} submissions\n`,
    'INSERT INTO assessment_submissions (template_id, player_id, assessed_by, assessment_date, responses)',
    'VALUES',
  ];

  const valueRows = allSubmissions.map((s) => {
    const responsesJson = escapeSql(JSON.stringify(s.responses));
    return `  (${escapeSql(s.template_id)}, ${escapeSql(s.player_id)}, ${escapeSql(s.assessed_by)}, ${escapeSql(s.assessment_date)}, ${responsesJson}::jsonb)`;
  });

  sqlLines.push(valueRows.join(',\n') + ';');

  fs.writeFileSync(OUTPUT_FILE, sqlLines.join('\n'), 'utf-8');
  console.log(`\nSQL written to ${OUTPUT_FILE}`);
  console.log(`Run it via Supabase MCP execute_sql or psql.`);
}

main();
