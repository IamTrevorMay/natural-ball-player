import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase, supabaseUrl, supabaseAnonKey } from './supabaseClient';
import { Mail, Send, History, LayoutTemplate, Image as ImageIcon, ShieldAlert, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import DOMPurify from 'dompurify';
import { formatUserError } from './errorMessage';

/*
 * Issue #281 — Email Campaigns, Phase 1 of 3. Mirrors EZFacility's Email
 * Campaign section: five sub-items in a left rail, with Send Email Campaign
 * as a 4-step wizard (Select Clients → Filter Clients → Compose Message →
 * Preview and Send) and the live recipient count repeated in every step
 * header.
 *
 * ⚠️ Phase 2 adds Send Blast — the only irreversible button in the app.
 * There are 937 real email addresses behind this screen. The protections,
 * in order: the recipient list is snapshotted into email_campaign_recipients
 * BEFORE anything sends (frozen at commit time — a signup mid-send changes
 * nothing); the admin must TYPE the exact recipient count to confirm; the
 * send-campaign edge function is admin-only, reads recipients server-side
 * by campaign id (never from the browser), verifies the snapshot matches
 * the confirmed count, skips blacklisted addresses (recorded as 'skipped'),
 * writes per-recipient results as it goes, and is idempotent — re-invoking
 * skips everyone already sent, so a double click or a retry cannot
 * double-send. Every campaign email carries a per-recipient unsubscribe
 * link. "Send Test" (one email, to the admin, via send-email) is unchanged.
 *
 * The recipient COUNT and the recipient LIST must never diverge, so both
 * derive from the same query builder (buildRecipientQuery) — the count is
 * head:true over exactly the query the list would run.
 */

const SECTIONS = [
  { key: 'send', label: 'Send Email Campaign', desc: 'Send an email to all or targeted clients', icon: Send },
  { key: 'history', label: 'Campaign History', desc: 'View history for email campaigns', icon: History },
  { key: 'templates', label: 'Email Template Library', desc: 'Create, edit, and email templates that can be used with an email blast', icon: LayoutTemplate },
  { key: 'images', label: 'Email Image Library', desc: 'Add and remove images that can be used with an email blast', icon: ImageIcon },
  { key: 'failed', label: 'Failed Emails', desc: 'View email addresses currently on the blacklist', icon: ShieldAlert },
];

const STEPS = ['Select Clients', 'Filter Clients', 'Compose Message', 'Preview and Send'];

const CATEGORIES = [
  { value: 'all', label: 'All Contacts' },
  { value: 'players', label: 'Players' },
  { value: 'staff', label: 'Staff (Coaches & Admins)' },
  { value: 'leads', label: 'Public Leads' },
];

// Rich-text toolbar kept to what email clients actually render.
const QUILL_MODULES = {
  toolbar: [
    [{ header: [false, 2, 3] }],
    ['bold', 'italic', 'underline'],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['link'],
    ['clean'],
  ],
};

export default function EmailCampaigns({ userId, section, onSectionChange }) {
  const [step, setStep] = useState(1);

  // Step 1 — category. Step 2 — filters.
  const [category, setCategory] = useState('all');
  const [teams, setTeams] = useState([]);
  const [filters, setFilters] = useState({ teamId: '', staffStatus: '', signedUpAfter: '', signedUpBefore: '' });
  // Resolved user ids for the chosen team; null = no team filter active.
  const [teamMemberIds, setTeamMemberIds] = useState(null);

  const [count, setCount] = useState(null);
  const [countError, setCountError] = useState(null);

  // Step 3 — compose.
  const [returnEmail, setReturnEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [templates, setTemplates] = useState([]);
  const [templatesUnavailable, setTemplatesUnavailable] = useState(false);
  const [templateCategory, setTemplateCategory] = useState('');

  // Step 4 — Send Test.
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [myProfile, setMyProfile] = useState(null);

  // Step 4 — Send Blast (#281 Phase 2). One state machine so a second run
  // cannot start while one is in flight: null → 'confirm' → 'snapshotting'
  // → 'sending' → 'done' | 'error'.
  const [blast, setBlast] = useState(null); // { phase, confirmText, confirmedCount, campaignId, tally, error }

  useEffect(() => {
    (async () => {
      const [{ data: teamRows, error: teamsError }, { data: me, error: meError }] = await Promise.all([
        supabase.from('teams').select('id, name').order('name'),
        supabase.from('users').select('id, full_name, email').eq('id', userId).maybeSingle(),
      ]);
      if (teamsError) console.error('EmailCampaigns: teams query failed:', teamsError);
      if (meError) console.error('EmailCampaigns: own user query failed:', meError);
      setTeams(teamRows || []);
      if (me) {
        setMyProfile(me);
        setReturnEmail(prev => prev || me.email || '');
      }
    })();
  }, [userId]);

  // Templates feed Step 3's picker. The email_templates table ships with this
  // phase's (unrun) migration, so tolerate it not existing yet.
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from('email_templates').select('id, name, category, subject, body_html').order('name');
      if (error) {
        console.error('EmailCampaigns: email_templates query failed (expected until the #281 migration runs):', error);
        setTemplatesUnavailable(true);
        setTemplates([]);
        return;
      }
      setTemplatesUnavailable(false);
      setTemplates(data || []);
    })();
  }, []);

  // Resolve the chosen team to user ids BEFORE counting, so the count and the
  // list can share one query.
  useEffect(() => {
    if (!filters.teamId) { setTeamMemberIds(null); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from('team_members').select('user_id').eq('team_id', filters.teamId);
      if (error) { console.error('EmailCampaigns: team_members query failed:', error); if (!cancelled) setTeamMemberIds([]); return; }
      if (!cancelled) setTeamMemberIds(Array.from(new Set((data || []).map(r => r.user_id).filter(Boolean))));
    })();
    return () => { cancelled = true; };
  }, [filters.teamId]);

  // THE single source of truth for who a campaign reaches. The header count
  // is this exact query with head:true — never a separate approximation.
  const buildRecipientQuery = useCallback((selectCols, { head = false } = {}) => {
    let q = supabase.from('users').select(selectCols, head ? { count: 'exact', head: true } : undefined);
    if (category === 'players') q = q.eq('role', 'player');
    else if (category === 'staff') q = q.in('role', ['admin', 'coach']);
    else if (category === 'leads') q = q.eq('role', 'public');
    // 'all' = All Contacts: every user row with an email.
    q = q.not('email', 'is', null);
    if (filters.teamId && teamMemberIds !== null) {
      // A team with no members must resolve to zero recipients, not "no filter".
      q = q.in('id', teamMemberIds.length > 0 ? teamMemberIds : ['00000000-0000-0000-0000-000000000000']);
    }
    if (category === 'staff' && filters.staffStatus) {
      // coach_status null counts as Active everywhere else in the app
      // (AdminSettings' getUserStatus) — mirror that here.
      if (filters.staffStatus === 'Active') q = q.or('coach_status.is.null,coach_status.eq.Active');
      else q = q.eq('coach_status', filters.staffStatus);
    }
    if (filters.signedUpAfter) q = q.gte('created_at', filters.signedUpAfter);
    if (filters.signedUpBefore) q = q.lte('created_at', filters.signedUpBefore + 'T23:59:59');
    return q;
  }, [category, filters, teamMemberIds]);

  useEffect(() => {
    // Waiting on the team resolve — don't show a count for the wrong list.
    if (filters.teamId && teamMemberIds === null) { setCount(null); return; }
    let cancelled = false;
    (async () => {
      const { count: n, error } = await buildRecipientQuery('id', { head: true });
      if (error) {
        console.error('EmailCampaigns: recipient count query failed:', error);
        if (!cancelled) { setCount(null); setCountError(formatUserError(error)); }
        return;
      }
      if (!cancelled) { setCount(n ?? 0); setCountError(null); }
    })();
    return () => { cancelled = true; };
  }, [buildRecipientQuery, filters.teamId, teamMemberIds]);

  const templateCategories = useMemo(
    () => Array.from(new Set(templates.map(t => t.category).filter(Boolean))).sort(),
    [templates]
  );
  const visibleTemplates = templateCategory
    ? templates.filter(t => t.category === templateCategory)
    : templates;

  const applyTemplate = (templateId) => {
    const t = templates.find(x => x.id === templateId);
    if (!t) return;
    if (t.subject) setSubject(t.subject);
    if (t.body_html) setBodyHtml(t.body_html);
  };

  // Quill emits '<p><br></p>' for an empty editor.
  const bodyIsEmpty = !bodyHtml || bodyHtml.replace(/<(.|\n)*?>/g, '').trim().length === 0;
  const canSendTest = !!subject.trim() && !bodyIsEmpty && !sendingTest;

  const htmlToText = (html) => {
    const div = document.createElement('div');
    // Sanitized even for text extraction — templates are staff-authored rows
    // shared between accounts, so treat their HTML as untrusted everywhere.
    div.innerHTML = DOMPurify.sanitize(html);
    return (div.innerText || '').trim();
  };

  // Sends exactly ONE email, to the logged-in admin, through the existing
  // single-recipient send-email function. It ignores the recipient list
  // entirely — that is the point. (send-email renders `body` as plain text,
  // so the test carries a text rendition; pixel-true HTML tests arrive with
  // Phase 2's send-campaign function, which owns HTML sending.)
  const handleSendTest = async () => {
    if (!canSendTest) return;
    setSendingTest(true);
    setTestResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const selfEmail = myProfile?.email || session?.user?.email;
      if (!session || !selfEmail) {
        setTestResult({ type: 'error', message: 'Could not resolve your own email address — not sending.' });
        return;
      }
      const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': supabaseAnonKey,
        },
        body: JSON.stringify({
          recipientEmail: selfEmail,
          recipientName: myProfile?.full_name || 'NBP Admin',
          subject: `[TEST] ${subject.trim()}`,
          body: htmlToText(bodyHtml),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTestResult({ type: 'error', message: data.error || 'Failed to send the test email' });
      } else {
        setTestResult({ type: 'success', message: `Test sent to ${selfEmail} — and only to ${selfEmail}.` });
      }
    } catch (err) {
      setTestResult({ type: 'error', message: err.message || 'Network error' });
    } finally {
      setSendingTest(false);
    }
  };

  // ---- Send Blast (#281 Phase 2) -------------------------------------
  const blastBusy = !!blast && ['snapshotting', 'sending'].includes(blast.phase);
  const canOpenBlastConfirm = !!subject.trim() && !bodyIsEmpty && (count || 0) >= 1 && !blastBusy;

  const readTally = async (campaignId) => {
    const { data, error } = await supabase
      .from('email_campaign_recipients')
      .select('status')
      .eq('campaign_id', campaignId)
      .range(0, 9999);
    if (error) { console.error('EmailCampaigns: tally query failed:', error); return null; }
    const tally = { sent: 0, failed: 0, skipped: 0, pending: 0, total: (data || []).length };
    (data || []).forEach(r => { if (tally[r.status] !== undefined) tally[r.status] += 1; });
    return tally;
  };

  const invokeSendCampaign = async (campaignId, { retryFailed = false } = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');
    const res = await fetch(`${supabaseUrl}/functions/v1/send-campaign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': supabaseAnonKey,
      },
      body: JSON.stringify({ campaignId, retryFailed }),
    });
    let data = {};
    try { data = await res.json(); } catch (_) { /* non-JSON body */ }
    if (!res.ok) throw new Error(data.error || `send-campaign returned status ${res.status}`);
    return data;
  };

  // Drives 'sending': invokes the function (re-invoking on { resume: true } —
  // idempotency makes resumption safe) while polling live tallies from the
  // database, which is the source of truth for progress.
  const runSend = async (campaignId, { retryFailed = false } = {}) => {
    setBlast(prev => ({ ...prev, phase: 'sending', campaignId, error: null }));
    const poll = setInterval(async () => {
      const tally = await readTally(campaignId);
      if (tally) setBlast(prev => (prev && prev.campaignId === campaignId ? { ...prev, tally } : prev));
    }, 1500);
    try {
      let result = await invokeSendCampaign(campaignId, { retryFailed });
      let hops = 0;
      while (result.resume && hops < 20) {
        result = await invokeSendCampaign(campaignId);
        hops += 1;
      }
      const tally = await readTally(campaignId);
      setBlast(prev => ({ ...prev, phase: 'done', tally: tally || prev?.tally || null }));
    } catch (err) {
      const tally = await readTally(campaignId);
      setBlast(prev => ({ ...prev, phase: 'error', error: err.message, tally: tally || prev?.tally || null }));
    } finally {
      clearInterval(poll);
    }
  };

  // The commit point. Everything before the invoke is reversible; the order
  // here is the safety: re-verify the count, freeze the snapshot, and only
  // then hand the campaign id (nothing else) to the server.
  const handleConfirmedBlast = async () => {
    const confirmedCount = blast?.confirmedCount;
    setBlast(prev => ({ ...prev, phase: 'snapshotting', error: null }));
    let campaignId = null;
    try {
      // 1. The list must still match the number the admin typed.
      const { count: liveCount, error: recountError } = await buildRecipientQuery('id', { head: true });
      if (recountError) throw new Error(`Could not re-verify the recipient count: ${formatUserError(recountError)}`);
      if (liveCount !== confirmedCount) {
        throw new Error(`The recipient list changed (now ${liveCount}, you confirmed ${confirmedCount}). Nothing was sent — please re-check and confirm again.`);
      }

      // 2. Freeze the list — same query the count came from.
      const { data: recipients, error: listError } = await buildRecipientQuery('id, email').range(0, 9999);
      if (listError) throw new Error(`Could not load the recipient list: ${formatUserError(listError)}`);
      if (!recipients || recipients.length !== confirmedCount) {
        throw new Error(`Recipient list loaded ${recipients?.length ?? 0} rows but the confirmed count is ${confirmedCount}. Nothing was sent.`);
      }

      // 3. The campaign row the server will trust.
      const { data: campaign, error: campaignError } = await supabase
        .from('email_campaigns')
        .insert({
          created_by: userId,
          subject: subject.trim(),
          body_html: DOMPurify.sanitize(bodyHtml),
          return_email: returnEmail || null,
          recipient_filter: { category, filters },
          recipient_count: confirmedCount,
          status: 'draft',
        })
        .select('id')
        .single();
      if (campaignError) throw new Error(`Could not create the campaign: ${formatUserError(campaignError)}`);
      campaignId = campaign.id;

      // 4. Snapshot rows (unsubscribe tokens are generated by the database).
      for (let i = 0; i < recipients.length; i += 500) {
        const chunk = recipients.slice(i, i + 500).map(r => ({ campaign_id: campaignId, user_id: r.id, email: r.email }));
        const { error: insertError } = await supabase.from('email_campaign_recipients').insert(chunk);
        if (insertError) throw new Error(`Could not snapshot recipients: ${formatUserError(insertError)}`);
      }

      // 5. Send. From here on the server owns the run.
      await runSend(campaignId);
    } catch (err) {
      // A failed snapshot must not leave a half-frozen draft behind.
      if (campaignId) {
        const { error: cleanupError } = await supabase.from('email_campaigns').delete().eq('id', campaignId).eq('status', 'draft');
        if (cleanupError) console.error('EmailCampaigns: draft cleanup failed:', cleanupError);
      }
      setBlast(prev => ({ ...prev, phase: 'error', error: err.message }));
    }
  };

  const activeCategoryLabel = (CATEGORIES.find(c => c.value === category) || CATEGORIES[0]).label;
  const countLabel = count === null ? '…' : count;

  const stepHeader = (title) => (
    <h4 className="text-base font-semibold text-gray-900">
      {title}{' '}
      <span className="font-normal text-gray-500">( {countLabel} client{count === 1 ? '' : 's'} selected. )</span>
    </h4>
  );

  const renderWizard = () => (
    <div>
      {/* Step rail */}
      <div className="flex items-center mb-6 overflow-x-auto">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const isCurrent = step === n;
          const isDone = step > n;
          return (
            <React.Fragment key={label}>
              {i > 0 && <div className={`h-0.5 w-6 sm:w-10 flex-shrink-0 ${step > i ? 'bg-blue-500' : 'bg-gray-200'}`} />}
              <button
                type="button"
                onClick={() => { if (n < step) setStep(n); }}
                className={`flex items-center space-x-2 px-2 py-1 rounded flex-shrink-0 ${n < step ? 'cursor-pointer hover:bg-gray-50' : 'cursor-default'}`}
              >
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${isCurrent ? 'bg-blue-600 text-white' : isDone ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-500'}`}>
                  {isDone ? <Check size={13} /> : n}
                </span>
                <span className={`text-sm whitespace-nowrap ${isCurrent ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>{label}</span>
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {countError && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
          Could not count recipients: {countError}
        </div>
      )}

      {/* Step 1 — Select Clients */}
      {step === 1 && (
        <div className="space-y-4">
          {stepHeader('Select Clients')}
          <div className="max-w-sm">
            <label className="block text-sm font-medium text-gray-700 mb-1">Client Category</label>
            <select
              value={category}
              onChange={(e) => { setCategory(e.target.value); setFilters({ teamId: '', staffStatus: '', signedUpAfter: '', signedUpBefore: '' }); }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <p className="text-xs text-gray-400 mt-1.5">
              The count above always reflects exactly who this campaign would reach with the current category and filters.
            </p>
          </div>
        </div>
      )}

      {/* Step 2 — Filter Clients */}
      {step === 2 && (
        <div className="space-y-4">
          {stepHeader('Filter Clients')}
          <div className="grid sm:grid-cols-2 gap-4 max-w-2xl">
            {(category === 'all' || category === 'players') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Team</label>
                <select
                  value={filters.teamId}
                  onChange={(e) => setFilters({ ...filters, teamId: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Any team</option>
                  {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}
            {category === 'staff' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Coach Status</label>
                <select
                  value={filters.staffStatus}
                  onChange={(e) => setFilters({ ...filters, staffStatus: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Any status</option>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Signed up after</label>
              <input
                type="date"
                value={filters.signedUpAfter}
                onChange={(e) => setFilters({ ...filters, signedUpAfter: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Signed up before</label>
              <input
                type="date"
                value={filters.signedUpBefore}
                onChange={(e) => setFilters({ ...filters, signedUpBefore: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <p className="text-xs text-gray-400 max-w-2xl">
            Filters are limited to what the database can answer exactly — the header count is derived from the same query that
            would produce the recipient list, never estimated separately.
          </p>
        </div>
      )}

      {/* Step 3 — Compose Message */}
      {step === 3 && (
        <div className="space-y-4 max-w-3xl">
          {stepHeader('Compose Message')}
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email Template</label>
              <div className="flex space-x-2">
                <select
                  value={templateCategory}
                  onChange={(e) => setTemplateCategory(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={templates.length === 0}
                >
                  <option value="">All categories</option>
                  {templateCategories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select
                  value=""
                  onChange={(e) => applyTemplate(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={visibleTemplates.length === 0}
                >
                  <option value="">{templates.length === 0 ? 'No templates yet' : 'Apply a template…'}</option>
                  {visibleTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {templatesUnavailable
                  ? 'The Template Library arrives with Phase 3 (its table is created by the #281 migration).'
                  : 'The Template Library (Phase 3) manages these.'}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Return Email Address</label>
              <input
                type="email"
                value={returnEmail}
                onChange={(e) => setReturnEmail(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
            <div className="bg-white border border-gray-300 rounded-lg overflow-hidden">
              <ReactQuill theme="snow" value={bodyHtml} onChange={setBodyHtml} modules={QUILL_MODULES} />
            </div>
          </div>
        </div>
      )}

      {/* Step 4 — Preview and Send */}
      {step === 4 && (
        <div className="space-y-4 max-w-3xl">
          {stepHeader('Preview and Send')}
          <div className="text-sm text-gray-600 space-y-1">
            <p><span className="font-medium text-gray-900">Recipients:</span> {countLabel} ({activeCategoryLabel})</p>
            <p><span className="font-medium text-gray-900">Return address:</span> {returnEmail || '—'}</p>
            <p><span className="font-medium text-gray-900">Subject:</span> {subject || <span className="italic text-gray-400">no subject yet</span>}</p>
          </div>
          <div className="border border-gray-200 rounded-lg p-6 bg-gray-50">
            {bodyIsEmpty ? (
              <p className="text-sm text-gray-400 italic">Nothing composed yet — go back to Compose Message.</p>
            ) : (
              <div className="prose prose-sm max-w-none bg-white rounded-lg border border-gray-200 p-5" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(bodyHtml) }} />
            )}
          </div>
          {!blast && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800">
              <span className="font-semibold">Send Blast is irreversible.</span> It emails every one of the {countLabel} recipients
              above and cannot be recalled. Confirming requires typing the exact recipient count. Send yourself a test first
              ({myProfile?.email || 'your account email'}).
            </div>
          )}
          {blast && ['snapshotting', 'sending'].includes(blast.phase) && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-800 space-y-1">
              <p className="font-semibold">{blast.phase === 'snapshotting' ? 'Freezing the recipient list…' : 'Sending…'}</p>
              {blast.tally && (
                <p>
                  {blast.tally.sent} sent · {blast.tally.failed} failed · {blast.tally.skipped} skipped ·{' '}
                  {blast.tally.pending} remaining of {blast.tally.total}
                </p>
              )}
              <p className="text-xs">Leave this screen open until it finishes. A second send cannot start while this runs.</p>
            </div>
          )}
          {blast && blast.phase === 'done' && blast.tally && (
            <div className={`rounded-lg px-4 py-3 text-sm space-y-2 ${blast.tally.failed > 0 ? 'bg-amber-50 border border-amber-200 text-amber-800' : 'bg-green-50 border border-green-200 text-green-800'}`}>
              <p className="font-semibold">
                Blast finished: {blast.tally.sent} sent, {blast.tally.failed} failed, {blast.tally.skipped} skipped
                {blast.tally.skipped > 0 ? ' (blacklisted)' : ''}.
              </p>
              <div className="flex items-center space-x-3">
                <button type="button" onClick={() => onSectionChange('history')} className="text-sm font-medium underline">
                  View in Campaign History
                </button>
                {blast.tally.failed > 0 && (
                  <button
                    type="button"
                    onClick={() => runSend(blast.campaignId, { retryFailed: true })}
                    className="text-sm font-medium underline"
                  >
                    Retry failed only ({blast.tally.failed})
                  </button>
                )}
              </div>
            </div>
          )}
          {blast && blast.phase === 'error' && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800 space-y-2">
              <p><span className="font-semibold">The blast did not complete:</span> {blast.error}</p>
              {blast.tally && (
                <p>{blast.tally.sent} sent · {blast.tally.failed} failed · {blast.tally.skipped} skipped · {blast.tally.pending} still pending of {blast.tally.total}.</p>
              )}
              {blast.campaignId ? (
                <button
                  type="button"
                  onClick={() => runSend(blast.campaignId)}
                  className="text-sm font-medium underline"
                >
                  Resume this campaign (skips everyone already sent)
                </button>
              ) : (
                <p className="text-xs">Nothing was sent. Fix the issue and confirm again.</p>
              )}
            </div>
          )}
          {testResult && (
            <div className={`rounded-lg px-4 py-3 text-sm ${testResult.type === 'success' ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
              {testResult.message}
            </div>
          )}
        </div>
      )}

      {/* Footer buttons — << Previous / Next >> / Send Test (no Send Blast in Phase 1) */}
      <div className="flex items-center justify-between border-t border-gray-200 mt-8 pt-4">
        <button
          type="button"
          onClick={() => setStep(s => Math.max(1, s - 1))}
          disabled={step === 1}
          className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center space-x-1"
        >
          <ChevronLeft size={16} /><span>Previous</span>
        </button>
        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={handleSendTest}
            disabled={!canSendTest}
            title={canSendTest ? `Sends one email to ${myProfile?.email || 'you'} only` : 'Compose a subject and message first'}
            className="px-4 py-2 border border-blue-300 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {sendingTest ? 'Sending test…' : 'Send Test'}
          </button>
          {step === 4 && (
            <button
              type="button"
              onClick={() => setBlast({ phase: 'confirm', confirmText: '', confirmedCount: count, campaignId: null, tally: null, error: null })}
              disabled={!canOpenBlastConfirm}
              title={canOpenBlastConfirm
                ? `Sends to all ${count} recipients — requires typing the count to confirm`
                : 'Needs a subject, a message, and at least 1 recipient'}
              className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {blastBusy ? 'Sending…' : 'Send Blast'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setStep(s => Math.min(4, s + 1))}
            disabled={step === 4}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center space-x-1"
          >
            <span>Next</span><ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );

  const renderPlaceholder = (title, body) => (
    <div className="text-center py-16 px-6">
      <Mail size={40} className="mx-auto mb-3 text-gray-300" />
      <h4 className="text-base font-semibold text-gray-900 mb-1">{title}</h4>
      <p className="text-sm text-gray-500 max-w-md mx-auto">{body}</p>
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Email Campaign</h2>
        <p className="text-gray-600">Send targeted email blasts, manage templates and images, and review campaign history.</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* Left rail — the five EZFacility items */}
        <aside className="bg-white rounded-lg shadow w-full lg:w-72 flex-shrink-0 divide-y divide-gray-100">
          {SECTIONS.map(({ key, label, desc, icon: Icon }) => (
            <button
              key={key}
              onClick={() => onSectionChange(key)}
              className={`w-full text-left px-4 py-3 transition flex items-start space-x-3 ${section === key ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
            >
              <Icon size={17} className={`mt-0.5 flex-shrink-0 ${section === key ? 'text-blue-600' : 'text-gray-400'}`} />
              <span>
                <span className={`block text-sm font-medium ${section === key ? 'text-blue-700' : 'text-gray-900'}`}>{label}</span>
                <span className="block text-xs text-gray-500 mt-0.5">{desc}</span>
              </span>
            </button>
          ))}
        </aside>

        {/* Content area */}
        <div className="bg-white rounded-lg shadow flex-1 min-w-0 p-6">
          {section === 'send' && renderWizard()}
          {section === 'history' && renderPlaceholder('Campaign History', 'Every sent campaign will be listed here with its subject, date, sender, recipient count and per-recipient sent/failed results. Arrives in Phase 3, once the blast path exists.')}
          {section === 'templates' && renderPlaceholder('Email Template Library', 'Create, edit and organize reusable templates by category — they feed the picker in Compose Message. Arrives in Phase 3.')}
          {section === 'images' && renderPlaceholder('Email Image Library', 'Upload images to use inside campaign emails. Arrives in Phase 3.')}
          {section === 'failed' && renderPlaceholder('Failed Emails', 'Addresses that bounced or complained land here and are skipped by future blasts. Populated automatically once the blast path (Phase 2) exists.')}
        </div>
      </div>

      {/* #281 Phase 2: the last thing between a mis-click and the whole list —
          the admin must TYPE the exact recipient count. */}
      {blast && blast.phase === 'confirm' && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Send this blast?</h3>
            <p className="text-sm text-gray-700 mb-1">
              This sends to <span className="font-bold">{blast.confirmedCount} recipients</span> ({activeCategoryLabel}).
              <span className="font-semibold"> It cannot be undone.</span>
            </p>
            <p className="text-sm text-gray-500 mb-4">Type the recipient count to confirm.</p>
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              value={blast.confirmText}
              onChange={(e) => setBlast(prev => ({ ...prev, confirmText: e.target.value }))}
              placeholder={String(blast.confirmedCount)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 mb-1"
            />
            {blast.confirmText.trim() !== '' && blast.confirmText.trim() !== String(blast.confirmedCount) && (
              <p className="text-xs text-red-600 mb-2">That does not match the recipient count.</p>
            )}
            <div className="flex justify-end space-x-3 mt-4">
              <button
                type="button"
                onClick={() => setBlast(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmedBlast}
                disabled={blast.confirmText.trim() !== String(blast.confirmedCount)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Send to {blast.confirmedCount} recipients
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
