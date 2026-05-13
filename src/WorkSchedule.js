import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus, X, Edit2, Trash2, MapPin, Building, UserCheck } from 'lucide-react';
import { fmtLocalDate, expandRecurringEvents } from './scheduleUtils';

function startOfWeek(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function formatTimeFromTS(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatTimeFromHHMM(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hour = parseInt(h);
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function dateToInputValue(iso) {
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60 * 1000).toISOString().slice(0, 16);
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function WorkSchedule({ userId, userRole }) {
  const isAdmin = userRole === 'admin';
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [staffEvents, setStaffEvents] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [facilityEvents, setFacilityEvents] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);

  const [viewMode, setViewMode] = useState('week');
  const [selectedDay, setSelectedDay] = useState(() => new Date());

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const weekEnd = addDays(weekStart, 7);
    const startStr = fmtLocalDate(weekStart);
    const endStr = fmtLocalDate(addDays(weekStart, 6));

    const [evRes, asgRes, facNonRec, facMasters, facEx, staffRes] = await Promise.all([
      supabase.from('staff_schedule_events').select('*').gte('start_at', weekStart.toISOString()).lt('start_at', weekEnd.toISOString()).order('start_at'),
      supabase.from('staff_schedule_assignments').select('id, event_id, user_id, role, user:user_id(full_name, avatar_url)'),
      supabase.from('facility_events').select('*').eq('is_recurring', false).is('recurrence_parent_id', null).gte('event_date', startStr).lte('event_date', endStr),
      supabase.from('facility_events').select('*').eq('is_recurring', true).is('recurrence_parent_id', null),
      supabase.from('facility_events').select('*').not('recurrence_parent_id', 'is', null).gte('event_date', startStr).lte('event_date', endStr),
      supabase.from('users').select('id, full_name, avatar_url, role').in('role', ['admin', 'coach']).order('full_name'),
    ]);

    if (evRes.error) console.error(evRes.error); else setStaffEvents(evRes.data || []);
    if (asgRes.error) console.error(asgRes.error); else setAssignments(asgRes.data || []);
    if (staffRes.error) console.error(staffRes.error); else setStaff(staffRes.data || []);

    const expanded = expandRecurringEvents(facMasters.data || [], facEx.data || [], weekStart, addDays(weekStart, 6));
    setFacilityEvents([...(facNonRec.data || []), ...expanded]);

    setLoading(false);
  }, [weekStart]);

  useEffect(() => {
    fetchAll();
    const ch1 = supabase.channel('work-sched-events').on('postgres_changes', { event: '*', schema: 'public', table: 'staff_schedule_events' }, () => fetchAll()).subscribe();
    const ch2 = supabase.channel('work-sched-asg').on('postgres_changes', { event: '*', schema: 'public', table: 'staff_schedule_assignments' }, () => fetchAll()).subscribe();
    return () => { supabase.removeChannel(ch1); supabase.removeChannel(ch2); };
  }, [fetchAll]);

  const goPrev = () => {
    if (viewMode === 'day') {
      const nd = addDays(selectedDay, -1);
      setSelectedDay(nd);
      if (fmtLocalDate(nd) < fmtLocalDate(weekStart)) setWeekStart(startOfWeek(nd));
    } else {
      setWeekStart(addDays(weekStart, -7));
    }
  };
  const goNext = () => {
    if (viewMode === 'day') {
      const nd = addDays(selectedDay, 1);
      setSelectedDay(nd);
      if (fmtLocalDate(nd) > fmtLocalDate(addDays(weekStart, 6))) setWeekStart(startOfWeek(nd));
    } else {
      setWeekStart(addDays(weekStart, 7));
    }
  };
  const goToday = () => {
    setWeekStart(startOfWeek(new Date()));
    setSelectedDay(new Date());
  };

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const myAssignedEventIds = new Set(assignments.filter(a => a.user_id === userId).map(a => a.event_id));
  const assignmentsByEvent = assignments.reduce((acc, a) => {
    (acc[a.event_id] = acc[a.event_id] || []).push(a);
    return acc;
  }, {});

  const eventsByDay = (date) => {
    const dayStr = fmtLocalDate(date);
    const items = [];
    staffEvents
      .filter(e => fmtLocalDate(new Date(e.start_at)) === dayStr)
      .forEach(e => items.push({ kind: 'staff', e, time: e.start_at }));
    facilityEvents
      .filter(f => f.event_date === dayStr)
      .forEach(f => items.push({ kind: 'facility', e: f, time: f.start_time || '00:00' }));
    items.sort((a, b) => String(a.time).localeCompare(String(b.time)));
    return items;
  };

  const staffHoursByDay = (date) => {
    const dayStr = fmtLocalDate(date);
    const totals = {};
    staffEvents
      .filter(e => fmtLocalDate(new Date(e.start_at)) === dayStr)
      .forEach(e => {
        const hours = Math.max(0, (new Date(e.end_at) - new Date(e.start_at)) / 3600000);
        const evAssigns = assignmentsByEvent[e.id] || [];
        evAssigns.forEach(a => {
          const key = a.user_id;
          if (!totals[key]) totals[key] = { name: a.user?.full_name || 'Unknown', hours: 0 };
          totals[key].hours += hours;
        });
      });
    return Object.values(totals).sort((a, b) => a.name.localeCompare(b.name));
  };

  const weekRangeLabel = (() => {
    const a = weekStart;
    const b = addDays(weekStart, 6);
    const sameMonth = a.getMonth() === b.getMonth();
    const opts = { month: 'short', day: 'numeric' };
    return `${a.toLocaleDateString('en-US', opts)} – ${b.toLocaleDateString('en-US', { ...opts, month: sameMonth ? undefined : 'short', year: 'numeric' })}`;
  })();

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow p-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center space-x-2">
          <button onClick={goPrev} className="p-2 hover:bg-gray-100 rounded-lg" title="Previous week"><ChevronLeft size={18} /></button>
          <button onClick={goToday} className="px-3 py-1.5 text-sm font-medium bg-gray-100 hover:bg-gray-200 rounded-lg">Today</button>
          <button onClick={goNext} className="p-2 hover:bg-gray-100 rounded-lg" title="Next week"><ChevronRight size={18} /></button>
          <h3 className="text-lg font-semibold text-gray-900 ml-2">
            {viewMode === 'day'
              ? selectedDay.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
              : weekRangeLabel}
          </h3>
        </div>
        <div className="flex items-center space-x-3">
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('week')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition ${viewMode === 'week' ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'}`}
            >
              Week
            </button>
            <button
              onClick={() => { setViewMode('day'); setSelectedDay(new Date()); }}
              className={`px-3 py-1 text-xs font-medium rounded-md transition ${viewMode === 'day' ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'}`}
            >
              Day
            </button>
          </div>
          <div className="hidden md:flex items-center space-x-3 text-xs text-gray-600">
            <span className="flex items-center space-x-1"><span className="w-3 h-3 rounded bg-indigo-500 inline-block" /><span>Staff</span></span>
            <span className="flex items-center space-x-1"><span className="w-3 h-3 rounded bg-purple-500 inline-block" /><span>Facility</span></span>
            <span className="flex items-center space-x-1"><UserCheck size={12} className="text-indigo-600" /><span>Assigned to you</span></span>
          </div>
          {isAdmin && (
            <button
              onClick={() => { setEditing(null); setShowForm(true); }}
              className="flex items-center space-x-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition text-sm font-medium"
            >
              <Plus size={16} />
              <span>New event</span>
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">Loading...</div>
      ) : viewMode === 'day' ? (
        <DailyTimeline
          day={selectedDay}
          staffEvents={staffEvents}
          facilityEvents={facilityEvents}
          staff={staff}
          assignments={assignments}
          assignmentsByEvent={assignmentsByEvent}
          myAssignedEventIds={myAssignedEventIds}
          onSelectEvent={setSelectedEvent}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
          {days.map((day, idx) => {
            const items = eventsByDay(day);
            const isToday = fmtLocalDate(day) === fmtLocalDate(new Date());
            return (
              <div key={idx} className={`bg-white rounded-lg shadow min-h-[120px] flex flex-col ${isToday ? 'ring-2 ring-indigo-300' : ''}`}>
                <div className={`p-2 border-b ${isToday ? 'bg-indigo-50' : 'bg-gray-50'}`}>
                  <p className="text-xs font-medium text-gray-500 uppercase">{DAY_LABELS[day.getDay()]}</p>
                  <p className={`text-lg font-bold ${isToday ? 'text-indigo-700' : 'text-gray-900'}`}>{day.getDate()}</p>
                </div>
                <div className="p-2 space-y-1.5 flex-1">
                  {items.length === 0 && <p className="text-xs text-gray-300 text-center py-3">—</p>}
                  {items.map((it, i) => {
                    if (it.kind === 'facility') {
                      return (
                        <div key={`f-${it.e.id}-${i}`} className="rounded-md p-2 bg-purple-50 border-l-2 border-purple-400 text-xs cursor-default">
                          <div className="flex items-center space-x-1 text-purple-700 font-medium">
                            <Building size={11} />
                            <span className="truncate flex-1">{it.e.title || 'Facility event'}</span>
                          </div>
                          {it.e.start_time && (
                            <p className="text-purple-600 mt-0.5">
                              {formatTimeFromHHMM(it.e.start_time)}
                              {it.e.end_time && ` – ${formatTimeFromHHMM(it.e.end_time)}`}
                            </p>
                          )}
                          {it.e.location && <p className="text-gray-600 truncate">{it.e.location}</p>}
                        </div>
                      );
                    }
                    const assigned = myAssignedEventIds.has(it.e.id);
                    const eventAssigns = assignmentsByEvent[it.e.id] || [];
                    return (
                      <button
                        key={`s-${it.e.id}`}
                        onClick={() => setSelectedEvent(it.e)}
                        className={`w-full text-left rounded-md p-2 border-l-2 text-xs hover:shadow-sm transition ${
                          assigned ? 'bg-indigo-100 border-indigo-600' : 'bg-indigo-50 border-indigo-400'
                        }`}
                      >
                        <div className="flex items-center space-x-1 text-indigo-700 font-medium">
                          {assigned && <UserCheck size={11} />}
                          <span className="truncate flex-1">{it.e.title}</span>
                        </div>
                        <p className="text-indigo-600 mt-0.5">
                          {formatTimeFromTS(it.e.start_at)} – {formatTimeFromTS(it.e.end_at)}
                        </p>
                        {it.e.location && <p className="text-gray-600 truncate">{it.e.location}</p>}
                        {eventAssigns.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {eventAssigns.slice(0, 4).map(a => (
                              <span
                                key={a.id}
                                className="inline-flex items-center bg-white text-indigo-700 px-1.5 py-0.5 rounded border border-indigo-200 truncate max-w-[88px] text-[10px]"
                                title={a.user?.full_name || 'Unknown'}
                              >
                                {(a.user?.full_name || '?').split(' ')[0]}
                              </span>
                            ))}
                            {eventAssigns.length > 4 && (
                              <span className="text-[10px] text-gray-500 self-center">+{eventAssigns.length - 4}</span>
                            )}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
                {(() => {
                  const summary = staffHoursByDay(day);
                  if (summary.length === 0) return null;
                  return (
                    <div className="border-t border-gray-100 px-2 py-1.5 bg-gray-50/60">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Staff hours</p>
                      <div className="space-y-0.5">
                        {summary.map(s => (
                          <div key={s.name} className="flex items-center justify-between text-[11px] text-gray-700">
                            <span className="truncate pr-1">{s.name}</span>
                            <span className="font-semibold tabular-nums">{(Math.round(s.hours * 10) / 10).toString().replace(/\.0$/, '')}h</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}

      {selectedEvent && (
        <EventDetailModal
          event={selectedEvent}
          assignments={assignmentsByEvent[selectedEvent.id] || []}
          isAdmin={isAdmin}
          onClose={() => setSelectedEvent(null)}
          onEdit={() => { setEditing(selectedEvent); setShowForm(true); setSelectedEvent(null); }}
          onDeleted={() => { setSelectedEvent(null); fetchAll(); }}
        />
      )}

      {showForm && (
        <EventFormModal
          editing={editing}
          staff={staff}
          existingAssignments={editing ? (assignmentsByEvent[editing.id] || []) : []}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); fetchAll(); }}
          createdBy={userId}
        />
      )}
    </div>
  );
}

function DailyTimeline({ day, staffEvents, facilityEvents, staff, assignments, assignmentsByEvent, myAssignedEventIds, onSelectEvent }) {
  const dayStr = fmtLocalDate(day);
  const START_HOUR = 6;
  const END_HOUR = 22;
  const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);
  const HOUR_HEIGHT = 60;

  const dayStaffEvents = staffEvents.filter(e => fmtLocalDate(new Date(e.start_at)) === dayStr);
  const dayFacilityEvents = facilityEvents.filter(f => f.event_date === dayStr);

  const staffWithEvents = {};
  dayStaffEvents.forEach(ev => {
    const evAssigns = assignmentsByEvent[ev.id] || [];
    if (evAssigns.length === 0) {
      const key = '__unassigned__';
      if (!staffWithEvents[key]) staffWithEvents[key] = { name: 'Unassigned', avatar_url: null, events: [] };
      staffWithEvents[key].events.push(ev);
    } else {
      evAssigns.forEach(a => {
        const key = a.user_id;
        if (!staffWithEvents[key]) staffWithEvents[key] = { name: a.user?.full_name || 'Unknown', avatar_url: a.user?.avatar_url, events: [] };
        staffWithEvents[key].events.push(ev);
      });
    }
  });

  const staffRows = staff.map(s => ({
    id: s.id,
    name: s.full_name,
    avatar_url: s.avatar_url,
    events: staffWithEvents[s.id]?.events || [],
  }));

  const scheduledCount = staffRows.filter(r => r.events.length > 0).length;
  const unscheduledCount = staffRows.length - scheduledCount;

  const getPosition = (startISO, endISO) => {
    const s = new Date(startISO);
    const e = new Date(endISO);
    const startMin = s.getHours() * 60 + s.getMinutes();
    const endMin = e.getHours() * 60 + e.getMinutes();
    const top = Math.max(0, (startMin - START_HOUR * 60)) * (HOUR_HEIGHT / 60);
    const height = Math.max(HOUR_HEIGHT / 4, (endMin - startMin) * (HOUR_HEIGHT / 60));
    return { top, height };
  };

  const isToday = fmtLocalDate(day) === fmtLocalDate(new Date());
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowTop = (nowMin - START_HOUR * 60) * (HOUR_HEIGHT / 60);
  const showNowLine = isToday && nowMin >= START_HOUR * 60 && nowMin <= END_HOUR * 60;

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-[700px]">
          {/* Header row with staff names */}
          <div className="flex border-b border-gray-200 bg-gray-50 sticky top-0 z-10">
            <div className="w-16 flex-shrink-0 p-2 text-xs font-semibold text-gray-500 border-r border-gray-200">Time</div>
            {staffRows.map(row => (
              <div key={row.id} className="flex-1 min-w-[120px] p-2 border-r border-gray-100 text-center">
                <div className="flex flex-col items-center">
                  {row.avatar_url ? (
                    <img src={row.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover mb-1" />
                  ) : (
                    <div className="w-7 h-7 bg-indigo-600 rounded-full flex items-center justify-center text-white text-xs font-bold mb-1">
                      {row.name.charAt(0)}
                    </div>
                  )}
                  <span className="text-xs font-medium text-gray-700 truncate max-w-[100px]">{row.name.split(' ')[0]}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Timeline body */}
          <div className="flex relative" style={{ height: HOURS.length * HOUR_HEIGHT }}>
            {/* Time labels */}
            <div className="w-16 flex-shrink-0 border-r border-gray-200 relative">
              {HOURS.map(h => (
                <div key={h} className="absolute w-full text-right pr-2 text-[10px] text-gray-400 -translate-y-1/2" style={{ top: (h - START_HOUR) * HOUR_HEIGHT }}>
                  {h % 12 || 12}{h >= 12 ? 'p' : 'a'}
                </div>
              ))}
            </div>

            {/* Staff columns */}
            {staffRows.map(row => (
              <div key={row.id} className="flex-1 min-w-[120px] border-r border-gray-100 relative">
                {/* Hour grid lines */}
                {HOURS.map(h => (
                  <div key={h} className="absolute w-full border-t border-gray-100" style={{ top: (h - START_HOUR) * HOUR_HEIGHT }} />
                ))}
                {/* Event blocks */}
                {row.events.map(ev => {
                  const { top, height } = getPosition(ev.start_at, ev.end_at);
                  const assigned = myAssignedEventIds.has(ev.id);
                  const durationH = (new Date(ev.end_at) - new Date(ev.start_at)) / 3600000;
                  return (
                    <button
                      key={ev.id}
                      onClick={() => onSelectEvent(ev)}
                      className={`absolute left-1 right-1 rounded-md px-1.5 py-0.5 text-[10px] overflow-hidden hover:shadow-md transition z-[5] ${
                        assigned ? 'bg-indigo-200 border border-indigo-400 text-indigo-800' : 'bg-indigo-100 border border-indigo-300 text-indigo-700'
                      }`}
                      style={{ top, height: Math.max(height, 20) }}
                      title={`${ev.title} (${Math.round(durationH * 10) / 10}h)`}
                    >
                      <div className="font-medium truncate">{ev.title}</div>
                      {height > 30 && (
                        <div className="text-indigo-500 truncate">
                          {formatTimeFromTS(ev.start_at)} – {formatTimeFromTS(ev.end_at)}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}

            {/* Now line */}
            {showNowLine && (
              <div className="absolute left-0 right-0 z-20 flex items-center pointer-events-none" style={{ top: nowTop }}>
                <div className="w-2 h-2 bg-red-500 rounded-full -ml-1" />
                <div className="flex-1 border-t-2 border-red-500" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Summary footer */}
      <div className="border-t border-gray-200 p-3 bg-gray-50 flex items-center justify-between text-xs text-gray-600">
        <div className="flex items-center space-x-4">
          <span className="flex items-center space-x-1">
            <span className="w-2.5 h-2.5 rounded bg-indigo-500 inline-block" />
            <span>{scheduledCount} scheduled</span>
          </span>
          <span className="text-gray-400">{unscheduledCount} unscheduled</span>
        </div>
        {dayFacilityEvents.length > 0 && (
          <div className="flex items-center space-x-1 text-purple-600">
            <Building size={12} />
            <span>{dayFacilityEvents.length} facility event{dayFacilityEvents.length !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function EventDetailModal({ event, assignments, isAdmin, onClose, onEdit, onDeleted }) {
  const handleDelete = async () => {
    if (!window.confirm(`Delete "${event.title}"?`)) return;
    const { error } = await supabase.from('staff_schedule_events').delete().eq('id', event.id);
    if (error) { alert('Delete failed: ' + error.message); return; }
    onDeleted();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-lg font-semibold text-gray-900">{event.title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex items-center space-x-2 text-sm text-gray-700">
            <CalendarIcon size={16} className="text-gray-400" />
            <span>
              {new Date(event.start_at).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}
              {' · '}{formatTimeFromTS(event.start_at)} – {formatTimeFromTS(event.end_at)}
            </span>
          </div>
          {event.location && (
            <div className="flex items-center space-x-2 text-sm text-gray-700">
              <MapPin size={16} className="text-gray-400" />
              <span>{event.location}</span>
            </div>
          )}
          {event.description && (
            <div className="text-sm text-gray-700 whitespace-pre-wrap">{event.description}</div>
          )}
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase mb-2">Assigned staff ({assignments.length})</p>
            {assignments.length === 0 ? (
              <p className="text-sm text-gray-500">No one assigned.</p>
            ) : (
              <div className="space-y-1.5">
                {assignments.map(a => (
                  <div key={a.id} className="flex items-center space-x-2 text-sm">
                    {a.user?.avatar_url ? (
                      <img src={a.user.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover" />
                    ) : (
                      <div className="w-6 h-6 bg-indigo-600 rounded-full flex items-center justify-center text-white text-xs font-bold">
                        {a.user?.full_name?.charAt(0) || '?'}
                      </div>
                    )}
                    <span className="text-gray-900">{a.user?.full_name || 'Unknown'}</span>
                    {a.role && <span className="text-xs text-gray-500">· {a.role}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        {isAdmin && (
          <div className="flex justify-end space-x-2 p-4 border-t bg-gray-50">
            <button
              onClick={handleDelete}
              className="px-3 py-1.5 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition flex items-center space-x-1"
            >
              <Trash2 size={14} />
              <span>Delete</span>
            </button>
            <button
              onClick={onEdit}
              className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition flex items-center space-x-1"
            >
              <Edit2 size={14} />
              <span>Edit</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function EventFormModal({ editing, staff, existingAssignments, onClose, onSaved, createdBy }) {
  const [title, setTitle] = useState(editing?.title || '');
  const [description, setDescription] = useState(editing?.description || '');
  const [startAt, setStartAt] = useState(editing ? dateToInputValue(editing.start_at) : '');
  const [endAt, setEndAt] = useState(editing ? dateToInputValue(editing.end_at) : '');
  const [location, setLocation] = useState(editing?.location || '');
  const [assignedIds, setAssignedIds] = useState(existingAssignments.map(a => a.user_id));
  const [saving, setSaving] = useState(false);

  const toggleAssign = (id) => {
    setAssignedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleSave = async () => {
    if (!title.trim()) { alert('Title is required.'); return; }
    if (!startAt || !endAt) { alert('Start and end times are required.'); return; }
    if (new Date(endAt) < new Date(startAt)) { alert('End time must be on or after start time.'); return; }
    setSaving(true);

    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      start_at: new Date(startAt).toISOString(),
      end_at: new Date(endAt).toISOString(),
      location: location.trim() || null,
    };

    let eventId = editing?.id;

    if (editing) {
      const { error } = await supabase.from('staff_schedule_events').update(payload).eq('id', editing.id);
      if (error) { alert('Save failed: ' + error.message); setSaving(false); return; }
    } else {
      const { data, error } = await supabase
        .from('staff_schedule_events')
        .insert({ ...payload, created_by: createdBy })
        .select('id')
        .single();
      if (error) { alert('Save failed: ' + error.message); setSaving(false); return; }
      eventId = data.id;
    }

    const existingIds = existingAssignments.map(a => a.user_id);
    const toAdd = assignedIds.filter(id => !existingIds.includes(id));
    const toRemove = existingAssignments.filter(a => !assignedIds.includes(a.user_id));

    if (toAdd.length > 0) {
      const { error } = await supabase
        .from('staff_schedule_assignments')
        .insert(toAdd.map(uid => ({ event_id: eventId, user_id: uid })));
      if (error) { console.error('Add assignment error:', error); }
    }
    if (toRemove.length > 0) {
      const { error } = await supabase
        .from('staff_schedule_assignments')
        .delete()
        .in('id', toRemove.map(a => a.id));
      if (error) { console.error('Remove assignment error:', error); }
    }

    setSaving(false);
    onSaved();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-lg font-semibold text-gray-900">{editing ? 'Edit event' : 'New staff event'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. All-staff meeting"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start</label>
              <input
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End</label>
              <input
                type="datetime-local"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Location (optional)</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Assign staff</label>
            <div className="border border-gray-300 rounded-lg max-h-48 overflow-y-auto divide-y divide-gray-100">
              {staff.map(s => (
                <label key={s.id} className="flex items-center space-x-2 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={assignedIds.includes(s.id)}
                    onChange={() => toggleAssign(s.id)}
                    className="rounded"
                  />
                  <span className="text-sm text-gray-900">{s.full_name}</span>
                  <span className="text-xs text-gray-500">({s.role})</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-1">{assignedIds.length} selected</p>
          </div>
        </div>
        <div className="flex justify-end space-x-2 p-4 border-t bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:text-gray-900 transition">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
          >
            {saving ? 'Saving...' : editing ? 'Save changes' : 'Create event'}
          </button>
        </div>
      </div>
    </div>
  );
}
