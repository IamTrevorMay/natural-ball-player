import React, { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import { assessmentReadiness, ASSESSMENT_AREAS } from './assessmentMetrics';
import { CheckCircle2, Circle } from 'lucide-react';

const fmtDate = (d) => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString() : '');

/**
 * Assessment "gates" panel: shows whether the selected athlete has real, metric-tagged
 * assessment data on file for each program area (S&C, Hitting, Throwing/Pitching) so a coach
 * can confirm the data is in before choosing a phase. `highlight` rings the current area.
 */
export default function AssessmentReadiness({ athleteId, highlight }) {
  const [ready, setReady] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!athleteId) { setReady(null); return undefined; }
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('assessment_submissions')
        .select('id, assessment_date, created_at, responses, assessment_templates(name, schema)')
        .eq('player_id', athleteId)
        .order('assessment_date', { ascending: false })
        .limit(50);
      if (!cancelled) { setReady(assessmentReadiness(data || [])); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [athleteId]);

  if (!athleteId) return null;
  const r = ready || { sc: null, hitting: null, throwing: null };
  const missing = ASSESSMENT_AREAS.filter((a) => !r[a.key]);
  const allDone = missing.length === 0;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Assessment readiness</div>
        {loading && <span className="text-[11px] text-gray-400">Loading…</span>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {ASSESSMENT_AREAS.map((a) => {
          const done = r[a.key];
          const isHi = highlight === a.key;
          return (
            <div
              key={a.key}
              className={`flex items-center gap-2 rounded border px-2.5 py-2 ${done ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'} ${isHi ? 'ring-2 ring-blue-400' : ''}`}
            >
              {done
                ? <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                : <Circle className="w-4 h-4 text-gray-300 flex-shrink-0" />}
              <div className="min-w-0">
                <div className="text-xs font-medium text-gray-700 truncate">{a.label}</div>
                <div className="text-[11px] text-gray-400">{done ? `Assessed ${fmtDate(done.date)}` : 'Not assessed'}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div className={`text-xs mt-2 ${allDone ? 'text-green-700' : 'text-amber-600'}`}>
        {allDone
          ? "All areas assessed — the data is in. Pick the athlete's phase below."
          : `Missing: ${missing.map((m) => m.label).join(', ')}. Add these assessments to fully inform phase selection.`}
      </div>
      <div className="text-[11px] text-gray-400 mt-1">
        The generator auto-fills each metric from the athlete's most recent assessment that measured it.
      </div>
    </div>
  );
}
