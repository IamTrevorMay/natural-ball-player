import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus, X, Users, User, Dumbbell, Utensils, Trash2, Edit2, Building, MapPin, AlignLeft, Repeat, Clock, Check } from 'lucide-react';

// ============================================
// RECURRENCE UTILITIES
// ============================================

function generateOccurrenceDates(startDate, rule, rangeStart, rangeEnd) {
  const dates = [];
  if (!rule || !rule.freq) return dates;
  const start = new Date(startDate);
  const interval = rule.interval || 1;
  const maxCount = rule.count || 365;
  const until = rule.until ? new Date(rule.until) : null;
  let current = new Date(start);
  let count = 0;
  while (count < maxCount) {
    if (until && current > until) break;
    if (current > rangeEnd) break;
    if (current >= rangeStart && current <= rangeEnd) {
      dates.push(new Date(current));
    }
    switch (rule.freq) {
      case 'daily': current.setDate(current.getDate() + interval); break;
      case 'weekly':
        if (rule.byDay && rule.byDay.length > 0) {
          let found = false;
          for (let i = 0; i < 7; i++) {
            current.setDate(current.getDate() + 1);
            const dayName = ['SU','MO','TU','WE','TH','FR','SA'][current.getDay()];
            if (rule.byDay.includes(dayName)) { found = true; break; }
          }
          if (!found) current.setDate(current.getDate() + 1);
        } else {
          current.setDate(current.getDate() + (7 * interval));
        }
        break;
      case 'monthly': current.setMonth(current.getMonth() + interval); break;
      case 'yearly': current.setFullYear(current.getFullYear() + interval); break;
      default: return dates;
    }
    count++;
  }
  return dates;
}

function expandRecurringEvents(masters, exceptions, rangeStart, rangeEnd) {
  const exceptionMap = {};
  exceptions.forEach(ex => {
    const key = `${ex.recurrence_parent_id}_${ex.original_date || ex.event_date}`;
    exceptionMap[key] = ex;
  });
  const expanded = [];
  masters.forEach(master => {
    if (!master.recurrence_rule) return;
    const dates = generateOccurrenceDates(master.event_date, master.recurrence_rule, rangeStart, rangeEnd);
    dates.forEach((date, index) => {
      const dateStr = date.toISOString().split('T')[0];
      const exKey = `${master.id}_${dateStr}`;
      if (exceptionMap[exKey]) {
        const ex = exceptionMap[exKey];
        if (!ex.is_exception) return;
        expanded.push(ex);
      } else {
        expanded.push({ ...master, id: `${master.id}_${index}`, event_date: dateStr, _is_virtual: true, _master_id: master.id, _occurrence_index: index });
      }
    });
  });
  return expanded;
}

