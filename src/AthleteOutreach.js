import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from './supabaseClient';
import {
  Package, CalendarClock, Send, AlertTriangle, RefreshCw, Loader2,
  Users, Info, Eye, X, Check, MessageSquare, Copy
} from 'lucide-react';
import { fmtLocalDate, expandRecurringEvents } from './scheduleUtils';
import { LANES } from './Schedule';
import { formatUserError } from './errorMessage';

/*
 * Issues #311 (package / subscription reminders) and #300 (open cage time
 * outreach). Two lists of the same shape — the system proactively messaging
 * athletes — so they live in one screen with two tabs.
 *
 * ⚠️ NOTHING HERE SENDS BY ITSELF. There is no cron, no scheduled job, no
 * background dispatch. Every send is: build the audience → uncheck anyone you
 * don't want → read the exact rendered message → confirm a modal that names
 * the recipient count → click Send. If the owner later wants this automatic,
 * that is a separate decision and a separate change.
 *
 * Transport is the app's EXISTING in-app messaging system (conversations /
 * conversation_participants / messages — the same three tables Messages.js
 * writes when staff send a Direct Message). An inserted message lights up the
 * athlete's NotificationBell unread count via useMainPortalCounts. No new mail
 * transport, no deliverability risk, no domain problem. "Copy emails" is
 * provided as a hand-off into the existing Email Campaign screen for anyone
 * who wants email instead.
 */

// ---------------------------------------------------------------------------
// Audience predicates
// ---------------------------------------------------------------------------

// THE app's existing "does this athlete have an active package" test, lifted
// verbatim from ReserveSlotModal in src/Schedule.js (~line 8029) — the gate
// that actually decides whether a player may book a session. Reused rather
// than re-invented so this screen and the booking gate can never disagree.
//
//   status in ('active','paid')  AND  (expires_at is null OR expires_at > now)
//   AND  kind 'package'          -> remaining_qty is null (unlimited) or > 0
//        kind 'bundle'/'lesson'  -> remaining_qty > 0 (null means "never a
//                                   pack", not "unlimited")
const PACKAGE_KINDS = ['package', 'bundle', 'lesson'];
const OWNING_STATUSES = ['active', 'paid'];

// `lenient` relaxes BOTH of this database's bookkeeping gaps at once, because
// they co-occur: the 46 lesson-pack purchases sit at status `pending` AND have
// a NULL remaining_qty, so relaxing only the status would still leave every one
// of them flagged and the toggle would look broken.
function isOwningPurchase(p, { lenient = false } = {}) {
  const statusOk = OWNING_STATUSES.includes(p.status) || (lenient && p.status === 'pending');
  if (!statusOk) return false;
  if (!PACKAGE_KINDS.includes(p.product_kind)) return false;
  if (p.expires_at && new Date(p.expires_at).getTime() <= Date.now()) return false;
  if (p.remaining_qty === null || p.remaining_qty === undefined) {
    // NULL is unlimited for a monthly kind='package'. For a bundle/lesson it
    // means no session count was ever recorded — strict reads that as "not a
    // pack" (what the booking gate does); lenient reads it as "unknown, assume
    // they have sessions" so the owner isn't nagging paying customers.
    return p.product_kind === 'package' || lenient;
  }
  return p.remaining_qty > 0;
}

// The duplicate-product rule the owner stated: "if the title of the two
// packages says the same name before the (frequency of charge) is listed then
// it is the same package in reality." Square exported the same real package
// once per billing frequency, so the frequency suffix is the only reliable
// signal of what a purchase actually is.
const FREQ_RE = /\s*\((MONTHLY|EVERY_TWO_WEEKS|EVERY_SIX_MONTHS|QUARTERLY|ANNUAL|[A-Z_]+)\s+price\)\s*$/i;

function productFrequency(name) {
  const m = (name || '').match(FREQ_RE);
  return m ? m[1].toUpperCase() : null;
}

function isMonthlyMembership(p) {
  const name = p.product_name_snapshot || p.store_products?.name || '';
  return productFrequency(name) === 'MONTHLY';
}

// #300 audience: "a cage rental package, or any package that is NOT a monthly
// membership". Cage rentals are keyed off store_products.kind = 'rental' —
// the app labels that kind "Cage / Lane Rental (one-time)" in WorkStore.js's
// KIND_OPTIONS and StoreModal.js's KIND_LABEL — with a name-contains-"cage"
// fallback for rows mis-kinded during the Square import.
function isCageRental(p) {
  const kind = p.product_kind || p.store_products?.kind;
  if (kind === 'rental') return true;
  const name = (p.product_name_snapshot || p.store_products?.name || '').toLowerCase();
  return name.includes('cage');
}

const DEFAULT_LOW_THRESHOLD = 2;    // "running low" = this many sessions or fewer
const DEFAULT_EXPIRING_DAYS = 14;   // "about to expire" = within this many days

// ---------------------------------------------------------------------------
// Open-cage-time availability
// ---------------------------------------------------------------------------

// The Lanes grid in src/Schedule.js (LaneView) draws lane occupancy from ONE
// source: facility_events.lanes. Coach training_slots render in their own
// per-coach band there, never in a lane row, so they are not lane occupancy
// and are not subtracted here either — same interpretation, not a second one.
const CAGE_LANES = LANES.filter(l => /^Lane \d+$/.test(l));

const DEFAULT_OPEN_HOUR = 8;   // matches DEFAULT_START_HOUR in Schedule.js
const DEFAULT_CLOSE_HOUR = 22; // matches DEFAULT_END_HOUR in Schedule.js
const DEFAULT_MIN_BLOCK_MIN = 60;

const toMinutes = (t) => {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  if (Number.isNaN(h)) return null;
  return h * 60 + (m || 0);
};

const fromMinutes = (mins) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
};

