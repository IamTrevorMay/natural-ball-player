// #276/#305: "same package, different Square billing frequency".
//
// Square exported the same real-world package more than once. The pattern is
// exact: one row carries the BARE product name (usually kind='lesson' — the
// version that got tagged on ~556 training slots), and one or more rows carry
// the SAME name plus a billing-frequency suffix,
// e.g. "NBP 2x A Week Training (EVERY_TWO_WEEKS price)" — and that is where the
// real purchases live.
//
// The business owner's rule, verbatim:
//   "if the title of the two packages says the same name before the (frequency
//    of charge) is listed then it is the same package in reality"
//
// This module is the single JS implementation of that rule. The identical
// expression is implemented in SQL as the generated column
// `store_products.family_key` (supabase/migrations/20260815_product_families.sql)
// so the database and the app can never drift apart.
//
// Deliberately dependency-free: it is imported by UI components and is cheap
// enough to call inside a render loop.

// Matches a trailing "(<FREQUENCY> price)" suffix:
//   \s*                    any spacing before the "("
//   \(\s*                  the "(" plus any spacing inside it
//   [A-Za-z][A-Za-z_]*     the frequency token — letters and underscores only.
//                          Live values: MONTHLY, EVERY_TWO_WEEKS,
//                          EVERY_SIX_MONTHS, QUARTERLY, ANNUAL. Written
//                          permissively so a new all-caps token Square invents
//                          later still matches without a code change.
//   \s+price\s*            the literal word "price" (required — this is what
//                          keeps a normal parenthetical such as
//                          "Lesson (30 min)" from being stripped)
//   \)\s*$                 the closing ")" at the very end of the name
// The /i flag makes the match case-tolerant. No /g flag: this RegExp instance
// is shared, and /g would make it stateful across calls.
const FREQUENCY_SUFFIX_RE = /\s*\(\s*([A-Za-z][A-Za-z_]*)\s+price\s*\)\s*$/i;

// Runs of any whitespace collapse to a single space before comparing, so
// "NBP  Training" and "NBP Training" land in the same family. The SQL side does
// the same collapse.
const WHITESPACE_RUN_RE = /\s+/g;

// Pull a usable product name off a string, a store_products row (`name`) or a
// store_purchases row (`product_name_snapshot`).
function nameOf(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return value.name || value.product_name_snapshot || '';
}

/**
 * The human-readable base name: the frequency suffix stripped, whitespace
 * tidied, ORIGINAL casing preserved. A no-op (beyond trimming) for a name that
 * has no suffix.
 *
 *   familyLabel('NBP Training (ANNUAL price)') === 'NBP Training'
 *   familyLabel('GH Discount')                 === 'GH Discount'
 */
export function familyLabel(name) {
  return String(nameOf(name) ?? '')
    .replace(FREQUENCY_SUFFIX_RE, '')
    .replace(WHITESPACE_RUN_RE, ' ')
    .trim();
}

/**
 * The canonical key two versions of the same package share: familyLabel()
 * lowercased. Use this for comparisons, never for display.
 *
 *   familyKey('NBP 2x A Week Training (MONTHLY price)')
 *     === familyKey('NBP 2x A Week Training')
 */
export function familyKey(name) {
  return familyLabel(name).toLowerCase();
}

/**
 * The billing frequency encoded in the name — 'MONTHLY', 'EVERY_TWO_WEEKS',
 * 'EVERY_SIX_MONTHS', 'QUARTERLY', 'ANNUAL', … — or null when the name carries
 * no suffix (the "bare" version of the package).
 */
export function frequencyOf(name) {
  const match = String(nameOf(name) ?? '').match(FREQUENCY_SUFFIX_RE);
  return match ? match[1].toUpperCase() : null;
}

/**
 * True when two products/purchases/names are the same real-world package.
 * Falls back to id equality when either side has no usable name, so callers
 * never get a false "different" out of a missing name.
 */
export function sameFamily(a, b) {
  const keyA = familyKey(a);
  const keyB = familyKey(b);
  if (keyA && keyB) return keyA === keyB;
  const idA = a && typeof a === 'object' ? a.id : null;
  const idB = b && typeof b === 'object' ? b.id : null;
  return !!idA && !!idB && idA === idB;
}

// Bare (no frequency) versions sort first — that is the version tagged on
// sessions — then by frequency name, then by full product name, so a family's
// versions always render in the same order.
function compareVersions(a, b) {
  const freqA = frequencyOf(a && a.name) || '';
  const freqB = frequencyOf(b && b.name) || '';
  if (freqA !== freqB) {
    if (!freqA) return -1;
    if (!freqB) return 1;
    return freqA.localeCompare(freqB);
  }
  return String((a && a.name) || '').localeCompare(String((b && b.name) || ''));
}

/**
 * Group an array of store_products rows into families.
 *
 * Returns [{ key, label, products: [...] }, …] sorted by label (A→Z), with each
 * family's `products` sorted bare-version-first. Rows with no name at all fall
 * into a single '' family rather than being dropped.
 */
export function groupByFamily(products) {
  const byKey = new Map();
  (products || []).forEach((product) => {
    if (!product) return;
    const key = familyKey(product.name);
    let group = byKey.get(key);
    if (!group) {
      group = { key, label: familyLabel(product.name) || '(unnamed)', products: [] };
      byKey.set(key, group);
    }
    group.products.push(product);
  });
  const groups = Array.from(byKey.values());
  groups.forEach((group) => group.products.sort(compareVersions));
  groups.sort((a, b) => a.label.localeCompare(b.label));
  return groups;
}
