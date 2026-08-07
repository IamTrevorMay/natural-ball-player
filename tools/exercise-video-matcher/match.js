#!/usr/bin/env node
// Step 2: match exercise names against the fetched video list and write
// proposed-matches.csv for a human to review.
//
// Usage:
//   node match.js <exercises.csv> <videos.csv> [output.csv]
//
// exercises.csv columns: name, category (category is read but not used in
// matching or in the output — it's just carried in the input for context).
// videos.csv columns: title, url (as produced by fetch-playlist.js).
const fs = require('fs');
const path = require('path');
const { parseCSVObjects, writeCSV } = require('./csv');
const { prepareVideos, matchExercise } = require('./matcher');

function readCSVObjects(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }
  return parseCSVObjects(fs.readFileSync(filePath, 'utf8'));
}

function main() {
  const [, , exercisesPath, videosPath, outputPathArg] = process.argv;
  if (!exercisesPath || !videosPath) {
    console.error('Usage: node match.js <exercises.csv> <videos.csv> [output.csv]');
    process.exit(1);
  }
  const outputPath = outputPathArg || path.join(process.cwd(), 'proposed-matches.csv');

  const exercises = readCSVObjects(exercisesPath);
  const videos = readCSVObjects(videosPath);

  if (videos.length === 0) {
    console.error(`No videos found in ${videosPath} — did step 1 (fetch-playlist.js) run successfully?`);
    process.exit(1);
  }

  const preparedVideos = prepareVideos(videos);

  const results = exercises.map((ex) => {
    const { video, confidence, needsReview } = matchExercise(ex.name, preparedVideos);
    return {
      exercise_name: ex.name,
      matched_video_title: video ? video.title : '',
      video_url: video ? video.url : '',
      confidence: confidence.toFixed(2),
      needs_review: needsReview ? 'TRUE' : 'false',
      // Carried alongside the result (not written to the output CSV, whose
      // columns are a fixed contract) purely so the console summary below
      // can break auto-matched down by Pro/HS usage.
      _usesInProOrHs: Number(ex.uses_in_pro_or_hs) > 0,
    };
  });

  const header = ['exercise_name', 'matched_video_title', 'video_url', 'confidence', 'needs_review'];
  const csvRows = [header, ...results.map((r) => header.map((key) => r[key]))];
  fs.writeFileSync(outputPath, writeCSV(csvRows), 'utf8');

  const total = results.length;
  const autoMatchedRows = results.filter((r) => r.needs_review === 'false');
  const autoMatched = autoMatchedRows.length;
  const unmatched = results.filter((r) => r.video_url === '').length;
  const needsReview = total - autoMatched - unmatched;
  const autoMatchedProHs = autoMatchedRows.filter((r) => r._usesInProOrHs).length;
  const autoMatchedOther = autoMatched - autoMatchedProHs;

  console.log(`Wrote ${total} rows to ${outputPath}\n`);
  console.log('Summary:');
  console.log(`  Total exercises:  ${total}`);
  console.log(`  Auto-matched:     ${autoMatched}  (confidence >= 0.85)`);
  console.log(`    - used in Pro or HS:  ${autoMatchedProHs}`);
  console.log(`    - not used in Pro/HS: ${autoMatchedOther}`);
  console.log(`  Needs review:     ${needsReview}  (candidate found, confidence < 0.85)`);
  console.log(`  Unmatched:        ${unmatched}  (no reasonable candidate found)`);
}

main();