export default function Schedule({ userId, userRole }) {
  const [view, setView] = useState(userRole === 'player' ? 'facility' : 'team');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [viewMode, setViewMode] = useState('month');
  const [teams, setTeams] = useState([]);
  const [players, setPlayers] = useState([]);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [events, setEvents] = useState([]);
  const [showAddPanel, setShowAddPanel] = useState(null);
  const [hoveredDate, setHoveredDate] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [showEventDetail, setShowEventDetail] = useState(false);
  // Facility & Training Slots state
  const [facilityEvents, setFacilityEvents] = useState([]);
  const [showAddFacilityEvent, setShowAddFacilityEvent] = useState(null);
  const [coaches, setCoaches] = useState([]);
  const [selectedCoach, setSelectedCoach] = useState(null);
  const [coachSlots, setCoachSlots] = useState([]);
  const [slotReservations, setSlotReservations] = useState([]);
  const [showCreateSlot, setShowCreateSlot] = useState(null);
  const [showReserveSlot, setShowReserveSlot] = useState(null);
  const [showFacilityEventDetail, setShowFacilityEventDetail] = useState(false);
  const [selectedFacilityEvent, setSelectedFacilityEvent] = useState(null);

  useEffect(() => {
    fetchTeams();
    if (userRole === 'admin' || userRole === 'coach') {
      fetchPlayers();
    }
  }, [userRole]);

  useEffect(() => {
    if (view === 'team' && selectedTeam) {
      fetchTeamEvents();
    } else if (view === 'player' && selectedPlayer) {
      fetchPlayerEvents();
    }
  }, [view, selectedTeam, selectedPlayer, selectedDate]);

  useEffect(() => {
    if (view === 'facility') {
      fetchFacilityEvents();
      fetchCoaches();
    }
  }, [view, selectedDate]);

  useEffect(() => {
    if (selectedCoach) {
      fetchCoachSlots(selectedCoach.id);
    }
  }, [selectedCoach, selectedDate]);

  const fetchTeams = async () => {
    const { data } = await supabase
      .from('teams')
      .select('*')
      .order('name');
    if (data && data.length > 0) {
      setTeams(data);
      setSelectedTeam(data[0].id);
    }
  };

  const fetchPlayers = async () => {
    let query = supabase
      .from('users')
      .select(`
        id, 
        full_name,
        team_members(team_id, teams(name))
      `)
      .eq('role', 'player')
      .order('full_name');

    // If coach, only show players from their teams
    if (userRole === 'coach') {
      const { data: coachTeams } = await supabase
        .from('team_members')
        .select('team_id')
        .eq('user_id', userId);
      
      const teamIds = coachTeams?.map(t => t.team_id) || [];
      if (teamIds.length > 0) {
        // Filter to only players on coach's teams
        const { data } = await query;
        const filteredPlayers = data?.filter(p => 
          p.team_members?.some(tm => teamIds.includes(tm.team_id))
        );
        setPlayers(filteredPlayers || []);
        return;
      }
    }

    const { data } = await query;
    setPlayers(data || []);
  };

  const fetchTeamEvents = async () => {
    if (!selectedTeam) return;

    const startOfMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    const endOfMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0);

    const { data } = await supabase
      .from('schedule_events')
      .select('*')
      .eq('team_id', selectedTeam)
      .gte('event_date', startOfMonth.toISOString().split('T')[0])
      .lte('event_date', endOfMonth.toISOString().split('T')[0]);

    setEvents(data || []);
  };

  const fetchPlayerEvents = async () => {
    if (!selectedPlayer) return;

    const startOfMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    const endOfMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0);

    const { data } = await supabase
      .from('schedule_events')
      .select('*')
      .eq('player_id', selectedPlayer)
      .gte('event_date', startOfMonth.toISOString().split('T')[0])
      .lte('event_date', endOfMonth.toISOString().split('T')[0]);

    setEvents(data || []);
  };

  const fetchFacilityEvents = async () => {
    const startOfMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    const endOfMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0);
    const startStr = startOfMonth.toISOString().split('T')[0];
    const endStr = endOfMonth.toISOString().split('T')[0];
    const { data: nonRecurring } = await supabase.from('facility_events').select('*').eq('is_recurring', false).is('recurrence_parent_id', null).gte('event_date', startStr).lte('event_date', endStr);
    const { data: masters } = await supabase.from('facility_events').select('*').eq('is_recurring', true).is('recurrence_parent_id', null);
    const { data: exceptions } = await supabase.from('facility_events').select('*').not('recurrence_parent_id', 'is', null).gte('event_date', startStr).lte('event_date', endStr);
    const expanded = expandRecurringEvents(masters || [], exceptions || [], startOfMonth, endOfMonth);
    setFacilityEvents([...(nonRecurring || []), ...expanded]);
  };

  const fetchCoaches = async () => {
    const { data } = await supabase.from('users').select('id, full_name, email, title, avatar_url, role').in('role', ['coach', 'admin']).order('full_name');
    setCoaches(data || []);
  };

  const fetchCoachSlots = async (coachId) => {
    const startOfMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    const endOfMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0);
    const startStr = startOfMonth.toISOString().split('T')[0];
    const endStr = endOfMonth.toISOString().split('T')[0];
    const { data: slots } = await supabase.from('training_slots').select('*').eq('coach_id', coachId);
    const expandedSlots = [];
    (slots || []).forEach(slot => {
      if (slot.repeat_weekly && !slot.recurrence_parent_id) {
        const slotStart = new Date(slot.slot_date);
        const endDate = slot.repeat_end_date ? new Date(slot.repeat_end_date) : endOfMonth;
        let current = new Date(slotStart);
        let index = 0;
        while (current <= endDate && current <= endOfMonth) {
          if (current >= startOfMonth) {
            expandedSlots.push({ ...slot, slot_date: current.toISOString().split('T')[0], _occurrence_index: index, _is_virtual: index > 0 });
          }
          current.setDate(current.getDate() + 7);
          index++;
        }
      } else if (!slot.recurrence_parent_id) {
        if (slot.slot_date >= startStr && slot.slot_date <= endStr) {
          expandedSlots.push(slot);
        }
      }
    });
    setCoachSlots(expandedSlots);
    const slotIds = (slots || []).map(s => s.id);
    if (slotIds.length > 0) {
      const { data: reservations } = await supabase.from('slot_reservations').select('*, users:player_id(full_name, email)').in('slot_id', slotIds).gte('slot_date', startStr).lte('slot_date', endStr);
      setSlotReservations(reservations || []);
    } else {
      setSlotReservations([]);
    }
  };

  const canManageCalendar = () => {
    if (userRole === 'admin') return true;
    if (userRole === 'coach') {
      if (view === 'facility') return true;
      if (view === 'player') {
        const player = players.find(p => p.id === selectedPlayer);
        return player !== undefined;
      }
    }
    return false;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Schedule</h2>
          <p className="text-gray-600 mt-1">Manage team events and player calendars</p>
        </div>
        
        {/* View Toggle */}
        <div className="flex items-center space-x-2">
          {(userRole === 'admin' || userRole === 'coach') && (
            <>
              <button
                onClick={() => { setView('team'); setSelectedCoach(null); }}
                className={`px-4 py-2 rounded-lg font-medium transition flex items-center space-x-2 ${
                  view === 'team' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <Users size={18} />
                <span>Team</span>
              </button>
              <button
                onClick={() => { setView('player'); setSelectedCoach(null); }}
                className={`px-4 py-2 rounded-lg font-medium transition flex items-center space-x-2 ${
                  view === 'player' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <User size={18} />
                <span>Player</span>
              </button>
            </>
          )}
          <button
            onClick={() => { setView('facility'); setSelectedCoach(null); }}
            className={`px-4 py-2 rounded-lg font-medium transition flex items-center space-x-2 ${
              view === 'facility' ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Building size={18} />
            <span>Facility</span>
          </button>
        </div>
      </div>

      {/* Facility View */}
      {view === 'facility' && (
        <div className="bg-white rounded-lg shadow">
          <div className="flex">
            {/* Coach Sidebar */}
            <div className="w-72 border-r border-gray-200 bg-gray-50 flex-shrink-0">
              <div className="p-4 border-b border-gray-200">
                <h3 className="font-semibold text-gray-900 text-sm">Coaches</h3>
                <p className="text-xs text-gray-500 mt-1">Select a coach to view training slots</p>
              </div>
              <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 400px)' }}>
                {selectedCoach && (
                  <button onClick={() => setSelectedCoach(null)} className="w-full px-4 py-3 text-left text-sm text-teal-600 hover:bg-teal-50 border-b border-gray-200 font-medium">
                    &larr; Back to Facility Events
                  </button>
                )}
                {coaches.map(coach => (
                  <button
                    key={coach.id}
                    onClick={() => setSelectedCoach(selectedCoach?.id === coach.id ? null : coach)}
                    className={`w-full px-4 py-3 text-left hover:bg-gray-100 transition border-b border-gray-100 ${selectedCoach?.id === coach.id ? 'bg-teal-50 border-l-4 border-l-teal-500' : ''}`}
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 bg-teal-600 rounded-full flex items-center justify-center text-white text-sm font-semibold">{coach.full_name.charAt(0)}</div>
                      <div>
                        <div className="text-sm font-medium text-gray-900">{coach.full_name}</div>
                        {coach.title && <div className="text-xs text-gray-500">{coach.title}</div>}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
            {/* Main Calendar Area */}
            <div className="flex-1">
              <div className="border-b border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-4">
                    <h3 className="text-lg font-semibold text-gray-900">
                      {selectedCoach ? `${selectedCoach.full_name}'s Training Slots` : 'Facility Calendar'}
                    </h3>
                    {canManageCalendar() && !selectedCoach && (
                      <button onClick={() => setShowAddFacilityEvent('new')} className="bg-teal-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-teal-700 transition flex items-center space-x-1">
                        <Plus size={16} /><span>Add Event</span>
                      </button>
                    )}
                    {selectedCoach && selectedCoach.id === userId && (userRole === 'coach' || userRole === 'admin') && (
                      <button onClick={() => setShowCreateSlot('new')} className="bg-teal-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-teal-700 transition flex items-center space-x-1">
                        <Plus size={16} /><span>Add Training Slot</span>
                      </button>
                    )}
                  </div>
                  <div className="flex items-center space-x-2">
                    <button onClick={() => setViewMode('week')} className={`px-3 py-1 rounded text-sm font-medium transition ${viewMode === 'week' ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>Week</button>
                    <button onClick={() => setViewMode('month')} className={`px-3 py-1 rounded text-sm font-medium transition ${viewMode === 'month' ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>Month</button>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <button onClick={() => setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, 1))} className="p-2 hover:bg-gray-100 rounded-lg transition"><ChevronLeft size={20} /></button>
                  <h3 className="text-xl font-semibold text-gray-900">{selectedDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h3>
                  <button onClick={() => setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 1))} className="p-2 hover:bg-gray-100 rounded-lg transition"><ChevronRight size={20} /></button>
                </div>
              </div>
              <div className="p-6">
                {selectedCoach ? (
                  <CoachSlotsWeekView
                    selectedDate={selectedDate}
                    slots={coachSlots}
                    reservations={slotReservations}
                    coach={selectedCoach}
                    userId={userId}
                    userRole={userRole}
                    onReserve={(slot) => setShowReserveSlot(slot)}
                    onConfirm={async (reservationId) => { await supabase.from('slot_reservations').update({ status: 'confirmed', confirmed_at: new Date().toISOString() }).eq('id', reservationId); fetchCoachSlots(selectedCoach.id); }}
                    onDecline={async (reservationId) => { await supabase.from('slot_reservations').update({ status: 'declined' }).eq('id', reservationId); fetchCoachSlots(selectedCoach.id); }}
                  />
                ) : viewMode === 'month' ? (
                  <MonthView selectedDate={selectedDate} events={facilityEvents} onDateClick={(date) => canManageCalendar() && setShowAddFacilityEvent(date)} hoveredDate={hoveredDate} setHoveredDate={setHoveredDate} canManage={canManageCalendar()} setSelectedEvent={setSelectedFacilityEvent} setShowEventDetail={setShowFacilityEventDetail} eventColorFn={() => 'bg-teal-100 text-teal-700 border-teal-200'} />
                ) : (
                  <WeekView selectedDate={selectedDate} events={facilityEvents} onDateClick={(date) => canManageCalendar() && setShowAddFacilityEvent(date)} canManage={canManageCalendar()} eventColorFn={() => 'border-l-4 border-teal-500 bg-teal-50'} />
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Team/Player Calendar Container */}
      {view !== 'facility' && <><div className="bg-white rounded-lg shadow">
        {/* Calendar Header */}
        <div className="border-b border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            {/* Team/Player Selector */}
            <div className="flex items-center space-x-4">
              {view === 'team' ? (
                <select
                  value={selectedTeam || ''}
                  onChange={(e) => setSelectedTeam(e.target.value)}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {teams.map(team => (
                    <option key={team.id} value={team.id}>{team.name}</option>
                  ))}
                </select>
              ) : (
                <select
                  value={selectedPlayer || ''}
                  onChange={(e) => setSelectedPlayer(e.target.value)}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select a player...</option>
                  {players.map(player => (
                    <option key={player.id} value={player.id}>{player.full_name}</option>
                  ))}
                </select>
              )}
            </div>

            {/* View Mode Toggle */}
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setViewMode('week')}
                className={`px-3 py-1 rounded text-sm font-medium transition ${
                  viewMode === 'week' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Week
              </button>
              <button
                onClick={() => setViewMode('month')}
                className={`px-3 py-1 rounded text-sm font-medium transition ${
                  viewMode === 'month' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Month
              </button>
            </div>
          </div>

          {/* Month Navigation */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, 1))}
              className="p-2 hover:bg-gray-100 rounded-lg transition"
            >
              <ChevronLeft size={20} />
            </button>
            <h3 className="text-xl font-semibold text-gray-900">
              {selectedDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </h3>
            <button
              onClick={() => setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 1))}
              className="p-2 hover:bg-gray-100 rounded-lg transition"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>

        {/* Calendar Grid */}
        <div className="p-6">
          {viewMode === 'month' ? (
            <MonthView
              selectedDate={selectedDate}
              events={events}
              onDateClick={(date) => canManageCalendar() && setShowAddPanel(date)}
              hoveredDate={hoveredDate}
              setHoveredDate={setHoveredDate}
              canManage={canManageCalendar()}
              setSelectedEvent={setSelectedEvent}
              setShowEventDetail={setShowEventDetail}
            />
          ) : (
            <WeekView
              selectedDate={selectedDate}
              events={events}
              onDateClick={(date) => canManageCalendar() && setShowAddPanel(date)}
              canManage={canManageCalendar()}
            />
          )}
        </div>
      </div>

      {/* Add Event Panel */}
      {showAddPanel && (
        <AddEventPanel
          date={showAddPanel}
          view={view}
          teamId={selectedTeam}
          playerId={selectedPlayer}
          onClose={() => setShowAddPanel(null)}
          onSuccess={() => {
            setShowAddPanel(null);
            if (view === 'team') fetchTeamEvents();
            else fetchPlayerEvents();
          }}
        />
      )}

      {/* Event Detail/Edit Modal */}
      {showEventDetail && selectedEvent && (
        <EventDetailModal
          event={selectedEvent}
          onClose={() => {
            setShowEventDetail(false);
            setSelectedEvent(null);
          }}
          onDelete={() => {
            setShowEventDetail(false);
            setSelectedEvent(null);
            if (view === 'team') fetchTeamEvents();
            else fetchPlayerEvents();
          }}
          onUpdate={() => {
            setShowEventDetail(false);
            setSelectedEvent(null);
            if (view === 'team') fetchTeamEvents();
            else fetchPlayerEvents();
          }}
        />
      )}
      </>}

      {/* Facility Event Panels */}
      {showAddFacilityEvent && (
        <AddFacilityEventPanel
          date={showAddFacilityEvent}
          onClose={() => setShowAddFacilityEvent(null)}
          onSuccess={() => { setShowAddFacilityEvent(null); fetchFacilityEvents(); }}
        />
      )}
      {showFacilityEventDetail && selectedFacilityEvent && (
        <FacilityEventDetail
          event={selectedFacilityEvent}
          onClose={() => { setShowFacilityEventDetail(false); setSelectedFacilityEvent(null); }}
          onUpdate={() => { setShowFacilityEventDetail(false); setSelectedFacilityEvent(null); fetchFacilityEvents(); }}
          onDelete={() => { setShowFacilityEventDetail(false); setSelectedFacilityEvent(null); fetchFacilityEvents(); }}
        />
      )}
      {/* Training Slot Panels */}
      {showCreateSlot && (
        <CreateSlotPanel
          onClose={() => setShowCreateSlot(null)}
          onSuccess={() => { setShowCreateSlot(null); if (selectedCoach) fetchCoachSlots(selectedCoach.id); }}
          userId={userId}
        />
      )}
      {showReserveSlot && (
        <ReserveSlotModal
          slot={showReserveSlot}
          coach={selectedCoach}
          onClose={() => setShowReserveSlot(null)}
          onSuccess={() => { setShowReserveSlot(null); if (selectedCoach) fetchCoachSlots(selectedCoach.id); }}
        />
      )}
    </div>
  );
}

