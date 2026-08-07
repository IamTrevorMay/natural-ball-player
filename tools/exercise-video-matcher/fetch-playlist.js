#!/usr/bin/env node
// Step 1: pull every video's title + URL from the exercise-demo YouTube
// playlist and save them to videos.csv. Uses yt-dlp --flat-playlist so it
// doesn't have to download or probe each video individually — just reads
// the playlist's own metadata.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { writeCSV } = require('./csv');

const PLAYLIST_URL = 'https://www.youtube.com/playlist?list=PLa7mFDcwawBfUqJoefK0j2hAltwS35vOa';
const OUT_PATH = path.join(__dirname, 'videos.csv');
const UNAVAILABLE_OUT_PATH = path.join(__dirname, 'unavailable-videos.csv');
const EXPECTED_COUNT = 481;

function ytDlpAvailable() {
  const check = spawnSync('yt-dlp', ['--version'], { stdio: 'ignore' });
  return check.status === 0;
}

function installYtDlp() {
  console.log('yt-dlp not found — attempting to install it...');

  const viaPip = spawnSync('pip3', ['install', '--user', '--upgrade', 'yt-dlp'], { stdio: 'inherit' });
  if (viaPip.status === 0 && ytDlpAvailable()) return;

  const viaBrew = spawnSync('brew', ['install', 'yt-dlp'], { stdio: 'inherit' });
  if (viaBrew.status === 0 && ytDlpAvailable()) return;

  console.error(
    '\nCould not install yt-dlp automatically.\n' +
    'Please install it manually, e.g.:\n' +
    '  brew install yt-dlp\n' +
    '  or: pip3 install --user yt-dlp\n' +
    'then re-run: node fetch-playlist.js',
  );
  process.exit(1);
}

function fetchPlaylistJSON() {
  console.log(`Fetching playlist metadata from:\n  ${PLAYLIST_URL}\n`);
  const result = spawnSync(
    'yt-dlp',
    ['--flat-playlist', '--dump-json', '--ignore-errors', PLAYLIST_URL],
    { maxBuffer: 1024 * 1024 * 256, encoding: 'utf8' },
  );

  if (result.error) {
    console.error('Failed to run yt-dlp:', result.error.message);
    process.exit(1);
  }
  if (result.stderr && result.stderr.trim()) {
    // yt-dlp prints warnings (e.g. unavailable videos) to stderr even on
    // success — surface them but don't treat them as fatal.
    console.error(result.stderr.trim());
  }
  return result.stdout;
}

function main() {
  if (!ytDlpAvailable()) {
    installYtDlp();
  }

  const stdout = fetchPlaylistJSON();
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);

  const rows = [];
  const unavailable = [];
  let unparseable = 0;
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (e) {
      unparseable += 1;
      continue;
    }
    const title = entry.title;
    const id = entry.id;
    if (!title || !id) {
      // Flat-playlist extraction still returns a bare entry (id, playlist
      // position, no title/duration/etc.) for videos it can't read metadata
      // for — in practice this is YouTube's own placeholder for a private or
      // deleted video. Record it instead of silently dropping it, so a human
      // can go find and fix it in YouTube Studio.
      unavailable.push({ playlist_index: entry.playlist_index || '', video_id: id || '', url: id ? `https://www.youtube.com/watch?v=${id}` : '' });
      continue;
    }
    rows.push({ title, url: `https://www.youtube.com/watch?v=${id}` });
  }

  const csvRows = [['title', 'url'], ...rows.map((r) => [r.title, r.url])];
  fs.writeFileSync(OUT_PATH, writeCSV(csvRows), 'utf8');

  console.log(`Wrote ${rows.length} videos to ${OUT_PATH}`);

  if (unavailable.length > 0) {
    const unavailCsvRows = [
      ['playlist_index', 'video_id', 'url'],
      ...unavailable.map((r) => [r.playlist_index, r.video_id, r.url]),
    ];
    fs.writeFileSync(UNAVAILABLE_OUT_PATH, writeCSV(unavailCsvRows), 'utf8');
    console.log(`${unavailable.length} playlist entries had no title/metadata (private or deleted) — listed in ${UNAVAILABLE_OUT_PATH}`);
  }
  if (unparseable > 0) {
    console.log(`(${unparseable} additional lines from yt-dlp could not be parsed as JSON and were skipped)`);
  }

  if (rows.length === EXPECTED_COUNT) {
    console.log(`Confirmed: got all ${EXPECTED_COUNT} videos.`);
  } else {
    console.warn(`NOTE: expected ${EXPECTED_COUNT} playlist entries total, got ${rows.length} usable + ${unavailable.length} unavailable = ${rows.length + unavailable.length}.`);
  }
}

main();
