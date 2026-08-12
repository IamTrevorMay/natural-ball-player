import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

// #319: the WHOOP community join code for the Natural Ballplayer group.
// Cordell wants every player to see this, not just players who dig into the
// WHOOP tab — so it's shown in more than one place (PlayerDashboard.js,
// WhoopTab.js). ONE constant here, referenced everywhere it's shown, so
// there's a single place to update it if it's ever reissued.
export const WHOOP_COMMUNITY_CODE = 'COMM-669235';

// `compact` renders a small pill (fits inline in a busy header); the default
// renders a full card with an explanation line (fits standalone on a page).
export default function WhoopCommunityCodeCard({ compact = false }) {
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(WHOOP_COMMUNITY_CODE);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard may be blocked; the code is still visible to copy by hand */ }
  };

  if (compact) {
    return (
      <button
        onClick={copyCode}
        title="Copy the WHOOP community code"
        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg text-xs font-medium text-blue-700 transition flex-shrink-0"
      >
        <span>WHOOP community: <span className="font-mono">{WHOOP_COMMUNITY_CODE}</span></span>
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    );
  }

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-center justify-between gap-3 flex-wrap">
      <div>
        <p className="text-sm font-semibold text-blue-900">Join the Natural Ballplayer WHOOP community</p>
        <p className="text-xs text-blue-700 mt-0.5">Enter this code in the WHOOP app to join — coaches can see your metrics once you do.</p>
      </div>
      <button
        onClick={copyCode}
        className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition flex-shrink-0"
      >
        <span className="font-mono">{WHOOP_COMMUNITY_CODE}</span>
        {copied ? <Check size={14} /> : <Copy size={14} />}
        <span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  );
}
