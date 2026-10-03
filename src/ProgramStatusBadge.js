// #436: green check / red X next to an NBP+ athlete's name — are lifting or
// mobility, meals, and throwing-or-hitting all on their calendar? The rollup
// is the staff-gated `program_status` RPC (see its migration for the exact
// rule); this file is the one place that turns a row into a verdict so the
// three staff lists (Training Groups, Admin Settings users, Manage Athletes)
// can't drift apart. Hovering the icon lists every category with its own
// check or cross.

import React from 'react';
import { CheckCircle2, XCircle, Check, X } from 'lucide-react';
import { supabase } from './supabaseClient';

const EMPTY = { lifting: false, mobility: false, throwing: false, hitting: false, meals: false };

// The requirements, in display order. `met` reads the RPC row. Lifting and
// mobility are ONE requirement (Trevor, 2026-10-03): either category counts.
export const PROGRAM_REQUIREMENTS = [
  { key: 'lifting', label: 'Lifting / Mobility', met: (s) => !!(s.lifting || s.mobility) },
  { key: 'meals', label: 'Meals', met: (s) => !!s.meals },
  { key: 'skill', label: 'Throwing / Hitting', met: (s) => !!(s.throwing || s.hitting) },
];

export function programChecklist(status) {
  const s = status || EMPTY;
  return PROGRAM_REQUIREMENTS.map((r) => ({ key: r.key, label: r.label, met: r.met(s) }));
}

// Labels of the requirements not met. Empty array = fully programmed.
export function programMissing(status) {
  return programChecklist(status).filter((r) => !r.met).map((r) => r.label);
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
// athlete). Hover or focus shows the full checklist.
export default function ProgramStatusBadge({ status, size = 14, className = '' }) {
  if (status === undefined) return null;
  const checklist = programChecklist(status);
  const ok = checklist.every((r) => r.met);
  const summary = ok ? 'Programmed' : `Needs programming: ${checklist.filter((r) => !r.met).map((r) => r.label).join(', ')}`;
  return (
    <span
      tabIndex={0}
      aria-label={summary}
      onClick={(e) => e.stopPropagation()}
      className={`relative inline-flex items-center flex-shrink-0 group outline-none ${className}`}
    >
      {ok
        ? <CheckCircle2 size={size} className="text-green-600" />
        : <XCircle size={size} className="text-red-500" />}
      <span
        role="tooltip"
        className="hidden group-hover:block group-focus:block absolute left-0 top-full mt-1 z-50 w-max min-w-[180px] rounded-lg border border-gray-200 bg-white shadow-lg p-2 text-left text-xs text-gray-800 normal-case tracking-normal font-normal"
      >
        <span className={`block font-semibold mb-1 ${ok ? 'text-green-700' : 'text-red-600'}`}>
          {ok ? 'Programmed' : 'Needs programming'}
        </span>
        {checklist.map((r) => (
          <span key={r.key} className="flex items-center gap-1.5 py-0.5 whitespace-nowrap">
            {r.met
              ? <Check size={12} className="text-green-600 flex-shrink-0" />
              : <X size={12} className="text-red-500 flex-shrink-0" />}
            <span className={r.met ? 'text-gray-800' : 'text-gray-500'}>{r.label}</span>
          </span>
        ))}
      </span>
    </span>
  );
}
