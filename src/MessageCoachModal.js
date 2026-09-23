// #407 (Cordell): "Clients who book sessions cannot directly message coaches
// about cancelling or questions for their sessions." An athlete with a pending
// or confirmed slot reservation gets a "Message coach" button (on the coach's
// slot card in Schedule → Facility, and in the session modal on My Schedule).
// It opens this modal: the session is referenced automatically, the athlete
// types the rest, and Send finds or creates their direct conversation with
// that coach, posts the message, and hands the conversation id back so App can
// switch to Messages with the thread open.
//
// Nothing here needs new database access: any signed-in user may create a
// conversation and add participants, and a participant may post to it.

import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { fetchUserDirectory } from './userDirectory';
import { X, Send, MessageSquare } from 'lucide-react';
import { formatUserError } from './errorMessage';

const QUICK_REASONS = [
  "I'm sick and can't make this session.",
  'I need to reschedule this session.',
  'I might be running late.',
  'I have a question about this session.',
];

const fmtTime = (t) => {
  if (!t) return '';
  const [h, m] = String(t).split(':');
  const hr = parseInt(h, 10);
  if (Number.isNaN(hr)) return '';
  return `${hr % 12 || 12}:${(m || '00').slice(0, 2)} ${hr >= 12 ? 'PM' : 'AM'}`;
};
const fmtDate = (d) => {
  if (!d) return '';
  const dt = new Date(`${d}T00:00:00`);
  return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

// The athlete's existing 1:1 `direct` conversation with this coach, if there is
// one (exactly the two of them, nobody else), else a freshly created one.
export async function findOrCreateDirectConversation(userId, otherUserId) {
  const { data: mine, error: mineErr } = await supabase
    .from('conversation_participants')
    .select('conversation_id')
    .eq('user_id', userId);
  if (mineErr) throw mineErr;
  const myIds = (mine || []).map((r) => r.conversation_id);

  if (myIds.length > 0) {
    const { data: convos, error: convErr } = await supabase
      .from('conversations')
      .select('id, updated_at')
      .in('id', myIds)
      .eq('type', 'direct')
      .order('updated_at', { ascending: false });
    if (convErr) throw convErr;
    const directIds = (convos || []).map((c) => c.id);
    if (directIds.length > 0) {
      const { data: parts, error: partErr } = await supabase
        .from('conversation_participants')
        .select('conversation_id, user_id')
        .in('conversation_id', directIds);
      if (partErr) throw partErr;
      const byConvo = new Map();
      (parts || []).forEach((p) => {
        if (!byConvo.has(p.conversation_id)) byConvo.set(p.conversation_id, new Set());
        byConvo.get(p.conversation_id).add(p.user_id);
      });
      // convos is newest-first, so the first match is the most recent thread.
      for (const c of convos) {
        const set = byConvo.get(c.id);
        if (set && set.size === 2 && set.has(userId) && set.has(otherUserId)) return c.id;
      }
    }
  }

  const { data: created, error: createErr } = await supabase
    .from('conversations')
    .insert({ type: 'direct', created_by: userId, is_pinned: false, replies_disabled: false })
    .select('id')
    .single();
  if (createErr) throw createErr;
  const { error: addErr } = await supabase
    .from('conversation_participants')
    .insert([
      { conversation_id: created.id, user_id: userId },
      { conversation_id: created.id, user_id: otherUserId },
    ]);
  if (addErr) throw addErr;
  return created.id;
}

export default function MessageCoachModal({ coachId, coachName, date, startTime, title, userId, onClose, onSent }) {
  const [name, setName] = useState(coachName || '');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  // The My Schedule modal only has the slot's coach_id, not the name.
  useEffect(() => {
    if (name || !coachId) return undefined;
    let cancelled = false;
    fetchUserDirectory([coachId]).then((dir) => {
      if (!cancelled && dir?.get?.(coachId)?.full_name) setName(dir.get(coachId).full_name);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [coachId, name]);

  const sessionLine = [fmtDate(date), fmtTime(startTime)].filter(Boolean).join(' at ');
  const headline = `Re: my training session${sessionLine ? ` ${sessionLine}` : ''}${title ? ` (${title})` : ''}`;

  const send = async () => {
    const body = text.trim();
    if (!body) { setError('Type a message first.'); return; }
    if (!coachId) { setError('This session has no coach to message.'); return; }
    setSending(true); setError('');
    try {
      const conversationId = await findOrCreateDirectConversation(userId, coachId);
      const { error: msgErr } = await supabase.from('messages').insert({
        conversation_id: conversationId,
        sender_id: userId,
        content: `${headline}\n\n${body}`,
      });
      if (msgErr) throw msgErr;
      onSent(conversationId);
    } catch (err) {
      setError('Message not sent: ' + formatUserError(err));
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 border-b border-gray-200">
          <div className="flex items-center space-x-2 min-w-0">
            <div className="p-2 rounded-lg bg-teal-50 flex-shrink-0"><MessageSquare size={18} className="text-teal-600" /></div>
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-gray-900 truncate">Message {name ? name : 'your coach'}</h3>
              <p className="text-xs text-gray-500 truncate">{sessionLine ? `About your session ${sessionLine}` : 'About your session'}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 flex-shrink-0" aria-label="Close"><X size={22} /></button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          <div className="flex flex-wrap gap-1.5">
            {QUICK_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setText(r)}
                className="px-2.5 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition touch-manipulation"
              >
                {r}
              </button>
            ))}
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            autoFocus
            placeholder="Tell your coach what's going on..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <p className="text-xs text-gray-500">
            The session date and time are added to your message automatically. The conversation continues in <span className="font-medium">Communication → Messages</span>.
          </p>
          {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">{error}</div>}
        </div>

        <div className="p-5 border-t border-gray-200 flex justify-end space-x-2">
          <button onClick={onClose} disabled={sending} className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition text-sm">Cancel</button>
          <button
            onClick={send}
            disabled={sending}
            className="px-4 py-2 bg-teal-600 text-white rounded-lg font-medium hover:bg-teal-700 transition disabled:opacity-50 text-sm inline-flex items-center space-x-1.5 min-h-[40px]"
          >
            <Send size={14} /><span>{sending ? 'Sending...' : 'Send'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
