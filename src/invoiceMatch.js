// Scoring a (pending purchase, Square invoice) pair for the #340 reconciler.
//
// WHY THIS EXISTS. 140 one-time purchases sit at 'pending' — $56,500 across
// ~104 athletes, the oldest from 16 June. The money did arrive: as Square
// invoices sent from the dashboard, or cards taken at the front desk. Those
// payments carry an order id the portal has never seen, so square_order_id can
// never match and the webhook can never settle them. There is no key linking a
// Square invoice to a portal purchase. So this module does NOT decide anything.
// It proposes, and it explains itself, and a human confirms one row at a time.
//
// It is deliberately pure: no React, no Supabase, no clock, no I/O. Everything
// it knows comes in as arguments, which is what makes it testable and what
// makes its output safe to print on screen as the evidence for a $400 write.
//
// ---------------------------------------------------------------------------
// THE TWO RULES THAT OUTRANK THE SCORING
// ---------------------------------------------------------------------------
// 1. NEVER return a match whose only signal is the amount. Dozens of packages
//    cost exactly the same. Confirming the wrong one marks the wrong family as
//    paid and hands them sessions they did not buy, while the family that did
//    pay stays pending. An amount on its own is arithmetic, not identity, so
//    it scores 'none' no matter how exactly it lines up. For the same reason
//    'strong' and 'likely' both require an identity signal (email or name):
//    amount + date + product name, with nothing tying the invoice to THIS
//    athlete, caps at 'weak'.
//
// 2. An invoice that is not actually paid is FLAGGED, not hidden. status not
//    PAID, or paid_amount_cents 0, means the money did not arrive — which is
//    exactly as useful to a staff member as a match, because it tells them the
//    right answer is "chase this family", not "settle this row". Such an
//    invoice can never score 'strong'.
//
// ---------------------------------------------------------------------------
// NULL IS NOT ZERO
// ---------------------------------------------------------------------------
// square-invoices-scan returns amount_cents and paid_amount_cents as null when
// it genuinely could not determine them (a draft with no payment requests, an
// order lookup that failed). null means UNKNOWN. Treating it as $0.00 would
// turn "we don't know" into "nobody paid", which is a lie in the direction that
// gets a paying family chased for money. Unknown is scored as no evidence
// either way and said out loud in the reasons.
//
// ---------------------------------------------------------------------------
// THE AMOUNT TRAP
// ---------------------------------------------------------------------------
// A purchase has BOTH amount_cents (list price) and discounted_price_cents
// (what was actually charged, #~discounts). PurchasesTab's dialog uses
// `discounted_price_cents ?? amount_cents` while its table prints the raw
// amount_cents — the two disagree on every discounted row. Square only ever saw
// the discounted figure, so matching on the raw one would mis-match every
// discounted purchase. purchaseAmountCents() below is the single source of
// truth for "what this purchase should have cost", and nothing in this file
// reads amount_cents directly.

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------
// strong — identity matches AND the money lines up AND Square confirms it
//          paid AND the two were created within a sane window. Safe to confirm
//          after reading the evidence. Each of those four is a hard gate, not a
//          weight: a big enough pile of soft agreement must never out-vote a
//          $12,000 discrepancy, which is exactly what a pure score does.
// likely — real identity evidence, but something is soft: the invoice is not
//          confirmed paid, the amount disagrees or is unknown, or the dates are
//          months apart.
// weak   — worth a human's eyes, not worth trusting. Anything with no identity
//          evidence lands here at best.
// none   — not proposed.
export const TIER_ORDER = ['none', 'weak', 'likely', 'strong'];

export const TIER_LABELS = {
  strong: 'Strong',
  likely: 'Likely',
  weak: 'Weak',
  none: 'No match',
};

const SCORE_STRONG = 80;
const SCORE_LIKELY = 55;
const SCORE_WEAK = 25;

// Points. Email dominates on purpose: it is the only field on a Square invoice
// that identifies a person the portal also knows.
const PTS = {
  emailExact: 50,
  emailDiffer: -14,
  nameExact: 22,
  nameSurname: 12,
  nameDiffer: -6,
  amountExact: 30,
  amountClose: 18,
  amountDiffer: -22,
  dateSameWeek: 14,
  dateSameDays: 20,
  dateSameMonth: 8,
  dateFar: -12,
  productClose: 12,
  productPartial: 6,
};

