// #440: staff-side view of the NBP+ Training Agreement — a chip next to an
// NBP+ athlete's name (signed / awaiting countersign / not signed) that opens
// the agreement in a modal so a coach or admin can read it and countersign
// for The Natural Ballplayer. Status comes from the staff-gated
// `nbp_plus_agreement_status` RPC in one call per list, keyed by user id.

import React, { useState } from 'react';
import { FileSignature, X } from 'lucide-react';
import { supabase } from './supabaseClient';
import NbpPlusAgreementPage from './NbpPlusAgreementPage';

// Returns { [userId]: { signed_at, countersigned, term_months, end_date } | null }
// with an entry for EVERY id asked for (null = not signed), so a caller can
// tell "not loaded" (map is null) from "unsigned".
export async function fetchAgreementStatus(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const map = {};
  ids.forEach((id) => { map[id] = null; });
  if (ids.length === 0) return map;
  const { data, error } = await supabase.rpc('nbp_plus_agreement_status', { p_user_ids: ids });
  if (error) {
    console.error('nbp_plus_agreement_status failed:', error);
    return map;
  }
  (data || []).forEach((r) => {
    map[r.user_id] = { signed_at: r.signed_at, countersigned: !!r.countersigned, term_months: r.term_months, end_date: r.end_date };
  });
  return map;
}

const STYLE = {
  unsigned: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100',
  pending: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
  signed: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100',
};

// `status` undefined = not loaded / not an NBP+ athlete → renders nothing.
export default function AgreementStatusChip({ status, athleteId, userId, userRole, className = '' }) {
  const [open, setOpen] = useState(false);
  if (status === undefined) return null;
  const kind = !status ? 'unsigned' : (status.countersigned ? 'signed' : 'pending');
  const label = kind === 'unsigned' ? 'No agreement' : kind === 'pending' ? 'Agreement · countersign' : `Agreement · ${status.term_months} mo`;
  const title = kind === 'unsigned'
    ? 'Has not signed the current NBP+ Training Agreement'
    : kind === 'pending'
      ? `Signed ${new Date(status.signed_at).toLocaleDateString()} — awaiting NBP countersignature`
      : `Signed ${new Date(status.signed_at).toLocaleDateString()} · ends ${status.end_date}`;

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title={title}
        className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap ${STYLE[kind]} ${className}`}
      >
        <FileSignature size={10} /> {label}
      </button>
      {open && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-start justify-center overflow-y-auto p-4" onClick={() => setOpen(false)}>
          <div className="bg-gray-50 rounded-xl shadow-xl w-full max-w-4xl my-4 relative" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setOpen(false)} className="absolute top-3 right-3 p-1.5 rounded-full bg-white border border-gray-200 text-gray-500 hover:text-gray-800 z-10" aria-label="Close">
              <X size={16} />
            </button>
            <NbpPlusAgreementPage userId={userId} userRole={userRole} athleteId={athleteId} />
          </div>
        </div>
      )}
    </>
  );
}
