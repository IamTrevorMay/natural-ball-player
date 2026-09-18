// #415 — "Sync to calendar": hands the athlete a private iCalendar URL that
// Google Calendar, Apple Calendar and Outlook can subscribe to. The feed
// itself is rendered by the calendar-feed edge function; the URL's token is
// the only credential, so "Reset link" mints a new one and dead-ends every
// calendar still holding the old URL.
import React, { useState, useEffect } from 'react';
import { supabase, supabaseUrl } from './supabaseClient';
import { X, Copy, Check, RefreshCw, ExternalLink, Calendar } from 'lucide-react';
import { useModalTracking } from './usage';
import { formatUserError } from './errorMessage';

// The Vercel rewrite in vercel.json maps /api/calendar/<token>.ics onto the
// edge function. Local dev has no rewrites, so fall back to the function URL.
export function calendarFeedUrl(token) {
  const origin = window.location.origin;
  const isLocal = /localhost|127\.0\.0\.1/.test(origin);
  return isLocal
    ? `${supabaseUrl}/functions/v1/calendar-feed?token=${token}`
    : `${origin}/api/calendar/${token}.ics`;
}

export default function CalendarSyncModal({ userId, onClose }) {
  useModalTracking('CalendarSyncModal');
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [resetting, setResetting] = useState(false);

  const mint = async () => {
    const { data, error: insErr } = await supabase
      .from('calendar_feed_tokens')
      .insert({ user_id: userId })
      .select('token')
      .single();
    if (insErr) throw insErr;
    return data.token;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError('');
      try {
        const { data, error: selErr } = await supabase
          .from('calendar_feed_tokens').select('token').eq('user_id', userId).maybeSingle();
        if (selErr) throw selErr;
        const t = data?.token || await mint();
        if (!cancelled) setToken(t);
      } catch (e) {
        console.error('CalendarSyncModal: token load failed:', e);
        if (!cancelled) setError(formatUserError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const reset = async () => {
    if (!window.confirm('Reset the link? Any calendar already subscribed with the old link will stop updating and will need the new one.')) return;
    setResetting(true); setError('');
    try {
      const { error: delErr } = await supabase.from('calendar_feed_tokens').delete().eq('user_id', userId);
      if (delErr) throw delErr;
      setToken(await mint());
    } catch (e) {
      setError(formatUserError(e));
    } finally {
      setResetting(false);
    }
  };

  const url = token ? calendarFeedUrl(token) : '';
  const webcal = url.replace(/^https?:/, 'webcal:');
  const googleUrl = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link:', url);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2"><Calendar size={18} className="text-blue-600" /> Sync to your calendar</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-gray-700">
            Subscribe once and your team practices, games, workouts, facility events and booked training sessions show up in the family calendar and stay updated. Calendar apps refresh subscriptions on their own schedule — Google usually within a day, Apple as often as you choose.
          </p>

          {error && <p className="text-sm text-red-600">{error}</p>}

          {loading ? (
            <p className="text-sm text-gray-500">Preparing your link…</p>
          ) : token && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Your private calendar link</label>
                <div className="flex gap-2">
                  <input readOnly value={url} onFocus={(e) => e.target.select()} className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-xs bg-gray-50 text-gray-700" />
                  <button onClick={copy} className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition flex items-center gap-1">
                    {copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">Anyone with this link can see your schedule. Share it only with family.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <a href={googleUrl} target="_blank" rel="noopener noreferrer" className="border border-gray-300 rounded-lg px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 transition flex items-center justify-between">
                  Add to Google Calendar <ExternalLink size={14} className="text-gray-400" />
                </a>
                <a href={webcal} className="border border-gray-300 rounded-lg px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 transition flex items-center justify-between">
                  Add to Apple Calendar <ExternalLink size={14} className="text-gray-400" />
                </a>
              </div>

              <details className="text-xs text-gray-600">
                <summary className="cursor-pointer font-medium text-gray-700">Manual steps (Outlook, or if the buttons don't work)</summary>
                <ul className="list-disc ml-5 mt-2 space-y-1">
                  <li><span className="font-medium">Google Calendar</span> (on a computer): Other calendars → + → From URL → paste the link.</li>
                  <li><span className="font-medium">Apple Calendar</span>: File → New Calendar Subscription → paste the link. On iPhone: Settings → Calendar → Accounts → Add Subscribed Calendar.</li>
                  <li><span className="font-medium">Outlook</span>: Add calendar → Subscribe from web → paste the link.</li>
                </ul>
              </details>

              <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                <button onClick={reset} disabled={resetting} className="text-xs text-gray-500 hover:text-red-600 flex items-center gap-1 disabled:opacity-50">
                  <RefreshCw size={12} /> {resetting ? 'Resetting…' : 'Reset link'}
                </button>
                <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition">Done</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
