import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { Plus, Calendar, Dumbbell, Utensils, TrendingUp, Target, X, Trash2, ChevronDown, ChevronUp, Users, User, Play, ExternalLink, Edit2 } from 'lucide-react';

export default function CoachTools({ userRole }) {
  const [activeTab, setActiveTab] = useState('schedule');
  const [teams, setTeams] = useState([]);
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchTeams(); fetchPlayers(); }, []);

  const fetchTeams = async () => {
    const { data, error } = await supabase.from('teams').select('*').order('name');
    if (!error) setTeams(data);
    setLoading(false);
  };

  const fetchPlayers = async () => {
    const { data, error } = await supabase
      .from('users')
      .select('id, full_name, email, player_profiles(position, jersey_number), team_members(team_id, teams(name))')
      .eq('role', 'player')
      .order('full_name');
    if (!error) setPlayers(data);
  };

  if (loading) {
    return (<div className="flex items-center justify-center py-12"><p className="text-gray-600">Loading...</p></div>);
  }

  const tabs = [
    { key: 'schedule', icon: Calendar, label: 'Schedule' },
    { key: 'stats', icon: TrendingUp, label: 'Player Stats' },
    { key: 'benchmarks', icon: Target, label: 'Benchmarks' },
    { key: 'training', icon: Dumbbell, label: 'Training Programs' },
    { key: 'meals', icon: Utensils, label: 'Meal Plans' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-gray-900">Coach Tools</h2>
        <p className="text-gray-600 mt-1">Manage schedules, stats, and training programs</p>
      </div>
      <div className="bg-white rounded-lg shadow">
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8 px-6 overflow-x-auto">
            {tabs.map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={`py-4 px-1 border-b-2 font-medium text-sm transition whitespace-nowrap ${activeTab === tab.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                <tab.icon size={16} className="inline mr-2" />{tab.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="p-6">
          {activeTab === 'schedule' && <ScheduleTab teams={teams} />}
          {activeTab === 'stats' && <div className="text-gray-600">Coming in next update...</div>}
          {activeTab === 'benchmarks' && <div className="text-gray-600">Coming in next update...</div>}
          {activeTab === 'training' && <TrainingTab teams={teams} players={players} />}
          {activeTab === 'meals' && <MealsTab teams={teams} players={players} />}
        </div>
      </div>
    </div>
  );
}

/* ============================================
   SCHEDULE TAB
   ============================================ */

function ScheduleTab({ teams }) {
  const [showForm, setShowForm] = useState(false);
  const [events, setEvents] = useState([]);
  useEffect(() => { fetchEvents(); }, []);

  const fetchEvents = async () => {
    const { data, error } = await supabase
      .from('schedule_events')
      .select('*, teams(name)')
      .not('team_id', 'is', null) // Only show team events
      .is('player_id', null) // Exclude player-specific events
      .order('event_date', { ascending: true });
    if (!error) setEvents(data);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-gray-900">Schedule Events</h3>
        <button onClick={() => setShowForm(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition flex items-center space-x-2">
          <Plus size={18} /><span>Add Event</span>
        </button>
      </div>
      <div className="space-y-2">
        {events.map(event => (
          <div key={event.id} className="bg-gray-50 rounded-lg p-4 flex justify-between items-center">
            <div>
              <div className="flex items-center space-x-3">
                <span className="font-semibold text-gray-900">{event.title || event.opponent}</span>
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                  event.event_type === 'game' ? 'bg-blue-100 text-blue-700' : 
                  event.event_type === 'practice' ? 'bg-green-100 text-green-700' :
                  event.event_type === 'workout' ? 'bg-purple-100 text-purple-700' :
                  event.event_type === 'meal' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-700'
                }`}>{event.event_type}</span>
                {event.is_optional && <span className="px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">Optional - RSVP</span>}
              </div>
              <div className="text-sm text-gray-600 mt-1">
                {new Date(event.event_date).toLocaleDateString()}
                {event.event_time && ` • ${event.event_time}`}
                {event.location && ` • ${event.location}`}
              </div>
              {event.teams && <div className="text-xs text-gray-500 mt-1">Team: {event.teams.name}</div>}
            </div>
          </div>
        ))}
      </div>
      {showForm && <CreateScheduleModal teams={teams} onClose={() => setShowForm(false)} onSuccess={() => { setShowForm(false); fetchEvents(); }} />}
    </div>
  );
}