// ============================================
// MONTH VIEW
// ============================================

function MonthView({ selectedDate, events, onDateClick, hoveredDate, setHoveredDate, canManage, setSelectedEvent, setShowEventDetail, eventColorFn }) {
  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth();

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay();

  const days = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Previous month's trailing days
  const prevMonthLastDay = new Date(year, month, 0).getDate();
  for (let i = startingDayOfWeek - 1; i >= 0; i--) {
    days.push({
      date: new Date(year, month - 1, prevMonthLastDay - i),
      isCurrentMonth: false
    });
  }

  // Current month's days
  for (let i = 1; i <= daysInMonth; i++) {
    days.push({
      date: new Date(year, month, i),
      isCurrentMonth: true
    });
  }

  // Next month's leading days
  const remainingDays = 42 - days.length; // 6 rows × 7 days
  for (let i = 1; i <= remainingDays; i++) {
    days.push({
      date: new Date(year, month + 1, i),
      isCurrentMonth: false
    });
  }

  const getEventsForDate = (date) => {
    const dateStr = date.toISOString().split('T')[0];
    return events.filter(e => e.event_date === dateStr);
  };

  const getEventColor = (eventType) => {
    switch(eventType) {
      case 'game': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'practice': return 'bg-green-100 text-green-700 border-green-200';
      case 'workout': return 'bg-purple-100 text-purple-700 border-purple-200';
      case 'meal': return 'bg-orange-100 text-orange-700 border-orange-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Day headers */}
      <div className="grid grid-cols-7 bg-gray-50 border-b border-gray-200">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
          <div key={day} className="p-2 text-center text-sm font-semibold text-gray-700">
            {day}
          </div>
        ))}
      </div>

      {/* Calendar days */}
      <div className="grid grid-cols-7">
        {days.map((day, idx) => {
          const dateStr = day.date.toISOString().split('T')[0];
          const dayEvents = getEventsForDate(day.date);
          const isToday = day.date.getTime() === today.getTime();
          const isHovered = hoveredDate === dateStr;

          return (
            <div
              key={idx}
              className={`min-h-[120px] border-b border-r border-gray-200 p-2 relative ${
                !day.isCurrentMonth ? 'bg-gray-50' : 'bg-white hover:bg-gray-50'
              } transition cursor-pointer`}
              onClick={() => day.isCurrentMonth && onDateClick(dateStr)}
              onMouseEnter={() => setHoveredDate(dateStr)}
              onMouseLeave={() => setHoveredDate(null)}
            >
              {/* Date number */}
              <div className={`text-sm font-medium mb-1 ${
                !day.isCurrentMonth ? 'text-gray-400' : 
                isToday ? 'text-blue-600 font-bold' : 'text-gray-900'
              }`}>
                {day.date.getDate()}
              </div>

              {/* Events */}
              <div className="space-y-1">
                {dayEvents.slice(0, 3).map(event => (
                  <div
                    key={event.id}
                    onClick={(e) => {
                      console.log('🟢 Event clicked in calendar:', event);
                      e.stopPropagation();
                      if (canManage) {
                        console.log('✅ User can manage, opening modal');
                        setSelectedEvent(event);
                        setShowEventDetail(true);
                      } else {
                        console.log('❌ User cannot manage events');
                      }
                    }}
                    className={`text-xs px-2 py-1 rounded border truncate ${eventColorFn ? eventColorFn(event.event_type) : getEventColor(event.event_type)} ${canManage ? 'cursor-pointer hover:opacity-75' : ''}`}
                    title={event.title || event.opponent || event.event_type}
                  >
                    {event.title || event.opponent || event.event_type}
                  </div>
                ))}
                {dayEvents.length > 3 && (
                  <div className="text-xs text-gray-500 px-2">+{dayEvents.length - 3} more</div>
                )}
              </div>

              {/* Add button on hover */}
              {canManage && day.isCurrentMonth && isHovered && (
                <button
                  className="absolute top-1 right-1 w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center hover:bg-blue-700 transition"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDateClick(dateStr);
                  }}
                >
                  <Plus size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================
// WEEK VIEW
// ============================================

function WeekView({ selectedDate, events, onDateClick, canManage, eventColorFn }) {
  // Get the week containing selectedDate
  const startOfWeek = new Date(selectedDate);
  startOfWeek.setDate(selectedDate.getDate() - selectedDate.getDay());
  startOfWeek.setHours(0, 0, 0, 0);

  const weekDays = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(startOfWeek);
    date.setDate(startOfWeek.getDate() + i);
    weekDays.push(date);
  }

  const getEventsForDate = (date) => {
    const dateStr = date.toISOString().split('T')[0];
    return events.filter(e => e.event_date === dateStr);
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="grid grid-cols-7 divide-x divide-gray-200">
        {weekDays.map((date, idx) => {
          const dateStr = date.toISOString().split('T')[0];
          const dayEvents = getEventsForDate(date);
          const isToday = date.getTime() === today.getTime();

          return (
            <div key={idx} className="min-h-[400px] bg-white">
              {/* Day header */}
              <div className={`p-3 border-b border-gray-200 text-center ${
                isToday ? 'bg-blue-50' : 'bg-gray-50'
              }`}>
                <div className="text-xs font-medium text-gray-600">
                  {date.toLocaleDateString('en-US', { weekday: 'short' })}
                </div>
                <div className={`text-lg font-semibold ${
                  isToday ? 'text-blue-600' : 'text-gray-900'
                }`}>
                  {date.getDate()}
                </div>
              </div>

              {/* Events */}
              <div className="p-2 space-y-2">
                {dayEvents.map(event => (
                  <EventCard key={event.id} event={event} compact eventColorFn={eventColorFn} />
                ))}

                {/* Add button */}
                {canManage && (
                  <button
                    onClick={() => onDateClick(dateStr)}
                    className="w-full border-2 border-dashed border-gray-300 rounded-lg py-2 text-gray-500 hover:border-blue-500 hover:text-blue-600 transition flex items-center justify-center space-x-1"
                  >
                    <Plus size={16} />
                    <span className="text-xs font-medium">Add</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventCard({ event, compact, eventColorFn }) {
  const getEventColor = (eventType) => {
    switch(eventType) {
      case 'game': return 'border-l-4 border-blue-500 bg-blue-50';
      case 'practice': return 'border-l-4 border-green-500 bg-green-50';
      case 'workout': return 'border-l-4 border-purple-500 bg-purple-50';
      case 'meal': return 'border-l-4 border-orange-500 bg-orange-50';
      default: return 'border-l-4 border-gray-500 bg-gray-50';
    }
  };

  const displayText = event.title || event.opponent || event.event_type;

  return (
    <div className={`p-2 rounded ${eventColorFn ? eventColorFn(event.event_type) : getEventColor(event.event_type)}`}>
      <div className="text-xs font-semibold text-gray-900">
        {displayText}
      </div>
      {event.event_time && (
        <div className="text-xs text-gray-600 mt-1">{event.event_time}</div>
      )}
      {!compact && event.location && (
        <div className="text-xs text-gray-500 mt-1">{event.location}</div>
      )}
    </div>
  );
}

// ============================================
// ADD EVENT PANEL
// ============================================

function AddEventPanel({ date, view, teamId, playerId, onClose, onSuccess }) {
  const [eventType, setEventType] = useState(null); // 'team-event', 'workout', 'meal'
  const [workoutType, setWorkoutType] = useState(null); // 'single-day', 'program'
  const [mealType, setMealType] = useState(null); // 'single-meal', 'plan'
  
  const [teamEventData, setTeamEventData] = useState({
    event_type: 'practice',
    opponent: '',
    event_time: '',
    location: '',
    address: '',
    home_away: null,
    is_optional: false,
    notes: ''
  });

  const [trainingPrograms, setTrainingPrograms] = useState([]);
  const [trainingDays, setTrainingDays] = useState([]);
  const [meals, setMeals] = useState([]);
  const [mealPlans, setMealPlans] = useState([]);
  const [selectedProgramId, setSelectedProgramId] = useState('');
  const [selectedDayId, setSelectedDayId] = useState('');
  const [selectedMealId, setSelectedMealId] = useState('');
  const [selectedMealPlanId, setSelectedMealPlanId] = useState('');
  const [workoutSelectionMode, setWorkoutSelectionMode] = useState(null); // 'existing' or 'create'
  const [mealSelectionMode, setMealSelectionMode] = useState(null); // 'existing' or 'create'
  const [newWorkoutData, setNewWorkoutData] = useState({ title: '', notes: '' });
  const [newMealData, setNewMealData] = useState({ 
    name: '', 
    description: '', 
    meal_type: 'breakfast',
    calories: '',
    protein_g: '',
    carbs_g: '',
    fat_g: ''
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (eventType === 'workout') {
      fetchTrainingPrograms();
    } else if (eventType === 'meal') {
      fetchMeals();
      fetchMealPlans();
    }
  }, [eventType]);

  useEffect(() => {
    if (selectedProgramId) {
      fetchTrainingDays(selectedProgramId);
    }
  }, [selectedProgramId]);

  const fetchTrainingPrograms = async () => {
    const { data } = await supabase
      .from('training_programs')
      .select('id, name, description')
      .order('name');
    setTrainingPrograms(data || []);
  };

  const fetchTrainingDays = async (programId) => {
    const { data } = await supabase
      .from('training_days')
      .select('id, day_number, title')
      .eq('program_id', programId)
      .order('day_number');
    setTrainingDays(data || []);
  };

  const fetchMeals = async () => {
    const { data } = await supabase
      .from('meals')
      .select('*')
      .order('meal_type')
      .order('name');
    setMeals(data || []);
  };

  const fetchMealPlans = async () => {
    const { data } = await supabase
      .from('meal_plans')
      .select('id, name, description')
      .order('name');
    setMealPlans(data || []);
  };

  const handleSubmit = async () => {
    setLoading(true);

    try {
      if (eventType === 'team-event') {
        // Create team event
        const { error } = await supabase
          .from('schedule_events')
          .insert({
            team_id: teamId,
            event_type: teamEventData.event_type,
            opponent: teamEventData.opponent,
            event_date: date,
            event_time: teamEventData.event_time,
            location: teamEventData.location,
            address: teamEventData.address || null,
            home_away: teamEventData.event_type === 'game' ? teamEventData.home_away : null,
            is_optional: teamEventData.is_optional,
            notes: teamEventData.notes || null
          });

        if (error) throw error;

      } else if (eventType === 'workout') {
        if (workoutType === 'single-day') {
          if (workoutSelectionMode === 'create') {
            // Create new one-time workout
            const { error } = await supabase
              .from('schedule_events')
              .insert({
                player_id: playerId,
                event_type: 'workout',
                event_date: date,
                title: newWorkoutData.title,
                notes: newWorkoutData.notes || null
              });

            if (error) {
              console.error('Error creating new workout:', error);
              throw error;
            }
          } else {
            // Create single workout day event from existing program
            const day = trainingDays.find(d => d.id === selectedDayId);
            const { error } = await supabase
              .from('schedule_events')
              .insert({
                player_id: playerId,
                event_type: 'workout',
                event_date: date,
                title: day?.title || `Day ${day?.day_number}`,
                training_day_id: selectedDayId
              });

            if (error) {
              console.error('Error creating workout event:', error);
              throw error;
            }
          }
        } else if (workoutType === 'program') {
          // Assign full training program
          const { data: { user } } = await supabase.auth.getUser();
          const { error } = await supabase
            .from('training_program_assignments')
            .insert({
              program_id: selectedProgramId,
              player_id: playerId,
              start_date: date,
              assigned_by: user?.id
            });

          if (error) throw error;
        }

      } else if (eventType === 'meal') {
        if (mealType === 'single-meal') {
          if (mealSelectionMode === 'create') {
            // Create new meal in meals table first, then schedule it
            const { data: { user } } = await supabase.auth.getUser();
            const { data: newMeal, error: mealError } = await supabase
              .from('meals')
              .insert({
                name: newMealData.name,
                description: newMealData.description || null,
                meal_type: newMealData.meal_type,
                calories: newMealData.calories ? parseInt(newMealData.calories) : null,
                protein_g: newMealData.protein_g ? parseFloat(newMealData.protein_g) : null,
                carbs_g: newMealData.carbs_g ? parseFloat(newMealData.carbs_g) : null,
                fat_g: newMealData.fat_g ? parseFloat(newMealData.fat_g) : null,
                created_by: user?.id
              })
              .select()
              .single();

            if (mealError) {
              console.error('Error creating meal:', mealError);
              throw mealError;
            }

            // Now create schedule event referencing the new meal
            const { error: scheduleError } = await supabase
              .from('schedule_events')
              .insert({
                player_id: playerId,
                event_type: 'meal',
                event_date: date,
                title: newMeal.name,
                meal_id: newMeal.id
              });

            if (scheduleError) {
              console.error('Error creating meal event:', scheduleError);
              throw scheduleError;
            }
          } else {
            // Create single meal event from existing meal
            const meal = meals.find(m => m.id === selectedMealId);
            const { error } = await supabase
              .from('schedule_events')
              .insert({
                player_id: playerId,
                event_type: 'meal',
                event_date: date,
                title: meal?.name,
                meal_id: selectedMealId
              });

            if (error) {
              console.error('Error creating meal event:', error);
              throw error;
            }
          }
        } else if (mealType === 'plan') {
          // Assign full meal plan
          const { data: { user } } = await supabase.auth.getUser();
          const { error } = await supabase
            .from('meal_plan_assignments')
            .insert({
              meal_plan_id: selectedMealPlanId,
              player_id: playerId,
              start_date: date,
              assigned_by: user?.id
            });

          if (error) throw error;
        }
      }

      // Success! Close modal and refresh
      alert('Event added successfully!');
      onSuccess();
    } catch (error) {
      console.error('Error in handleSubmit:', error);
      alert('Error creating event: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex items-center justify-between z-10">
          <div>
            <h3 className="text-xl font-bold text-gray-900">Add Event</h3>
            <p className="text-sm text-gray-600 mt-1">
              {new Date(date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Event Type Selection */}
          {!eventType && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-700">What would you like to add?</p>
              
              {view === 'team' && (
                <button
                  onClick={() => setEventType('team-event')}
                  className="w-full p-4 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition text-left"
                >
                  <div className="flex items-center space-x-3">
                    <Users className="text-blue-600" size={24} />
                    <div>
                      <div className="font-semibold text-gray-900">Team Event</div>
                      <div className="text-sm text-gray-600">Game, practice, or team activity</div>
                    </div>
                  </div>
                </button>
              )}

              {view === 'player' && (
                <>
                  <button
                    onClick={() => setEventType('workout')}
                    className="w-full p-4 border-2 border-gray-200 rounded-lg hover:border-purple-500 hover:bg-purple-50 transition text-left"
                  >
                    <div className="flex items-center space-x-3">
                      <Dumbbell className="text-purple-600" size={24} />
                      <div>
                        <div className="font-semibold text-gray-900">Workout</div>
                        <div className="text-sm text-gray-600">Single day or full program</div>
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => setEventType('meal')}
                    className="w-full p-4 border-2 border-gray-200 rounded-lg hover:border-orange-500 hover:bg-orange-50 transition text-left"
                  >
                    <div className="flex items-center space-x-3">
                      <Utensils className="text-orange-600" size={24} />
                      <div>
                        <div className="font-semibold text-gray-900">Meal</div>
                        <div className="text-sm text-gray-600">Single meal or full plan</div>
                      </div>
                    </div>
                  </button>
                </>
              )}
            </div>
          )}

          {/* Team Event Form */}
          {eventType === 'team-event' && (
            <div className="space-y-4">
              <button
                onClick={() => setEventType(null)}
                className="text-sm text-blue-600 hover:text-blue-800 flex items-center space-x-1"
              >
                <ChevronLeft size={16} />
                <span>Back</span>
              </button>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Event Type *</label>
                  <select
                    value={teamEventData.event_type}
                    onChange={(e) => setTeamEventData({...teamEventData, event_type: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="practice">Practice</option>
                    <option value="game">Game</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {teamEventData.event_type === 'game' ? 'Opponent' : 'Event Name'} *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={teamEventData.event_type === 'game' ? 'e.g., Hawks Academy' : 'e.g., Team Practice'}
                    value={teamEventData.opponent}
                    onChange={(e) => setTeamEventData({...teamEventData, opponent: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Time *</label>
                  <input
                    type="time"
                    required
                    value={teamEventData.event_time}
                    onChange={(e) => setTeamEventData({...teamEventData, event_time: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Location *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g., Home Field"
                    value={teamEventData.location}
                    onChange={(e) => setTeamEventData({...teamEventData, location: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {teamEventData.event_type === 'game' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Home/Away</label>
                    <select
                      value={teamEventData.home_away || ''}
                      onChange={(e) => setTeamEventData({...teamEventData, home_away: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Not specified</option>
                      <option value="home">Home</option>
                      <option value="away">Away</option>
                    </select>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Workout Selection */}
          {eventType === 'workout' && !workoutType && (
            <div className="space-y-3">
              <button
                onClick={() => setEventType(null)}
                className="text-sm text-blue-600 hover:text-blue-800 flex items-center space-x-1"
              >
                <ChevronLeft size={16} />
                <span>Back</span>
              </button>

              <p className="text-sm font-medium text-gray-700">Select workout type:</p>

              <button
                onClick={() => setWorkoutType('single-day')}
                className="w-full p-4 border-2 border-gray-200 rounded-lg hover:border-purple-500 hover:bg-purple-50 transition text-left"
              >
                <div className="font-semibold text-gray-900">Single Workout Day</div>
                <div className="text-sm text-gray-600">Add one day from a training program</div>
              </button>

              <button
                onClick={() => setWorkoutType('program')}
                className="w-full p-4 border-2 border-gray-200 rounded-lg hover:border-purple-500 hover:bg-purple-50 transition text-left"
              >
                <div className="font-semibold text-gray-900">Full Training Program</div>
                <div className="text-sm text-gray-600">Assign entire multi-day program</div>
              </button>
            </div>
          )}

          {/* Single Workout Day Form */}
          {eventType === 'workout' && workoutType === 'single-day' && (
            <div className="space-y-4">
              <button
                onClick={() => setWorkoutType(null)}
                className="text-sm text-blue-600 hover:text-blue-800 flex items-center space-x-1"
              >
                <ChevronLeft size={16} />
                <span>Back</span>
              </button>

              {/* Choose Existing or Create New */}
              {!workoutSelectionMode && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-3">Choose option:</p>
                  <div className="space-y-2">
                    <button
                      onClick={() => setWorkoutSelectionMode('existing')}
                      className="w-full p-3 border-2 border-gray-200 rounded-lg hover:border-purple-500 hover:bg-purple-50 transition text-left"
                    >
                      <div className="font-semibold text-gray-900">Select Existing Workout</div>
                      <div className="text-sm text-gray-600">Choose from existing training programs</div>
                    </button>
                    <button
                      onClick={() => setWorkoutSelectionMode('create')}
                      className="w-full p-3 border-2 border-gray-200 rounded-lg hover:border-purple-500 hover:bg-purple-50 transition text-left"
                    >
                      <div className="font-semibold text-gray-900">Create New Workout</div>
                      <div className="text-sm text-gray-600">Create a one-time workout</div>
                    </button>
                  </div>
                </div>
              )}

              {/* Existing Workout Selection */}
              {workoutSelectionMode === 'existing' && (
                <div className="space-y-4">
                  <button
                    onClick={() => setWorkoutSelectionMode(null)}
                    className="text-sm text-blue-600 hover:text-blue-800 flex items-center space-x-1"
                  >
                    <ChevronLeft size={16} />
                    <span>Back</span>
                  </button>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Training Program *</label>
                    <select
                      value={selectedProgramId}
                      onChange={(e) => setSelectedProgramId(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select program...</option>
                      {trainingPrograms.map(program => (
                        <option key={program.id} value={program.id}>{program.name}</option>
                      ))}
                    </select>
                  </div>

                  {selectedProgramId && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Workout Day *</label>
                      <select
                        value={selectedDayId}
                        onChange={(e) => setSelectedDayId(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">Select day...</option>
                        {trainingDays.map(day => (
                          <option key={day.id} value={day.id}>
                            Day {day.day_number}{day.title ? `: ${day.title}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {/* Create New Workout */}
              {workoutSelectionMode === 'create' && (
                <div className="space-y-4">
                  <button
                    onClick={() => setWorkoutSelectionMode(null)}
                    className="text-sm text-blue-600 hover:text-blue-800 flex items-center space-x-1"
                  >
                    <ChevronLeft size={16} />
                    <span>Back</span>
                  </button>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Workout Title *</label>
                    <input
                      type="text"
                      placeholder="e.g., Upper Body Day, Hitting Focus"
                      value={newWorkoutData.title}
                      onChange={(e) => setNewWorkoutData({ ...newWorkoutData, title: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Notes (Optional)</label>
                    <textarea
                      placeholder="Any special instructions or details..."
                      value={newWorkoutData.notes}
                      onChange={(e) => setNewWorkoutData({ ...newWorkoutData, notes: e.target.value })}
                      rows="3"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Full Program Form */}
          {eventType === 'workout' && workoutType === 'program' && (
            <div className="space-y-4">
              <button
                onClick={() => setWorkoutType(null)}
                className="text-sm text-blue-600 hover:text-blue-800 flex items-center space-x-1"
              >
                <ChevronLeft size={16} />
                <span>Back</span>
              </button>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Training Program *</label>
                <select
                  value={selectedProgramId}
                  onChange={(e) => setSelectedProgramId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select program...</option>
                  {trainingPrograms.map(program => (
                    <option key={program.id} value={program.id}>{program.name}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Program will start on {new Date(date).toLocaleDateString()}
                </p>
              </div>
            </div>
          )}

          {/* Meal Selection */}
          {eventType === 'meal' && !mealType && (
            <div className="space-y-3">
              <button
                onClick={() => setEventType(null)}
                className="text-sm text-blue-600 hover:text-blue-800 flex items-center space-x-1"
              >
                <ChevronLeft size={16} />
                <span>Back</span>
              </button>

              <p className="text-sm font-medium text-gray-700">Select meal type:</p>

              <button
                onClick={() => setMealType('single-meal')}
                className="w-full p-4 border-2 border-gray-200 rounded-lg hover:border-orange-500 hover:bg-orange-50 transition text-left"
              >
                <div className="font-semibold text-gray-900">Single Meal</div>
                <div className="text-sm text-gray-600">Add one specific meal</div>
              </button>

              <button
                onClick={() => setMealType('plan')}
                className="w-full p-4 border-2 border-gray-200 rounded-lg hover:border-orange-500 hover:bg-orange-50 transition text-left"
              >
                <div className="font-semibold text-gray-900">Full Meal Plan</div>
                <div className="text-sm text-gray-600">Assign entire meal plan</div>
              </button>
            </div>
          )}

          {/* Single Meal Form */}
          {eventType === 'meal' && mealType === 'single-meal' && (
            <div className="space-y-4">
              <button
                onClick={() => setMealType(null)}
                className="text-sm text-blue-600 hover:text-blue-800 flex items-center space-x-1"
              >
                <ChevronLeft size={16} />
                <span>Back</span>
              </button>

              {/* Choose Existing or Create New */}
              {!mealSelectionMode && (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-3">Choose option:</p>
                  <div className="space-y-2">
                    <button
                      onClick={() => setMealSelectionMode('existing')}
                      className="w-full p-3 border-2 border-gray-200 rounded-lg hover:border-orange-500 hover:bg-orange-50 transition text-left"
                    >
                      <div className="font-semibold text-gray-900">Select Existing Meal</div>
                      <div className="text-sm text-gray-600">Choose from meal library</div>
                    </button>
                    <button
                      onClick={() => setMealSelectionMode('create')}
                      className="w-full p-3 border-2 border-gray-200 rounded-lg hover:border-orange-500 hover:bg-orange-50 transition text-left"
                    >
                      <div className="font-semibold text-gray-900">Create New Meal</div>
                      <div className="text-sm text-gray-600">Create a one-time meal</div>
                    </button>
                  </div>
                </div>
              )}

              {/* Existing Meal Selection */}
              {mealSelectionMode === 'existing' && (
                <div className="space-y-4">
                  <button
                    onClick={() => setMealSelectionMode(null)}
                    className="text-sm text-blue-600 hover:text-blue-800 flex items-center space-x-1"
                  >
                    <ChevronLeft size={16} />
                    <span>Back</span>
                  </button>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Select Meal *</label>
                    <select
                      value={selectedMealId}
                      onChange={(e) => setSelectedMealId(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Choose a meal...</option>
                      {['breakfast', 'lunch', 'dinner', 'snack'].map(type => {
                        const typeMeals = meals.filter(m => m.meal_type === type);
                        if (typeMeals.length === 0) return null;
                        return (
                          <optgroup key={type} label={type.charAt(0).toUpperCase() + type.slice(1)}>
                            {typeMeals.map(meal => (
                              <option key={meal.id} value={meal.id}>
                                {meal.name} {meal.calories && `(${meal.calories} cal)`}
                              </option>
                            ))}
                          </optgroup>
                        );
                      })}
                    </select>
                  </div>
                </div>
              )}

              {/* Create New Meal */}
              {mealSelectionMode === 'create' && (
                <div className="space-y-4">
                  <button
                    onClick={() => setMealSelectionMode(null)}
                    className="text-sm text-blue-600 hover:text-blue-800 flex items-center space-x-1"
                  >
                    <ChevronLeft size={16} />
                    <span>Back</span>
                  </button>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Meal Name *</label>
                    <input
                      type="text"
                      placeholder="e.g., Pre-Game Breakfast, Recovery Smoothie"
                      value={newMealData.name}
                      onChange={(e) => setNewMealData({ ...newMealData, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                    <textarea
                      placeholder="Optional details..."
                      value={newMealData.description}
                      onChange={(e) => setNewMealData({ ...newMealData, description: e.target.value })}
                      rows="2"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Meal Type *</label>
                    <select
                      value={newMealData.meal_type}
                      onChange={(e) => setNewMealData({ ...newMealData, meal_type: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="breakfast">Breakfast</option>
                      <option value="lunch">Lunch</option>
                      <option value="dinner">Dinner</option>
                      <option value="snack">Snack</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Calories</label>
                      <input
                        type="number"
                        placeholder="550"
                        value={newMealData.calories}
                        onChange={(e) => setNewMealData({ ...newMealData, calories: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Protein (g)</label>
                      <input
                        type="number"
                        step="0.1"
                        placeholder="40"
                        value={newMealData.protein_g}
                        onChange={(e) => setNewMealData({ ...newMealData, protein_g: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Carbs (g)</label>
                      <input
                        type="number"
                        step="0.1"
                        placeholder="60"
                        value={newMealData.carbs_g}
                        onChange={(e) => setNewMealData({ ...newMealData, carbs_g: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Fat (g)</label>
                      <input
                        type="number"
                        step="0.1"
                        placeholder="15"
                        value={newMealData.fat_g}
                        onChange={(e) => setNewMealData({ ...newMealData, fat_g: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Meal Plan Form */}
          {eventType === 'meal' && mealType === 'plan' && (
            <div className="space-y-4">
              <button
                onClick={() => setMealType(null)}
                className="text-sm text-blue-600 hover:text-blue-800 flex items-center space-x-1"
              >
                <ChevronLeft size={16} />
                <span>Back</span>
              </button>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Meal Plan *</label>
                <select
                  value={selectedMealPlanId}
                  onChange={(e) => setSelectedMealPlanId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select plan...</option>
                  {mealPlans.map(plan => (
                    <option key={plan.id} value={plan.id}>{plan.name}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Plan will start on {new Date(date).toLocaleDateString()}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="border-t border-gray-200 p-6 flex space-x-3">
          <button
            onClick={onClose}
            className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !eventType || 
              (eventType === 'team-event' && !teamEventData.opponent) ||
              (eventType === 'workout' && workoutType === 'single-day' && workoutSelectionMode === 'existing' && !selectedDayId) ||
              (eventType === 'workout' && workoutType === 'single-day' && workoutSelectionMode === 'create' && !newWorkoutData.title) ||
              (eventType === 'workout' && workoutType === 'program' && !selectedProgramId) ||
              (eventType === 'meal' && mealType === 'single-meal' && mealSelectionMode === 'existing' && !selectedMealId) ||
              (eventType === 'meal' && mealType === 'single-meal' && mealSelectionMode === 'create' && !newMealData.name) ||
              (eventType === 'meal' && mealType === 'plan' && !selectedMealPlanId)
            }
            className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
          >
            {loading ? 'Adding...' : 'Add Event'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// EVENT DETAIL/EDIT/DELETE MODAL - COMPLETE VERSION
// ============================================

function EventDetailModal({ event, onClose, onDelete, onUpdate }) {
  console.log('🔵 EventDetailModal rendered with event:', event);
  
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false); // Custom confirm modal
  const [mealData, setMealData] = useState(null);
  const [formData, setFormData] = useState({
    title: event.title || event.opponent || '',
    event_date: event.event_date,
    event_time: event.event_time || '',
    location: event.location || '',
    notes: event.notes || ''
  });
  const [mealFormData, setMealFormData] = useState({
    name: '',
    description: '',
    meal_type: 'breakfast',
    calories: '',
    protein_g: '',
    carbs_g: '',
    fat_g: ''
  });

  // Fetch full meal data if this is a meal event
  useEffect(() => {
    if (event.event_type === 'meal' && event.meal_id) {
      fetchMealData();
    }
  }, [event]);

  const fetchMealData = async () => {
    const { data, error } = await supabase
      .from('meals')
      .select('*')
      .eq('id', event.meal_id)
      .single();
    
    if (!error && data) {
      setMealData(data);
      // Populate meal form data
      setMealFormData({
        name: data.name || '',
        description: data.description || '',
        meal_type: data.meal_type || 'breakfast',
        calories: data.calories || '',
        protein_g: data.protein_g || '',
        carbs_g: data.carbs_g || '',
        fat_g: data.fat_g || ''
      });
    }
  };

  const handleDelete = async () => {
    console.log('🔴 handleDelete function called!');
    console.log('✅ User confirmed delete (via custom modal)');
    console.log('=== DELETE ATTEMPT ===');
    console.log('Event to delete:', event);
    setDeleting(true);
    
    try {
      // First, verify we're authenticated
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      console.log('Current user:', user);
      console.log('Auth error:', authError);
      
      if (authError || !user) {
        throw new Error('Not authenticated. Please log in again.');
      }

      // Check user role
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .single();
      
      console.log('User role:', userData?.role);
      console.log('User error:', userError);

      if (userError || !userData) {
        throw new Error('Could not verify user permissions.');
      }

      if (!['admin', 'coach'].includes(userData.role)) {
        throw new Error('You do not have permission to delete events.');
      }

      // Now attempt the delete
      console.log('Attempting delete with ID:', event.id);
      const { data: deleteData, error: deleteError } = await supabase
        .from('schedule_events')
        .delete()
        .eq('id', event.id)
        .select(); // Get the deleted row to confirm
      
      console.log('Delete data:', deleteData);
      console.log('Delete error:', deleteError);

      if (deleteError) {
        console.error('Delete error details:', {
          message: deleteError.message,
          details: deleteError.details,
          hint: deleteError.hint,
          code: deleteError.code
        });
        throw deleteError;
      }
      
      if (!deleteData || deleteData.length === 0) {
        console.error('No rows deleted - event may not exist or RLS prevented deletion');
        throw new Error('Event could not be deleted. It may have already been removed or you lack permission.');
      }
      
      console.log('=== DELETE SUCCESS ===');
      alert('Event deleted successfully!');
      onDelete();
    } catch (error) {
      console.error('=== DELETE FAILED ===');
      console.error('Error:', error);
      alert('Error deleting event: ' + error.message);
      setDeleting(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    
    try {
      // Update schedule_events record
      const updates = {
        title: formData.title,
        event_time: formData.event_time || null,
        location: formData.location || null,
        notes: formData.notes || null
      };

      // For team events, also update opponent
      if (event.team_id) {
        updates.opponent = formData.title;
      }

      const { error: scheduleError } = await supabase
        .from('schedule_events')
        .update(updates)
        .eq('id', event.id);

      if (scheduleError) throw scheduleError;

      // If this is a meal with meal_id, also update the meals table
      if (event.event_type === 'meal' && event.meal_id) {
        const mealUpdates = {
          name: mealFormData.name,
          description: mealFormData.description || null,
          meal_type: mealFormData.meal_type,
          calories: mealFormData.calories ? parseInt(mealFormData.calories) : null,
          protein_g: mealFormData.protein_g ? parseFloat(mealFormData.protein_g) : null,
          carbs_g: mealFormData.carbs_g ? parseFloat(mealFormData.carbs_g) : null,
          fat_g: mealFormData.fat_g ? parseFloat(mealFormData.fat_g) : null
        };

        const { error: mealError } = await supabase
          .from('meals')
          .update(mealUpdates)
          .eq('id', event.meal_id);

        if (mealError) throw mealError;

        // Also update the title in schedule_events to match meal name
        const { error: titleError } = await supabase
          .from('schedule_events')
          .update({ title: mealFormData.name })
          .eq('id', event.id);

        if (titleError) throw titleError;
      }

      alert('Event updated successfully!');
      setEditing(false);
      onUpdate();
    } catch (error) {
      console.error('Error updating event:', error);
      alert('Error updating event: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const getEventColor = (eventType) => {
    switch(eventType) {
      case 'game': return 'from-blue-50 to-blue-100 border-blue-200';
      case 'practice': return 'from-green-50 to-green-100 border-green-200';
      case 'workout': return 'from-purple-50 to-purple-100 border-purple-200';
      case 'meal': return 'from-orange-50 to-orange-100 border-orange-200';
      default: return 'from-gray-50 to-gray-100 border-gray-200';
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className={`bg-gradient-to-br ${getEventColor(event.event_type)} border-2 p-6 rounded-t-lg`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-600 mb-1">
                {event.event_type}
              </div>
              <h3 className="text-xl font-bold text-gray-900">
                {event.title || event.opponent}
              </h3>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <X size={24} />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {editing ? (
            // EDIT MODE
            <div className="space-y-4">
              {event.event_type === 'meal' && event.meal_id ? (
                // MEAL EDIT FORM
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Meal Name *</label>
                    <input
                      type="text"
                      value={mealFormData.name}
                      onChange={(e) => setMealFormData({ ...mealFormData, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                    <textarea
                      value={mealFormData.description}
                      onChange={(e) => setMealFormData({ ...mealFormData, description: e.target.value })}
                      rows="2"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Meal Type *</label>
                    <select
                      value={mealFormData.meal_type}
                      onChange={(e) => setMealFormData({ ...mealFormData, meal_type: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="breakfast">Breakfast</option>
                      <option value="lunch">Lunch</option>
                      <option value="dinner">Dinner</option>
                      <option value="snack">Snack</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Calories</label>
                      <input
                        type="number"
                        value={mealFormData.calories}
                        onChange={(e) => setMealFormData({ ...mealFormData, calories: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Protein (g)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={mealFormData.protein_g}
                        onChange={(e) => setMealFormData({ ...mealFormData, protein_g: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Carbs (g)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={mealFormData.carbs_g}
                        onChange={(e) => setMealFormData({ ...mealFormData, carbs_g: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Fat (g)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={mealFormData.fat_g}
                        onChange={(e) => setMealFormData({ ...mealFormData, fat_g: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Notes</label>
                    <textarea
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      rows="2"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </>
              ) : (
                // REGULAR EVENT EDIT FORM
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Title</label>
                    <input
                      type="text"
                      value={formData.title}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {event.team_id && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Time</label>
                        <input
                          type="time"
                          value={formData.event_time}
                          onChange={(e) => setFormData({ ...formData, event_time: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Location</label>
                        <input
                          type="text"
                          value={formData.location}
                          onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Notes</label>
                    <textarea
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      rows="3"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </>
              )}

              <div className="flex space-x-3 pt-4 border-t border-gray-200">
                <button
                  onClick={() => setEditing(false)}
                  className="flex-1 border border-gray-300 text-gray-700 py-2 px-4 rounded-lg font-medium hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={loading}
                  className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
                >
                  {loading ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            // VIEW MODE
            <div className="space-y-3">
              <div className="flex items-center space-x-3 text-sm">
                <CalendarIcon size={16} className="text-gray-400" />
                <span className="text-gray-900">
                  {new Date(event.event_date).toLocaleDateString('en-US', { 
                    weekday: 'long', 
                    month: 'long', 
                    day: 'numeric', 
                    year: 'numeric' 
                  })}
                </span>
              </div>

              {event.event_time && (
                <div className="flex items-center space-x-3 text-sm">
                  <span className="text-gray-400 font-medium">Time:</span>
                  <span className="text-gray-900">{event.event_time}</span>
                </div>
              )}

              {event.location && (
                <div className="flex items-center space-x-3 text-sm">
                  <span className="text-gray-400 font-medium">Location:</span>
                  <span className="text-gray-900">{event.location}</span>
                </div>
              )}

              {/* Meal Nutritional Data */}
              {event.event_type === 'meal' && mealData && (
                <div className="mt-4 p-4 bg-orange-50 rounded-lg border-2 border-orange-200">
                  <h4 className="text-sm font-semibold text-orange-900 mb-3">Nutritional Information</h4>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {mealData.meal_type && (
                      <div>
                        <span className="text-orange-700 font-medium">Type:</span>
                        <span className="ml-2 text-gray-900 capitalize">{mealData.meal_type}</span>
                      </div>
                    )}
                    {mealData.calories && (
                      <div>
                        <span className="text-orange-700 font-medium">Calories:</span>
                        <span className="ml-2 text-gray-900">{mealData.calories}</span>
                      </div>
                    )}
                    {mealData.protein_g && (
                      <div>
                        <span className="text-orange-700 font-medium">Protein:</span>
                        <span className="ml-2 text-gray-900">{mealData.protein_g}g</span>
                      </div>
                    )}
                    {mealData.carbs_g && (
                      <div>
                        <span className="text-orange-700 font-medium">Carbs:</span>
                        <span className="ml-2 text-gray-900">{mealData.carbs_g}g</span>
                      </div>
                    )}
                    {mealData.fat_g && (
                      <div>
                        <span className="text-orange-700 font-medium">Fat:</span>
                        <span className="ml-2 text-gray-900">{mealData.fat_g}g</span>
                      </div>
                    )}
                  </div>
                  {mealData.description && (
                    <div className="mt-3 pt-3 border-t border-orange-300">
                      <span className="text-orange-700 font-medium text-sm">Description:</span>
                      <p className="text-gray-900 text-sm mt-1">{mealData.description}</p>
                    </div>
                  )}
                </div>
              )}

              {event.notes && (
                <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                  <div className="text-xs font-semibold text-gray-600 mb-1">Notes</div>
                  <div className="text-sm text-gray-900">{event.notes}</div>
                </div>
              )}

              <div className="flex space-x-3 pt-4 border-t border-gray-200">
                <button
                  onClick={onClose}
                  className="flex-1 border border-gray-300 text-gray-700 py-2 px-4 rounded-lg font-medium hover:bg-gray-50 transition"
                >
                  Close
                </button>
                <button
                  onClick={() => setEditing(true)}
                  className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-blue-700 transition flex items-center justify-center space-x-2"
                >
                  <Edit2 size={16} />
                  <span>Edit</span>
                </button>
                <button
                  onClick={() => {
                    console.log('DELETE BUTTON CLICKED!');
                    setConfirmDelete(true); // Show custom confirm modal
                  }}
                  disabled={deleting}
                  className="flex-1 bg-red-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-red-700 transition disabled:opacity-50 flex items-center justify-center space-x-2"
                >
                  <Trash2 size={16} />
                  <span>{deleting ? 'Deleting...' : 'Delete'}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Custom Delete Confirmation Modal */}
        {confirmDelete && (
          <div className="absolute inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 rounded-lg">
            <div className="bg-white rounded-lg p-6 max-w-sm mx-4">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Confirm Delete</h3>
              <p className="text-gray-700 mb-6">
                Are you sure you want to delete this {event.event_type}?
                <br />
                <span className="font-semibold mt-2 block">"{event.title || event.opponent}"</span>
              </p>
              <p className="text-sm text-red-600 mb-4">This action cannot be undone.</p>
              <div className="flex space-x-3">
                <button
                  onClick={() => {
                    console.log('❌ User cancelled delete via custom modal');
                    setConfirmDelete(false);
                  }}
                  className="flex-1 border border-gray-300 text-gray-700 py-2 px-4 rounded-lg font-medium hover:bg-gray-50 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    console.log('✅ User confirmed delete via custom modal');
                    setConfirmDelete(false);
                    handleDelete();
                  }}
                  className="flex-1 bg-red-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-red-700 transition"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// ADD FACILITY EVENT PANEL
// ============================================

function AddFacilityEventPanel({ date, onClose, onSuccess }) {
  const [title, setTitle] = useState('');
  const [eventDate, setEventDate] = useState(typeof date === 'string' && date !== 'new' ? date : new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [recurrence, setRecurrence] = useState('none');
  const [customRule, setCustomRule] = useState({ freq: 'weekly', interval: 1, byDay: [], endType: 'never', count: 10, until: '' });
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!title.trim()) return alert('Title is required');
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const isRecurring = recurrence !== 'none';
      let recurrenceRule = null;
      if (isRecurring) {
        recurrenceRule = recurrence === 'custom' ? customRule : { freq: recurrence, interval: 1, endType: 'never' };
      }
      const { error } = await supabase.from('facility_events').insert({
        title: title.trim(), description: description || null, event_date: eventDate,
        start_time: startTime || null, end_time: endTime || null, location: location || null,
        is_recurring: isRecurring, recurrence_rule: recurrenceRule, created_by: user?.id
      });
      if (error) throw error;
      onSuccess();
    } catch (err) {
      alert('Error creating event: ' + err.message);
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
        <div className="p-6">
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add title" className="w-full text-2xl font-medium text-gray-900 placeholder-gray-400 border-0 border-b-2 border-gray-200 focus:border-teal-500 focus:outline-none pb-2 mb-6" autoFocus />
          <div className="flex items-center space-x-3 mb-4">
            <CalendarIcon size={20} className="text-gray-400" />
            <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
            <span className="text-gray-400">to</span>
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <div className="flex items-center space-x-3 mb-4">
            <Repeat size={20} className="text-gray-400" />
            <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
              <option value="custom">Custom...</option>
            </select>
          </div>
          {recurrence === 'custom' && (
            <div className="ml-8 mb-4 p-4 bg-gray-50 rounded-lg space-y-3">
              <div className="flex items-center space-x-3">
                <span className="text-sm text-gray-700">Every</span>
                <input type="number" min="1" value={customRule.interval} onChange={(e) => setCustomRule({...customRule, interval: parseInt(e.target.value) || 1})} className="w-16 px-2 py-1 border border-gray-300 rounded text-sm" />
                <select value={customRule.freq} onChange={(e) => setCustomRule({...customRule, freq: e.target.value})} className="px-2 py-1 border border-gray-300 rounded text-sm">
                  <option value="daily">day(s)</option><option value="weekly">week(s)</option><option value="monthly">month(s)</option><option value="yearly">year(s)</option>
                </select>
              </div>
              {customRule.freq === 'weekly' && (
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-700">On:</span>
                  {['SU','MO','TU','WE','TH','FR','SA'].map(day => (
                    <button key={day} type="button" onClick={() => { const days = customRule.byDay || []; setCustomRule({...customRule, byDay: days.includes(day) ? days.filter(d => d !== day) : [...days, day]}); }}
                      className={`w-8 h-8 rounded-full text-xs font-medium ${(customRule.byDay || []).includes(day) ? 'bg-teal-600 text-white' : 'bg-gray-200 text-gray-600'}`}>{day.charAt(0)}</button>
                  ))}
                </div>
              )}
              <div className="flex items-center space-x-3">
                <span className="text-sm text-gray-700">Ends:</span>
                <select value={customRule.endType} onChange={(e) => setCustomRule({...customRule, endType: e.target.value})} className="px-2 py-1 border border-gray-300 rounded text-sm">
                  <option value="never">Never</option><option value="count">After</option><option value="until">On date</option>
                </select>
                {customRule.endType === 'count' && <><input type="number" min="1" value={customRule.count} onChange={(e) => setCustomRule({...customRule, count: parseInt(e.target.value) || 1})} className="w-16 px-2 py-1 border border-gray-300 rounded text-sm" /><span className="text-sm text-gray-700">occurrences</span></>}
                {customRule.endType === 'until' && <input type="date" value={customRule.until} onChange={(e) => setCustomRule({...customRule, until: e.target.value})} className="px-2 py-1 border border-gray-300 rounded text-sm" />}
              </div>
            </div>
          )}
          <div className="flex items-center space-x-3 mb-4">
            <MapPin size={20} className="text-gray-400" />
            <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Add location" className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <div className="flex items-start space-x-3 mb-6">
            <AlignLeft size={20} className="text-gray-400 mt-2" />
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Add description" rows="3" className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <div className="flex justify-end space-x-3">
            <button onClick={onClose} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition text-sm font-medium">Cancel</button>
            <button onClick={handleSave} disabled={loading} className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition text-sm font-medium disabled:opacity-50">{loading ? 'Saving...' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// FACILITY EVENT DETAIL
// ============================================

function FacilityEventDetail({ event, onClose, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({ title: event.title, description: event.description || '', start_time: event.start_time || '', end_time: event.end_time || '', location: event.location || '' });

  const handleSave = async () => {
    setLoading(true);
    try {
      const eventId = event._master_id || event.id;
      const { error } = await supabase.from('facility_events').update({ title: formData.title, description: formData.description || null, start_time: formData.start_time || null, end_time: formData.end_time || null, location: formData.location || null }).eq('id', eventId);
      if (error) throw error;
      onUpdate();
    } catch (err) { alert('Error: ' + err.message); } finally { setLoading(false); }
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this event?')) return;
    try {
      const eventId = event._master_id || event.id;
      const { error } = await supabase.from('facility_events').delete().eq('id', eventId);
      if (error) throw error;
      onDelete();
    } catch (err) { alert('Error: ' + err.message); }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="bg-gradient-to-br from-teal-50 to-teal-100 border-2 border-teal-200 p-6 rounded-t-lg">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-teal-600 mb-1">Facility Event</div>
              <h3 className="text-xl font-bold text-gray-900">{event.title}</h3>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={24} /></button>
          </div>
        </div>
        <div className="p-6 space-y-4">
          {editing ? (
            <div className="space-y-4">
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Title</label><input type="text" value={formData.title} onChange={(e) => setFormData({...formData, title: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label><input type="time" value={formData.start_time} onChange={(e) => setFormData({...formData, start_time: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" /></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">End Time</label><input type="time" value={formData.end_time} onChange={(e) => setFormData({...formData, end_time: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" /></div>
              </div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Location</label><input type="text" value={formData.location} onChange={(e) => setFormData({...formData, location: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Description</label><textarea value={formData.description} onChange={(e) => setFormData({...formData, description: e.target.value})} rows="3" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" /></div>
              <div className="flex space-x-3 pt-2">
                <button onClick={() => setEditing(false)} className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-50 transition">Cancel</button>
                <button onClick={handleSave} disabled={loading} className="flex-1 bg-teal-600 text-white py-2 rounded-lg hover:bg-teal-700 transition disabled:opacity-50">{loading ? 'Saving...' : 'Save'}</button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center space-x-3 text-sm"><CalendarIcon size={16} className="text-gray-400" /><span>{new Date(event.event_date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span></div>
              {(event.start_time || event.end_time) && <div className="flex items-center space-x-3 text-sm"><Clock size={16} className="text-gray-400" /><span>{event.start_time}{event.end_time ? ` - ${event.end_time}` : ''}</span></div>}
              {event.location && <div className="flex items-center space-x-3 text-sm"><MapPin size={16} className="text-gray-400" /><span>{event.location}</span></div>}
              {event.is_recurring && <div className="flex items-center space-x-3 text-sm"><Repeat size={16} className="text-gray-400" /><span className="text-gray-500">Recurring event</span></div>}
              {event.description && <div className="mt-3 p-3 bg-gray-50 rounded-lg text-sm text-gray-900">{event.description}</div>}
              <div className="flex space-x-3 pt-4 border-t border-gray-200">
                <button onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-50 transition">Close</button>
                <button onClick={() => setEditing(true)} className="flex-1 bg-teal-600 text-white py-2 rounded-lg hover:bg-teal-700 transition flex items-center justify-center space-x-1"><Edit2 size={16} /><span>Edit</span></button>
                <button onClick={handleDelete} className="flex-1 bg-red-600 text-white py-2 rounded-lg hover:bg-red-700 transition flex items-center justify-center space-x-1"><Trash2 size={16} /><span>Delete</span></button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// COACH SLOTS WEEK VIEW
// ============================================

function CoachSlotsWeekView({ selectedDate, slots, reservations, coach, userId, userRole, onReserve, onConfirm, onDecline }) {
  const startOfWeek = new Date(selectedDate);
  startOfWeek.setDate(selectedDate.getDate() - selectedDate.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  const weekDays = [];
  for (let i = 0; i < 7; i++) { const d = new Date(startOfWeek); d.setDate(startOfWeek.getDate() + i); weekDays.push(d); }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const isOwnSlots = coach.id === userId;

  const formatTime = (time) => {
    if (!time) return '';
    const [h, m] = time.split(':');
    const hour = parseInt(h);
    return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
  };
  const getEndTime = (startTime, mins) => {
    if (!startTime) return '';
    const [h, m] = startTime.split(':').map(Number);
    const total = h * 60 + m + mins;
    return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  };

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="grid grid-cols-7 divide-x divide-gray-200">
        {weekDays.map((date, idx) => {
          const dateStr = date.toISOString().split('T')[0];
          const daySlots = slots.filter(s => s.slot_date === dateStr);
          const isToday = date.getTime() === today.getTime();
          return (
            <div key={idx} className="min-h-[400px] bg-white">
              <div className={`p-3 border-b border-gray-200 text-center ${isToday ? 'bg-teal-50' : 'bg-gray-50'}`}>
                <div className="text-xs font-medium text-gray-600">{date.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                <div className={`text-lg font-semibold ${isToday ? 'text-teal-600' : 'text-gray-900'}`}>{date.getDate()}</div>
              </div>
              <div className="p-2 space-y-2">
                {daySlots.map((slot, si) => {
                  const slotRes = reservations.filter(r => r.slot_id === slot.id && r.slot_date === dateStr && r.status !== 'cancelled');
                  const isBooked = slotRes.length >= (slot.max_players || 1);
                  const userRes = slotRes.find(r => r.player_id === userId);
                  const endTime = getEndTime(slot.start_time, slot.duration_minutes);
                  return (
                    <div key={`${slot.id}-${si}`} className={`p-2 rounded-lg border text-xs ${isBooked ? 'bg-gray-100 border-gray-200' : 'bg-teal-50 border-teal-200'}`}>
                      <div className="font-semibold text-gray-900">{formatTime(slot.start_time)} - {formatTime(endTime)}</div>
                      <div className="text-gray-500">{slot.duration_minutes} min</div>
                      {slot.notes && <div className="text-gray-500 mt-1 truncate">{slot.notes}</div>}
                      {isOwnSlots && slotRes.map(res => (
                        <div key={res.id} className="mt-2 p-2 bg-white rounded border">
                          <div className="font-medium text-gray-900">{res.users?.full_name}</div>
                          {res.player_note && <div className="text-gray-500 mt-1">{res.player_note}</div>}
                          <div className={`inline-block px-2 py-0.5 rounded-full text-xs mt-1 ${res.status === 'confirmed' ? 'bg-green-100 text-green-700' : res.status === 'pending' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>{res.status}</div>
                          {res.status === 'pending' && (
                            <div className="flex space-x-1 mt-2">
                              <button onClick={() => onConfirm(res.id)} className="flex-1 bg-green-600 text-white py-1 rounded text-xs hover:bg-green-700">Confirm</button>
                              <button onClick={() => onDecline(res.id)} className="flex-1 bg-red-600 text-white py-1 rounded text-xs hover:bg-red-700">Decline</button>
                            </div>
                          )}
                        </div>
                      ))}
                      {!isOwnSlots && userRole === 'player' && !userRes && !isBooked && (
                        <button onClick={() => onReserve({ ...slot, slot_date: dateStr })} className="mt-2 w-full bg-teal-600 text-white py-1 rounded text-xs hover:bg-teal-700 transition">Reserve</button>
                      )}
                      {userRes && <div className={`mt-1 text-xs font-medium ${userRes.status === 'confirmed' ? 'text-green-600' : userRes.status === 'pending' ? 'text-yellow-600' : 'text-red-600'}`}>{userRes.status === 'confirmed' ? 'Confirmed' : userRes.status === 'pending' ? 'Pending' : 'Declined'}</div>}
                      {!isOwnSlots && isBooked && !userRes && <div className="mt-1 text-xs text-gray-400">Fully booked</div>}
                    </div>
                  );
                })}
                {daySlots.length === 0 && <div className="text-center py-4 text-gray-400 text-xs">No slots</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================
// CREATE SLOT PANEL
// ============================================

function CreateSlotPanel({ onClose, onSuccess, userId }) {
  const [slotDate, setSlotDate] = useState(new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState('09:00');
  const [duration, setDuration] = useState(60);
  const [autoConfirm, setAutoConfirm] = useState(false);
  const [repeatWeekly, setRepeatWeekly] = useState(false);
  const [repeatEndDate, setRepeatEndDate] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(1);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.from('training_slots').insert({
        coach_id: userId, slot_date: slotDate, start_time: startTime, duration_minutes: duration,
        auto_confirm: autoConfirm, is_recurring: repeatWeekly, repeat_weekly: repeatWeekly,
        repeat_end_date: repeatWeekly && repeatEndDate ? repeatEndDate : null, max_players: maxPlayers, notes: notes || null
      });
      if (error) throw error;
      onSuccess();
    } catch (err) { alert('Error creating slot: ' + err.message); } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="border-b border-gray-200 p-6 flex items-center justify-between">
          <h3 className="text-xl font-bold text-gray-900">Create Training Slot</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={24} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Date</label><input type="date" value={slotDate} onChange={(e) => setSlotDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label><input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Duration</label><select value={duration} onChange={(e) => setDuration(parseInt(e.target.value))} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>60 min</option><option value={90}>90 min</option></select></div>
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Max Players</label><input type="number" min="1" max="10" value={maxPlayers} onChange={(e) => setMaxPlayers(parseInt(e.target.value) || 1)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" /></div>
          <div className="flex items-center space-x-3"><input type="checkbox" id="autoConfirm" checked={autoConfirm} onChange={(e) => setAutoConfirm(e.target.checked)} className="rounded" /><label htmlFor="autoConfirm" className="text-sm text-gray-700">Auto-confirm reservations</label></div>
          <div className="flex items-center space-x-3"><input type="checkbox" id="repeatWeekly" checked={repeatWeekly} onChange={(e) => setRepeatWeekly(e.target.checked)} className="rounded" /><label htmlFor="repeatWeekly" className="text-sm text-gray-700">Repeat weekly</label></div>
          {repeatWeekly && <div><label className="block text-sm font-medium text-gray-700 mb-1">Repeat until</label><input type="date" value={repeatEndDate} onChange={(e) => setRepeatEndDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" /></div>}
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g., Hitting session, Pitching mechanics" rows="2" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" /></div>
          <div className="flex space-x-3 pt-2">
            <button onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-50 transition">Cancel</button>
            <button onClick={handleSave} disabled={loading} className="flex-1 bg-teal-600 text-white py-2 rounded-lg hover:bg-teal-700 transition disabled:opacity-50">{loading ? 'Creating...' : 'Create Slot'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// RESERVE SLOT MODAL
// ============================================

function ReserveSlotModal({ slot, coach, onClose, onSuccess }) {
  const [playerNote, setPlayerNote] = useState('');
  const [loading, setLoading] = useState(false);

  const formatTime = (time) => {
    if (!time) return '';
    const [h, m] = time.split(':');
    const hour = parseInt(h);
    return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
  };

  const handleReserve = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const status = slot.auto_confirm ? 'confirmed' : 'pending';
      const { error } = await supabase.from('slot_reservations').insert({
        slot_id: slot.id, player_id: user.id, slot_date: slot.slot_date, status,
        player_note: playerNote || null, confirmed_at: slot.auto_confirm ? new Date().toISOString() : null
      });
      if (error) throw error;
      alert(slot.auto_confirm ? 'Reservation confirmed!' : 'Reservation submitted! Waiting for coach confirmation.');
      onSuccess();
    } catch (err) { alert('Error: ' + err.message); } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="border-b border-gray-200 p-6 flex items-center justify-between">
          <h3 className="text-xl font-bold text-gray-900">Reserve Training Slot</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={24} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="bg-teal-50 rounded-lg p-4">
            <div className="text-sm font-semibold text-teal-900">{coach?.full_name}</div>
            {coach?.title && <div className="text-xs text-teal-600">{coach.title}</div>}
            <div className="mt-2 text-sm text-gray-700">
              <div>{new Date(slot.slot_date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
              <div>{formatTime(slot.start_time)} - {slot.duration_minutes} min</div>
            </div>
            {slot.notes && <div className="mt-2 text-xs text-gray-500">{slot.notes}</div>}
          </div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">What would you like to work on? (optional)</label><textarea value={playerNote} onChange={(e) => setPlayerNote(e.target.value)} placeholder="e.g., I want to work on my swing mechanics" rows="3" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" /></div>
          {slot.auto_confirm && <div className="flex items-center space-x-2 text-sm text-green-600"><Check size={16} /><span>This slot auto-confirms reservations</span></div>}
          <div className="flex space-x-3 pt-2">
            <button onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-50 transition">Cancel</button>
            <button onClick={handleReserve} disabled={loading} className="flex-1 bg-teal-600 text-white py-2 rounded-lg hover:bg-teal-700 transition disabled:opacity-50">{loading ? 'Reserving...' : 'Reserve'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