// Sunday of the week AFTER the week `from` sits in — #300 asks for "next
// week's" openings, sent the week before.
function nextWeekRange(from = new Date()) {
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay() + 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

// Invert each lane's busy intervals against the facility's open window.
function computeOpenBlocks(events, dates, lanes, openHour, closeHour, minBlockMin) {
  const dayOpen = openHour * 60;
  const dayClose = closeHour * 60;
  const out = [];
  dates.forEach(dateStr => {
    const dayEvents = events.filter(ev => ev.event_date === dateStr);
    lanes.forEach(lane => {
      const busy = [];
      dayEvents.forEach(ev => {
        if (!(ev.lanes || []).includes(lane)) return;
        const s = toMinutes(ev.start_time || ev.event_time);
        if (s === null) return;
        const e = toMinutes(ev.end_time);
        busy.push([s, e === null || e <= s ? s + 60 : e]);
      });
      busy.sort((a, b) => a[0] - b[0]);
      const merged = [];
      busy.forEach(([s, e]) => {
        const last = merged[merged.length - 1];
        if (last && s <= last[1]) last[1] = Math.max(last[1], e);
        else merged.push([s, e]);
      });
      let cursor = dayOpen;
      const gaps = [];
      merged.forEach(([s, e]) => {
        if (s > cursor) gaps.push([cursor, Math.min(s, dayClose)]);
        cursor = Math.max(cursor, e);
      });
      if (cursor < dayClose) gaps.push([cursor, dayClose]);
      gaps.forEach(([s, e]) => {
        if (e - s >= minBlockMin && s < dayClose) {
          out.push({ date: dateStr, lane, start: s, end: Math.min(e, dayClose) });
        }
      });
    });
  });
  return out;
}

const prettyDate = (dateStr) =>
  new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

// ---------------------------------------------------------------------------
// Message templates
// ---------------------------------------------------------------------------

const DEFAULT_NO_PACKAGE_MSG =
`Hi {{first_name}},

We noticed you don't have an active training package or membership with NBP right now. A package is the easiest way to lock in your sessions and it brings your per-session cost down.

Open the Store in your NBP portal to pick one up, or just reply to this message and we'll help you choose the right one.

— NBP`;

const DEFAULT_LOW_MSG =
`Hi {{first_name}},

Quick heads up on your package: {{package}} — {{status_line}}.

Grab another package in the Store so you don't lose your spot on the schedule, or reply here and we'll get it set up for you.

— NBP`;

const DEFAULT_CAGE_MSG =
`Hi {{first_name}},

We have open cage time next week and wanted to offer it to you first:

{{openings}}

Reply to this message or call the facility and we'll get you booked in.

— NBP`;

function firstName(fullName) {
  return (fullName || '').trim().split(/\s+/)[0] || 'there';
}

function renderTemplate(tpl, tokens) {
  return Object.entries(tokens).reduce(
    (acc, [k, v]) => acc.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), v ?? ''),
    tpl || ''
  );
}

// ---------------------------------------------------------------------------
// Small shared bits
// ---------------------------------------------------------------------------

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// PostgREST caps an unbounded select (Supabase's db.max_rows, 1000 by default).
// A silently truncated purchase list is the one failure that actually matters
// here: purchases that never arrive look like "this athlete has no package",
// which is exactly how you blast paying customers. So page explicitly.
const PAGE = 1000;
async function fetchAll(build) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

const MISSING_TABLE = (err) =>
  err && (err.code === '42P01' || /does not exist|schema cache/i.test(err.message || ''));