function CreateScheduleModal({ teams, onClose, onSuccess }) {
  const [formData, setFormData] = useState({ team_id: '', event_type: 'practice', opponent: '', event_date: '', event_time: '', location: '', address: '', home_away: null, is_optional: false, notes: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault(); setLoading(true); setError('');
    const { error: insertError } = await supabase.from('schedule_events').insert({ ...formData, home_away: formData.event_type === 'game' ? formData.home_away : null });
    if (insertError) { setError(insertError.message); setLoading(false); } else { alert('Event created successfully!'); onSuccess(); }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex items-center justify-between">
          <h3 className="text-xl font-bold text-gray-900">Add Schedule Event</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={24} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Team *</label>
              <select required value={formData.team_id} onChange={(e) => setFormData({...formData, team_id: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Select team</option>
                {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Event Type *</label>
              <select value={formData.event_type} onChange={(e) => setFormData({...formData, event_type: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="practice">Practice</option><option value="game">Game</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">{formData.event_type === 'game' ? 'Opponent' : 'Event Name'} *</label>
              <input type="text" required placeholder={formData.event_type === 'game' ? 'e.g., Hawks Academy' : 'e.g., Team Practice'} value={formData.opponent} onChange={(e) => setFormData({...formData, opponent: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Date *</label>
              <input type="date" required value={formData.event_date} onChange={(e) => setFormData({...formData, event_date: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Time *</label>
              <input type="time" required value={formData.event_time} onChange={(e) => setFormData({...formData, event_time: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Location *</label>
              <input type="text" required placeholder="e.g., Home Field" value={formData.location} onChange={(e) => setFormData({...formData, location: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Address</label>
              <input type="text" placeholder="Full address" value={formData.address} onChange={(e) => setFormData({...formData, address: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            {formData.event_type === 'game' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Home/Away</label>
                <select value={formData.home_away || ''} onChange={(e) => setFormData({...formData, home_away: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Not specified</option><option value="home">Home</option><option value="away">Away</option>
                </select>
              </div>
            )}
            <div className="col-span-2">
              <label className="flex items-center space-x-2">
                <input type="checkbox" checked={formData.is_optional} onChange={(e) => setFormData({...formData, is_optional: e.target.checked})} className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500" />
                <span className="text-sm font-medium text-gray-700">Optional Event (players can RSVP)</span>
              </label>
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">Notes</label>
              <textarea value={formData.notes} onChange={(e) => setFormData({...formData, notes: e.target.value})} rows="3" placeholder="Additional information..." className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="flex space-x-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 transition">Cancel</button>
            <button type="submit" disabled={loading} className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50">{loading ? 'Creating...' : 'Create Event'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ============================================
   TRAINING PROGRAMS TAB
   ============================================ */

function TrainingTab({ teams, players }) {
  const [programs, setPrograms] = useState([]);
  const [showCreateProgram, setShowCreateProgram] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [selectedProgram, setSelectedProgram] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchPrograms(); }, []);

  const fetchPrograms = async () => {
    const { data, error } = await supabase
      .from('training_programs')
      .select(`
        *,
        training_days(
          id, day_number, title, notes,
          training_exercises(id, category, name, description, sets, reps, weight, video_url, image_url, sort_order)
        ),
        training_program_assignments(
          id, player_id, team_id, start_date, end_date,
          users:player_id(full_name),
          teams:team_id(name)
        )
      `)
      .order('created_at', { ascending: false });
    if (!error) setPrograms(data);
    setLoading(false);
  };

  const handleDeleteProgram = async (programId) => {
    if (!window.confirm('Delete this training program and all its days/exercises?')) return;
    const { error } = await supabase.from('training_programs').delete().eq('id', programId);
    if (!error) fetchPrograms();
  };

  if (loading) return <div className="text-gray-600">Loading training programs...</div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-gray-900">Training Programs</h3>
        <button onClick={() => setShowCreateProgram(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition flex items-center space-x-2">
          <Plus size={18} /><span>Create Program</span>
        </button>
      </div>

      {programs.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <Dumbbell size={40} className="mx-auto mb-3 text-gray-300" />
          <p>No training programs yet. Create your first program to get started!</p>
        </div>
      ) : (
        <div className="space-y-4">
          {programs.map(program => (
            <TrainingProgramCard
              key={program.id}
              program={program}
              onDelete={handleDeleteProgram}
              onAssign={() => { setSelectedProgram(program); setShowAssign(true); }}
              onRefresh={fetchPrograms}
            />
          ))}
        </div>
      )}

      {showCreateProgram && (
        <CreateTrainingProgramModal
          onClose={() => setShowCreateProgram(false)}
          onSuccess={() => { setShowCreateProgram(false); fetchPrograms(); }}
        />
      )}

      {showAssign && selectedProgram && (
        <AssignTrainingProgramModal
          program={selectedProgram}
          teams={teams}
          players={players}
          onClose={() => { setShowAssign(false); setSelectedProgram(null); }}
          onSuccess={() => { setShowAssign(false); setSelectedProgram(null); fetchPrograms(); }}
        />
      )}
    </div>
  );
}

/* ---- TRAINING PROGRAM CARD ---- */

const categoryColors = {
  hitting: 'bg-red-100 text-red-700',
  pitching: 'bg-blue-100 text-blue-700',
  fielding: 'bg-green-100 text-green-700',
  conditioning: 'bg-orange-100 text-orange-700',
  recovery: 'bg-purple-100 text-purple-700',
  other: 'bg-gray-100 text-gray-700',
};

function TrainingProgramCard({ program, onDelete, onAssign, onRefresh }) {
  const [expanded, setExpanded] = useState(false);
  const [showAddDay, setShowAddDay] = useState(false);
  const [showAddExercise, setShowAddExercise] = useState(null); // day_id

  const days = (program.training_days || []).sort((a, b) => a.day_number - b.day_number);
  const assignments = program.training_program_assignments || [];
  const totalExercises = days.reduce((sum, day) => sum + (day.training_exercises?.length || 0), 0);

  // Get unique categories across all exercises
  const allCategories = [...new Set(days.flatMap(d => (d.training_exercises || []).map(e => e.category)))];

  return (
    <div className="bg-gray-50 rounded-lg p-4">
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <div className="flex items-center space-x-3">
            <span className="font-semibold text-gray-900 text-lg">{program.name}</span>
            {program.duration_weeks && <span className="text-xs text-gray-500">{program.duration_weeks} weeks</span>}
          </div>
          {program.description && <p className="text-sm text-gray-600 mt-1">{program.description}</p>}
          <div className="flex items-center space-x-4 mt-2 text-sm">
            <span className="text-gray-500">{days.length} days &bull; {totalExercises} exercises</span>
            <div className="flex space-x-1">
              {allCategories.map(cat => (
                <span key={cat} className={`px-2 py-0.5 rounded-full text-xs font-medium ${categoryColors[cat]}`}>{cat}</span>
              ))}
            </div>
          </div>
          {assignments.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {assignments.map(a => (
                <span key={a.id} className="inline-flex items-center px-2 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-medium">
                  {a.teams ? <><Users size={12} className="mr-1" />{a.teams.name}</> : a.users ? <><User size={12} className="mr-1" />{a.users.full_name}</> : null}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center space-x-2 ml-4">
          <button onClick={onAssign} className="text-blue-600 hover:text-blue-800 text-sm font-medium transition">Assign</button>
          <button onClick={() => setExpanded(!expanded)} className="text-gray-400 hover:text-gray-600 transition">{expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>
          <button onClick={() => onDelete(program.id)} className="text-gray-400 hover:text-red-600 transition"><Trash2 size={16} /></button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-gray-200 space-y-4">
          {days.map(day => {
            const exercises = (day.training_exercises || []).sort((a, b) => a.sort_order - b.sort_order);
            // Group exercises by category
            const grouped = {};
            exercises.forEach(ex => {
              if (!grouped[ex.category]) grouped[ex.category] = [];
              grouped[ex.category].push(ex);
            });

            return (
              <div key={day.id} className="bg-white rounded-lg p-4 border border-gray-200">
                <div className="flex justify-between items-center mb-3">
                  <div>
                    <h5 className="font-semibold text-gray-900">Day {day.day_number}{day.title ? `: ${day.title}` : ''}</h5>
                    {day.notes && <p className="text-xs text-gray-500 mt-0.5">{day.notes}</p>}
                  </div>
                  <button onClick={() => setShowAddExercise(day.id)} className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center space-x-1">
                    <Plus size={14} /><span>Add Exercise</span>
                  </button>
                </div>

                {exercises.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">No exercises yet</p>
                ) : (
                  <div className="space-y-3">
                    {['hitting', 'pitching', 'fielding', 'conditioning', 'recovery', 'other'].map(cat => {
                      if (!grouped[cat]) return null;
                      return (
                        <div key={cat}>
                          <h6 className="text-xs font-semibold uppercase tracking-wide mb-1.5">
                            <span className={`px-2 py-0.5 rounded-full ${categoryColors[cat]}`}>{cat}</span>
                          </h6>
                          <div className="space-y-2">
                            {grouped[cat].map(ex => (
                              <ExerciseRow key={ex.id} exercise={ex} onRefresh={onRefresh} />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {showAddExercise === day.id && (
                  <AddExerciseModal
                    dayId={day.id}
                    currentCount={exercises.length}
                    onClose={() => setShowAddExercise(null)}
                    onSuccess={() => { setShowAddExercise(null); onRefresh(); }}
                  />
                )}
              </div>
            );
          })}

          <button onClick={() => setShowAddDay(true)} className="w-full border-2 border-dashed border-gray-300 rounded-lg py-3 text-gray-500 hover:text-blue-600 hover:border-blue-300 transition flex items-center justify-center space-x-2">
            <Plus size={18} /><span>Add Day {days.length + 1}</span>
          </button>

          {showAddDay && (
            <AddDayModal
              programId={program.id}
              nextDayNumber={days.length + 1}
              onClose={() => setShowAddDay(false)}
              onSuccess={() => { setShowAddDay(false); onRefresh(); }}
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ---- EXERCISE ROW ---- */

function ExerciseRow({ exercise, onRefresh }) {
  const handleDelete = async () => {
    if (!window.confirm(`Delete "${exercise.name}"?`)) return;
    await supabase.from('training_exercises').delete().eq('id', exercise.id);
    onRefresh();
  };

  return (
    <div className="flex items-start justify-between py-2 px-3 bg-gray-50 rounded-lg">
      <div className="flex-1">
        <div className="flex items-center space-x-2">
          <span className="font-medium text-gray-900 text-sm">{exercise.name}</span>
          {exercise.video_url && (
            <a href={exercise.video_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700" title="Watch demo">
              <Play size={14} />
            </a>
          )}
          {exercise.image_url && (
            <a href={exercise.image_url} target="_blank" rel="noopener noreferrer" className="text-green-500 hover:text-green-700" title="View image">
              <ExternalLink size={14} />
            </a>
          )}
        </div>
        {exercise.description && <p className="text-xs text-gray-500 mt-0.5">{exercise.description}</p>}
        <div className="flex items-center space-x-3 mt-1 text-xs text-gray-600">
          {exercise.sets && <span><strong>{exercise.sets}</strong> sets</span>}
          {exercise.reps && <span><strong>{exercise.reps}</strong> reps</span>}
          {exercise.weight && <span><strong>{exercise.weight}</strong></span>}
        </div>
      </div>
      <button onClick={handleDelete} className="text-gray-400 hover:text-red-600 transition ml-2"><Trash2 size={14} /></button>
    </div>
  );
}

/* ---- CREATE TRAINING PROGRAM MODAL ---- */

function CreateTrainingProgramModal({ onClose, onSuccess }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [durationWeeks, setDurationWeeks] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault(); setLoading(true); setError('');
    const { data: { user } } = await supabase.auth.getUser();
    const { error: insertError } = await supabase.from('training_programs').insert({
      name, description: description || null,
      duration_weeks: durationWeeks ? parseInt(durationWeeks) : null,
      created_by: user?.id
    });
    if (insertError) { setError(insertError.message); setLoading(false); } else { onSuccess(); }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
        <div className="border-b border-gray-200 p-6 flex items-center justify-between">
          <h3 className="text-xl font-bold text-gray-900">Create Training Program</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={24} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Program Name *</label>
            <input type="text" required placeholder="e.g., Off-Season Hitting Program" value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
            <textarea placeholder="What is this program for?" value={description} onChange={(e) => setDescription(e.target.value)} rows="2" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Duration (weeks)</label>
            <input type="number" min="1" placeholder="e.g., 8" value={durationWeeks} onChange={(e) => setDurationWeeks(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded text-sm">
            After creating the program, expand it to add days and exercises.
          </div>
          <div className="flex space-x-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 transition">Cancel</button>
            <button type="submit" disabled={loading} className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50">{loading ? 'Creating...' : 'Create Program'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---- ADD DAY MODAL ---- */

function AddDayModal({ programId, nextDayNumber, onClose, onSuccess }) {
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault(); setLoading(true); setError('');
    const { error: insertError } = await supabase.from('training_days').insert({
      program_id: programId, day_number: nextDayNumber, title: title || null, notes: notes || null
    });
    if (insertError) { setError(insertError.message); setLoading(false); } else { onSuccess(); }
  };

  return (
    <div className="bg-white rounded-lg border-2 border-blue-200 p-4 mt-2">
      <form onSubmit={handleSubmit} className="space-y-3">
        <h5 className="font-semibold text-gray-900">Add Day {nextDayNumber}</h5>
        {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">{error}</div>}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Day Title (optional)</label>
          <input type="text" placeholder="e.g., Upper Body, Hitting Focus" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
          <input type="text" placeholder="e.g., Light warmup before starting" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
        </div>
        <div className="flex space-x-2">
          <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 transition">Cancel</button>
          <button type="submit" disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition disabled:opacity-50">{loading ? 'Adding...' : 'Add Day'}</button>
        </div>
      </form>
    </div>
  );
}

/* ---- ADD EXERCISE MODAL ---- */

function AddExerciseModal({ dayId, currentCount, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    category: 'hitting', name: '', description: '', sets: '', reps: '', weight: '', video_url: '', image_url: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault(); setLoading(true); setError('');
    const { error: insertError } = await supabase.from('training_exercises').insert({
      day_id: dayId, category: formData.category, name: formData.name,
      description: formData.description || null,
      sets: formData.sets ? parseInt(formData.sets) : null,
      reps: formData.reps || null, weight: formData.weight || null,
      video_url: formData.video_url || null, image_url: formData.image_url || null,
      sort_order: currentCount
    });
    if (insertError) { setError(insertError.message); setLoading(false); } else { onSuccess(); }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex items-center justify-between">
          <h3 className="text-xl font-bold text-gray-900">Add Exercise</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={24} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Category *</label>
            <select value={formData.category} onChange={(e) => setFormData({...formData, category: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="hitting">Hitting</option>
              <option value="pitching">Pitching</option>
              <option value="fielding">Fielding</option>
              <option value="conditioning">Conditioning</option>
              <option value="recovery">Recovery</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Exercise Name *</label>
            <input type="text" required placeholder="e.g., Tee Work, Long Toss, Squats" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
            <textarea placeholder="Instructions or notes for this exercise..." value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} rows="2" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Sets</label>
              <input type="number" min="1" placeholder="e.g., 3" value={formData.sets} onChange={(e) => setFormData({...formData, sets: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Reps</label>
              <input type="text" placeholder="e.g., 10, 8-12" value={formData.reps} onChange={(e) => setFormData({...formData, reps: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Weight</label>
              <input type="text" placeholder="e.g., 135 lbs, BW" value={formData.weight} onChange={(e) => setFormData({...formData, weight: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Video URL</label>
            <input type="url" placeholder="https://youtube.com/watch?v=..." value={formData.video_url} onChange={(e) => setFormData({...formData, video_url: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Image URL</label>
            <input type="url" placeholder="https://example.com/image.jpg" value={formData.image_url} onChange={(e) => setFormData({...formData, image_url: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex space-x-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 transition">Cancel</button>
            <button type="submit" disabled={loading} className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50">{loading ? 'Adding...' : 'Add Exercise'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---- ASSIGN TRAINING PROGRAM MODAL ---- */

function AssignTrainingProgramModal({ program, teams, players, onClose, onSuccess }) {
  const [assignType, setAssignType] = useState('team');
  const [teamId, setTeamId] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault(); setLoading(true); setError('');
    const { data: { user } } = await supabase.auth.getUser();
    const { error: insertError } = await supabase.from('training_program_assignments').insert({
      program_id: program.id,
      player_id: assignType === 'player' ? playerId : null,
      team_id: assignType === 'team' ? teamId : null,
      start_date: startDate || null, end_date: endDate || null,
      assigned_by: user?.id
    });
    if (insertError) { setError(insertError.message); setLoading(false); } else { onSuccess(); }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="border-b border-gray-200 p-6 flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold text-gray-900">Assign Program</h3>
            <p className="text-sm text-gray-600 mt-1">{program.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={24} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Assign To</label>
            <div className="flex space-x-2">
              <button type="button" onClick={() => setAssignType('team')} className={`flex-1 flex items-center justify-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition ${assignType === 'team' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                <Users size={16} /><span>Team</span>
              </button>
              <button type="button" onClick={() => setAssignType('player')} className={`flex-1 flex items-center justify-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition ${assignType === 'player' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                <User size={16} /><span>Player</span>
              </button>
            </div>
          </div>
          {assignType === 'team' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Select Team *</label>
              <select required value={teamId} onChange={(e) => setTeamId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Choose a team</option>
                {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Select Player *</label>
              <select required value={playerId} onChange={(e) => setPlayerId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Choose a player</option>
                {players.map(player => <option key={player.id} value={player.id}>{player.full_name}</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">End Date</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="flex space-x-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 transition">Cancel</button>
            <button type="submit" disabled={loading} className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50">{loading ? 'Assigning...' : 'Assign Program'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ============================================
   MEALS TAB (unchanged from previous)
   ============================================ */

function MealsTab({ teams, players }) {
  const [mealsSubTab, setMealsSubTab] = useState('meals');
  const [meals, setMeals] = useState([]);
  const [mealPlans, setMealPlans] = useState([]);
  const [showCreateMeal, setShowCreateMeal] = useState(false);
  const [showCreatePlan, setShowCreatePlan] = useState(false);
  const [showAssignPlan, setShowAssignPlan] = useState(false);
  const [selectedPlanForAssign, setSelectedPlanForAssign] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchMeals(); fetchMealPlans(); }, []);

  const fetchMeals = async () => {
    const { data, error } = await supabase.from('meals').select('*').order('meal_type').order('name');
    if (!error) setMeals(data); setLoading(false);
  };

  const fetchMealPlans = async () => {
    const { data, error } = await supabase.from('meal_plans')
      .select('*, meal_plan_items(id, sort_order, meal_id, meals(*)), meal_plan_assignments(id, player_id, team_id, start_date, end_date, users:player_id(full_name), teams:team_id(name))')
      .order('created_at', { ascending: false });
    if (!error) setMealPlans(data);
  };

  const handleDeleteMeal = async (mealId) => {
    if (!window.confirm('Delete this meal?')) return;
    const { error } = await supabase.from('meals').delete().eq('id', mealId);
    if (!error) { fetchMeals(); fetchMealPlans(); }
  };

  const handleDeletePlan = async (planId) => {
    if (!window.confirm('Delete this meal plan?')) return;
    const { error } = await supabase.from('meal_plans').delete().eq('id', planId);
    if (!error) fetchMealPlans();
  };

  if (loading) return <div className="text-gray-600">Loading meals...</div>;

  return (
    <div className="space-y-4">
      <div className="flex space-x-2">
        <button onClick={() => setMealsSubTab('meals')} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${mealsSubTab === 'meals' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>Individual Meals ({meals.length})</button>
        <button onClick={() => setMealsSubTab('plans')} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${mealsSubTab === 'plans' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>Meal Plans ({mealPlans.length})</button>
      </div>

      {mealsSubTab === 'meals' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold text-gray-900">Individual Meals</h3>
            <button onClick={() => setShowCreateMeal(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition flex items-center space-x-2"><Plus size={18} /><span>Add Meal</span></button>
          </div>
          {meals.length === 0 ? (
            <div className="text-center py-8 text-gray-500"><Utensils size={40} className="mx-auto mb-3 text-gray-300" /><p>No meals created yet.</p></div>
          ) : (
            <div className="space-y-2">
              {['breakfast', 'lunch', 'dinner', 'snack'].map(type => {
                const typeMeals = meals.filter(m => m.meal_type === type);
                if (typeMeals.length === 0) return null;
                return (<div key={type}><h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-4">{type} ({typeMeals.length})</h4>{typeMeals.map(meal => <MealCard key={meal.id} meal={meal} onDelete={handleDeleteMeal} />)}</div>);
              })}
            </div>
          )}
          {showCreateMeal && <CreateMealModal onClose={() => setShowCreateMeal(false)} onSuccess={() => { setShowCreateMeal(false); fetchMeals(); }} />}
        </div>
      )}

      {mealsSubTab === 'plans' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold text-gray-900">Meal Plans</h3>
            <button onClick={() => setShowCreatePlan(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition flex items-center space-x-2" disabled={meals.length === 0}><Plus size={18} /><span>Create Plan</span></button>
          </div>
          {meals.length === 0 && <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded text-sm">Create some individual meals first.</div>}
          {mealPlans.length === 0 ? (
            <div className="text-center py-8 text-gray-500"><Utensils size={40} className="mx-auto mb-3 text-gray-300" /><p>No meal plans yet.</p></div>
          ) : (
            <div className="space-y-4">{mealPlans.map(plan => <MealPlanCard key={plan.id} plan={plan} onDelete={handleDeletePlan} onAssign={() => { setSelectedPlanForAssign(plan); setShowAssignPlan(true); }} />)}</div>
          )}
          {showCreatePlan && <CreateMealPlanModal meals={meals} onClose={() => setShowCreatePlan(false)} onSuccess={() => { setShowCreatePlan(false); fetchMealPlans(); }} />}
          {showAssignPlan && selectedPlanForAssign && <AssignMealPlanModal plan={selectedPlanForAssign} teams={teams} players={players} onClose={() => { setShowAssignPlan(false); setSelectedPlanForAssign(null); }} onSuccess={() => { setShowAssignPlan(false); setSelectedPlanForAssign(null); fetchMealPlans(); }} />}
        </div>
      )}
    </div>
  );
}

function MealCard({ meal, onDelete }) {
  const colors = { breakfast: 'bg-yellow-100 text-yellow-700', lunch: 'bg-green-100 text-green-700', dinner: 'bg-blue-100 text-blue-700', snack: 'bg-purple-100 text-purple-700' };
  return (
    <div className="bg-gray-50 rounded-lg p-4 flex justify-between items-start mb-2">
      <div className="flex-1">
        <div className="flex items-center space-x-3"><span className="font-semibold text-gray-900">{meal.name}</span><span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[meal.meal_type]}`}>{meal.meal_type}</span></div>
        {meal.description && <p className="text-sm text-gray-600 mt-1">{meal.description}</p>}
        <div className="flex items-center space-x-4 mt-2 text-sm text-gray-500">
          {meal.calories && <span>{meal.calories} cal</span>}{meal.protein_g && <span>P: {meal.protein_g}g</span>}{meal.carbs_g && <span>C: {meal.carbs_g}g</span>}{meal.fat_g && <span>F: {meal.fat_g}g</span>}
        </div>
      </div>
      <button onClick={() => onDelete(meal.id)} className="text-gray-400 hover:text-red-600 transition ml-4"><Trash2 size={16} /></button>
    </div>
  );
}

function MealPlanCard({ plan, onDelete, onAssign }) {
  const [expanded, setExpanded] = useState(false);
  const items = plan.meal_plan_items || [];
  const assignments = plan.meal_plan_assignments || [];
  const totals = items.reduce((acc, item) => { const m = item.meals; if (m) { acc.calories += m.calories || 0; acc.protein += parseFloat(m.protein_g) || 0; acc.carbs += parseFloat(m.carbs_g) || 0; acc.fat += parseFloat(m.fat_g) || 0; } return acc; }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
  const grouped = {}; items.forEach(item => { if (item.meals) { const t = item.meals.meal_type; if (!grouped[t]) grouped[t] = []; grouped[t].push(item.meals); } });

  return (
    <div className="bg-gray-50 rounded-lg p-4">
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <div className="flex items-center space-x-3"><span className="font-semibold text-gray-900 text-lg">{plan.name}</span><span className="text-xs text-gray-500">{items.length} meals</span></div>
          {plan.description && <p className="text-sm text-gray-600 mt-1">{plan.description}</p>}
          <div className="flex items-center space-x-4 mt-2 text-sm font-medium">
            <span className="text-orange-600">{totals.calories} cal</span><span className="text-blue-600">P: {totals.protein.toFixed(1)}g</span><span className="text-green-600">C: {totals.carbs.toFixed(1)}g</span><span className="text-yellow-600">F: {totals.fat.toFixed(1)}g</span>
          </div>
          {assignments.length > 0 && <div className="flex flex-wrap gap-2 mt-2">{assignments.map(a => <span key={a.id} className="inline-flex items-center px-2 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-medium">{a.teams ? <><Users size={12} className="mr-1" />{a.teams.name}</> : a.users ? <><User size={12} className="mr-1" />{a.users.full_name}</> : null}</span>)}</div>}
        </div>
        <div className="flex items-center space-x-2 ml-4">
          <button onClick={onAssign} className="text-blue-600 hover:text-blue-800 text-sm font-medium transition">Assign</button>
          <button onClick={() => setExpanded(!expanded)} className="text-gray-400 hover:text-gray-600 transition">{expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>
          <button onClick={() => onDelete(plan.id)} className="text-gray-400 hover:text-red-600 transition"><Trash2 size={16} /></button>
        </div>
      </div>
      {expanded && (
        <div className="mt-4 pt-4 border-t border-gray-200 space-y-3">
          {['breakfast', 'lunch', 'dinner', 'snack'].map(type => {
            if (!grouped[type]) return null;
            return (<div key={type}><h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{type}</h5>{grouped[type].map(meal => <div key={meal.id} className="flex justify-between items-center py-1 px-2 text-sm"><span className="text-gray-900">{meal.name}</span><span className="text-gray-500">{meal.calories && `${meal.calories} cal`}{meal.protein_g && ` Â· P:${meal.protein_g}g`}{meal.carbs_g && ` Â· C:${meal.carbs_g}g`}{meal.fat_g && ` Â· F:${meal.fat_g}g`}</span></div>)}</div>);
          })}
        </div>
      )}
    </div>
  );
}

function CreateMealModal({ onClose, onSuccess }) {
  const [formData, setFormData] = useState({ name: '', description: '', meal_type: 'breakfast', calories: '', protein_g: '', carbs_g: '', fat_g: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const handleSubmit = async (e) => {
    e.preventDefault(); setLoading(true); setError('');
    const { data: { user } } = await supabase.auth.getUser();
    const { error: err } = await supabase.from('meals').insert({ name: formData.name, description: formData.description || null, meal_type: formData.meal_type, calories: formData.calories ? parseInt(formData.calories) : null, protein_g: formData.protein_g ? parseFloat(formData.protein_g) : null, carbs_g: formData.carbs_g ? parseFloat(formData.carbs_g) : null, fat_g: formData.fat_g ? parseFloat(formData.fat_g) : null, created_by: user?.id });
    if (err) { setError(err.message); setLoading(false); } else { onSuccess(); }
  };
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex items-center justify-between"><h3 className="text-xl font-bold text-gray-900">Add Meal</h3><button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={24} /></button></div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{error}</div>}
          <div><label className="block text-sm font-medium text-gray-700 mb-2">Meal Name *</label><input type="text" required placeholder="e.g., Grilled Chicken & Rice" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-2">Description</label><textarea placeholder="Optional details..." value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} rows="2" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-2">Meal Type *</label><select value={formData.meal_type} onChange={(e) => setFormData({...formData, meal_type: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"><option value="breakfast">Breakfast</option><option value="lunch">Lunch</option><option value="dinner">Dinner</option><option value="snack">Snack</option></select></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-2">Calories</label><input type="number" placeholder="550" value={formData.calories} onChange={(e) => setFormData({...formData, calories: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-2">Protein (g)</label><input type="number" step="0.1" placeholder="40" value={formData.protein_g} onChange={(e) => setFormData({...formData, protein_g: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-2">Carbs (g)</label><input type="number" step="0.1" placeholder="60" value={formData.carbs_g} onChange={(e) => setFormData({...formData, carbs_g: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-2">Fat (g)</label><input type="number" step="0.1" placeholder="15" value={formData.fat_g} onChange={(e) => setFormData({...formData, fat_g: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
          </div>
          <div className="flex space-x-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 transition">Cancel</button>
            <button type="submit" disabled={loading} className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50">{loading ? 'Creating...' : 'Add Meal'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CreateMealPlanModal({ meals, onClose, onSuccess }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedMealIds, setSelectedMealIds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const toggleMeal = (id) => setSelectedMealIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  const selected = meals.filter(m => selectedMealIds.includes(m.id));
  const totals = selected.reduce((acc, m) => { acc.calories += m.calories || 0; acc.protein += parseFloat(m.protein_g) || 0; acc.carbs += parseFloat(m.carbs_g) || 0; acc.fat += parseFloat(m.fat_g) || 0; return acc; }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

  const handleSubmit = async (e) => {
    e.preventDefault(); if (selectedMealIds.length === 0) { setError('Select at least one meal'); return; }
    setLoading(true); setError('');
    const { data: { user } } = await supabase.auth.getUser();
    const { data: plan, error: pErr } = await supabase.from('meal_plans').insert({ name, description: description || null, created_by: user?.id }).select().single();
    if (pErr) { setError(pErr.message); setLoading(false); return; }
    const items = selectedMealIds.map((id, i) => ({ meal_plan_id: plan.id, meal_id: id, sort_order: i }));
    const { error: iErr } = await supabase.from('meal_plan_items').insert(items);
    if (iErr) { setError(iErr.message); setLoading(false); } else { onSuccess(); }
  };

  const typeColors = { breakfast: 'border-yellow-300 bg-yellow-50', lunch: 'border-green-300 bg-green-50', dinner: 'border-blue-300 bg-blue-50', snack: 'border-purple-300 bg-purple-50' };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex items-center justify-between z-10"><h3 className="text-xl font-bold text-gray-900">Create Meal Plan</h3><button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={24} /></button></div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{error}</div>}
          <div><label className="block text-sm font-medium text-gray-700 mb-2">Plan Name *</label><input type="text" required placeholder="e.g., Game Day Nutrition" value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-2">Description</label><textarea placeholder="What is this plan for?" value={description} onChange={(e) => setDescription(e.target.value)} rows="2" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
          {selectedMealIds.length > 0 && (
            <div className="bg-gray-100 rounded-lg p-3 flex items-center justify-between text-sm font-medium">
              <span className="text-gray-700">{selectedMealIds.length} meals</span>
              <div className="flex space-x-4"><span className="text-orange-600">{totals.calories} cal</span><span className="text-blue-600">P: {totals.protein.toFixed(1)}g</span><span className="text-green-600">C: {totals.carbs.toFixed(1)}g</span><span className="text-yellow-600">F: {totals.fat.toFixed(1)}g</span></div>
            </div>
          )}
          <div><label className="block text-sm font-medium text-gray-700 mb-2">Select Meals *</label>
            <div className="space-y-4">
              {['breakfast', 'lunch', 'dinner', 'snack'].map(type => {
                const tm = meals.filter(m => m.meal_type === type); if (tm.length === 0) return null;
                return (<div key={type}><h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{type}</h5><div className="space-y-2">{tm.map(meal => (
                  <label key={meal.id} className={`flex items-center justify-between p-3 rounded-lg border-2 cursor-pointer transition ${selectedMealIds.includes(meal.id) ? typeColors[type] : 'border-gray-200 hover:border-gray-300'}`}>
                    <div className="flex items-center space-x-3"><input type="checkbox" checked={selectedMealIds.includes(meal.id)} onChange={() => toggleMeal(meal.id)} className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500" /><div><span className="font-medium text-gray-900">{meal.name}</span>{meal.description && <p className="text-xs text-gray-500">{meal.description}</p>}</div></div>
                    <div className="text-xs text-gray-500 text-right">{meal.calories && <div>{meal.calories} cal</div>}{meal.protein_g && <div>P:{meal.protein_g}g C:{meal.carbs_g}g F:{meal.fat_g}g</div>}</div>
                  </label>
                ))}</div></div>);
              })}
            </div>
          </div>
          <div className="flex space-x-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 transition">Cancel</button>
            <button type="submit" disabled={loading || selectedMealIds.length === 0} className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50">{loading ? 'Creating...' : 'Create Plan'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AssignMealPlanModal({ plan, teams, players, onClose, onSuccess }) {
  const [assignType, setAssignType] = useState('team');
  const [teamId, setTeamId] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault(); setLoading(true); setError('');
    const { data: { user } } = await supabase.auth.getUser();
    const { error: err } = await supabase.from('meal_plan_assignments').insert({ meal_plan_id: plan.id, player_id: assignType === 'player' ? playerId : null, team_id: assignType === 'team' ? teamId : null, start_date: startDate || null, end_date: endDate || null, assigned_by: user?.id });
    if (err) { setError(err.message); setLoading(false); } else { onSuccess(); }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="border-b border-gray-200 p-6 flex items-center justify-between"><div><h3 className="text-xl font-bold text-gray-900">Assign Meal Plan</h3><p className="text-sm text-gray-600 mt-1">{plan.name}</p></div><button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={24} /></button></div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{error}</div>}
          <div><label className="block text-sm font-medium text-gray-700 mb-2">Assign To</label>
            <div className="flex space-x-2">
              <button type="button" onClick={() => setAssignType('team')} className={`flex-1 flex items-center justify-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition ${assignType === 'team' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}><Users size={16} /><span>Team</span></button>
              <button type="button" onClick={() => setAssignType('player')} className={`flex-1 flex items-center justify-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition ${assignType === 'player' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}><User size={16} /><span>Player</span></button>
            </div>
          </div>
          {assignType === 'team' ? (
            <div><label className="block text-sm font-medium text-gray-700 mb-2">Select Team *</label><select required value={teamId} onChange={(e) => setTeamId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"><option value="">Choose a team</option>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
          ) : (
            <div><label className="block text-sm font-medium text-gray-700 mb-2">Select Player *</label><select required value={playerId} onChange={(e) => setPlayerId(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"><option value="">Choose a player</option>{players.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-2">End Date</label><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
          </div>
          <div className="flex space-x-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 transition">Cancel</button>
            <button type="submit" disabled={loading} className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50">{loading ? 'Assigning...' : 'Assign Plan'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
