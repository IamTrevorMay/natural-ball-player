// Minimal CSV read/write. Video titles routinely contain commas, quotes,
// and dashes, so this needs real quoting/escaping rather than a naive
// split(','). No external dependency — the format we need is small enough
// to get right by hand and it keeps this tool runnable with zero `npm
// install` step.

function escapeField(value) {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function writeCSV(rows) {
  // rows: array of arrays (first row is the header)
  return rows.map((row) => row.map(escapeField).join(',')).join('\n') + '\n';
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c === '\r') {
      // ignore — the following \n (if any) ends the row
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

// Parses CSV text with a header row into an array of plain objects keyed
// by the header names.
function parseCSVObjects(text) {
  const rows = parseCSV(text);
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows.slice(1).map((row) => {
    const obj = {};
    header.forEach((key, i) => {
      obj[key] = row[i] !== undefined ? row[i] : '';
    });
    return obj;
  });
}

module.exports = { escapeField, writeCSV, parseCSV, parseCSVObjects };
