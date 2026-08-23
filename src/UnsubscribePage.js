import React, { useEffect, useRef, useState } from 'react';
import { supabaseUrl, supabaseAnonKey } from './supabaseClient';

// #281 — the public unsubscribe confirmation page.
//
// WHY THIS LIVES IN THE APP AND NOT IN THE EDGE FUNCTION.
// The first version rendered this page from the `unsubscribe` edge function.
// It arrived in the browser as a wall of raw source code, because Supabase
// documents that Edge Functions REWRITE a `text/html` response to
// `text/plain`: "Edge Functions are designed for APIs and data processing,
// not serving web pages." No amount of header-setting gets around that, so
// the page moved here and the function went back to being an API.
//
// 🔴 THE SAFETY PROPERTY THIS PAGE EXISTS TO PROTECT.
// Opening this page must NOT unsubscribe anyone. Microsoft Defender Safe
// Links, Mimecast, Proofpoint and Barracuda fetch every URL in an inbound
// email before the human ever sees it, so if merely loading the link
// unsubscribed you, every parent whose mail runs through a corporate filter
// would silently vanish from the list without ever clicking. Loading this
// page only READS. The POST that actually unsubscribes happens when a human
// presses the button. Do not "simplify" this into an auto-submit.
//
// The one-click unsubscribe built into Gmail and Yahoo does not come through
// here at all — those clients POST straight to the edge function via the
// List-Unsubscribe header, which is the correct RFC 8058 behaviour.

const fnUrl = (token) =>
  `${supabaseUrl}/functions/v1/unsubscribe?token=${encodeURIComponent(token)}`;

export default function UnsubscribePage() {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [state, setState] = useState({ phase: 'loading' });
  const [working, setWorking] = useState(false);
  // Belt and braces on top of `working`: two clicks dispatched in the same JS
  // tick both pass a state check, because React cannot re-render between them.
  const inFlight = useRef(false);

  useEffect(() => {
    if (!token) { setState({ phase: 'invalid' }); return; }
    let cancelled = false;
    (async () => {
      try {
        // A plain read. Changes nothing — see the note at the top.
        const res = await fetch(fnUrl(token), {
          method: 'GET',
          headers: { Accept: 'application/json', apikey: supabaseAnonKey },
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) { setState({ phase: 'invalid' }); return; }
        setState({
          phase: data.alreadyUnsubscribed ? 'already' : 'confirm',
          email: data.email || '',
        });
      } catch {
        if (!cancelled) setState({ phase: 'error' });
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const confirm = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setWorking(true);
    try {
      const res = await fetch(fnUrl(token), {
        method: 'POST',
        headers: { Accept: 'application/json', apikey: supabaseAnonKey },
      });
      const data = await res.json().catch(() => ({}));
      setState(res.ok
        ? { phase: 'done', email: data.email || state.email }
        : { phase: 'error' });
    } catch {
      setState({ phase: 'error' });
    } finally {
      inFlight.current = false;
      setWorking(false);
    }
  };

  const Card = ({ children }) => (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center px-4 py-16">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-xl p-8 text-center shadow-sm">
        {children}
        <p className="text-xs text-gray-400 mt-8">The Natural Ballplayer</p>
      </div>
    </div>
  );

  if (state.phase === 'loading') {
    return <Card><p className="text-sm text-gray-500">Checking your link…</p></Card>;
  }

  if (state.phase === 'invalid') {
    return (
      <Card>
        <h1 className="text-lg font-semibold text-gray-900 mb-3">This link is not valid</h1>
        <p className="text-sm text-gray-600 leading-relaxed">
          It may have expired, or the whole link may not have been copied across.
          If you are still getting emails you do not want, just reply to one of them
          and we will take you off the list by hand.
        </p>
      </Card>
    );
  }

  if (state.phase === 'error') {
    return (
      <Card>
        <h1 className="text-lg font-semibold text-gray-900 mb-3">Something went wrong</h1>
        <p className="text-sm text-gray-600 leading-relaxed mb-5">
          We could not process that just now — nothing has changed. Please try again
          in a moment.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="px-5 py-2.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          Try again
        </button>
      </Card>
    );
  }

  if (state.phase === 'already') {
    return (
      <Card>
        <h1 className="text-lg font-semibold text-gray-900 mb-3">You're already unsubscribed</h1>
        <p className="text-sm text-gray-600 leading-relaxed">
          {state.email ? <strong className="text-gray-900 break-words">{state.email}</strong> : 'This address'}
          {' '}is not receiving campaign emails from us.
        </p>
      </Card>
    );
  }

  if (state.phase === 'done') {
    return (
      <Card>
        <h1 className="text-lg font-semibold text-gray-900 mb-3">You're unsubscribed</h1>
        <p className="text-sm text-gray-600 leading-relaxed">
          {state.email ? <strong className="text-gray-900 break-words">{state.email}</strong> : 'This address'}
          {' '}will no longer receive campaign or newsletter emails from The Natural Ballplayer.
        </p>
        <p className="text-sm text-gray-600 leading-relaxed mt-3">
          You will still get account emails — booking confirmations, schedule changes
          and password resets.
        </p>
      </Card>
    );
  }

  // phase === 'confirm'
  return (
    <Card>
      <h1 className="text-lg font-semibold text-gray-900 mb-3">Unsubscribe from campaign emails?</h1>
      <p className="text-sm text-gray-600 leading-relaxed mb-2">
        This will stop campaign and newsletter emails to{' '}
        {state.email ? <strong className="text-gray-900 break-words">{state.email}</strong> : 'this address'}.
      </p>
      <p className="text-sm text-gray-600 leading-relaxed mb-6">
        You will still get account emails — booking confirmations, schedule changes
        and password resets.
      </p>
      <button
        type="button"
        onClick={confirm}
        disabled={working}
        className="px-6 py-3 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {working ? 'Unsubscribing…' : 'Yes, unsubscribe me'}
      </button>
    </Card>
  );
}