// "Close enough" on money: a dollar, or one percent, whichever is larger.
// Square rounds tax and tips into invoice totals in ways the portal never sees.
const AMOUNT_TOLERANCE_CENTS = 100;
const AMOUNT_TOLERANCE_RATIO = 0.01;

const DAY_MS = 86400000;
const DATE_TIGHT_DAYS = 2;
const DATE_WEEK_DAYS = 7;
const DATE_MONTH_DAYS = 30;
const DATE_FAR_DAYS = 90;

const NAME_STOPWORDS = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'mr', 'mrs', 'ms', 'dr']);
const PRODUCT_STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'for', 'with', 'to', 'per', 'plus']);

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function normText(v) {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

export function formatCents(cents) {
  if (!isNum(cents)) return 'unknown';
  return `$${(cents / 100).toFixed(2)}`;
}

// Case-insensitive, trimmed. Returns null for anything that isn't a usable
// address, so "missing" and "different" stay distinguishable downstream.
export function normalizeEmail(v) {
  const s = normText(v);
  return s || null;
}

// What this purchase actually cost. See THE AMOUNT TRAP above. `??` semantics:
// a discounted price of 0 is a real price and must win over amount_cents; only
// null/undefined falls through.
export function purchaseAmountCents(purchase) {
  const discounted = purchase?.discounted_price_cents;
  if (isNum(discounted)) return discounted;
  const raw = purchase?.amount_cents;
  if (isNum(raw)) return raw;
  return null;
}

export function purchaseEmail(purchase) {
  return normalizeEmail(purchase?.user?.email ?? purchase?.athlete_email ?? purchase?.email);
}

export function purchaseName(purchase) {
  const n = purchase?.user?.full_name ?? purchase?.athlete_name ?? purchase?.full_name;
  return typeof n === 'string' && n.trim() ? n.trim() : null;
}

function parseTime(v) {
  if (typeof v !== 'string' || !v) return null;
  const t = Date.parse(v.length === 10 ? `${v}T00:00:00Z` : v);
  return Number.isFinite(t) ? t : null;
}

export function daysApart(a, b) {
  const ta = parseTime(a);
  const tb = parseTime(b);
  if (ta === null || tb === null) return null;
  return Math.abs(ta - tb) / DAY_MS;
}

function tokens(value, stopwords) {
  return normText(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t && !stopwords.has(t));
}

// Overlap against the SHORTER side. "Hitting" vs "Hitting Lesson 60min" should
// read as a strong overlap; dividing by the union would bury it.
function overlapRatio(aTokens, bTokens) {
  if (aTokens.length === 0 || bTokens.length === 0) return null;
  const b = new Set(bTokens);
  let hits = 0;
  for (const t of new Set(aTokens)) if (b.has(t)) hits++;
  return hits / Math.min(new Set(aTokens).size, b.size);
}

// ---------------------------------------------------------------------------
// Did the money actually arrive?
// ---------------------------------------------------------------------------
// Four states, and they are not interchangeable:
//   paid    — status PAID and Square reports a non-zero amount collected.
//   partial — some money landed, but not the whole invoice.
//   unpaid  — Square says nothing has been collected. Evidence AGAINST.
//   unknown — Square did not report a paid amount. NOT the same as zero, and
//             not evidence of anything; it means go and look in Square.
// Only 'paid' can support a 'strong' proposal.
export function invoicePaymentState(invoice) {
  const rawStatus = typeof invoice?.status === 'string' ? invoice.status.trim().toUpperCase() : '';
  const statusLabel = rawStatus || 'an unknown status';
  const paid = invoice?.paid_amount_cents;
  const paidKnown = isNum(paid);

  if (paidKnown && paid > 0 && rawStatus !== 'PAID') {
    return {
      state: 'partial',
      confirmed: false,
      reason: `Square shows ${formatCents(paid)} collected but the invoice status is ${statusLabel}, not PAID — this invoice is only part-settled.`,
    };
  }
  if (rawStatus !== 'PAID') {
    return {
      state: 'unpaid',
      confirmed: false,
      reason: `Square shows this invoice as ${statusLabel}, not PAID — on Square's own record the money has not arrived through it.`,
    };
  }
  if (!paidKnown) {
    return {
      state: 'unknown',
      confirmed: false,
      reason: 'The invoice status is PAID but Square reported no collected amount — unknown, which is not the same as $0.00. Open the invoice in Square before settling this row.',
    };
  }
  if (paid === 0) {
    return {
      state: 'unpaid',
      confirmed: false,
      reason: 'Square shows $0.00 actually collected against this invoice, despite the PAID status.',
    };
  }
  return {
    state: 'paid',
    confirmed: true,
    reason: `Square confirms ${formatCents(paid)} collected on a PAID invoice.`,
  };
}

// Square's invoice payload carries no "paid on" date — the scan function
// returns created_at and nothing else dated. These optional fields are read
// defensively in case the function grows one later; null means the caller must
// fall back to now AND say so, rather than inventing a settlement date.
export function invoicePaidAt(invoice) {
  const candidates = [invoice?.paid_at, invoice?.paid_date, invoice?.payment_date];
  for (const c of candidates) {
    if (typeof c === 'string' && parseTime(c) !== null) return c;
  }
  return null;
}

function capTier(tier, max) {
  return TIER_ORDER.indexOf(tier) > TIER_ORDER.indexOf(max) ? max : tier;
}

function floorTier(tier, min) {
  return TIER_ORDER.indexOf(tier) < TIER_ORDER.indexOf(min) ? min : tier;
}

/**
 * Score one purchase against one invoice.
 *
 * Returns plain data — no exceptions, no throwing on malformed input, because
 * this runs across every pending row on screen and one odd invoice must not
 * blank the page.
 *
 * {
 *   invoice, invoiceId, tier, score,
 *   reasons:   string[]  — evidence FOR the match, in weight order
 *   cautions:  string[]  — evidence AGAINST, and gaps in the evidence
 *   flags:     string[]  — the money did not arrive (rule 2)
 *   signals:   { emailMatch, nameMatch, amountMatch, dateProximity, ... }
 *   paymentState: 'paid' | 'partial' | 'unpaid' | 'unknown'
 * }
 */
export function scoreMatch(purchase, invoice) {
  const reasons = [];
  const cautions = [];
  const flags = [];
  const positives = new Set();
  let score = 0;

  const payment = invoicePaymentState(invoice);
  if (payment.confirmed) {
    reasons.push(payment.reason);
  } else {
    flags.push(payment.reason);
  }

  // --- email -------------------------------------------------------------
  const pEmail = purchaseEmail(purchase);
  const iEmail = normalizeEmail(invoice?.customer_email);
  let emailMatch = false;
  if (pEmail && iEmail) {
    if (pEmail === iEmail) {
      emailMatch = true;
      score += PTS.emailExact;
      positives.add('email');
      reasons.push(`Email matches exactly: ${iEmail}`);
    } else {
      score += PTS.emailDiffer;
      cautions.push(`Emails differ — athlete has ${pEmail}, invoice went to ${iEmail}. (Families do pay from a parent's address, so this is not proof of a mismatch.)`);
    }
  } else if (!pEmail) {
    cautions.push('No email on file for this athlete, so there is no email evidence either way. If the athlete list loaded without emails at all, stop and fix that first.');
  } else {
    cautions.push('This Square invoice carries no customer email, so there is no email evidence either way.');
  }

  // --- name ---------------------------------------------------------------
  const pName = purchaseName(purchase);
  const iName = typeof invoice?.customer_name === 'string' && invoice.customer_name.trim()
    ? invoice.customer_name.trim()
    : null;
  let nameMatch = false;
  if (pName && iName) {
    const pTok = tokens(pName, NAME_STOPWORDS);
    const iTok = tokens(iName, NAME_STOPWORDS);
    const same = pTok.length > 0 && pTok.length === iTok.length && pTok.every((t, idx) => t === iTok[idx]);
    const surnameSame = pTok.length > 1 && iTok.length > 1 && pTok[pTok.length - 1] === iTok[iTok.length - 1];
    if (same) {
      nameMatch = true;
      score += PTS.nameExact;
      positives.add('name');
      reasons.push(`Name matches: "${iName}"`);
    } else if (surnameSame) {
      nameMatch = true;
      score += PTS.nameSurname;
      positives.add('name');
      reasons.push(`Same surname — athlete "${pName}", invoice "${iName}". Plausibly a parent paying for their child.`);
    } else {
      score += PTS.nameDiffer;
      cautions.push(`Names do not overlap — athlete "${pName}", invoice "${iName}".`);
    }
  } else if (!iName) {
    cautions.push('This Square invoice carries no customer name.');
  }

  // --- amount -------------------------------------------------------------
  // Compare against the invoice TOTAL. If the total is unknown but Square did
  // report money collected, compare against that instead and say which was
  // used — a reconciler needs to know what the number on screen actually is.
  const pAmount = purchaseAmountCents(purchase);
  const iAmount = isNum(invoice?.amount_cents) ? invoice.amount_cents : null;
  const iPaid = isNum(invoice?.paid_amount_cents) ? invoice.paid_amount_cents : null;
  const compareTo = iAmount !== null ? iAmount : (iPaid !== null && iPaid > 0 ? iPaid : null);
  const compareBasis = iAmount !== null ? 'invoice total' : 'amount collected';
  const discounted = isNum(purchase?.discounted_price_cents);
  let amountMatch = false;

  if (pAmount === null) {
    cautions.push('This purchase has no usable price, so the amount cannot be compared.');
  } else if (compareTo === null) {
    cautions.push(`Square did not report a total for this invoice (unknown, not $0.00), so ${formatCents(pAmount)} cannot be compared against it.`);
  } else {
    const diff = Math.abs(pAmount - compareTo);
    const tolerance = Math.max(AMOUNT_TOLERANCE_CENTS, Math.round(compareTo * AMOUNT_TOLERANCE_RATIO));
    const priceNote = discounted
      ? ` (the discounted price actually charged; list price was ${formatCents(purchase?.amount_cents)})`
      : '';
    if (diff === 0) {
      amountMatch = true;
      score += PTS.amountExact;
      positives.add('amount');
      reasons.push(`Amount matches exactly: ${formatCents(pAmount)}${priceNote} against the ${compareBasis}.`);
    } else if (diff <= tolerance) {
      amountMatch = true;
      score += PTS.amountClose;
      positives.add('amount');
      reasons.push(`Amount is within ${formatCents(tolerance)}: purchase ${formatCents(pAmount)}${priceNote}, ${compareBasis} ${formatCents(compareTo)}.`);
    } else {
      score += PTS.amountDiffer;
      cautions.push(`Amounts disagree by ${formatCents(diff)} — purchase ${formatCents(pAmount)}${priceNote}, ${compareBasis} ${formatCents(compareTo)}.`);
    }
  }

  // --- date proximity ------------------------------------------------------
  const gap = daysApart(purchase?.created_at, invoice?.created_at);
  if (gap === null) {
    cautions.push('One of the two dates is missing or unreadable, so they cannot be compared.');
  } else {
    const whole = Math.round(gap);
    const dayWord = whole === 1 ? 'day' : 'days';
    if (gap <= DATE_TIGHT_DAYS) {
      score += PTS.dateSameDays;
      positives.add('date');
      reasons.push(`Created ${whole} ${dayWord} apart.`);
    } else if (gap <= DATE_WEEK_DAYS) {
      score += PTS.dateSameWeek;
      positives.add('date');
      reasons.push(`Created ${whole} ${dayWord} apart — same week.`);
    } else if (gap <= DATE_MONTH_DAYS) {
      score += PTS.dateSameMonth;
      positives.add('date');
      reasons.push(`Created ${whole} ${dayWord} apart — same month.`);
    } else if (gap <= DATE_FAR_DAYS) {
      cautions.push(`Created ${whole} ${dayWord} apart — far enough that the dates are not evidence of anything.`);
    } else {
      score += PTS.dateFar;
      cautions.push(`Created ${whole} ${dayWord} apart — months. Even an exact amount is weak evidence across that gap.`);
    }
  }

  // --- product name (supporting only) -------------------------------------
  const pProduct = purchase?.product_name_snapshot;
  // line_item_names === null means the order lookup did not run — that is not
  // the same as "the invoice had no line items", so it is not held against it.
  const lineItems = Array.isArray(invoice?.line_item_names) ? invoice.line_item_names : [];
  const invoiceText = [invoice?.title, ...lineItems].filter(Boolean).join(' ');
  if (pProduct && invoiceText) {
    const ratio = overlapRatio(tokens(pProduct, PRODUCT_STOPWORDS), tokens(invoiceText, PRODUCT_STOPWORDS));
    const shown = invoice?.title || lineItems.join(', ');
    if (ratio !== null && ratio >= 0.6) {
      score += PTS.productClose;
      positives.add('product');
      reasons.push(`Product wording lines up: "${pProduct}" vs "${shown}".`);
    } else if (ratio !== null && ratio >= 0.3) {
      score += PTS.productPartial;
      positives.add('product');
      reasons.push(`Product wording partly lines up: "${pProduct}" vs "${shown}".`);
    } else {
      cautions.push(`Product wording does not line up: "${pProduct}" vs "${shown}".`);
    }
  } else if (pProduct && !invoiceText) {
    cautions.push(invoice?.line_item_names === null
      ? 'Square\'s line items could not be retrieved for this invoice, so the product name could not be compared.'
      : 'This invoice has no title or line items to compare the product name against.');
  }

  // --- tier ----------------------------------------------------------------
  const identity = emailMatch || nameMatch;
  const amountOnly = positives.size > 0 && positives.size === 1 && positives.has('amount');

  let tier;
  if (score >= SCORE_STRONG) tier = 'strong';
  else if (score >= SCORE_LIKELY) tier = 'likely';
  else if (score >= SCORE_WEAK) tier = 'weak';
  else tier = 'none';

  // RULE 1, absolute: the amount alone is never a match.
  if (positives.size === 0 || amountOnly) {
    tier = 'none';
    if (amountOnly) {
      cautions.push('The amount is the ONLY thing that lines up. Dozens of packages cost the same, so this is not proposed as a match.');
    }
  }

  // No identity evidence at all: worth a look, never worth confidence.
  if (tier !== 'none' && !identity) {
    tier = capTier(tier, 'weak');
    cautions.push('Nothing ties this invoice to this athlete — no matching email, no matching name. Only a human who recognises the family should act on it.');
  }

  // RULE 2: an invoice Square does not confirm as paid can never be 'strong'.
  if (!payment.confirmed) {
    tier = capTier(tier, 'likely');
  }

  // The money has to line up for 'strong' to mean anything. Without this gate
  // a perfect email + name + product agreement scores 82 and reads as 'strong'
  // while the amounts differ by $12,100 — the score outvotes the one fact that
  // decides whether this is the same payment. An unknown invoice total lands
  // here too: we cannot confirm money we were never told about.
  if (!amountMatch) {
    tier = capTier(tier, 'likely');
  }

  // Months apart is weak evidence even when everything else agrees, so it caps
  // as well rather than merely costing points.
  if (gap === null || gap > DATE_FAR_DAYS) {
    tier = capTier(tier, 'likely');
  }

  // An exact email match always gets shown to a human, whatever else disagrees.
  // "Right family, wrong amount" is a finding, not noise.
  if (emailMatch) tier = floorTier(tier, 'weak');

  return {
    invoice: invoice || null,
    invoiceId: invoice?.id ?? null,
    tier,
    score,
    reasons,
    cautions,
    flags,
    paymentState: payment.state,
    paymentConfirmed: payment.confirmed,
    signals: {
      emailMatch,
      nameMatch,
      amountMatch,
      identity,
      amountOnly,
      daysApart: gap === null ? null : Math.round(gap),
      purchaseAmountCents: pAmount,
      usedDiscountedPrice: discounted,
      comparedAgainstCents: compareTo,
      comparedBasis: compareTo === null ? null : compareBasis,
    },
  };
}

/**
 * Rank every invoice against one purchase, best first.
 * Ties break on invoice id so the order is stable between renders.
 */
export function rankCandidates(purchase, invoices, options = {}) {
  const { includeNone = false, limit = 8 } = options;
  const list = Array.isArray(invoices) ? invoices : [];
  const scored = list
    .map((inv) => scoreMatch(purchase, inv))
    .filter((r) => includeNone || r.tier !== 'none')
    .sort((a, b) => (b.score - a.score) || String(a.invoiceId).localeCompare(String(b.invoiceId)));
  return limit > 0 ? scored.slice(0, limit) : scored;
}

export function bestCandidate(purchase, invoices) {
  return rankCandidates(purchase, invoices, { limit: 1 })[0] || null;
}
