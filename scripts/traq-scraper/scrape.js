#!/usr/bin/env node

const { chromium } = require("playwright");
const { stringify } = require("csv-stringify/sync");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const TRAQ_BASE = "https://traq.drivelinebaseball.com";
const OUTPUT_DIR = "/Users/trevor/Desktop/NBP Assessments";
const PROGRESS_FILE = path.join(__dirname, "progress.json");

const TABS = [
  { name: "Movement Screening", csv: "Movement Screening" },
  { name: "Strength & Conditioning Assessment", csv: "Strength & Conditioning" },
  { name: "Hitting Assessment", csv: "Hitting Assessment" },
  { name: "Pitching / Throwing Assessment", csv: "Pitching Assessment" },
  { name: "Catching Assessment", csv: "Catching Assessment" },
];

const NAV_DELAY_MS = 1500;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf-8"));
  }
  return { completed: {}, players: [], data: {} };
}

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Scrape the currently-active assessment sub-tab pane
// ---------------------------------------------------------------------------
async function scrapeActivePane(page) {
  return page.evaluate(() => {
    const activePane = document.querySelector(
      'div.tab-pane.active[id^="sub-assessnemnt-custom"]'
    );
    if (!activePane) return {};

    const data = {};

    // Primary pattern: label + p pairs inside div.form-group
    activePane.querySelectorAll("div.form-group").forEach((group) => {
      const label = group.querySelector("label");
      const valueEl = group.querySelector("p");
      if (!label) return;

      const key = label.textContent.trim().replace(/:$/, "");
      const value = valueEl ? valueEl.textContent.trim() : "";
      if (key && value) data[key] = value;
    });

    // Also try tables with actual data (thead headers + tbody rows)
    activePane.querySelectorAll("table.table").forEach((table) => {
      const headerRow = table.querySelector("thead tr");
      if (!headerRow) return;

      const headers = Array.from(headerRow.querySelectorAll("th")).map((th) => {
        const span = th.querySelector("span.edit");
        return (span ? span.textContent : th.textContent).trim();
      });
      if (headers.length === 0) return;

      const bodyRows = table.querySelectorAll("tbody tr");
      bodyRows.forEach((row, rowIdx) => {
        const cells = row.querySelectorAll("td");
        if (cells.length === 0) return;

        // Get cell value: check input.value, then innerText, then textContent
        function getCellValue(td) {
          const input = td.querySelector("input, select, textarea");
          if (input) {
            if (input.tagName === "SELECT") {
              return input.options[input.selectedIndex]?.text?.trim() || "";
            }
            if (input.value?.trim()) return input.value.trim();
          }
          return td.innerText?.trim() || td.textContent?.trim() || "";
        }

        if (headers.length === 2) {
          const key = getCellValue(cells[0]) || headers[0];
          const value = getCellValue(cells[1]);
          if (key && value) data[key] = value;
        } else {
          const rowLabel = getCellValue(cells[0]) || `Row${rowIdx}`;
          for (let i = 1; i < cells.length && i < headers.length; i++) {
            const value = getCellValue(cells[i]);
            if (!value) continue;
            data[`${rowLabel} - ${headers[i]}`] = value;
          }
        }
      });
    });

    // dt/dd pairs
    activePane.querySelectorAll("dt").forEach((dt) => {
      const dd = dt.nextElementSibling;
      if (dd && dd.tagName === "DD") {
        const label = dt.textContent.trim();
        const value = dd.textContent.trim();
        if (label && value) data[label] = value;
      }
    });

    return data;
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("=== TRAQ Assessment Scraper ===\n");

  const progress = loadProgress();
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // ---- Launch browser ----
  const browser = await chromium.launch({
    headless: false,
    args: ["--window-size=1920,1080", "--window-position=0,0"],
  });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  // ---- Navigate to TRAQ and pause for login ----
  console.log("Navigating to TRAQ...");
  await page.goto(TRAQ_BASE, { waitUntil: "domcontentloaded" });
  console.log("\n>>> PAUSED: Log in to TRAQ, then click Resume <<<\n");
  await page.pause();

  // ---- Navigate to roster ----
  console.log("Navigating to roster page...");
  await page.goto(`${TRAQ_BASE}/athletes`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await sleep(3000);

  const onRoster = await page.evaluate(
    () => document.querySelector("tr[class^='userRow-']") !== null
  );
  if (!onRoster) {
    console.log("Roster table not found. Navigate manually and click Resume.");
    await page.pause();
  }

  // ---- Extract player list ----
  let players = [];

  if (progress.players && progress.players.length > 0) {
    console.log(
      `Resuming with ${progress.players.length} players from previous run.`
    );
    players = progress.players;
  } else {
    console.log("Scraping player list...");
    await sleep(2000);

    // Try to show all players via DataTables length selector
    const expanded = await page.evaluate(() => {
      const lengthSelects = document.querySelectorAll(
        'select[name$="_length"], .dataTables_length select'
      );
      for (const sel of lengthSelects) {
        let bestOpt = null;
        for (const opt of sel.options) {
          if (opt.value === "-1") { bestOpt = opt; break; }
        }
        if (!bestOpt) {
          let maxVal = 0;
          for (const opt of sel.options) {
            const v = parseInt(opt.value);
            if (v > maxVal) { maxVal = v; bestOpt = opt; }
          }
        }
        if (bestOpt) {
          sel.value = bestOpt.value;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          return `Set page length to "${bestOpt.text}" (value=${bestOpt.value})`;
        }
      }
      return null;
    });

    if (expanded) {
      console.log(`  ${expanded}`);
      await sleep(5000);
    }

    // Paginate through all pages
    let allPlayers = [];
    let pageNum = 1;

    while (true) {
      const pagePlayers = await page.evaluate(() => {
        const results = [];
        document.querySelectorAll("tr[class^='userRow-']").forEach((row) => {
          const cells = row.querySelectorAll("td");
          if (cells.length < 3) return;
          const firstNameLink = cells[1]?.querySelector("a[href*='/athletes/view/']");
          const lastNameLink = cells[2]?.querySelector("a[href*='/athletes/view/']");
          if (!firstNameLink) return;
          const firstName = firstNameLink.textContent.trim();
          const lastName = lastNameLink ? lastNameLink.textContent.trim() : "";
          const url = firstNameLink.href;
          results.push({ name: `${firstName} ${lastName}`.trim(), url });
        });
        return results;
      });

      console.log(`  Page ${pageNum}: ${pagePlayers.length} players`);
      allPlayers.push(...pagePlayers);

      if (pagePlayers.length === 0) break;

      // Try clicking Next
      const hasNext = await page.evaluate(() => {
        const next = document.querySelector(".paginate_button.next:not(.disabled)");
        if (next) { next.click(); return true; }
        const allLinks = document.querySelectorAll("a, button");
        for (const el of allLinks) {
          const txt = el.textContent.trim();
          if (
            (txt === "Next" || txt === "›" || txt === "»") &&
            !el.classList.contains("disabled") &&
            !el.parentElement?.classList.contains("disabled")
          ) {
            el.click();
            return true;
          }
        }
        return false;
      });

      if (!hasNext) break;
      pageNum++;
      await sleep(3000);
    }

    // Deduplicate
    const seen = new Set();
    players = allPlayers.filter((p) => {
      if (seen.has(p.url)) return false;
      seen.add(p.url);
      return true;
    });

    if (players.length === 0) {
      console.log("\nNo players found. Navigate manually and click Resume.");
      await page.pause();
      players = await page.evaluate(() => {
        const results = [];
        document.querySelectorAll("tr[class^='userRow-']").forEach((row) => {
          const cells = row.querySelectorAll("td");
          if (cells.length < 3) return;
          const firstNameLink = cells[1]?.querySelector("a[href*='/athletes/view/']");
          const lastNameLink = cells[2]?.querySelector("a[href*='/athletes/view/']");
          if (!firstNameLink) return;
          results.push({
            name: `${firstNameLink.textContent.trim()} ${lastNameLink?.textContent.trim() || ""}`.trim(),
            url: firstNameLink.href,
          });
        });
        return results;
      });
    }

    if (players.length === 0) {
      console.error("ERROR: No players found. Exiting.");
      await browser.close();
      process.exit(1);
    }

    progress.players = players;
    saveProgress(progress);
  }

  console.log(`\nFound ${players.length} players.`);
  console.log("First 5:");
  players.slice(0, 5).forEach((p) => console.log(`  "${p.name}" -> ${p.url}`));

  // ---- Data store ----
  const allData = {};
  TABS.forEach((t) => (allData[t.csv] = []));
  if (progress.data) {
    for (const tab of TABS) {
      if (progress.data[tab.csv]) allData[tab.csv] = progress.data[tab.csv];
    }
  }

  // ---- Scrape each player ----
  const total = players.length;
  console.log(`\n=== Scraping ${total} players ===\n`);

  for (let i = 0; i < total; i++) {
    const player = players[i];

    if (progress.completed[player.url]) {
      console.log(`[${i + 1}/${total}] ${player.name} — skipped (already scraped)`);
      continue;
    }

    process.stdout.write(`[${i + 1}/${total}] ${player.name} — `);

    try {
      // Step 1: Navigate to player profile
      await page.goto(player.url, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await sleep(NAV_DELAY_MS);

      // Step 2: Click the top-level "Assessments" tab (href="#tab-2")
      const assessmentsTab = page.locator('a[data-toggle="tab"][href="#tab-2"]');
      const hasAssessmentsTab = (await assessmentsTab.count()) > 0;

      if (!hasAssessmentsTab) {
        console.log("no Assessments tab");
        progress.completed[player.url] = true;
        progress.data = allData;
        saveProgress(progress);
        continue;
      }

      await assessmentsTab.click();
      await sleep(1000);

      // Step 3: Click each assessment sub-tab and scrape
      const tabResults = [];

      for (const tab of TABS) {
        try {
          // Find the sub-tab by exact text
          const subTab = page.locator(
            'a[onclick="changeLink(this)"][data-toggle="tab"]',
            { hasText: tab.name }
          );

          if ((await subTab.count()) === 0) {
            tabResults.push(`${tab.csv.split(" ")[0]}:skip`);
            continue;
          }

          await subTab.first().click();
          await sleep(800);

          // Scrape the active pane
          const tabData = await scrapeActivePane(page);
          const fieldCount = Object.keys(tabData).length;

          if (fieldCount > 0) {
            tabData["Full Name"] = player.name;
            allData[tab.csv].push(tabData);
            tabResults.push(`${tab.csv.split(" ")[0]}:${fieldCount}`);
          } else {
            tabResults.push(`${tab.csv.split(" ")[0]}:0`);
          }
        } catch (tabErr) {
          tabResults.push(`${tab.csv.split(" ")[0]}:ERR`);
        }
      }

      console.log(tabResults.join("  "));

      progress.completed[player.url] = true;
      progress.data = allData;
      saveProgress(progress);
    } catch (playerErr) {
      console.log(`ERROR - ${playerErr.message.substring(0, 80)}`);
    }

    await sleep(500);
  }

  // ---- Build CSVs ----
  console.log("\n=== Writing CSV files ===\n");

  for (const tab of TABS) {
    const rows = allData[tab.csv];
    if (rows.length === 0) {
      console.log(`${tab.csv}.csv — no data, skipping`);
      continue;
    }

    const fieldSet = new Set();
    rows.forEach((row) => {
      Object.keys(row).forEach((k) => {
        if (k !== "Full Name") fieldSet.add(k);
      });
    });

    const columns = ["Full Name", ...Array.from(fieldSet).sort()];
    const csvRows = rows.map((row) => columns.map((col) => row[col] || ""));
    const csvContent = stringify([columns, ...csvRows]);
    const outPath = path.join(OUTPUT_DIR, `${tab.csv}.csv`);
    fs.writeFileSync(outPath, csvContent);
    console.log(
      `${tab.csv}.csv — ${rows.length} athletes, ${columns.length - 1} fields`
    );
  }

  console.log(`\nCSV files written to: ${OUTPUT_DIR}`);
  console.log("Done!");

  await browser.close();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
