import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { Users, Search, Check, ChevronDown } from 'lucide-react';
import { useStatusOptions, StatusBadgeSelect } from './StatusSelect';
import { COACH_SKILL_OPTIONS } from './skillOptions';

// Inline skills editor for the coach roster (#245). Admins get a toggle
// dropdown; everyone else sees read-only chips.
function SkillsCell({ skills, isAdmin, onToggle }) {
  const [open, setOpen] = useState(false);
  const selected = skills || [];
  if (!isAdmin) {
    return selected.length > 0 ? (
      <div className="flex flex-wrap gap-1">
        {selected.map(s => <span key={s} className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-700 font-medium">{s}</span>)}
      </div>
    ) : <span className="text-gray-400 text-xs">—</span>;
  }
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 flex-wrap text-left min-w-[120px] hover:opacity-80"
      >
        {selected.length > 0 ? (
          selected.map(s => <span key={s} className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-700 font-medium">{s}</span>)
        ) : <span className="text-gray-400 text-xs">Set skills</span>}
        <ChevronDown size={12} className="text-gray-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-lg py-1">
            {COACH_SKILL_OPTIONS.map(skill => {
              const active = selected.includes(skill);
              return (
                <button
                  key={skill}
                  onClick={() => onToggle(skill)}
                  className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                >
                  <span>{skill}</span>
                  {active && <Check size={14} className="text-teal-600" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

const STATUS_COLORS = {
  'Active': 'bg-green-500 text-white',
  'Remote': 'bg-orange-500 text-white',
  'On-Site': 'bg-blue-500 text-white',
  'Inactive': 'bg-gray-500 text-white',
  'Archived': 'bg-red-500 text-white',
};

export default function ManageCoaches({ userId, userRole, onNavigateToProfile, mode = 'coaches' }) {
  const isInternsMode = mode === 'interns';
  const labels = isInternsMode
    ? { title: 'Manage Interns', subtitle: 'View and manage interns', empty: 'No interns yet — promote a coach by toggling the Intern flag.' }
    : { title: 'Manage Coaches', subtitle: 'View and manage coaching staff', empty: 'No coaches found.' };

  const [coaches, setCoaches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTeam, setFilterTeam] = useState('All');
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterSubStatus, setFilterSubStatus] = useState('All');

  const { options: statusOptions, addOption: addStatusOption } = useStatusOptions('status');
  const { options: subStatusOptions, addOption: addSubStatusOption } = useStatusOptions('sub_status');
  const isAdmin = userRole === 'admin';

  useEffect(() => { fetchCoaches(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [mode]);

  const fetchCoaches = async () => {
    setLoading(true);
    let query = supabase
      .from('users')
      .select('id, full_name, email, phone, avatar_url, coach_status, coach_sub_status, is_intern, skills, team_members(team_id, teams(name))')
      .or('role.eq.coach,secondary_role.eq.coach');
    if (isInternsMode) query = query.eq('is_intern', true);
    query = query.order('full_name');
    const { data, error } = await query;

    if (error) { console.error(error); setLoading(false); return; }
    setCoaches(data || []);
    setLoading(false);
  };

  const handleInlineUpdate = async (coachId, field, value) => {
    const { error } = await supabase.from('users').update({ [field]: value }).eq('id', coachId);
    if (error) {
      alert(`Could not update: ${error.message}`);
      return;
    }
    if (isInternsMode && field === 'is_intern' && !value) {
      setCoaches(prev => prev.filter(c => c.id !== coachId));
    } else {
      setCoaches(prev => prev.map(c => c.id === coachId ? { ...c, [field]: value } : c));
    }
  };

  const handleToggleSkill = (coach, skill) => {
    const current = coach.skills || [];
    const next = current.includes(skill) ? current.filter(s => s !== skill) : [...current, skill];
    handleInlineUpdate(coach.id, 'skills', next);
  };

  const splitName = (fullName) => {
    const parts = (fullName || '').trim().split(/\s+/);
    return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') || '' };
  };

  const allTeamNames = [...new Set(
    coaches.flatMap(c => (c.team_members || []).map(tm => tm.teams?.name).filter(Boolean))
  )].sort();

  const displayCoaches = coaches.filter(c => {
    const teamNames = (c.team_members || []).map(tm => tm.teams?.name).filter(Boolean);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!(c.full_name || '').toLowerCase().includes(q)) return false;
    }
    if (filterTeam !== 'All' && !teamNames.includes(filterTeam)) return false;
    if (filterStatus !== 'All' && (c.coach_status || '') !== filterStatus) return false;
    if (filterSubStatus !== 'All' && (c.coach_sub_status || '') !== filterSubStatus) return false;
    return true;
  });

  const filterSelectClass = "w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white text-gray-700";

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Loading coaches...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <div className="flex items-center space-x-3">
            <h2 className="text-3xl font-bold text-gray-900">{labels.title}</h2>
            <span className="bg-blue-600 text-white px-3 py-1 rounded-lg text-sm font-bold">
              {coaches.length}
            </span>
          </div>
          <p className="text-gray-600 mt-1">{labels.subtitle}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th colSpan={2} className="px-3 py-2 text-left">
                  <div className="relative">
                    <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search for a Coach..."
                      className="w-full pl-7 pr-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </th>
                <th className="px-2 py-2">
                  <select value={filterTeam} onChange={(e) => setFilterTeam(e.target.value)} className={filterSelectClass}>
                    <option value="All">All</option>
                    {allTeamNames.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </th>
                <th className="px-2 py-2">
                  <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className={filterSelectClass}>
                    <option value="All">All</option>
                    {statusOptions.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </th>
                <th className="px-2 py-2">
                  <select value={filterSubStatus} onChange={(e) => setFilterSubStatus(e.target.value)} className={filterSelectClass}>
                    <option value="All">All</option>
                    {subStatusOptions.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </th>
              </tr>
              <tr className="border-b border-gray-200 bg-white">
                <th className="text-left py-3 px-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">First Name</th>
                <th className="text-left py-3 px-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Last Name</th>
                <th className="text-left py-3 px-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Team</th>
                <th className="text-left py-3 px-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Status</th>
                <th className="text-left py-3 px-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Sub Status</th>
                <th className="text-left py-3 px-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Skills</th>
                {isAdmin && <th className="text-left py-3 px-3 font-semibold text-gray-500 text-xs uppercase tracking-wider">Intern Status</th>}
              </tr>
            </thead>
            <tbody>
              {displayCoaches.map(coach => {
                const { firstName, lastName } = splitName(coach.full_name);
                const teamNames = (coach.team_members || []).map(tm => tm.teams?.name).filter(Boolean);

                return (
                  <tr key={coach.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-3">
                      <div className="flex items-center space-x-1.5">
                        <button
                          onClick={() => onNavigateToProfile && onNavigateToProfile(coach.id)}
                          className="font-medium text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          {firstName}
                        </button>
                        {!isInternsMode && coach.is_intern && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">Intern</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3 font-semibold text-gray-900">{lastName}</td>
                    <td className="py-3 px-3 text-gray-600 text-xs">{teamNames.join(', ') || '—'}</td>
                    <td className="py-3 px-3">
                      <StatusBadgeSelect
                        value={coach.coach_status}
                        options={statusOptions}
                        colors={STATUS_COLORS}
                        onChange={(val) => handleInlineUpdate(coach.id, 'coach_status', val)}
                        onAddOption={addStatusOption}
                        isAdmin={isAdmin}
                      />
                    </td>
                    <td className="py-3 px-3">
                      <StatusBadgeSelect
                        value={coach.coach_sub_status}
                        options={subStatusOptions}
                        colors={STATUS_COLORS}
                        onChange={(val) => handleInlineUpdate(coach.id, 'coach_sub_status', val)}
                        onAddOption={addSubStatusOption}
                        isAdmin={isAdmin}
                      />
                    </td>
                    <td className="py-3 px-3">
                      <SkillsCell skills={coach.skills} isAdmin={isAdmin} onToggle={(skill) => handleToggleSkill(coach, skill)} />
                    </td>
                    {isAdmin && (
                      <td className="py-3 px-3">
                        {isInternsMode ? (
                          <button
                            onClick={() => handleInlineUpdate(coach.id, 'is_intern', false)}
                            className="text-xs px-2 py-1 rounded-full bg-red-50 text-red-600 hover:bg-red-100 transition"
                          >
                            Remove Intern Flag
                          </button>
                        ) : coach.is_intern ? (
                          <span className="inline-flex items-center text-xs px-2 py-1 rounded-full bg-purple-100 text-purple-700">
                            <Check size={12} className="mr-1" /> Intern
                          </span>
                        ) : (
                          <button
                            onClick={() => handleInlineUpdate(coach.id, 'is_intern', true)}
                            className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200 transition"
                          >
                            Mark as Intern
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {displayCoaches.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <Users size={40} className="mx-auto mb-3 text-gray-300" />
              <p>{labels.empty}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
