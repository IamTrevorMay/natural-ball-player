// #436: green check / red X next to an NBP+ athlete's name — are lifting,
// mobility, meals and throwing-or-hitting all on their calendar? The rollup
// is the staff-gated `program_status` RPC (see its migration for the exact
// rule); this file is the one place that turns a row into a verdict so the
// three staff lists (Training Groups, Admin Settings users, Manage Athletes)
// can't drift apart.

import React from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { supabase } from './supabaseClient';

const EMPTY = { lifting: false, mobility: false, throwing: false, hitting: false, meals: false };

// Which of the four requirements are missing. Empty array = fully programmed.
export function programMissing(status) {
  const s = status || EMPTY;
  const missing = [];
  if (!s.lifting) missing.push('Lifting');
  if (!s.mobility) missing.push('Mobility');
  if (!s.meals) missing.push('Meals');
  if (!s.throwing && !s.hitting) missing.push('Throwing or hitting');
  return missing;
}

export function isProgrammed(status) {
  return programMissing(status).length === 0;
}

// Returns { [userId]: status } with an entry for EVERY id asked for, so a
// caller can tell "not loaded yet" (map is null) from "nothing programmed".
export async function fetchProgramStatus(userIds) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const map = {};
  ids.forEach((id) => { map[id] = { ...EMPTY }; });
  if (ids.length === 0) return map;
  const { data, error } = await supabase.rpc('program_status', { p_user_ids: ids });
  if (error) {
    console.error('program_status failed:', error);
    return map;
  }
  (data || []).forEach((r) => {
    map[r.user_id] = { lifting: !!r.lifting, mobility: !!r.mobility, throwing: !!r.throwing, hitting: !!r.hitting, meals: !!r.meals };
  });
  return map;
}

// Renders nothing while `status` is undefined (not loaded / not an NBP+
// athlete). Hover shows exactly what is missing.
export default function ProgramStatusBadge({ status, size = 14, className = '' }) {
  if (status === undefined) return null;
  const missing = programMissing(status);
  const ok = missing.length === 0;
  const title = ok
    ? 'Programmed: lifting, mobility, meals and throwing/hitting are all on this athlete\'s calendar'
    : `Needs programming — missing: ${missing.join(', ')}`;
  return (
    <span title={title} aria-label={title} className={`inline-flex items-center flex-shrink-0 ${className}`}>
      {ok
        ? <CheckCircle2 size={size} className="text-green-600" />
        : <XCircle size={size} className="text-red-500" />}
    </span>
  );
}