function CountBadge({ n, tone = 'indigo' }) {
  const tones = {
    indigo: 'bg-indigo-100 text-indigo-700',
    amber: 'bg-amber-100 text-amber-800',
    gray: 'bg-gray-100 text-gray-600',
  };
  return (
    <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-semibold ${tones[tone] || tones.indigo}`}>
      {n}
    </span>
  );
}

function StateBlock({ icon: Icon, title, body, tone = 'gray', spin = false }) {
  const tones = {
    gray: 'text-gray-300',
    red: 'text-red-300',
  };
  return (
    <div className="text-center py-12 px-6">
      <Icon size={36} className={`mx-auto mb-3 ${tones[tone]} ${spin ? 'animate-spin' : ''}`} />
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      {body && <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">{body}</p>}
    </div>
  );
}

// Recipient table with per-row checkbox + per-row "preview this person's exact
// message". Shared by all three lists.
function RecipientList({ rows, selected, onToggle, onToggleAll, previewId, onPreview, lastSentByUser }) {
  const allOn = rows.length > 0 && rows.every(r => selected.has(r.user.id));
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="flex items-center px-3 py-2 bg-gray-50 border-b border-gray-200">
        <input
          type="checkbox"
          checked={allOn}
          onChange={() => onToggleAll(!allOn)}
          className="mr-3 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          aria-label="Select all recipients"
        />
        <span className="text-xs font-medium text-gray-600">
          {selected.size} of {rows.length} selected
        </span>
      </div>
      <div className="max-h-80 overflow-y-auto divide-y divide-gray-100">
        {rows.map(r => {
          const on = selected.has(r.user.id);
          const last = lastSentByUser?.[r.user.id];
          return (
            <div key={r.user.id} className={`flex items-center px-3 py-2 text-sm ${on ? '' : 'opacity-50'}`}>
              <input
                type="checkbox"
                checked={on}
                onChange={() => onToggle(r.user.id)}
                className="mr-3 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                aria-label={`Include ${r.user.full_name}`}
              />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-gray-900 truncate">{r.user.full_name || 'Unnamed'}</div>
                <div className="text-xs text-gray-500 truncate">
                  {r.user.email || 'no email on file'}
                  {r.detail ? ` · ${r.detail}` : ''}
                  {last ? ` · last reminded ${new Date(last).toLocaleDateString()}` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onPreview(r.user.id)}
                title="Preview this athlete's exact message"
                className={`ml-2 p-1.5 rounded transition ${previewId === r.user.id ? 'bg-indigo-100 text-indigo-700' : 'text-gray-400 hover:text-indigo-600 hover:bg-gray-100'}`}
              >
                <Eye size={15} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ConfirmSendModal({ count, listLabel, sampleName, onCancel, onConfirm, sending }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="border-b border-gray-200 p-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">Send to {count} athlete{count === 1 ? '' : 's'}?</h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600" disabled={sending}><X size={22} /></button>
        </div>
        <div className="p-5 space-y-3 text-sm text-gray-700">
          <p>
            This will post an in-app message to <span className="font-semibold text-gray-900">{count}</span>{' '}
            athlete{count === 1 ? '' : 's'} from the <span className="font-semibold text-gray-900">{listLabel}</span> list.
            {sampleName ? <> Each one gets their own direct message (e.g. {sampleName}).</> : null}
          </p>
          <p className="text-gray-500">
            They will see it in their NBP portal notifications immediately. Nothing is emailed and nothing is scheduled.
          </p>
        </div>
        <div className="border-t border-gray-200 p-4 flex justify-end space-x-3">
          <button
            onClick={onCancel}
            disabled={sending}
            className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-50 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={sending || count === 0}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition disabled:opacity-50 flex items-center space-x-2"
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            <span>{sending ? 'Sending…' : `Send to ${count}`}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Send path — the app's existing in-app messaging tables
// ---------------------------------------------------------------------------

// Reuses an existing 1:1 direct conversation with each athlete when one is
// already there, so this doesn't litter the athlete's Messages list with a new
// thread every time. Batched: 3 round trips for the whole blast, not 3 per
// recipient. The conversations insert is order-independent — a conversation row
// carries no recipient identity, the participants insert we write establishes
// the pairing.
async function sendInAppMessages(adminId, items) {
  const sent = [];
  const failed = [];

  // 1. Map athlete -> existing direct conversation with this admin.
  const directMap = new Map();
  try {
    const { data: myParts, error: mpErr } = await supabase
      .from('conversation_participants').select('conversation_id').eq('user_id', adminId);
    if (mpErr) throw mpErr;
    const myConvIds = Array.from(new Set((myParts || []).map(p => p.conversation_id).filter(Boolean)));
    const directIds = [];
    for (const ids of chunk(myConvIds, 150)) {
      const { data, error } = await supabase.from('conversations').select('id').eq('type', 'direct').in('id', ids);
      if (error) throw error;
      directIds.push(...(data || []).map(c => c.id));
    }
    const byConv = {};
    for (const ids of chunk(directIds, 150)) {
      const { data, error } = await supabase
        .from('conversation_participants').select('conversation_id, user_id').in('conversation_id', ids);
      if (error) throw error;
      (data || []).forEach(p => { (byConv[p.conversation_id] = byConv[p.conversation_id] || []).push(p.user_id); });
    }
    Object.entries(byConv).forEach(([convId, uids]) => {
      const uniq = Array.from(new Set(uids));
      if (uniq.length === 2 && uniq.includes(adminId)) {
        const other = uniq.find(u => u !== adminId);
        if (other && !directMap.has(other)) directMap.set(other, convId);
      }
    });
  } catch (e) {
    // A failed lookup only costs us thread reuse — fall through and create new
    // conversations rather than refusing to send.
    console.error('AthleteOutreach: existing-conversation lookup failed:', e);
  }

  // 2. Create conversations for everyone without one.
  const needConv = items.filter(i => !directMap.has(i.userId));
  for (const batch of chunk(needConv, 100)) {
    const { data, error } = await supabase
      .from('conversations')
      .insert(batch.map(() => ({ type: 'direct', created_by: adminId, is_pinned: false, replies_disabled: false })))
      .select('id');
    if (error || !data || data.length !== batch.length) {
      batch.forEach(i => failed.push({ ...i, reason: formatUserError(error, 'Could not open a conversation.') }));
      continue;
    }
    const participants = [];
    batch.forEach((i, idx) => {
      directMap.set(i.userId, data[idx].id);
      participants.push({ conversation_id: data[idx].id, user_id: adminId });
      participants.push({ conversation_id: data[idx].id, user_id: i.userId });
    });
    const { error: pErr } = await supabase.from('conversation_participants').insert(participants);
    if (pErr) {
      batch.forEach(i => { directMap.delete(i.userId); failed.push({ ...i, reason: formatUserError(pErr) }); });
    }
  }

  // 3. One message row per recipient.
  const deliverable = items.filter(i => directMap.has(i.userId));
  for (const batch of chunk(deliverable, 100)) {
    const { error } = await supabase.from('messages').insert(
      batch.map(i => ({ conversation_id: directMap.get(i.userId), sender_id: adminId, content: i.body }))
    );
    if (error) batch.forEach(i => failed.push({ ...i, reason: formatUserError(error) }));
    else sent.push(...batch);
  }

  return { sent, failed };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const TABS = [
  { id: 'packages', label: 'Package Reminders', icon: Package },
  { id: 'cage', label: 'Open Cage Time', icon: CalendarClock },
];

export default function AthleteOutreach({ userId }) {
  const [tab, setTab] = useState('packages');

  // Shared data
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [players, setPlayers] = useState([]);
  const [purchases, setPurchases] = useState([]);

  // Admin-configurable thresholds (#311 specifies none, so these are settings
  // with visible defaults rather than magic numbers buried in the query).
  const [lowThreshold, setLowThreshold] = useState(DEFAULT_LOW_THRESHOLD);
  const [expiringDays, setExpiringDays] = useState(DEFAULT_EXPIRING_DAYS);
  const [lenientOwnership, setLenientOwnership] = useState(false);
  const [excludeMonthlyHolders, setExcludeMonthlyHolders] = useState(true);

  // Outreach log (optional table — see supabase/migrations/20260815_outreach_log.sql)
  const [logAvailable, setLogAvailable] = useState(true);
  const [lastSentByUser, setLastSentByUser] = useState({});

  const loadCore = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [playerRows, purchaseRows] = await Promise.all([
        fetchAll(() => supabase
          .from('users').select('id, full_name, email, role')
          .eq('role', 'player').order('full_name')),
        fetchAll(() => supabase
          .from('store_purchases')
          .select('id, user_id, product_id, product_kind, product_name_snapshot, status, remaining_qty, expires_at, created_at, paid_at, store_products(name, kind, recurring, bundle_qty)')
          .order('created_at', { ascending: false })),
      ]);
      setPlayers(playerRows);
      setPurchases(purchaseRows);
    } catch (e) {
      console.error('AthleteOutreach: load failed:', e);
      setLoadError(formatUserError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadCore(); }, [loadCore]);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('athlete_outreach_log')
        .select('user_id, kind, sent_at')
        .order('sent_at', { ascending: false })
        .limit(2000);
      if (error) {
        console.error('AthleteOutreach: athlete_outreach_log unavailable (expected until the migration runs):', error);
        setLogAvailable(false);
        return;
      }
      setLogAvailable(true);
      const map = {};
      (data || []).forEach(r => { if (!map[r.user_id]) map[r.user_id] = r.sent_at; });
      setLastSentByUser(map);
    })();
  }, []);

  // ------- derived audiences -------
  const purchasesByUser = useMemo(() => {
    const m = new Map();
    purchases.forEach(p => {
      if (!p.user_id) return;
      if (!m.has(p.user_id)) m.set(p.user_id, []);
      m.get(p.user_id).push(p);
    });
    return m;
  }, [purchases]);

  const noPackage = useMemo(() => {
    const rows = [];
    let pendingOnly = 0;
    let nullQtyOnly = 0;
    players.forEach(u => {
      const mine = purchasesByUser.get(u.id) || [];
      if (mine.some(p => isOwningPurchase(p, { lenient: lenientOwnership }))) return;
      // Why is this person flagged? Two known data traps in this database.
      const hasPendingPack = mine.some(p =>
        p.status === 'pending' && PACKAGE_KINDS.includes(p.product_kind));
      const hasOwningStatusButNoQty = mine.some(p =>
        OWNING_STATUSES.includes(p.status) &&
        PACKAGE_KINDS.includes(p.product_kind) &&
        p.product_kind !== 'package' &&
        (p.remaining_qty === null || p.remaining_qty <= 0));
      if (hasPendingPack) pendingOnly++;
      else if (hasOwningStatusButNoQty) nullQtyOnly++;
      rows.push({
        user: u,
        detail: hasPendingPack
          ? 'has a package purchase stuck at "pending"'
          : hasOwningStatusButNoQty
            ? 'paid pack with no sessions recorded'
            : 'no package purchase on file',
      });
    });
    return { rows, pendingOnly, nullQtyOnly, totalPlayers: players.length };
  }, [players, purchasesByUser, lenientOwnership]);

  const lowOrExpiring = useMemo(() => {
    const playerById = new Map(players.map(u => [u.id, u]));
    const horizon = Date.now() + expiringDays * 86400000;
    const byUser = new Map();
    let unknownQty = 0;
    purchases.forEach(p => {
      const u = playerById.get(p.user_id);
      if (!u) return;
      if (!isOwningPurchase(p, { lenient: lenientOwnership })) return;
      const expTs = p.expires_at ? new Date(p.expires_at).getTime() : null;
      const expiringSoon = expTs !== null && expTs <= horizon;
      // remaining_qty is NULL on nearly every row in this database. NULL is
      // "unknown", never "zero" — those rows are excluded from the low-sessions
      // arm and counted so the owner can see how many the list can't judge.
      const qtyKnown = p.remaining_qty !== null && p.remaining_qty !== undefined;
      const runningLow = qtyKnown && p.remaining_qty <= lowThreshold;
      if (!qtyKnown && !expiringSoon) {
        // A monthly kind='package' with a NULL count is genuinely unlimited,
        // not unknown — it can't "run low", so it isn't a skipped row either.
        if (p.product_kind !== 'package') unknownQty++;
        return;
      }
      if (!runningLow && !expiringSoon) return;
      const bits = [];
      if (runningLow) bits.push(`${p.remaining_qty} session${p.remaining_qty === 1 ? '' : 's'} left`);
      if (expiringSoon) {
        const days = Math.ceil((expTs - Date.now()) / 86400000);
        bits.push(days < 0 ? `expired ${Math.abs(days)}d ago` : days === 0 ? 'expires today' : `expires in ${days}d`);
      }
      const detail = `${p.product_name_snapshot || p.store_products?.name || 'Package'} — ${bits.join(', ')}`;
      // One message per athlete; keep the most urgent purchase.
      const existing = byUser.get(p.user_id);
      if (!existing || (runningLow && !existing.runningLow)) {
        byUser.set(p.user_id, {
          user: u, detail, runningLow,
          packageName: p.product_name_snapshot || p.store_products?.name || 'your package',
          statusLine: bits.join(' and '),
        });
      }
    });
    return { rows: Array.from(byUser.values()), unknownQty };
  }, [players, purchases, lowThreshold, expiringDays, lenientOwnership]);

  const cageAudience = useMemo(() => {
    const playerById = new Map(players.map(u => [u.id, u]));
    const qualifying = new Map();
    const monthlyHolders = new Set();
    purchases.forEach(p => {
      if (!playerById.has(p.user_id)) return;
      const counts = OWNING_STATUSES.includes(p.status) || (lenientOwnership && p.status === 'pending');
      if (!counts) return;
      if (isMonthlyMembership(p)) { monthlyHolders.add(p.user_id); return; }
      // "a cage rental package, or any package that is not a monthly
      // membership" — a retail purchase (hat, shirt) is neither, so kinds
      // outside package/bundle/lesson only qualify via the cage-rental test.
      const cage = isCageRental(p);
      if (!cage && !PACKAGE_KINDS.includes(p.product_kind)) return;
      if (!qualifying.has(p.user_id)) {
        qualifying.set(p.user_id, {
          user: playerById.get(p.user_id),
          detail: `bought ${p.product_name_snapshot || p.store_products?.name || 'a package'}${cage ? ' (cage rental)' : ''}`,
        });
      }
    });
    const all = Array.from(qualifying.values());
    const excluded = all.filter(r => monthlyHolders.has(r.user.id)).length;
    const rows = excludeMonthlyHolders ? all.filter(r => !monthlyHolders.has(r.user.id)) : all;
    return { rows, excluded, monthlyHolderCount: monthlyHolders.size };
  }, [players, purchases, lenientOwnership, excludeMonthlyHolders]);

  const settingsBar = (
    <div className="bg-white rounded-lg shadow border border-gray-200 p-4">
      <div className="flex items-center mb-3">
        <Info size={15} className="text-indigo-600 mr-2 flex-shrink-0" />
        <span className="text-sm font-semibold text-gray-900">Audience settings</span>
        <button
          onClick={loadCore}
          className="ml-auto flex items-center gap-1.5 text-xs text-gray-600 hover:text-indigo-600 transition"
        >
          <RefreshCw size={13} /> Refresh data
        </button>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            &quot;Running low&quot; at or below
          </label>
          <input
            type="number" min="0" max="99"
            value={lowThreshold}
            onChange={(e) => setLowThreshold(Math.max(0, Number(e.target.value) || 0))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <p className="text-[11px] text-gray-400 mt-1">sessions remaining (default {DEFAULT_LOW_THRESHOLD})</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">&quot;Expiring soon&quot; within</label>
          <input
            type="number" min="1" max="365"
            value={expiringDays}
            onChange={(e) => setExpiringDays(Math.max(1, Number(e.target.value) || 1))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <p className="text-[11px] text-gray-400 mt-1">days (default {DEFAULT_EXPIRING_DAYS})</p>
        </div>
        <label className="flex items-start gap-2 text-xs text-gray-700 sm:col-span-2 lg:col-span-1">
          <input
            type="checkbox"
            checked={lenientOwnership}
            onChange={(e) => setLenientOwnership(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span>
            <span className="font-medium text-gray-900">Count half-recorded purchases as owned</span>
            <span className="block text-[11px] text-gray-400 mt-0.5">
              Off by default, matching the booking gate in <code>Schedule.js</code>. Turning it on also counts
              purchases stuck at status <code>pending</code> and packs whose <code>remaining_qty</code> was never
              recorded — in this database every lesson pack is both at once, so relaxing only one would change
              nothing.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-xs text-gray-700 sm:col-span-2 lg:col-span-1">
          <input
            type="checkbox"
            checked={excludeMonthlyHolders}
            onChange={(e) => setExcludeMonthlyHolders(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span>
            <span className="font-medium text-gray-900">Open Cage: exclude monthly members</span>
            <span className="block text-[11px] text-gray-400 mt-0.5">
              A product name ending <code>(MONTHLY price)</code> is a monthly membership.
            </span>
          </span>
        </label>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Athlete Outreach</h2>
        <p className="text-gray-600">Remind athletes to buy packages and fill open cage time.</p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
        <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
        <span>
          <span className="font-semibold">Manual for now.</span> Nothing on this screen sends on a schedule — there is no
          cron job and no background dispatch. You build the list, read the exact message, and click Send. Making it
          automatic is a separate decision.
        </span>
      </div>

      <div className="flex border-b border-gray-200">
        {TABS.map(t => {
          const Icon = t.icon;
          const n = t.id === 'packages'
            ? noPackage.rows.length + lowOrExpiring.rows.length
            : cageAudience.rows.length;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition flex items-center gap-2 ${
                tab === t.id
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
              }`}
            >
              <Icon size={16} />
              {t.label}
              {!loading && !loadError && <CountBadge n={n} tone={tab === t.id ? 'indigo' : 'gray'} />}
            </button>
          );
        })}
      </div>

      {settingsBar}

      {!logAvailable && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5 text-xs text-gray-600">
          Send history is not being recorded — apply{' '}
          <code className="font-mono">supabase/migrations/20260815_outreach_log.sql</code> first. Sending still works
          without it; you just won&apos;t see &quot;last reminded&quot; dates or have a record of what went out.
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-lg shadow border border-gray-200">
          <StateBlock icon={Loader2} spin title="Loading athletes and purchases…" />
        </div>
      ) : loadError ? (
        <div className="bg-white rounded-lg shadow border border-gray-200">
          <StateBlock
            icon={AlertTriangle}
            tone="red"
            title="Could not load the audience"
            body={loadError}
          />
          <div className="pb-6 text-center">
            <button onClick={loadCore} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition">
              Try again
            </button>
          </div>
        </div>
      ) : tab === 'packages' ? (
        <PackageRemindersTab
          adminId={userId}
          noPackage={noPackage}
          lowOrExpiring={lowOrExpiring}
          lowThreshold={lowThreshold}
          expiringDays={expiringDays}
          lenientOwnership={lenientOwnership}
          lastSentByUser={lastSentByUser}
          onLogged={(map) => setLastSentByUser(prev => ({ ...prev, ...map }))}
          onLogUnavailable={() => setLogAvailable(false)}
        />
      ) : (
        <OpenCageTab
          adminId={userId}
          audience={cageAudience}
          lastSentByUser={lastSentByUser}
          onLogged={(map) => setLastSentByUser(prev => ({ ...prev, ...map }))}
          onLogUnavailable={() => setLogAvailable(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared "build a list, preview it, send it" panel
// ---------------------------------------------------------------------------

function OutreachPanel({
  adminId, kind, listLabel, rows, template, setTemplate, tokensFor,
  emptyTitle, emptyBody, notes, lastSentByUser, onLogged, onLogUnavailable,
}) {
  const [selected, setSelected] = useState(() => new Set(rows.map(r => r.user.id)));
  const [previewId, setPreviewId] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  // Re-select everyone whenever the underlying list changes (threshold edit,
  // data refresh) — a stale selection of ids that no longer qualify is worse
  // than starting fresh.
  const rowKey = rows.map(r => r.user.id).join(',');
  useEffect(() => {
    setSelected(new Set(rows.map(r => r.user.id)));
    setPreviewId(null);
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowKey]);

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = (on) => setSelected(on ? new Set(rows.map(r => r.user.id)) : new Set());

  const chosen = rows.filter(r => selected.has(r.user.id));
  const previewRow = chosen.find(r => r.user.id === previewId) || chosen[0] || rows[0] || null;
  const previewBody = previewRow ? renderTemplate(template, tokensFor(previewRow)) : '';

  const copyEmails = async () => {
    const emails = chosen.map(r => r.user.email).filter(Boolean).join(', ');
    try {
      await navigator.clipboard.writeText(emails);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (e) {
      window.prompt('Copy these addresses:', emails);
    }
  };

  const doSend = async () => {
    setSending(true);
    try {
      const items = chosen.map(r => ({
        userId: r.user.id,
        name: r.user.full_name,
        body: renderTemplate(template, tokensFor(r)),
      }));
      const { sent, failed } = await sendInAppMessages(adminId, items);

      let logNote = null;
      if (sent.length > 0) {
        const { error: logErr } = await supabase.from('athlete_outreach_log').insert(
          sent.map(s => ({
            kind, user_id: s.userId, sent_by: adminId, message_snapshot: s.body,
          }))
        );
        if (logErr) {
          console.error('AthleteOutreach: could not write athlete_outreach_log:', logErr);
          onLogUnavailable?.();
          logNote = MISSING_TABLE(logErr)
            ? 'Messages went out, but nothing was recorded — apply supabase/migrations/20260815_outreach_log.sql first.'
            : `Messages went out, but the send could not be logged: ${formatUserError(logErr)}`;
        } else {
          const now = new Date().toISOString();
          const map = {};
          sent.forEach(s => { map[s.userId] = now; });
          onLogged?.(map);
        }
      }

      setResult({
        type: failed.length === 0 ? 'success' : 'partial',
        sent: sent.length,
        failed: failed.length,
        firstError: failed[0]?.reason || null,
        logNote,
      });
      setConfirming(false);
    } catch (e) {
      console.error('AthleteOutreach: send failed:', e);
      setResult({ type: 'error', sent: 0, failed: chosen.length, firstError: formatUserError(e) });
      setConfirming(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow border border-gray-200">
      <div className="px-5 py-3 border-b border-gray-200 flex items-center">
        <h3 className="text-base font-semibold text-gray-900">{listLabel}</h3>
        <CountBadge n={rows.length} />
      </div>

      <div className="p-5 space-y-4">
        {notes}

        {rows.length === 0 ? (
          <StateBlock icon={Users} title={emptyTitle} body={emptyBody} />
        ) : (
          <>
            <RecipientList
              rows={rows}
              selected={selected}
              onToggle={toggle}
              onToggleAll={toggleAll}
              previewId={previewRow?.user.id ?? null}
              onPreview={setPreviewId}
              lastSentByUser={lastSentByUser}
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
              <textarea
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                rows={9}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Placeholders are filled per athlete. Available here:{' '}
                <code>{Object.keys(tokensFor(rows[0])).map(k => `{{${k}}}`).join('  ')}</code>
              </p>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-1">
                <Eye size={14} className="text-gray-400" />
                <span className="text-sm font-medium text-gray-700">
                  Exact message {previewRow ? `for ${previewRow.user.full_name || 'this athlete'}` : ''}
                </span>
              </div>
              <pre className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-800 whitespace-pre-wrap font-sans">
                {previewBody || 'Nobody selected.'}
              </pre>
            </div>

            {result && (
              <div className={`rounded-lg px-4 py-3 text-sm ${
                result.type === 'success' ? 'bg-green-50 border border-green-200 text-green-800'
                  : result.type === 'partial' ? 'bg-amber-50 border border-amber-200 text-amber-800'
                    : 'bg-red-50 border border-red-200 text-red-700'
              }`}>
                <p className="font-medium">
                  {result.sent > 0
                    ? `Sent ${result.sent} in-app message${result.sent === 1 ? '' : 's'}.`
                    : 'Nothing was sent.'}
                  {result.failed > 0 ? ` ${result.failed} failed.` : ''}
                </p>
                {result.firstError && <p className="mt-1 text-xs">{result.firstError}</p>}
                {result.logNote && <p className="mt-1 text-xs">{result.logNote}</p>}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 border-t border-gray-200 pt-4">
              <button
                onClick={() => setConfirming(true)}
                disabled={chosen.length === 0}
                className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <MessageSquare size={16} />
                Send in-app message to {chosen.length}
              </button>
              <button
                onClick={copyEmails}
                disabled={chosen.length === 0}
                title="Paste into Admin → Store → Email Campaign if you'd rather email this list"
                className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition disabled:opacity-40 flex items-center gap-2"
              >
                {copied ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
                {copied ? 'Copied' : 'Copy emails for a campaign'}
              </button>
              <span className="text-xs text-gray-400">
                Sends as a direct message from your account — it lands in their portal notifications.
              </span>
            </div>
          </>
        )}
      </div>

      {confirming && (
        <ConfirmSendModal
          count={chosen.length}
          listLabel={listLabel}
          sampleName={chosen[0]?.user.full_name}
          sending={sending}
          onCancel={() => !sending && setConfirming(false)}
          onConfirm={doSend}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 1 — #311
// ---------------------------------------------------------------------------

function PackageRemindersTab({
  adminId, noPackage, lowOrExpiring, lowThreshold, expiringDays, lenientOwnership,
  lastSentByUser, onLogged, onLogUnavailable,
}) {
  const [noPkgMsg, setNoPkgMsg] = useState(DEFAULT_NO_PACKAGE_MSG);
  const [lowMsg, setLowMsg] = useState(DEFAULT_LOW_MSG);

  const flaggedShare = noPackage.totalPlayers
    ? Math.round((noPackage.rows.length / noPackage.totalPlayers) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <OutreachPanel
        adminId={adminId}
        kind="no_package"
        listLabel="Athletes with no active package or subscription"
        rows={noPackage.rows}
        template={noPkgMsg}
        setTemplate={setNoPkgMsg}
        tokensFor={(r) => ({ first_name: firstName(r?.user?.full_name) })}
        emptyTitle="Every player has an active package"
        emptyBody="Nobody matches the app's active-package test right now."
        lastSentByUser={lastSentByUser}
        onLogged={onLogged}
        onLogUnavailable={onLogUnavailable}
        notes={
          <div className="space-y-3">
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-xs text-gray-600">
              <span className="font-semibold text-gray-900">How this list is built:</span> the same predicate the
              booking gate uses (<code>ReserveSlotModal</code> in <code>src/Schedule.js</code>) — a purchase of kind
              package/bundle/lesson, status <code>active</code> or <code>paid</code>
              {lenientOwnership ? ' or pending (you relaxed that above)' : ''}, not expired, and with sessions left
              (a monthly <code>package</code> may have an unlimited/NULL count; a bundle or lesson pack may not).
            </div>
            {(noPackage.rows.length > 0) && (
              <div className={`rounded-lg px-4 py-3 text-xs flex items-start gap-2 ${
                flaggedShare >= 50
                  ? 'bg-red-50 border border-red-200 text-red-800'
                  : 'bg-amber-50 border border-amber-200 text-amber-800'
              }`}>
                <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
                <span>
                  <span className="font-semibold">
                    {noPackage.rows.length} of {noPackage.totalPlayers} players ({flaggedShare}%) are flagged.
                  </span>{' '}
                  Read this before you send: <span className="font-semibold">{noPackage.pendingOnly}</span> of them
                  DO have a package purchase that is simply stuck at status <code>pending</code> — in this database
                  every lesson-pack purchase sits at <code>pending</code>, so they probably are paying customers.
                  Another <span className="font-semibold">{noPackage.nullQtyOnly}</span> have a paid pack whose
                  session count was never recorded (<code>remaining_qty</code> is NULL). Flip{' '}
                  <span className="font-semibold">Count &quot;pending&quot; purchases as owned</span> above to see the
                  list without them, or uncheck people individually below.
                </span>
              </div>
            )}
          </div>
        }
      />

      <OutreachPanel
        adminId={adminId}
        kind="low_or_expiring"
        listLabel={`Athletes running low or expiring (≤ ${lowThreshold} sessions, or within ${expiringDays} days)`}
        rows={lowOrExpiring.rows}
        template={lowMsg}
        setTemplate={setLowMsg}
        tokensFor={(r) => ({
          first_name: firstName(r?.user?.full_name),
          package: r?.packageName || 'your package',
          status_line: r?.statusLine || 'it is running low',
        })}
        emptyTitle="Nobody is running low"
        emptyBody={`No package is at or below ${lowThreshold} sessions or expiring within ${expiringDays} days.`}
        lastSentByUser={lastSentByUser}
        onLogged={onLogged}
        onLogUnavailable={onLogUnavailable}
        notes={
          <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-xs text-gray-600">
            <span className="font-semibold text-gray-900">Thresholds are yours to set</span> — defaults are{' '}
            {DEFAULT_LOW_THRESHOLD} sessions and {DEFAULT_EXPIRING_DAYS} days, editable above.
            {lowOrExpiring.unknownQty > 0 && (
              <>
                {' '}
                <span className="font-semibold text-amber-700">
                  {lowOrExpiring.unknownQty} purchase{lowOrExpiring.unknownQty === 1 ? ' was' : 's were'} skipped
                </span>{' '}
                because <code>remaining_qty</code> is NULL and there is no expiry date — the number of sessions left
                is unknown, so they are treated as unknown rather than as zero.
              </>
            )}
          </div>
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2 — #300
// ---------------------------------------------------------------------------

function OpenCageTab({ adminId, audience, lastSentByUser, onLogged, onLogUnavailable }) {
  const [msg, setMsg] = useState(DEFAULT_CAGE_MSG);
  const [avLoading, setAvLoading] = useState(true);
  const [avError, setAvError] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [dropped, setDropped] = useState(() => new Set()); // block keys the admin unchecked
  const [lanes, setLanes] = useState(() => new Set(CAGE_LANES));
  const [openHour, setOpenHour] = useState(DEFAULT_OPEN_HOUR);
  const [closeHour, setCloseHour] = useState(DEFAULT_CLOSE_HOUR);
  const [minBlock, setMinBlock] = useState(DEFAULT_MIN_BLOCK_MIN);
  const [events, setEvents] = useState([]);

  const { start, end } = useMemo(() => nextWeekRange(new Date()), []);
  const weekDates = useMemo(() => {
    const out = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      out.push(fmtLocalDate(d));
    }
    return out;
  }, [start]);

  const loadAvailability = useCallback(async () => {
    setAvLoading(true);
    setAvError(null);
    try {
      const startStr = fmtLocalDate(start);
      const endStr = fmtLocalDate(end);
      // Same three-query shape as fetchFacilityEvents in src/Schedule.js:
      // non-recurring rows in range, recurring masters, and exception children —
      // then expandRecurringEvents (the shared helper both portals use) turns
      // masters into per-date occurrences and drops tombstoned dates.
      const sel = 'id, title, event_date, start_time, end_time, lanes, is_recurring, recurrence_rule, recurrence_parent_id, is_exception, original_date';
      const [nrRes, mRes, exRes] = await Promise.all([
        supabase.from('facility_events').select(sel)
          .eq('is_recurring', false).is('recurrence_parent_id', null)
          .gte('event_date', startStr).lte('event_date', endStr),
        supabase.from('facility_events').select(sel)
          .eq('is_recurring', true).is('recurrence_parent_id', null),
        supabase.from('facility_events').select(sel)
          .not('recurrence_parent_id', 'is', null)
          .gte('event_date', startStr).lte('event_date', endStr),
      ]);
      if (nrRes.error) throw nrRes.error;
      if (mRes.error) throw mRes.error;
      if (exRes.error) throw exRes.error;
      const expanded = expandRecurringEvents(mRes.data || [], exRes.data || [], start, end);
      setEvents([...(nrRes.data || []), ...expanded]);
    } catch (e) {
      console.error('AthleteOutreach: availability load failed:', e);
      setAvError(formatUserError(e));
      setEvents([]);
    } finally {
      setAvLoading(false);
    }
  }, [start, end]);

  useEffect(() => { loadAvailability(); }, [loadAvailability]);

  useEffect(() => {
    setBlocks(computeOpenBlocks(events, weekDates, CAGE_LANES.filter(l => lanes.has(l)), openHour, closeHour, minBlock));
    setDropped(new Set());
  }, [events, weekDates, lanes, openHour, closeHour, minBlock]);

  const blockKey = (b) => `${b.date}|${b.lane}|${b.start}`;
  const kept = blocks.filter(b => !dropped.has(blockKey(b)));

  const openingsText = useMemo(() => {
    if (kept.length === 0) return '(no openings selected)';
    const byDate = {};
    kept.forEach(b => { (byDate[b.date] = byDate[b.date] || []).push(b); });
    return Object.keys(byDate).sort().map(d => {
      const lines = byDate[d]
        .sort((a, b) => a.lane.localeCompare(b.lane) || a.start - b.start)
        .map(b => `  • ${b.lane} — ${fromMinutes(b.start)} to ${fromMinutes(b.end)}`);
      return `${prettyDate(d)}\n${lines.join('\n')}`;
    }).join('\n\n');
  }, [kept]);

  const rangeLabel = `${prettyDate(fmtLocalDate(start))} – ${prettyDate(fmtLocalDate(end))}`;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow border border-gray-200">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center flex-wrap gap-2">
          <h3 className="text-base font-semibold text-gray-900">Next week&apos;s open cage time</h3>
          <span className="text-sm text-gray-500">{rangeLabel}</span>
          <CountBadge n={kept.length} />
          <button
            onClick={loadAvailability}
            className="ml-auto flex items-center gap-1.5 text-xs text-gray-600 hover:text-indigo-600 transition"
          >
            <RefreshCw size={13} /> Reload schedule
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-xs text-gray-600">
            <span className="font-semibold text-gray-900">Where this comes from:</span> the same source the
            Schedule &rarr; Facility &rarr; <span className="font-medium">Lanes</span> grid draws from —{' '}
            <code>facility_events.lanes</code>, expanded through the shared{' '}
            <code>expandRecurringEvents</code> helper. Anything not covered by a facility event on a lane, inside the
            open window below, is offered as open. Coach training sessions are not lane-assigned in this data (the
            Lanes grid puts them in their own per-coach band), so they are not subtracted here either — uncheck
            anything that is actually taken before you send.
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Facility opens</label>
              <input type="number" min="0" max="23" value={openHour}
                onChange={(e) => setOpenHour(Math.min(23, Math.max(0, Number(e.target.value) || 0)))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <p className="text-[11px] text-gray-400 mt-1">hour, 24h (default {DEFAULT_OPEN_HOUR})</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Facility closes</label>
              <input type="number" min="1" max="24" value={closeHour}
                onChange={(e) => setCloseHour(Math.min(24, Math.max(1, Number(e.target.value) || 1)))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <p className="text-[11px] text-gray-400 mt-1">hour, 24h (default {DEFAULT_CLOSE_HOUR})</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Smallest block to offer</label>
              <input type="number" min="15" step="15" max="480" value={minBlock}
                onChange={(e) => setMinBlock(Math.max(15, Number(e.target.value) || 15))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <p className="text-[11px] text-gray-400 mt-1">minutes (default {DEFAULT_MIN_BLOCK_MIN})</p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Lanes to offer</label>
            <div className="flex flex-wrap gap-2">
              {CAGE_LANES.map(l => (
                <label key={l} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs cursor-pointer transition ${
                  lanes.has(l) ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-white border-gray-300 text-gray-500'
                }`}>
                  <input
                    type="checkbox"
                    checked={lanes.has(l)}
                    onChange={() => setLanes(prev => {
                      const next = new Set(prev);
                      if (next.has(l)) next.delete(l); else next.add(l);
                      return next;
                    })}
                    className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  {l}
                </label>
              ))}
            </div>
          </div>

          {avLoading ? (
            <StateBlock icon={Loader2} spin title="Reading next week's schedule…" />
          ) : avError ? (
            <StateBlock icon={AlertTriangle} tone="red" title="Could not read the schedule" body={avError} />
          ) : blocks.length === 0 ? (
            <StateBlock
              icon={CalendarClock}
              title="No open cage time next week"
              body="Every selected lane is booked for the whole open window, or nothing is on the calendar to compare against. Widen the hours, lower the smallest block, or add lanes above."
            />
          ) : (
            <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-72 overflow-y-auto">
              {weekDates.filter(d => blocks.some(b => b.date === d)).map(d => (
                <div key={d} className="p-3">
                  <div className="text-xs font-semibold text-gray-900 mb-1.5">{prettyDate(d)}</div>
                  <div className="flex flex-wrap gap-2">
                    {blocks.filter(b => b.date === d).map(b => {
                      const k = blockKey(b);
                      const on = !dropped.has(k);
                      return (
                        <label key={k} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs cursor-pointer transition ${
                          on ? 'bg-teal-50 border-teal-300 text-teal-800' : 'bg-white border-gray-200 text-gray-400'
                        }`}>
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => setDropped(prev => {
                              const next = new Set(prev);
                              if (next.has(k)) next.delete(k); else next.add(k);
                              return next;
                            })}
                            className="h-3.5 w-3.5 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                          />
                          {b.lane} · {fromMinutes(b.start)}–{fromMinutes(b.end)}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <OutreachPanel
        adminId={adminId}
        kind="open_cage"
        listLabel="Cage-rental and non-monthly package buyers"
        rows={audience.rows}
        template={msg}
        setTemplate={setMsg}
        tokensFor={(r) => ({
          first_name: firstName(r?.user?.full_name),
          openings: openingsText,
          week: rangeLabel,
        })}
        emptyTitle="No matching buyers"
        emptyBody="Nobody has a cage rental or a non-monthly package purchase in an owned status."
        lastSentByUser={lastSentByUser}
        onLogged={onLogged}
        onLogUnavailable={onLogUnavailable}
        notes={
          <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-xs text-gray-600">
            <span className="font-semibold text-gray-900">Who this reaches:</span> players who bought a cage rental
            (<code>store_products.kind = &apos;rental&apos;</code>, the kind the Store labels &quot;Cage / Lane Rental&quot;,
            plus any product whose name contains &quot;cage&quot;) or any package that is not a monthly membership.
            A product name ending <code>(MONTHLY price)</code> is a monthly membership.
            {audience.excluded > 0 && (
              <> <span className="font-semibold text-amber-700">{audience.excluded}</span> buyer
                {audience.excluded === 1 ? '' : 's'} also hold a monthly membership and{' '}
                {audience.excluded === 1 ? 'is' : 'are'} excluded — untick that setting above to include them.</>
            )}
            {kept.length === 0 && (
              <> <span className="font-semibold text-red-700">There are no openings selected</span>, so the message
                body has nothing to offer yet.</>
            )}
          </div>
        }
      />
    </div>
  );
}
