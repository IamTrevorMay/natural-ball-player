import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from './supabaseClient';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus, X, Users, User, UserCheck, Dumbbell, Utensils, Trash2, Edit2, Building, MapPin, AlignLeft, Repeat, Clock, Check, ClipboardList, Apple, Search, ExternalLink, CheckSquare, Copy } from 'lucide-react';
import { fmtLocalDate, expandRecurringEvents, monthWeekRange } from './scheduleUtils';
import CalendarContextMenu from './CalendarContextMenu';
import RecurrenceDecisionModal from './RecurrenceDecisionModal';
import CopyToPickerModal from './CopyToPickerModal';
import ProgramLibrarySidebar, { compareTemplates } from './ProgramLibrarySidebar';
import { formatUserError } from './errorMessage';
import { useModalTracking, trackAction } from './usage';

// Format a time string (e.g. "14:00" or "2:30 PM") to 12-hour AM/PM
function formatTimeDisplay(time) {
  if (!time) return '';
  // Already has AM/PM — return as-is
  if (/[ap]m/i.test(time)) return time;
  const parts = time.match(/^(\d{1,2}):(\d{2})/);
  if (!parts) return time;
  const h = parseInt(parts[1], 10);
  const m = parts[2];
  return `${h % 12 || 12}:${m} ${h >= 12 ? 'PM' : 'AM'}`;
}

// Get the week range label for a given date (e.g. "May 12 – May 18, 2026")
function getWeekRangeLabel(date) {
  const start = new Date(date);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const opts = { month: 'short', day: 'numeric' };
  if (start.getMonth() === end.getMonth()) {
    return `${start.toLocaleDateString('en-US', opts)} – ${end.getDate()}, ${end.getFullYear()}`;
  }
  // Across a year boundary (Dec → Jan) show the start year too.
  if (start.getFullYear() !== end.getFullYear()) {
    const optsY = { month: 'short', day: 'numeric', year: 'numeric' };
    return `${start.toLocaleDateString('en-US', optsY)} – ${end.toLocaleDateString('en-US', optsY)}`;
  }
  return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}, ${end.getFullYear()}`;
}

// Categorize workout events by title for color-coding
function getWorkoutCategory(title) {
  const t = (title || '').toLowerCase();
  if (t.includes('pitch') || t.includes('throw') || t.includes('mound') || t.includes('bullpen') || t.includes('long toss') || t.includes('velo') || t.includes('pen ') || t.includes(' pen')) return 'pitching';
  if (t.includes('hit') || t.includes('tee') || t.includes('bp ') || t.includes('batting') || t.includes('swing') || t.includes(' bp')) return 'hitting';
  if (t.includes('warm') || t.includes('mobil') || t.includes('stretch') || t.includes('cars') || t.includes('foam') || t.includes('band') || t.includes('recovery') || t.includes('yoga') || t.includes('cool')) return 'warmup';
  return 'general';
}

// Map a ProgramLibrarySidebar folder name to the canonical category we store on
// schedule_events.category so calendar tiles inherit the source-library color.
// Keep in sync with FOLDER_COLORS in ProgramLibrarySidebar.js (#191).
export function folderToCategory(folder) {
  if (!folder) return null;
  const f = String(folder).toLowerCase();
  if (f === 'hitting') return 'hitting';
  if (f === 'pitching') return 'pitching';
  if (['catching', 'infield', 'outfield', 'submarine', 'football'].includes(f)) return 'fielding';
  if (['strength', 'body builder', 'college', 'high school', 'pro', 'youth', 'youth weighted'].includes(f)) return 'strength';
  if (['recovery', 'rehab', 'meals'].includes(f)) return 'recovery';
  if (f === 'warmup') return 'warmup';
  if (f === 'cardio') return 'conditioning';
  return null;
}

function expandMealPlanAssignments(assignments, startOfMonth, endOfMonth) {
  const events = [];
  for (const a of assignments) {
    const planName = a.meal_plans?.name || 'Meal Plan';
    const aStart = new Date(a.start_date + 'T00:00:00');
    const aEnd = a.end_date ? new Date(a.end_date + 'T00:00:00') : null;
    const from = aStart > startOfMonth ? aStart : startOfMonth;
    const to = aEnd && aEnd < endOfMonth ? aEnd : endOfMonth;
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      events.push({
        id: `mpa-${a.id}-${fmtLocalDate(d)}`,
        event_type: 'meal',
        event_date: fmtLocalDate(d),
        title: planName,
        player_id: a.player_id,
        _isMealPlan: true,
      });
    }
  }
  return events;
}

export default function Schedule({ userId, userRole }) {
  const [view, setView] = useState(userRole === 'player' ? 'my-schedule' : 'facility');
  const [myScheduleEvents, setMyScheduleEvents] = useState([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [viewMode, setViewMode] = useState(userRole === 'player' ? 'month' : 'lanes');
  const [teams, setTeams] = useState([]);
  const [players, setPlayers] = useState([]);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [selectedPlayers, setSelectedPlayers] = useState([]);
  const [playerDropdownOpen, setPlayerDropdownOpen] = useState(false);
  const [playerSearch, setPlayerSearch] = useState('');
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
  const [showEditSlot, setShowEditSlot] = useState(null);
  const [showFacilityEventDetail, setShowFacilityEventDetail] = useState(false);
  const [selectedFacilityEvent, setSelectedFacilityEvent] = useState(null);
  const [laneDate, setLaneDate] = useState(fmtLocalDate(new Date()));
  const [coachesDrawerOpen, setCoachesDrawerOpen] = useState(false);
  const [showPlayerAddGame, setShowPlayerAddGame] = useState(false);
  const [staffScheduleEvents, setStaffScheduleEvents] = useState([]);
  const [staffAssignments, setStaffAssignments] = useState([]);
  // Calendar selection + context menu state (shared across views)
  const [selecting, setSelecting] = useState(false);
  const [selectedEvents, setSelectedEvents] = useState([]); // raw event objects (need event object for source context)
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, event, source }
  const [recurrencePrompt, setRecurrencePrompt] = useState(null); // { event, action, source, onPick }
  const [copyToPicker, setCopyToPicker] = useState(null); // { event, source, options, onPick, title }
  const selectedIds = useMemo(() => new Set(selectedEvents.map((e) => String(e.id))), [selectedEvents]);
  const toggleSelect = (ev) => setSelectedEvents((arr) => {
    const sid = String(ev.id);
    return arr.some((e) => String(e.id) === sid) ? arr.filter((e) => String(e.id) !== sid) : [...arr, ev];
  });
  const exitSelectMode = () => { setSelecting(false); setSelectedEvents([]); };
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);

  useEffect(() => {
    fetchTeams();
    if (userRole === 'admin' || userRole === 'coach') {
      fetchPlayers();
    }
  }, [userRole]);

  useEffect(() => {
    if (view === 'team' && selectedTeam) {
      fetchTeamEvents();
    } else if (view === 'player' && (selectedPlayers.length > 0 || selectedPlayer)) {
      fetchPlayerEvents();
    }
  }, [view, selectedTeam, selectedPlayer, selectedPlayers, selectedDate]);

  useEffect(() => {
    if (view === 'my-schedule') {
      fetchMyScheduleEvents();
    }
  }, [view, selectedDate]);

  useEffect(() => {
    if (view === 'facility') {
      fetchFacilityEvents();
      fetchCoaches();
    }
  }, [view, selectedDate]);

  // Fetch staff schedule for lane view
  useEffect(() => {
    if (view === 'facility' && viewMode === 'lanes' && laneDate) {
      fetchStaffSchedule(laneDate);
    }
  }, [view, viewMode, laneDate]);

  // Sync selectedDate month when laneDate changes to a different month, OR
  // when viewMode flips into 'lanes' for an existing laneDate. The effect
  // previously only watched laneDate, so switching to the Lanes view while
  // laneDate was already set left selectedDate's month out of sync.
  useEffect(() => {
    if (viewMode === 'lanes' && laneDate) {
      const ld = new Date(laneDate + 'T12:00:00');
      if (ld.getMonth() !== selectedDate.getMonth() || ld.getFullYear() !== selectedDate.getFullYear()) {
        setSelectedDate(new Date(ld.getFullYear(), ld.getMonth(), 1));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laneDate, viewMode]);

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
      // Include everyone (players, coaches, interns, admins) so staff can be programmed
      // just like athletes (#156). Coach view is still scoped to their teams below.
      .order('full_name');

    // If coach, only show players from their teams
    if (userRole === 'coach') {
      const { data: coachTeams } = await supabase
        .from('team_members')
        .select('team_id')
        .eq('user_id', userId);
      
      const teamIds = coachTeams?.map(t => t.team_id) || [];
      // A coach only ever sees players on their own teams. With no teams, that's an
      // empty set — never fall through to the unfiltered all-users query.
      if (teamIds.length === 0) {
        setPlayers([]);
        return;
      }
      // Filter to only players on coach's teams
      const { data } = await query;
      const filteredPlayers = data?.filter(p =>
        p.team_members?.some(tm => teamIds.includes(tm.team_id))
      );
      setPlayers(filteredPlayers || []);
      return;
    }

    const { data } = await query;
    setPlayers(data || []);
  };

  // Fetch schedule events for a set of players, chunked by member count.
  // A single Supabase query caps at 1000 rows, and a very large .in() list blows the
  // request URL length limit — both silently drop team-programmed workouts on big
  // rosters, so mass-programmed events "don't show" (#155). Chunking keeps each query
  // small enough to return every row and stay under the URL limit.
  const fetchEventsForPlayers = async (playerIds, startStr, endStr) => {
    const CHUNK = 25;
    const all = [];
    for (let i = 0; i < playerIds.length; i += CHUNK) {
      const chunk = playerIds.slice(i, i + CHUNK);
      const { data, error } = await supabase.from('schedule_events').select('*')
        .in('player_id', chunk)
        .gte('event_date', startStr).lte('event_date', endStr)
        .order('event_date');
      if (error) { console.error('Error fetching player schedule events:', error); continue; }
      all.push(...(data || []));
    }
    return all;
  };

  const fetchTeamEvents = async () => {
    if (!selectedTeam) return;

    const { startStr, endStr } = monthWeekRange(selectedDate);

    // Fetch team members so we can also pull their individual events
    const { data: members } = await supabase.from('team_members').select('user_id').eq('team_id', selectedTeam);
    const memberIds = (members || []).map(m => m.user_id).filter(Boolean);

    const [{ data: teamData }, playerData] = await Promise.all([
      supabase.from('schedule_events').select('*')
        .contains('team_ids', [selectedTeam])
        .gte('event_date', startStr).lte('event_date', endStr),
      memberIds.length > 0
        ? fetchEventsForPlayers(memberIds, startStr, endStr)
        : Promise.resolve([]),
    ]);

    // Merge and dedupe by id
    const seen = new Set();
    const merged = [];
    for (const ev of [...(teamData || []), ...(playerData || [])]) {
      if (!seen.has(ev.id)) { seen.add(ev.id); merged.push(ev); }
    }
    setEvents(merged);
  };

  const fetchPlayerEvents = async () => {
    const ids = selectedPlayers.length > 0 ? selectedPlayers : (selectedPlayer ? [selectedPlayer] : []);
    if (ids.length === 0) { setEvents([]); return; }

    const { rangeStart, rangeEnd, startStr, endStr } = monthWeekRange(selectedDate);

    const { data: tmRows } = await supabase.from('team_members').select('team_id').in('user_id', ids);
    const playerTeamIds = Array.from(new Set((tmRows || []).map(r => r.team_id).filter(Boolean)));

    const [{ data }, { data: mpa }, { data: teamEv }] = await Promise.all([
      supabase.from('schedule_events').select('*').in('player_id', ids)
        .gte('event_date', startStr).lte('event_date', endStr),
      supabase.from('meal_plan_assignments').select('*, meal_plans(name)').in('player_id', ids)
        .lte('start_date', endStr).or(`end_date.gte.${startStr},end_date.is.null`),
      playerTeamIds.length > 0
        ? supabase.from('schedule_events').select('*')
            .overlaps('team_ids', playerTeamIds).gte('event_date', startStr).lte('event_date', endStr)
        : Promise.resolve({ data: [] }),
    ]);

    const directIds = new Set((data || []).map(e => e.id));
    const teamOnly = (teamEv || []).filter(e => !directIds.has(e.id));
    const mealEvents = expandMealPlanAssignments(mpa || [], rangeStart, rangeEnd);
    setEvents([...(data || []), ...teamOnly, ...mealEvents]);
  };

  const fetchMyScheduleEvents = async () => {
    const { rangeStart, rangeEnd, startStr, endStr } = monthWeekRange(selectedDate);
    const isCoach = userRole === 'coach' || userRole === 'admin';

    // Direct per-player events only make sense for players. For coaches/admins
    // we skip this query entirely so a coach's My Schedule does not pull in
    // per-athlete rows where player_id happens to equal their user id.
    let data = [];
    if (!isCoach) {
      const { data: directData, error: evErr } = await supabase.from('schedule_events').select('*')
        .eq('player_id', userId).gte('event_date', startStr).lte('event_date', endStr);
      if (evErr) console.error('Error fetching schedule events:', evErr);
      data = directData || [];
    }

    // Fetch direct meal plan assignments (player view only)
    let directMpa = [];
    if (!isCoach) {
      const { data: mpa, error: mpaErr } = await supabase.from('meal_plan_assignments').select('*, meal_plans(name)')
        .eq('player_id', userId).lte('start_date', endStr).or(`end_date.gte.${startStr},end_date.is.null`);
      if (mpaErr) console.error('Error fetching meal plan assignments:', mpaErr);
      directMpa = mpa || [];
    }

    // Resolve team memberships once for both team events and team meal plans
    const { data: myTeams } = await supabase.from('team_members').select('team_id').eq('user_id', userId);
    const teamIds = (myTeams || []).map(t => t.team_id);

    let teamEvents = [];
    let teamMpa = [];
    if (teamIds.length > 0) {
      // For coaches the team overlap must exclude per-player rows (issue #165):
      // team programming creates one schedule_events row per athlete with both
      // player_id set AND team_ids populated, so .overlaps('team_ids', ...)
      // would otherwise pull every athlete's workout onto the coach calendar.
      let teamEvQuery = supabase.from('schedule_events').select('*')
        .overlaps('team_ids', teamIds).gte('event_date', startStr).lte('event_date', endStr);
      if (isCoach) teamEvQuery = teamEvQuery.is('player_id', null);

      const [{ data: tEv, error: tEvErr }, { data: tMpa, error: tErr }] = await Promise.all([
        teamEvQuery,
        supabase.from('meal_plan_assignments').select('*, meal_plans(name)')
          .in('team_id', teamIds).lte('start_date', endStr).or(`end_date.gte.${startStr},end_date.is.null`),
      ]);
      if (tEvErr) console.error('Error fetching team schedule events:', tEvErr);
      if (tErr) console.error('Error fetching team meal plan assignments:', tErr);

      const directIds = new Set(data.map(e => e.id));
      teamEvents = (tEv || []).filter(e => !directIds.has(e.id));
      teamMpa = (tMpa || []).map(a => ({ ...a, player_id: userId }));
    }

    const allMpa = [...directMpa, ...teamMpa];
    const mealEvents = expandMealPlanAssignments(allMpa, rangeStart, rangeEnd);

    // Show training slots in My Schedule:
    // coaches see slots where they are the coach; players see their confirmed reservations.
    const slotEvents = [];
    if (isCoach) {
      const { data: rawSlots } = await supabase.from('training_slots').select('*').eq('coach_id', userId);
      (rawSlots || []).forEach(slot => {
        if (slot.repeat_weekly && !slot.recurrence_parent_id) {
          const slotStart = new Date(slot.slot_date + 'T00:00:00');
          const endDate = slot.repeat_end_date ? new Date(slot.repeat_end_date + 'T00:00:00') : rangeEnd;
          let current = new Date(slotStart);
          let index = 0;
          while (current <= rangeEnd && current <= endDate) {
            const occStr = fmtLocalDate(current);
            if (occStr >= startStr && occStr <= endStr) {
              slotEvents.push({ ...slot, event_date: occStr, event_type: 'training_slot', title: slot.notes || 'Training Slot', _is_slot: true, _occurrence_index: index, _is_virtual: index > 0 });
            }
            current.setDate(current.getDate() + 7);
            index++;
            if (index > 500) break;
          }
        } else if (!slot.recurrence_parent_id && slot.slot_date >= startStr && slot.slot_date <= endStr) {
          slotEvents.push({ ...slot, event_date: slot.slot_date, event_type: 'training_slot', title: slot.notes || 'Training Slot', _is_slot: true });
        }
      });
    } else {
      const { data: myRes } = await supabase.from('slot_reservations').select('*, training_slots(*)').eq('player_id', userId).eq('status', 'confirmed');
      (myRes || []).forEach(r => {
        const slot = r.training_slots;
        if (!slot) return;
        if (slot.repeat_weekly && !slot.recurrence_parent_id) {
          const slotStart = new Date(slot.slot_date + 'T00:00:00');
          const endDate = slot.repeat_end_date ? new Date(slot.repeat_end_date + 'T00:00:00') : rangeEnd;
          let current = new Date(slotStart);
          let index = 0;
          while (current <= rangeEnd && current <= endDate) {
            const occStr = fmtLocalDate(current);
            if (occStr >= startStr && occStr <= endStr) {
              slotEvents.push({ ...slot, event_date: occStr, event_type: 'training_slot', title: slot.notes || 'Training Session', _is_slot: true, _occurrence_index: index, _is_virtual: index > 0 });
            }
            current.setDate(current.getDate() + 7);
            index++;
            if (index > 500) break;
          }
        } else if (!slot.recurrence_parent_id && slot.slot_date >= startStr && slot.slot_date <= endStr) {
          slotEvents.push({ ...slot, event_date: slot.slot_date, event_type: 'training_slot', title: slot.notes || 'Training Session', _is_slot: true });
        }
      });
    }

    setMyScheduleEvents([...data, ...teamEvents, ...mealEvents, ...slotEvents]);
  };

  const fetchFacilityEvents = async () => {
    const { rangeStart, rangeEnd, startStr, endStr } = monthWeekRange(selectedDate);
    const facSelect = '*, athlete:athlete_id(full_name), coach:coach_id(full_name)';
    let nrQuery = supabase.from('facility_events').select(facSelect).eq('is_recurring', false).is('recurrence_parent_id', null).gte('event_date', startStr).lte('event_date', endStr);
    let masterQuery = supabase.from('facility_events').select(facSelect).eq('is_recurring', true).is('recurrence_parent_id', null);
    let exceptionsQuery = supabase.from('facility_events').select(facSelect).not('recurrence_parent_id', 'is', null).gte('event_date', startStr).lte('event_date', endStr);
    // Players only see facility events they're the athlete for, or signed up for.
    const restrictToPlayer = userRole === 'player';
    let signedUpIds = new Set();
    if (restrictToPlayer) {
      nrQuery = nrQuery.eq('athlete_id', userId);
      masterQuery = masterQuery.eq('athlete_id', userId);
      exceptionsQuery = exceptionsQuery.eq('athlete_id', userId);
      const { data: signups } = await supabase
        .from('event_signups')
        .select('event_id')
        .eq('user_id', userId)
        .gte('event_date', startStr)
        .lte('event_date', endStr);
      signedUpIds = new Set((signups || []).map(s => s.event_id));
    }
    const { data: nonRecurring } = await nrQuery;
    const { data: masters } = await masterQuery;
    const { data: exceptions } = await exceptionsQuery;
    const expanded = expandRecurringEvents(masters || [], exceptions || [], rangeStart, rangeEnd);
    let combined = [...(nonRecurring || []), ...expanded];
    if (restrictToPlayer && signedUpIds.size > 0) {
      const haveIds = new Set(combined.map(e => e.id));
      const missingIds = [...signedUpIds].filter(id => !haveIds.has(id));
      if (missingIds.length > 0) {
        const { data: signedUpEvents } = await supabase
          .from('facility_events')
          .select(facSelect)
          .in('id', missingIds)
          .gte('event_date', startStr)
          .lte('event_date', endStr);
        combined = [...combined, ...(signedUpEvents || [])];
      }
    }
    setFacilityEvents(combined);
  };

  const fetchCoaches = async () => {
    const { data } = await supabase.from('users').select('id, full_name, email, title, avatar_url, role').in('role', ['coach', 'admin']).order('full_name');
    setCoaches(data || []);
  };

  const fetchStaffSchedule = async (dateStr) => {
    // Build day boundaries in UTC for the given local date
    const dayStart = new Date(dateStr + 'T00:00:00');
    const dayEnd = new Date(dateStr + 'T23:59:59');
    const [evRes, asgRes] = await Promise.all([
      supabase.from('staff_schedule_events').select('*').gte('start_at', dayStart.toISOString()).lte('start_at', dayEnd.toISOString()).order('start_at'),
      supabase.from('staff_schedule_assignments').select('id, event_id, user_id, role, user:user_id(full_name, avatar_url)'),
    ]);
    setStaffScheduleEvents(evRes.data || []);
    setStaffAssignments(asgRes.data || []);
  };

  const fetchCoachSlots = async (coachId) => {
    // Expand range to cover the displayed week even if it spans month boundaries
    const startOfWeek = new Date(selectedDate);
    startOfWeek.setDate(selectedDate.getDate() - selectedDate.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    const startOfMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    const endOfMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0);
    const rangeStart = startOfWeek < startOfMonth ? startOfWeek : startOfMonth;
    const rangeEnd = endOfWeek > endOfMonth ? endOfWeek : endOfMonth;
    const startStr = fmtLocalDate(rangeStart);
    const endStr = fmtLocalDate(rangeEnd);
    const { data: slots, error: slotErr } = await supabase.from('training_slots').select('*').eq('coach_id', coachId);
    if (slotErr) console.error('Error fetching training slots:', slotErr);
    const expandedSlots = [];
    (slots || []).forEach(slot => {
      if (slot.repeat_weekly && !slot.recurrence_parent_id) {
        const slotStart = new Date(slot.slot_date + 'T00:00:00');
        const endDate = slot.repeat_end_date ? new Date(slot.repeat_end_date + 'T00:00:00') : rangeEnd;
        let current = new Date(slotStart);
        let index = 0;
        while (current <= endDate && current <= rangeEnd) {
          if (current >= rangeStart) {
            expandedSlots.push({ ...slot, slot_date: fmtLocalDate(current), _occurrence_index: index, _is_virtual: index > 0 });
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
    // Ensure first visible occurrence per repeating master is draggable
    const firstRepeatSeen = new Set();
    for (const es of expandedSlots) {
      if (es.repeat_weekly && !firstRepeatSeen.has(es.id)) {
        es._is_virtual = false;
        firstRepeatSeen.add(es.id);
      }
    }
    setCoachSlots(expandedSlots);
    const slotIds = (slots || []).map(s => s.id);
    if (slotIds.length > 0) {
      const { data: reservations } = await supabase.from('slot_reservations').select('*, users:player_id(full_name, email)').in('slot_id', slotIds).gte('slot_date', startStr).lte('slot_date', endStr);
      setSlotReservations(reservations || []);
    } else {
      setSlotReservations([]);
    }
  };

  // ============================================
  // Calendar action helpers (delete / duplicate / copy / bulk delete)
  // source: 'facility' | 'team' | 'slot' | 'staff'
  // ============================================

  const tableForSource = (source) => ({
    facility: 'facility_events',
    team: 'schedule_events',
    slot: 'training_slots',
    staff: 'staff_schedule_events',
  })[source];

  const refetchForSource = (source) => {
    if (source === 'facility') fetchFacilityEvents();
    else if (source === 'team') { if (view === 'team') fetchTeamEvents(); else fetchPlayerEvents(); }
    else if (source === 'slot' && selectedCoach) fetchCoachSlots(selectedCoach.id);
  };

  const isRecurringEvent = (event, source) => {
    if (source === 'slot') return !!event.repeat_weekly;
    return !!(event._is_virtual || event.is_recurring || event.recurrence_parent_id);
  };

  // Delete one occurrence (virtual): insert exception
  const deleteVirtualOccurrence = async (event, source) => {
    if (source === 'facility') {
      const { error } = await supabase.from('facility_events').insert({
        recurrence_parent_id: event._master_id || event.recurrence_parent_id,
        original_date: event.event_date,
        event_date: event.event_date,
        is_exception: true,
        is_recurring: false,
        title: event.title,
        description: event.description,
        start_time: event.start_time,
        end_time: event.end_time,
        location: event.location,
        color: event.color,
        lanes: event.lanes || [],
        athlete_id: event.athlete_id,
        coach_id: event.coach_id,
        coach_ids: event.coach_ids || null,
      });
      return error;
    }
    if (source === 'staff') {
      const { error } = await supabase.from('staff_schedule_events').insert({
        recurrence_parent_id: event._master_id || event.recurrence_parent_id,
        original_date: event.event_date,
        event_date: event.event_date,
        is_cancelled: true,
        title: event.title,
        start_at: event.start_at,
        end_at: event.end_at,
      });
      return error;
    }
    if (source === 'team') {
      const { error } = await supabase.from('schedule_events').delete().eq('id', event.id);
      return error;
    }
    if (source === 'slot') {
      // Slots have no per-occurrence exception model, so a single virtual occurrence
      // can't be tombstoned — we only clear its reservations. (This path is currently
      // unreachable: slots pass allowOne:false. Kept honest rather than a no-op update.)
      const { error } = await supabase.from('slot_reservations').delete().eq('slot_id', event.id).eq('slot_date', event.slot_date);
      return error;
    }
  };

  // Delete entire series ('all'): delete master and children
  const deleteSeries = async (event, source) => {
    const masterId = event._master_id || event.recurrence_parent_id || event.id;
    if (source === 'team') {
      await supabase.from('schedule_events').delete().eq('recurrence_parent_id', masterId);
      const { error } = await supabase.from('schedule_events').delete().eq('id', masterId);
      return error;
    }
    const table = tableForSource(source);
    await supabase.from(table).delete().eq('recurrence_parent_id', masterId);
    const { error } = await supabase.from(table).delete().eq('id', masterId);
    return error;
  };

  // Delete this and future
  const deleteFuture = async (event, source) => {
    const masterId = event._master_id || event.recurrence_parent_id || event.id;
    const cutoff = event.event_date || event.slot_date;
    if (source === 'team') {
      const { error } = await supabase.from('schedule_events').delete().eq('recurrence_parent_id', masterId).gte('event_date', cutoff);
      if (event.id === masterId) {
        const { error: e2 } = await supabase.from('schedule_events').delete().eq('id', masterId);
        return e2;
      }
      return error;
    }
    if (source === 'facility' || source === 'staff') {
      const { data: master } = await supabase.from(tableForSource(source)).select('recurrence_rule, event_date').eq('id', masterId).single();
      if (!master) return null;
      const cutoffDate = new Date(cutoff + 'T00:00:00');
      cutoffDate.setDate(cutoffDate.getDate() - 1);
      const until = fmtLocalDate(cutoffDate);
      if (master.event_date && master.event_date > until) {
        return await deleteSeries(event, source);
      }
      const rule = typeof master.recurrence_rule === 'string' ? JSON.parse(master.recurrence_rule) : (master.recurrence_rule || {});
      rule.until = until;
      const ruleVal = source === 'facility' || source === 'staff' ? rule : JSON.stringify(rule);
      const { error } = await supabase.from(tableForSource(source)).update({ recurrence_rule: ruleVal }).eq('id', masterId);
      return error;
    }
    if (source === 'slot') {
      const cutoffDate = new Date(cutoff + 'T00:00:00');
      cutoffDate.setDate(cutoffDate.getDate() - 1);
      const { error } = await supabase.from('training_slots').update({ repeat_end_date: fmtLocalDate(cutoffDate) }).eq('id', masterId);
      return error;
    }
  };

  const handleDelete = (event, source) => {
    const recurring = isRecurringEvent(event, source);
    if (!recurring) {
      if (!window.confirm('Delete this event?')) return;
      (async () => {
        const id = event._master_id || event.id;
        const { error } = await supabase.from(tableForSource(source)).delete().eq('id', id);
        if (error) { alert('Failed to delete: ' + formatUserError(error)); return; }
        refetchForSource(source);
      })();
      return;
    }
    setRecurrencePrompt({
      event, source, action: 'delete',
      allowOne: source !== 'slot',
      onPick: async (choice) => {
        setRecurrencePrompt(null);
        let err;
        if (choice === 'one') err = await deleteVirtualOccurrence(event, source);
        else if (choice === 'future') err = await deleteFuture(event, source);
        else err = await deleteSeries(event, source);
        if (err) { alert('Failed to delete: ' + formatUserError(err)); return; }
        refetchForSource(source);
      },
    });
  };

  const handleDuplicate = async (event, source) => {
    const newDateStr = window.prompt('Duplicate to which date? (YYYY-MM-DD)', event.event_date || event.slot_date);
    if (!newDateStr) return;
    const id = event._master_id || event.id;
    const { data: src } = await supabase.from(tableForSource(source)).select('*').eq('id', id).single();
    if (!src) { alert('Original event not found'); return; }
    const clone = { ...src };
    delete clone.id;
    delete clone.created_at;
    delete clone.updated_at;
    if (source === 'slot') {
      clone.slot_date = newDateStr;
      clone.repeat_weekly = false;
      clone.repeat_end_date = null;
      clone.is_recurring = false;
      clone.recurrence_parent_id = null;
      delete clone.recurrence_rule;
      delete clone.original_date;
    } else {
      clone.is_recurring = false;
      clone.recurrence_parent_id = null;
      clone.recurrence_rule = null;
      clone.original_date = null;
      clone.event_date = newDateStr;
      if (source === 'staff' && src.start_at && src.end_at) {
        const oldStart = new Date(src.start_at);
        const newStart = new Date(newDateStr + 'T00:00:00');
        newStart.setHours(oldStart.getHours(), oldStart.getMinutes(), 0, 0);
        const dur = new Date(src.end_at) - new Date(src.start_at);
        clone.start_at = newStart.toISOString();
        clone.end_at = new Date(newStart.getTime() + dur).toISOString();
      }
    }
    const { error } = await supabase.from(tableForSource(source)).insert(clone);
    if (error) { alert('Failed to duplicate: ' + formatUserError(error)); return; }
    refetchForSource(source);
  };

  const openCopyToPicker = async (event, source) => {
    if (source === 'slot') {
      const { data: list } = await supabase.from('users').select('id, full_name, email').in('role', ['coach', 'admin']).order('full_name');
      const opts = (list || []).filter((u) => u.id !== (event.coach_id)).map((u) => ({ id: u.id, label: u.full_name, subtitle: u.email }));
      setCopyToPicker({ event, source, options: opts, title: 'Copy slot to other coaches', actionLabel: 'Copy', onPick: async (ids) => {
        for (const cid of ids) {
          const { data: src } = await supabase.from('training_slots').select('*').eq('id', event.id).single();
          const clone = { ...src };
          delete clone.id; delete clone.created_at; delete clone.updated_at;
          clone.coach_id = cid;
          await supabase.from('training_slots').insert(clone);
        }
        setCopyToPicker(null);
        refetchForSource(source);
      } });
      return;
    }
    if (source === 'team') {
      const { data: list } = await supabase.from('teams').select('id, name').order('name');
      const evTeams = new Set(event.team_ids || (event.team_id ? [event.team_id] : []));
      const opts = (list || []).filter((t) => !evTeams.has(t.id)).map((t) => ({ id: t.id, label: t.name }));
      setCopyToPicker({ event, source, options: opts, title: 'Copy event to other teams', actionLabel: 'Copy', onPick: async (ids) => {
        const id = event._master_id || event.id;
        const { data: src } = await supabase.from('schedule_events').select('*').eq('id', id).single();
        for (const tid of ids) {
          const clone = { ...src };
          delete clone.id; delete clone.created_at; delete clone.updated_at;
          clone.team_id = tid;
          clone.team_ids = [tid];
          clone.recurrence_parent_id = null;
          await supabase.from('schedule_events').insert(clone);
        }
        setCopyToPicker(null);
        refetchForSource(source);
      } });
      return;
    }
    if (source === 'staff') {
      const { data: list } = await supabase.from('users').select('id, full_name, email').in('role', ['coach', 'admin']).order('full_name');
      const opts = (list || []).map((u) => ({ id: u.id, label: u.full_name, subtitle: u.email }));
      setCopyToPicker({ event, source, options: opts, title: 'Assign copy of event to staff', actionLabel: 'Create + assign', onPick: async (ids) => {
        const masterId = event._master_id || event.id;
        const { data: src } = await supabase.from('staff_schedule_events').select('*').eq('id', masterId).single();
        const clone = { ...src };
        delete clone.id; delete clone.created_at; delete clone.updated_at;
        clone.is_recurring = false;
        clone.recurrence_parent_id = null;
        clone.recurrence_rule = null;
        clone.original_date = null;
        const { data: newEv } = await supabase.from('staff_schedule_events').insert(clone).select().single();
        if (newEv) {
          for (const uid of ids) {
            await supabase.from('staff_schedule_assignments').insert({ event_id: newEv.id, user_id: uid });
          }
        }
        setCopyToPicker(null);
        refetchForSource(source);
      } });
    }
  };

  const buildContextMenuItems = (event, source) => {
    const items = [];
    const editable = !!event;
    items.push({ label: 'Edit', icon: <Edit2 size={14} />, onClick: () => {
      if (source === 'facility') { setSelectedFacilityEvent(event); setShowFacilityEventDetail(true); }
      else if (source === 'team') { setSelectedEvent(event); setShowEventDetail(true); }
      else if (source === 'slot') { setShowEditSlot(event); }
    }, disabled: !editable });
    items.push({ label: 'Duplicate', icon: <Copy size={14} />, onClick: () => handleDuplicate(event, source) });
    if (source === 'team' || source === 'slot' || source === 'staff') {
      items.push({ label: 'Copy to...', icon: <Copy size={14} />, onClick: () => openCopyToPicker(event, source) });
    }
    items.push({ divider: true });
    items.push({ label: 'Delete', icon: <Trash2 size={14} />, onClick: () => handleDelete(event, source), danger: true });
    return items;
  };

  const onEventContextMenu = (source) => (event, e) => {
    setCtxMenu({ x: e.clientX, y: e.clientY, items: buildContextMenuItems(event, source) });
  };

  const bulkDelete = async () => {
    if (selectedEvents.length === 0) return;
    if (!window.confirm(`Delete ${selectedEvents.length} selected event(s)?`)) return;
    trackAction('bulk_delete_events', { count: selectedEvents.length });
    // Group by source — but we only support one source at a time per view. Infer from selecting context: use first event's known fields.
    // Determine source per current view
    let source = 'facility';
    if (view === 'team' || view === 'player') source = 'team';
    if (view === 'facility' && selectedCoach) source = 'slot';
    let failed = 0;
    let skipped = 0;
    let deleted = 0;
    for (const ev of selectedEvents) {
      const id = ev._master_id || ev.id;
      try {
        if (ev._is_virtual && source === 'facility') {
          const error = await deleteVirtualOccurrence(ev, source);
          if (error) throw error;
          deleted++;
        } else if (ev._is_virtual && source === 'slot') {
          // Bulk delete of virtual training slot occurrences: skip — would need exception support
          skipped++;
          continue;
        } else {
          const { error } = await supabase.from(tableForSource(source)).delete().eq('id', id);
          if (error) throw error;
          deleted++;
        }
      } catch (err) {
        failed++;
        console.error('Bulk delete failed for event', id, err);
      }
    }
    if (failed > 0 || skipped > 0) {
      const parts = [`${deleted} deleted`];
      if (skipped > 0) parts.push(`${skipped} skipped (recurring slots)`);
      if (failed > 0) parts.push(`${failed} failed`);
      alert(`${parts.join(', ')}. Refresh to see current state.`);
    }
    exitSelectMode();
    refetchForSource(source);
  };

  // ============================================
  // Drop handler for Program Library sidebar
  // payload: { kind: 'template'|'program'|'meal_plan'|'meal', id, name }
  // ============================================
  const handleProgramDrop = async (payload, dateStr) => {
    trackAction('drop_template_on_calendar', { kind: payload?.kind });
    if (!payload || !dateStr) return;
    if (!canManageCalendar() && view !== 'my-schedule') { alert('You do not have permission to schedule events here.'); return; }

    // Determine targets based on current view
    let targets = {};
    if (view === 'team') {
      if (!selectedTeam) { alert('Select a team first.'); return; }
      // Fetch team members to create per-player events (visible on individual schedules)
      const { data: members } = await supabase.from('team_members').select('user_id').eq('team_id', selectedTeam);
      const memberIds = (members || []).map(m => m.user_id).filter(Boolean);
      if (memberIds.length === 0) { alert('No players on this team.'); return; }
      targets = { _playerIds: memberIds };
    } else if (view === 'player') {
      const playerIds = selectedPlayers.length > 0 ? selectedPlayers : (selectedPlayer ? [selectedPlayer] : []);
      if (playerIds.length === 0) { alert('Select a player first.'); return; }
      targets = { _playerIds: playerIds };
    } else if (view === 'my-schedule') {
      targets = { player_id: userId };
    } else {
      return;
    }

    const insertSchedule = async (rows) => {
      const expanded = [];
      if (targets._playerIds) {
        for (const pid of targets._playerIds) {
          for (const r of rows) expanded.push({ ...r, player_id: pid });
        }
      } else {
        for (const r of rows) expanded.push({ ...r, ...targets });
      }
      const { error } = await supabase.from('schedule_events').insert(expanded);
      if (error) { alert('Failed to schedule: ' + formatUserError(error)); return false; }
      return true;
    };

    if (payload.kind === 'template') {
      // Fetch template exercises so the workout has full details
      const { data: tpl } = await supabase.from('workout_templates').select('*').eq('id', payload.id).single();
      const exercises = tpl?.exercises || [];
      const notesWithExercises = [
        tpl?.notes || '',
        exercises.length > 0 ? '\n--- Exercises ---\n' + exercises.map(ex =>
          [ex.name, ex.sets && ex.reps ? `${ex.sets}x${ex.reps}` : (ex.sets || ''), ex.rest || '', ex.load || '', ex.link || ''].join(' | ')
        ).join('\n') : ''
      ].filter(Boolean).join('\n');
      const category = folderToCategory(tpl?.folder) || folderToCategory(payload.folder) || getWorkoutCategory(tpl?.name || payload.name);
      const ok = await insertSchedule([{ event_type: 'workout', title: tpl?.name || payload.name, notes: notesWithExercises || null, event_date: dateStr, category }]);
      if (ok) { if (view === 'team') fetchTeamEvents(); else if (view === 'player') fetchPlayerEvents(); else fetchMyScheduleEvents(); }
      return;
    }
    if (payload.kind === 'meal') {
      const ok = await insertSchedule([{ event_type: 'meal', meal_id: payload.id, title: payload.name, event_date: dateStr }]);
      if (ok) { if (view === 'team') fetchTeamEvents(); else if (view === 'player') fetchPlayerEvents(); else fetchMyScheduleEvents(); }
      return;
    }
    if (payload.kind === 'program') {
      const { data: days } = await supabase.from('training_days').select('id, day_number, title').eq('program_id', payload.id).order('day_number');
      const rows = (days || []).map((d) => {
        const dt = new Date(dateStr + 'T00:00:00');
        dt.setDate(dt.getDate() + ((d.day_number || 1) - 1));
        return {
          event_type: 'workout',
          training_program_id: payload.id,
          training_day_id: d.id,
          title: d.title || payload.name,
          event_date: fmtLocalDate(dt),
        };
      });
      if (rows.length === 0) { alert('Program has no days to schedule.'); return; }
      const ok = await insertSchedule(rows);
      if (ok) { if (view === 'team') fetchTeamEvents(); else if (view === 'player') fetchPlayerEvents(); else fetchMyScheduleEvents(); }
      return;
    }
    if (payload.kind === 'meal_plan') {
      const assignments = [];
      if (view === 'team') {
        assignments.push({ meal_plan_id: payload.id, team_id: selectedTeam, start_date: dateStr });
      } else if (view === 'player') {
        for (const pid of (targets._playerIds || [])) assignments.push({ meal_plan_id: payload.id, player_id: pid, start_date: dateStr });
      } else {
        assignments.push({ meal_plan_id: payload.id, player_id: userId, start_date: dateStr });
      }
      const { error } = await supabase.from('meal_plan_assignments').insert(assignments);
      if (error) { alert('Failed to assign meal plan: ' + formatUserError(error)); return; }
      if (view === 'team') fetchTeamEvents(); else if (view === 'player') fetchPlayerEvents(); else fetchMyScheduleEvents();
    }
  };

  const canManageCalendar = () => {
    if (userRole === 'admin') return true;
    if (userRole === 'coach') {
      if (view === 'facility') return true;
      if (view === 'team') return true;
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
          {userRole === 'player' ? (
            <>
              <button
                onClick={() => { setView('my-schedule'); setSelectedCoach(null); }}
                className={`px-4 py-2 rounded-lg font-medium transition flex items-center space-x-2 ${
                  view === 'my-schedule' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <CalendarIcon size={18} />
                <span>My Schedule</span>
              </button>
              <button
                onClick={() => { setView('facility'); setSelectedCoach(null); }}
                className={`px-4 py-2 rounded-lg font-medium transition flex items-center space-x-2 ${
                  view === 'facility' ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <Building size={18} />
                <span>Facility</span>
              </button>
            </>
          ) : (
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
              <button
                onClick={() => { setView('facility'); setSelectedCoach(null); }}
                className={`px-4 py-2 rounded-lg font-medium transition flex items-center space-x-2 ${
                  view === 'facility' ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <Building size={18} />
                <span>Facility</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* My Schedule View (Player) */}
      {view === 'my-schedule' && (
        <div className="flex space-x-4">
          {(userRole === 'admin' || userRole === 'coach') && (
            <ProgramLibrarySidebar collapsed={libraryCollapsed} onToggle={() => setLibraryCollapsed(!libraryCollapsed)} />
          )}
          <div className="bg-white rounded-lg shadow flex-1 min-w-0">
          <div className="border-b border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <h3 className="text-lg font-semibold text-gray-900">My Schedule</h3>
                <button
                  onClick={() => setShowPlayerAddGame(true)}
                  className="bg-blue-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-blue-700 transition flex items-center space-x-1 text-sm"
                >
                  <Plus size={16} />
                  <span>Add Game</span>
                </button>
              </div>
              <div className="flex items-center space-x-2">
                <button onClick={() => setViewMode('week')} className={`px-3 py-1 rounded text-sm font-medium transition ${viewMode === 'week' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>Week</button>
                <button onClick={() => setViewMode('month')} className={`px-3 py-1 rounded text-sm font-medium transition ${viewMode === 'month' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>Month</button>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <button onClick={() => {
                if (viewMode === 'week') { const d = new Date(selectedDate); d.setDate(d.getDate() - 7); setSelectedDate(d); }
                else setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, 1));
              }} className="p-2 hover:bg-gray-100 rounded-lg transition"><ChevronLeft size={20} /></button>
              <h3 className="text-xl font-semibold text-gray-900">{viewMode === 'week' ? getWeekRangeLabel(selectedDate) : selectedDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h3>
              <button onClick={() => {
                if (viewMode === 'week') { const d = new Date(selectedDate); d.setDate(d.getDate() + 7); setSelectedDate(d); }
                else setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 1));
              }} className="p-2 hover:bg-gray-100 rounded-lg transition"><ChevronRight size={20} /></button>
            </div>
          </div>
          <div className="p-6">
            {viewMode === 'month' ? (
              <MonthView
                selectedDate={selectedDate}
                events={myScheduleEvents}
                onDateClick={() => {}}
                hoveredDate={hoveredDate}
                setHoveredDate={setHoveredDate}
                canManage={true}
                setSelectedEvent={setSelectedEvent}
                setShowEventDetail={setShowEventDetail}
                onProgramDrop={handleProgramDrop}
              />
            ) : (
              <WeekView
                selectedDate={selectedDate}
                events={myScheduleEvents}
                onDateClick={() => {}}
                canManage={true}
                onEventClick={(ev) => { setSelectedEvent(ev); setShowEventDetail(true); }}
                onProgramDrop={handleProgramDrop}
              />
            )}
          </div>
          {showPlayerAddGame && (
            <PlayerAddGameModal
              userId={userId}
              onClose={() => setShowPlayerAddGame(false)}
              onSuccess={() => { setShowPlayerAddGame(false); fetchMyScheduleEvents(); }}
            />
          )}
          </div>
        </div>
      )}

      {/* Facility View */}
      {view === 'facility' && (
        <div className="bg-white rounded-lg shadow relative">
          {/* Coach Drawer (pop-out) */}
          {coachesDrawerOpen && (
            <div className="fixed inset-0 z-[60]" onClick={() => setCoachesDrawerOpen(false)}>
              <div className="absolute inset-0 bg-black bg-opacity-40" />
              <aside
                className="absolute top-0 left-0 h-full w-80 max-w-[90vw] bg-white shadow-xl flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-900 text-sm">Coaches</h3>
                    <p className="text-xs text-gray-500 mt-1">Select a coach to view training slots</p>
                  </div>
                  <button
                    onClick={() => setCoachesDrawerOpen(false)}
                    className="p-1 text-gray-500 hover:text-gray-900"
                    aria-label="Close coaches drawer"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {selectedCoach && (
                    <button
                      onClick={() => { setSelectedCoach(null); setCoachesDrawerOpen(false); }}
                      className="w-full px-4 py-3 text-left text-sm text-teal-600 hover:bg-teal-50 border-b border-gray-200 font-medium"
                    >
                      &larr; Back to Facility Events
                    </button>
                  )}
                  {coaches.map(coach => (
                    <button
                      key={coach.id}
                      onClick={() => {
                        setSelectedCoach(selectedCoach?.id === coach.id ? null : coach);
                        setCoachesDrawerOpen(false);
                      }}
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
              </aside>
            </div>
          )}

          <div className="flex">
            {/* Main Calendar Area */}
            <div className="flex-1 min-w-0">
              <div className="border-b border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-4">
                    <button
                      onClick={() => setCoachesDrawerOpen(true)}
                      className="flex items-center space-x-1 bg-gray-100 text-gray-700 hover:bg-gray-200 px-3 py-1.5 rounded-lg text-sm font-medium transition"
                    >
                      <Users size={16} />
                      <span>Coaches</span>
                    </button>
                    <h3 className="text-lg font-semibold text-gray-900">
                      {selectedCoach ? `${selectedCoach.full_name}'s Training Slots` : 'Facility Calendar'}
                    </h3>
                    {canManageCalendar() && !selectedCoach && (
                      <button onClick={() => setShowAddFacilityEvent('new')} className="bg-teal-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-teal-700 transition flex items-center space-x-1">
                        <Plus size={16} /><span>Add Event</span>
                      </button>
                    )}
                    {selectedCoach && (userRole === 'coach' || userRole === 'admin') && (
                      <button onClick={() => setShowCreateSlot('new')} className="bg-teal-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-teal-700 transition flex items-center space-x-1">
                        <Plus size={16} /><span>Add Training Slot</span>
                      </button>
                    )}
                    {canManageCalendar() && viewMode !== 'lanes' && (
                      <button onClick={() => { if (selecting) exitSelectMode(); else setSelecting(true); }} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition flex items-center space-x-1 ${selecting ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                        <CheckSquare size={16} /><span>{selecting ? 'Done' : 'Select'}</span>
                      </button>
                    )}
                  </div>
                  <div className="flex items-center space-x-2">
                    <button onClick={() => setViewMode('week')} className={`px-3 py-1 rounded text-sm font-medium transition ${viewMode === 'week' ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>Week</button>
                    <button onClick={() => setViewMode('month')} className={`px-3 py-1 rounded text-sm font-medium transition ${viewMode === 'month' ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>Month</button>
                    <button onClick={() => setViewMode('lanes')} className={`px-3 py-1 rounded text-sm font-medium transition ${viewMode === 'lanes' ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>Lanes</button>
                  </div>
                </div>
                {selecting && selectedEvents.length > 0 && (
                  <div className="mb-3 flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg p-2 px-3">
                    <span className="text-sm text-blue-900 font-medium">{selectedEvents.length} selected</span>
                    <div className="flex items-center space-x-2">
                      <button onClick={bulkDelete} className="bg-red-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-red-700 transition flex items-center space-x-1">
                        <Trash2 size={14} /><span>Delete</span>
                      </button>
                      <button onClick={exitSelectMode} className="bg-gray-200 text-gray-700 px-3 py-1.5 rounded text-sm font-medium hover:bg-gray-300 transition">Cancel</button>
                    </div>
                  </div>
                )}
                {viewMode !== 'lanes' && (
                <div className="flex items-center justify-between">
                  {/* When a coach is selected we always render CoachSlotsWeekView (a week
                      grid), so navigation must move by week regardless of viewMode —
                      otherwise players jump a whole month at a time and can't browse
                      availability to book (#152). */}
                  <button onClick={() => {
                    if (viewMode === 'week' || selectedCoach) { const d = new Date(selectedDate); d.setDate(d.getDate() - 7); setSelectedDate(d); }
                    else setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, 1));
                  }} className="p-2 hover:bg-gray-100 rounded-lg transition"><ChevronLeft size={20} /></button>
                  <h3 className="text-xl font-semibold text-gray-900">{(viewMode === 'week' || selectedCoach) ? getWeekRangeLabel(selectedDate) : selectedDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h3>
                  <button onClick={() => {
                    if (viewMode === 'week' || selectedCoach) { const d = new Date(selectedDate); d.setDate(d.getDate() + 7); setSelectedDate(d); }
                    else setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 1));
                  }} className="p-2 hover:bg-gray-100 rounded-lg transition"><ChevronRight size={20} /></button>
                </div>
                )}
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
                    canManage={userRole === 'coach' || userRole === 'admin'}
                    onAddSlot={(dateStr) => setShowCreateSlot(dateStr)}
                    selecting={selecting}
                    selectedIds={selectedIds}
                    onToggleSelect={toggleSelect}
                    onEventContextMenu={onEventContextMenu('slot')}
                    onSlotDrop={async (slotId, newDate) => {
                      const slot = coachSlots.find((s) => String(s.id) === String(slotId));
                      if (!slot || slot._is_virtual || slot.slot_date === newDate) return;
                      const { error } = await supabase.from('training_slots').update({ slot_date: newDate }).eq('id', slotId);
                      if (error) { alert('Failed to move slot: ' + formatUserError(error)); return; }
                      fetchCoachSlots(selectedCoach.id);
                    }}
                    onReserve={(slot) => setShowReserveSlot(slot)}
                    onConfirm={async (reservationId) => {
                      const { error } = await supabase.from('slot_reservations').update({ status: 'confirmed', confirmed_at: new Date().toISOString() }).eq('id', reservationId);
                      if (error) { alert('Failed to confirm reservation: ' + formatUserError(error)); return; }
                      fetchCoachSlots(selectedCoach.id);
                    }}
                    onDecline={async (reservationId) => {
                      const { error } = await supabase.from('slot_reservations').update({ status: 'declined' }).eq('id', reservationId);
                      if (error) { alert('Failed to decline reservation: ' + formatUserError(error)); return; }
                      fetchCoachSlots(selectedCoach.id);
                    }}
                  />
                ) : viewMode === 'lanes' ? (
                  <LaneView
                    selectedDate={selectedDate}
                    events={facilityEvents}
                    laneDate={laneDate}
                    setLaneDate={setLaneDate}
                    canManage={canManageCalendar()}
                    onCellClick={(prefill) => canManageCalendar() && setShowAddFacilityEvent(prefill)}
                    onEventClick={(ev) => { setSelectedFacilityEvent(ev); setShowFacilityEventDetail(true); }}
                    staffEvents={staffScheduleEvents}
                    staffAssignments={staffAssignments}
                    coaches={coaches}
                  />
                ) : viewMode === 'month' ? (
                  <MonthView selectedDate={selectedDate} events={facilityEvents} onDateClick={(date) => canManageCalendar() && setShowAddFacilityEvent(date)} hoveredDate={hoveredDate} setHoveredDate={setHoveredDate} canManage={canManageCalendar()} allowEventClick={true} setSelectedEvent={setSelectedFacilityEvent} setShowEventDetail={setShowFacilityEventDetail} eventColorFn={(ev) => getFacilityColorClasses(ev?.color, 'month')} selecting={selecting} selectedIds={selectedIds} onToggleSelect={toggleSelect} onEventContextMenu={onEventContextMenu('facility')} onEventDrop={async (eventId, newDate) => {
                    const ev = facilityEvents.find(e => String(e.id) === String(eventId));
                    if (!ev || ev._is_virtual || ev.event_date === newDate) return;
                    const { error } = await supabase.from('facility_events').update({ event_date: newDate }).eq('id', eventId);
                    if (error) { alert('Failed to move event: ' + formatUserError(error)); return; }
                    fetchFacilityEvents();
                  }} />
                ) : (
                  <WeekView selectedDate={selectedDate} events={facilityEvents} onDateClick={(date) => canManageCalendar() && setShowAddFacilityEvent(date)} canManage={canManageCalendar()} allowEventClick={true} onEventClick={(ev) => { setSelectedFacilityEvent(ev); setShowFacilityEventDetail(true); }} eventColorFn={(ev) => getFacilityColorClasses(ev?.color, 'week')} selecting={selecting} selectedIds={selectedIds} onToggleSelect={toggleSelect} onEventContextMenu={onEventContextMenu('facility')} onEventDrop={async (eventId, newDate) => {
                    const ev = facilityEvents.find(e => String(e.id) === String(eventId));
                    if (!ev || ev._is_virtual || ev.event_date === newDate) return;
                    const { error } = await supabase.from('facility_events').update({ event_date: newDate }).eq('id', eventId);
                    if (error) { alert('Failed to move event: ' + formatUserError(error)); return; }
                    fetchFacilityEvents();
                  }} />
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Team/Player Calendar Container */}
      {view !== 'facility' && view !== 'my-schedule' && <><div className="flex space-x-4">{(userRole === 'admin' || userRole === 'coach') && <ProgramLibrarySidebar collapsed={libraryCollapsed} onToggle={() => setLibraryCollapsed(!libraryCollapsed)} />}<div className="bg-white rounded-lg shadow flex-1 min-w-0">
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
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => { setPlayerDropdownOpen(!playerDropdownOpen); if (playerDropdownOpen) setPlayerSearch(''); }}
                    className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white min-w-[240px] text-left flex items-center justify-between"
                  >
                    <span className="text-sm truncate">
                      {selectedPlayers.length === 0
                        ? (selectedPlayer ? (players.find(p => p.id === selectedPlayer)?.full_name || 'Select players...') : 'Select players...')
                        : selectedPlayers.length === 1
                          ? (players.find(p => p.id === selectedPlayers[0])?.full_name || '1 player')
                          : `${selectedPlayers.length} players selected`}
                    </span>
                    <ChevronRight size={16} className={`transition-transform ${playerDropdownOpen ? 'rotate-90' : ''}`} />
                  </button>
                  {playerDropdownOpen && (
                    <div className="absolute z-20 mt-1 w-72 bg-white border border-gray-300 rounded-lg shadow-lg max-h-80 flex flex-col">
                      <div className="p-2 border-b border-gray-200">
                        <div className="relative mb-2">
                          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                          <input
                            type="text"
                            value={playerSearch}
                            onChange={(e) => setPlayerSearch(e.target.value)}
                            placeholder="Search players..."
                            className="w-full pl-7 pr-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-500">{selectedPlayers.length} selected</span>
                          <button
                            type="button"
                            onClick={() => { setSelectedPlayers([]); setSelectedPlayer(null); }}
                            className="text-xs text-blue-600 hover:text-blue-800"
                          >
                            Clear all
                          </button>
                        </div>
                      </div>
                      <div className="overflow-y-auto flex-1">
                      {players.filter(p => !playerSearch || p.full_name.toLowerCase().includes(playerSearch.toLowerCase())).map((player) => {
                        const checked = selectedPlayers.includes(player.id);
                        const paletteIdx = selectedPlayers.indexOf(player.id);
                        return (
                          <label key={player.id} className="flex items-center space-x-2 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setSelectedPlayers(prev => {
                                  const next = prev.includes(player.id) ? prev.filter(id => id !== player.id) : [...prev, player.id];
                                  setSelectedPlayer(next[0] || null);
                                  return next;
                                });
                              }}
                              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                            />
                            {checked && paletteIdx >= 0 && (
                              <span className={`inline-block w-3 h-3 rounded-full ${PLAYER_OVERLAY_PALETTE[paletteIdx % PLAYER_OVERLAY_PALETTE.length].dot}`} />
                            )}
                            <span className="text-sm text-gray-900">{player.full_name}</span>
                          </label>
                        );
                      })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* View Mode Toggle */}
            <div className="flex items-center space-x-2">
              {canManageCalendar() && (
                <button
                  onClick={() => { if (selecting) exitSelectMode(); else setSelecting(true); }}
                  className={`px-3 py-1.5 rounded text-sm font-medium transition flex items-center space-x-1 ${selecting ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                >
                  <CheckSquare size={16} /><span>{selecting ? 'Done' : 'Select'}</span>
                </button>
              )}
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

          {selecting && selectedEvents.length > 0 && (
            <div className="mb-3 flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg p-2 px-3">
              <span className="text-sm text-blue-900 font-medium">{selectedEvents.length} selected</span>
              <div className="flex items-center space-x-2">
                <button onClick={bulkDelete} className="bg-red-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-red-700 transition flex items-center space-x-1">
                  <Trash2 size={14} /><span>Delete</span>
                </button>
                <button onClick={exitSelectMode} className="bg-gray-200 text-gray-700 px-3 py-1.5 rounded text-sm font-medium hover:bg-gray-300 transition">Cancel</button>
              </div>
            </div>
          )}

          {/* Month / Week Navigation */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => {
                if (viewMode === 'week') { const d = new Date(selectedDate); d.setDate(d.getDate() - 7); setSelectedDate(d); }
                else setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, 1));
              }}
              className="p-2 hover:bg-gray-100 rounded-lg transition"
            >
              <ChevronLeft size={20} />
            </button>
            <h3 className="text-xl font-semibold text-gray-900">
              {viewMode === 'week' ? getWeekRangeLabel(selectedDate) : selectedDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </h3>
            <button
              onClick={() => {
                if (viewMode === 'week') { const d = new Date(selectedDate); d.setDate(d.getDate() + 7); setSelectedDate(d); }
                else setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 1));
              }}
              className="p-2 hover:bg-gray-100 rounded-lg transition"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>

        {/* Calendar Grid */}
        <div className="p-6">
          {view === 'player' && selectedPlayers.length > 1 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {selectedPlayers.map((pid, idx) => {
                const player = players.find(p => p.id === pid);
                if (!player) return null;
                const c = PLAYER_OVERLAY_PALETTE[idx % PLAYER_OVERLAY_PALETTE.length];
                return (
                  <span key={pid} className="inline-flex items-center space-x-2 px-2 py-1 rounded-full bg-gray-100 text-xs">
                    <span className={`w-2.5 h-2.5 rounded-full ${c.dot}`} />
                    <span className="text-gray-800">{player.full_name}</span>
                  </span>
                );
              })}
            </div>
          )}
          {viewMode === 'month' ? (
            <MonthView
              selectedDate={selectedDate}
              events={events}
              onDateClick={(date) => canManageCalendar() && setShowAddPanel(date)}
              hoveredDate={hoveredDate}
              setHoveredDate={setHoveredDate}
              canManage={canManageCalendar()}
              allowEventClick={true}
              setSelectedEvent={setSelectedEvent}
              setShowEventDetail={setShowEventDetail}
              selecting={selecting}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onEventContextMenu={onEventContextMenu('team')}
              onProgramDrop={handleProgramDrop}
              onEventDrop={async (eventId, newDate) => {
                const ev = events.find(e => String(e.id) === String(eventId));
                if (!ev || ev.event_date === newDate) return;
                const { error } = await supabase.from('schedule_events').update({ event_date: newDate }).eq('id', eventId);
                if (error) { alert('Failed to move event: ' + formatUserError(error)); return; }
                if (view === 'team') fetchTeamEvents(); else fetchPlayerEvents();
              }}
              playerNames={(view === 'player' && selectedPlayers.length > 1) || view === 'team' ? players.reduce((m, p) => { m[p.id] = p.full_name; return m; }, {}) : null}
            />
          ) : (
            <WeekView
              selectedDate={selectedDate}
              events={events}
              onDateClick={(date) => canManageCalendar() && setShowAddPanel(date)}
              canManage={canManageCalendar()}
              allowEventClick={true}
              onEventClick={(ev) => { setSelectedEvent(ev); setShowEventDetail(true); }}
              selecting={selecting}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onEventContextMenu={onEventContextMenu('team')}
              onProgramDrop={handleProgramDrop}
              onEventDrop={async (eventId, newDate) => {
                const ev = events.find(e => String(e.id) === String(eventId));
                if (!ev || ev.event_date === newDate) return;
                const { error } = await supabase.from('schedule_events').update({ event_date: newDate }).eq('id', eventId);
                if (error) { alert('Failed to move event: ' + formatUserError(error)); return; }
                if (view === 'team') fetchTeamEvents(); else fetchPlayerEvents();
              }}
              playerNames={(view === 'player' && selectedPlayers.length > 1) || view === 'team' ? players.reduce((m, p) => { m[p.id] = p.full_name; return m; }, {}) : null}
            />
          )}
        </div>
      </div>
      </div>

      {/* Add Event Panel */}
      {showAddPanel && (
        <AddEventPanel
          date={showAddPanel}
          view={view}
          teamId={selectedTeam}
          playerIds={selectedPlayers.length > 0 ? selectedPlayers : (selectedPlayer ? [selectedPlayer] : [])}
          onClose={() => setShowAddPanel(null)}
          onSuccess={() => {
            setShowAddPanel(null);
            if (view === 'team') fetchTeamEvents();
            else fetchPlayerEvents();
          }}
        />
      )}

      {/* Event Detail/Edit Modal */}
      </>}

      {/* Event detail modal — rendered at top level so it works in every view
          (team/player AND the player's My Schedule view). Previously this lived
          inside the team/player fragment, so players clicking a workout on their
          own schedule set the state but no modal ever mounted (#153, #159). */}
      {showEventDetail && selectedEvent && (
        selectedEvent.event_type === 'workout' ? (
          <WorkoutDetailModal
            event={selectedEvent}
            userRole={userRole}
            onClose={() => {
              setShowEventDetail(false);
              setSelectedEvent(null);
            }}
            onDelete={() => {
              setShowEventDetail(false);
              setSelectedEvent(null);
              if (view === 'team') fetchTeamEvents();
              else if (view === 'my-schedule') fetchMyScheduleEvents();
              else fetchPlayerEvents();
            }}
          />
        ) : (
          <EventDetailModal
            event={selectedEvent}
            userRole={userRole}
            userId={userId}
            onClose={() => {
              setShowEventDetail(false);
              setSelectedEvent(null);
            }}
            onDelete={() => {
              setShowEventDetail(false);
              setSelectedEvent(null);
              if (view === 'team') fetchTeamEvents();
              else if (view === 'my-schedule') fetchMyScheduleEvents();
              else fetchPlayerEvents();
            }}
            onUpdate={() => {
              setShowEventDetail(false);
              setSelectedEvent(null);
              if (view === 'team') fetchTeamEvents();
              else if (view === 'my-schedule') fetchMyScheduleEvents();
              else fetchPlayerEvents();
            }}
          />
        )
      )}

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
          userId={userId}
          userRole={userRole}
          coaches={coaches}
          onClose={() => { setShowFacilityEventDetail(false); setSelectedFacilityEvent(null); }}
          onUpdate={() => { setShowFacilityEventDetail(false); setSelectedFacilityEvent(null); fetchFacilityEvents(); }}
          onDelete={() => { setShowFacilityEventDetail(false); setSelectedFacilityEvent(null); fetchFacilityEvents(); }}
        />
      )}
      {/* Training Slot Panels */}
      {showCreateSlot && selectedCoach && (
        <CreateSlotPanel
          onClose={() => setShowCreateSlot(null)}
          onSuccess={() => { setShowCreateSlot(null); if (selectedCoach) fetchCoachSlots(selectedCoach.id); }}
          coachId={selectedCoach.id}
          coachName={selectedCoach.full_name}
          initialDate={typeof showCreateSlot === 'string' && showCreateSlot !== 'new' ? showCreateSlot : null}
        />
      )}
      {showEditSlot && selectedCoach && (
        <CreateSlotPanel
          onClose={() => setShowEditSlot(null)}
          onSuccess={() => { setShowEditSlot(null); if (selectedCoach) fetchCoachSlots(selectedCoach.id); }}
          coachId={selectedCoach.id}
          coachName={selectedCoach.full_name}
          existingSlot={showEditSlot}
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
      {ctxMenu && (
        <CalendarContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />
      )}
      {recurrencePrompt && (
        <RecurrenceDecisionModal
          title="This is a recurring event"
          message="What part of the series do you want to delete?"
          actionLabel="Delete"
          allowOne={recurrencePrompt.allowOne !== false}
          onPick={recurrencePrompt.onPick}
          onClose={() => setRecurrencePrompt(null)}
        />
      )}
      {copyToPicker && (
        <CopyToPickerModal
          title={copyToPicker.title}
          options={copyToPicker.options}
          actionLabel={copyToPicker.actionLabel || 'Copy'}
          onPick={copyToPicker.onPick}
          onClose={() => setCopyToPicker(null)}
        />
      )}
    </div>
  );
}

// ============================================
// MONTH VIEW
// ============================================

function MonthView({ selectedDate, events, onDateClick, hoveredDate, setHoveredDate, canManage, setSelectedEvent, setShowEventDetail, eventColorFn, onEventDrop, allowEventClick, selecting, selectedIds, onToggleSelect, onEventContextMenu, onProgramDrop, playerNames }) {
  const eventsAreClickable = canManage || allowEventClick;
  const isSelected = (e) => selecting && selectedIds && selectedIds.has(String(e.id));
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

  const formatLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const getEventsForDate = (date) => {
    const dateStr = formatLocal(date);
    return events.filter(e => e.event_date === dateStr);
  };

  const getEventColor = (event) => {
    const eventType = typeof event === 'string' ? event : event?.event_type;
    if (eventType === 'workout') {
      // Prefer the explicit category column set at drag/drop time (#191); fall
      // back to title heuristic for legacy rows that don't have it yet.
      const cat = (typeof event === 'object' && event?.category) || getWorkoutCategory(typeof event === 'string' ? '' : event?.title);
      switch(cat) {
        case 'hitting': return 'bg-blue-500 text-white border-blue-600';
        case 'pitching': return 'bg-green-500 text-white border-green-600';
        case 'fielding': return 'bg-green-500 text-white border-green-600';
        case 'strength': return 'bg-orange-500 text-white border-orange-600';
        case 'recovery': return 'bg-purple-500 text-white border-purple-600';
        case 'warmup': return 'bg-purple-500 text-white border-purple-600';
        case 'mobility': return 'bg-purple-500 text-white border-purple-600';
        case 'conditioning': return 'bg-yellow-500 text-white border-yellow-600';
        default: return 'bg-gray-500 text-white border-gray-600';
      }
    }
    switch(eventType) {
      case 'game': return 'bg-slate-600 text-white border-slate-700';
      case 'practice': return 'bg-green-500 text-white border-green-600';
      case 'tryout': return 'bg-amber-500 text-white border-amber-600';
      case 'meal': return 'bg-yellow-400 text-yellow-900 border-yellow-500';
      case 'training_slot': return 'bg-teal-500 text-white border-teal-600';
      default: return 'bg-gray-500 text-white border-gray-600';
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
          const dateStr = formatLocal(day.date);
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
              onDragOver={(e) => {
                if (!day.isCurrentMonth) return;
                const types = [...e.dataTransfer.types];
                if (types.includes('application/x-program-item') && onProgramDrop) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'copy';
                } else if (types.includes('application/x-event-id') && canManage && onEventDrop) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }
              }}
              onDrop={(e) => {
                if (!day.isCurrentMonth) return;
                e.preventDefault();
                const eventId = e.dataTransfer.getData('application/x-event-id');
                if (eventId && canManage && onEventDrop) { onEventDrop(eventId, dateStr); return; }
                const programData = e.dataTransfer.getData('application/x-program-item');
                if (programData && onProgramDrop) {
                  try { onProgramDrop(JSON.parse(programData), dateStr); } catch (_) {}
                }
              }}
            >
              {/* Date number */}
              <div className={`text-sm font-medium mb-1 ${
                !day.isCurrentMonth ? 'text-gray-400' :
                isToday ? 'text-blue-600 font-bold' : 'text-gray-900'
              }`}>
                {day.date.getDate()}
              </div>

              {/* Events */}
              <div className="space-y-1 max-h-[140px] overflow-y-auto">
                {dayEvents.map(event => (
                  <div
                    key={event.id}
                    draggable={canManage && !selecting && !event._is_virtual && !event._isMealPlan && !!onEventDrop}
                    onDragStart={(e) => {
                      e.stopPropagation();
                      e.dataTransfer.setData('application/x-event-id', String(event.id));
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (selecting && onToggleSelect) { onToggleSelect(event); return; }
                      if (eventsAreClickable && setSelectedEvent && setShowEventDetail) {
                        setSelectedEvent(event);
                        setShowEventDetail(true);
                      }
                    }}
                    onContextMenu={(e) => { if (onEventContextMenu) { e.preventDefault(); e.stopPropagation(); onEventContextMenu(event, e); } }}
                    className={`text-xs px-2 py-1 rounded border truncate flex items-center justify-between gap-1 group/event ${(eventColorFn && eventColorFn(event)) || getEventColor(event)} ${eventsAreClickable ? 'cursor-pointer hover:opacity-75' : ''} ${isSelected(event) ? 'ring-2 ring-blue-500' : ''}`}
                    title={canManage ? `Right-click for options. Drag to reschedule: ${event.title || event.opponent || event.event_type}` : event.title || event.opponent || event.event_type}
                  >
                    <span className="truncate">
                      {isSelected(event) && <Check size={10} className="inline mr-1" />}
                      {playerNames && event.player_id && playerNames[event.player_id] && (
                        <span className="font-semibold mr-1 opacity-70">{playerNames[event.player_id].split(' ').map(n => n[0]).join('')}</span>
                      )}
                      {(event.start_time || event.event_time) && <span className="font-medium">{formatTimeDisplay(event.start_time || event.event_time)} </span>}
                      {event.title || event.opponent || event.event_type}
                    </span>
                    {canManage && !selecting && <Edit2 size={10} className="flex-shrink-0 opacity-0 group-hover/event:opacity-70 transition" />}
                  </div>
                ))}
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

function WeekView({ selectedDate, events, onDateClick, canManage, eventColorFn, onEventClick, onEventDrop, allowEventClick, selecting, selectedIds, onToggleSelect, onEventContextMenu, onProgramDrop, playerNames }) {
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

  const formatLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const getEventsForDate = (date) => {
    const dateStr = formatLocal(date);
    return events.filter(e => e.event_date === dateStr);
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="grid grid-cols-7 divide-x divide-gray-200">
        {weekDays.map((date, idx) => {
          const dateStr = formatLocal(date);
          const dayEvents = getEventsForDate(date);
          const isToday = date.getTime() === today.getTime();

          return (
            <div
              key={idx}
              className="min-h-[400px] bg-white"
              onDragOver={(e) => {
                const types = [...e.dataTransfer.types];
                if (types.includes('application/x-program-item') && onProgramDrop) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'copy';
                } else if (types.includes('application/x-event-id') && canManage && onEventDrop) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                const eventId = e.dataTransfer.getData('application/x-event-id');
                if (eventId && canManage && onEventDrop) { onEventDrop(eventId, dateStr); return; }
                const programData = e.dataTransfer.getData('application/x-program-item');
                if (programData && onProgramDrop) {
                  try { onProgramDrop(JSON.parse(programData), dateStr); } catch (_) {}
                }
              }}
            >
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
                  <EventCard
                    key={event.id}
                    event={event}
                    compact
                    eventColorFn={eventColorFn}
                    playerNames={playerNames}
                    onClick={(ev) => {
                      if (selecting && onToggleSelect) { onToggleSelect(ev); return; }
                      if ((canManage || allowEventClick) && onEventClick) onEventClick(ev);
                    }}
                    onContextMenu={onEventContextMenu}
                    draggable={canManage && !selecting && !event._is_virtual && !event._isMealPlan && !!onEventDrop}
                    selected={selecting && selectedIds && selectedIds.has(String(event.id))}
                  />
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

function EventCard({ event, compact, eventColorFn, onClick, draggable, onContextMenu, selected, playerNames }) {
  const getEventColor = (ev) => {
    const eventType = typeof ev === 'string' ? ev : ev?.event_type;
    if (eventType === 'workout') {
      // Match MonthView palette: read explicit category first (#191).
      const cat = (typeof ev === 'object' && ev?.category) || getWorkoutCategory(typeof ev === 'string' ? '' : ev?.title);
      switch(cat) {
        case 'hitting': return 'border-l-4 border-blue-600 bg-blue-100';
        case 'pitching': return 'border-l-4 border-green-600 bg-green-100';
        case 'fielding': return 'border-l-4 border-green-600 bg-green-100';
        case 'strength': return 'border-l-4 border-orange-600 bg-orange-100';
        case 'recovery': return 'border-l-4 border-purple-600 bg-purple-100';
        case 'warmup': return 'border-l-4 border-purple-600 bg-purple-100';
        case 'mobility': return 'border-l-4 border-purple-600 bg-purple-100';
        case 'conditioning': return 'border-l-4 border-yellow-600 bg-yellow-100';
        default: return 'border-l-4 border-gray-600 bg-gray-100';
      }
    }
    switch(eventType) {
      case 'game': return 'border-l-4 border-slate-600 bg-slate-100';
      case 'practice': return 'border-l-4 border-green-600 bg-green-100';
      case 'tryout': return 'border-l-4 border-amber-600 bg-amber-100';
      case 'meal': return 'border-l-4 border-yellow-600 bg-yellow-100';
      case 'training_slot': return 'border-l-4 border-teal-600 bg-teal-100';
      default: return 'border-l-4 border-gray-600 bg-gray-100';
    }
  };

  const displayText = event.title || event.opponent || event.event_type;
  const clickable = typeof onClick === 'function';

  return (
    <div
      className={`p-2 rounded relative group ${(eventColorFn && eventColorFn(event)) || getEventColor(event)} ${clickable ? 'cursor-pointer hover:opacity-80 transition' : ''} ${selected ? 'ring-2 ring-blue-500' : ''}`}
      onClick={clickable ? (e) => { e.stopPropagation(); onClick(event); } : undefined}
      onContextMenu={(e) => { if (onContextMenu) { e.preventDefault(); e.stopPropagation(); onContextMenu(event, e); } }}
      draggable={!!draggable}
      onDragStart={draggable ? (e) => {
        e.stopPropagation();
        e.dataTransfer.setData('application/x-event-id', String(event.id));
        e.dataTransfer.effectAllowed = 'move';
      } : undefined}
      title={clickable ? (draggable ? 'Right-click for options. Drag to reschedule.' : 'Click to edit') : undefined}
    >
      {clickable && (
        <Edit2 size={12} className="absolute top-1.5 right-1.5 text-gray-500 opacity-0 group-hover:opacity-100 transition" />
      )}
      <div className="text-xs font-semibold text-gray-900 pr-4">
        {playerNames && event.player_id && playerNames[event.player_id] && (
          <span className="opacity-70 mr-1">{playerNames[event.player_id].split(' ').map(n => n[0]).join('')}</span>
        )}
        {displayText}
      </div>
      <div className="text-xs text-gray-600 mt-1">{formatTimeDisplay(event.event_time) || 'TBD'}</div>
      {!compact && event.location && (
        <div className="text-xs text-gray-500 mt-1">{event.location}</div>
      )}
    </div>
  );
}

// ============================================
// LANE VIEW (Daily Schedule by Lane)
// ============================================

function LaneView({ selectedDate, events, laneDate, setLaneDate, canManage, onCellClick, onEventClick, staffEvents = [], staffAssignments = [], coaches = [] }) {
  const LANES = ['Lane 1', 'Lane 2', 'Lane 3', 'Lane 4', 'Lane 5', 'Lane 6', 'Lane 7', 'Turf Field', 'Main Weight Room', 'Top Weight Room', 'Speed & Agility'];

  // Generate 15-minute time slots from 6:00 AM to 10:00 PM
  const timeSlots = [];
  for (let h = 6; h <= 22; h++) {
    for (let m = 0; m < 60; m += 15) {
      const hour = String(h).padStart(2, '0');
      const min = String(m).padStart(2, '0');
      timeSlots.push(`${hour}:${min}`);
    }
  }

  const dateStr = laneDate || fmtLocalDate(new Date());

  // Filter events for this date
  const dayEvents = events.filter(ev => ev.event_date === dateStr);

  // Parse time to slot index
  const timeToIndex = (timeStr) => {
    if (!timeStr) return -1;
    const [h, m] = timeStr.split(':').map(Number);
    return (h - 6) * 4 + Math.floor(m / 15);
  };

  // Build a map: lane -> array of {startIdx, span, event}
  const laneEvents = {};
  LANES.forEach(lane => { laneEvents[lane] = []; });

  dayEvents.forEach(ev => {
    const evLanes = ev.lanes || [];
    const startTime = ev.start_time || ev.event_time;
    if (!startTime) return;
    const startIdx = timeToIndex(startTime);
    if (startIdx < 0) return;
    const endTime = ev.end_time;
    const endIdx = endTime ? timeToIndex(endTime) : startIdx + 4; // default 1 hour
    const span = Math.max(endIdx - startIdx, 1);

    evLanes.forEach(lane => {
      if (laneEvents[lane]) {
        laneEvents[lane].push({ startIdx, span, event: ev });
      }
    });
  });

  // Assign each lane's events to non-overlapping tracks so overlapping events render as stacked rows
  const assignTracks = (entries) => {
    const sorted = [...entries].sort((a, b) => a.startIdx - b.startIdx);
    const tracks = [];
    for (const entry of sorted) {
      let placed = false;
      for (const track of tracks) {
        const last = track[track.length - 1];
        if (last.startIdx + last.span <= entry.startIdx) {
          track.push(entry);
          placed = true;
          break;
        }
      }
      if (!placed) tracks.push([entry]);
    }
    return tracks;
  };

  const laneTracks = {};
  LANES.forEach(lane => { laneTracks[lane] = assignTracks(laneEvents[lane]); });

  const formatLabel = (slot) => {
    const [h, m] = slot.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${hour12}:${String(m).padStart(2, '0')} ${ampm}`;
  };

  const prevDay = () => {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    setLaneDate(fmtLocalDate(d));
  };
  const nextDay = () => {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + 1);
    setLaneDate(fmtLocalDate(d));
  };

  const handleEmptyClick = (lane, slot) => {
    if (!canManage || !onCellClick) return;
    const [h, m] = slot.split(':').map(Number);
    const endH = m + 60 >= 60 ? h + 1 : h;
    const endM = (m + 60) % 60;
    const endSlot = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
    onCellClick({ date: dateStr, lane, startTime: slot, endTime: endSlot });
  };

  const SLOT_WIDTH = 48; // px per 15-min slot

  return (
    <div>
      <div className="flex items-center justify-center space-x-4 mb-4">
        <button onClick={prevDay} className="p-1 hover:bg-gray-100 rounded transition"><ChevronLeft size={18} /></button>
        <div className="flex items-center space-x-2">
          <input type="date" value={dateStr} onChange={(e) => setLaneDate(e.target.value)} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          <span className="text-sm font-medium text-gray-700">
            {new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </span>
        </div>
        <button onClick={nextDay} className="p-1 hover:bg-gray-100 rounded transition"><ChevronRight size={18} /></button>
      </div>
      <div className="overflow-x-auto overflow-y-auto border border-gray-200 rounded-lg max-w-full" style={{ maxHeight: 'calc(100vh - 320px)' }}>
        <table className="border-collapse text-xs" style={{ tableLayout: 'fixed' }}>
          <thead className="sticky top-0 z-20 bg-white">
            <tr>
              <th className="border border-gray-200 bg-gray-50 px-2 py-2 text-left text-xs font-semibold text-gray-700 sticky left-0 z-30" style={{ width: 130, minWidth: 130 }}>
                Lane
              </th>
              {timeSlots.map((slot) => {
                const isHour = slot.endsWith(':00');
                return (
                  <th
                    key={slot}
                    className={`border border-gray-200 px-0 py-1 text-center text-[10px] font-medium text-gray-600 ${isHour ? 'bg-gray-100' : 'bg-gray-50'}`}
                    style={{ width: SLOT_WIDTH, minWidth: SLOT_WIDTH }}
                  >
                    {isHour ? formatLabel(slot) : ''}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {LANES.flatMap((lane) => {
              const tracks = laneTracks[lane];
              const renderTracks = tracks.length === 0 ? [[]] : tracks;
              return renderTracks.map((track, trackIdx) => (
                <tr key={`${lane}-${trackIdx}`}>
                  {trackIdx === 0 && (
                    <td
                      rowSpan={renderTracks.length}
                      className="border border-gray-200 bg-gray-50 px-2 py-2 text-xs font-semibold text-gray-700 sticky left-0 z-10"
                      style={{ width: 130, minWidth: 130 }}
                    >
                      {lane}
                    </td>
                  )}
                  {timeSlots.map((slot, slotIdx) => {
                    const entry = track.find(e => e.startIdx === slotIdx);
                    if (entry) {
                      const colorClasses = getFacilityColorClasses(entry.event.color, 'lane');
                      return (
                        <td
                          key={slot}
                          colSpan={entry.span}
                          className="border border-gray-200 p-0.5 align-top"
                          style={{ width: SLOT_WIDTH * entry.span }}
                        >
                          <button
                            type="button"
                            onClick={() => onEventClick && onEventClick(entry.event)}
                            className={`${colorClasses} rounded px-1 py-1 h-full w-full text-left hover:opacity-80 transition`}
                          >
                            <div className="font-semibold truncate text-xs">{entry.event.title || entry.event.opponent}</div>
                            <div className="truncate text-[10px] opacity-80">
                              {formatTimeDisplay(entry.event.start_time || entry.event.event_time)}
                              {entry.event.end_time ? `–${formatTimeDisplay(entry.event.end_time)}` : ''}
                            </div>
                          </button>
                        </td>
                      );
                    }
                    // Skip cells consumed by the colSpan of an earlier event in this track
                    const covered = track.some(e => slotIdx > e.startIdx && slotIdx < e.startIdx + e.span);
                    if (covered) return null;
                    const isHour = slot.endsWith(':00');
                    return (
                      <td
                        key={slot}
                        onClick={() => handleEmptyClick(lane, slot)}
                        className={`border border-gray-200 ${isHour ? 'bg-gray-50/40' : ''} ${canManage ? 'cursor-pointer hover:bg-teal-50' : ''}`}
                        style={{ width: SLOT_WIDTH, minWidth: SLOT_WIDTH, height: 40 }}
                      />
                    );
                  })}
                </tr>
              ));
            })}
            {/* Staff Schedule separator */}
            {coaches.length > 0 && (
              <tr>
                <td
                  colSpan={timeSlots.length + 1}
                  className="bg-indigo-50 border border-indigo-200 px-3 py-2 text-xs font-bold text-indigo-700 sticky left-0"
                >
                  Staff Schedule
                </td>
              </tr>
            )}
            {/* Staff rows */}
            {coaches.map((coach) => {
              // Find events assigned to this coach
              const coachEventIds = staffAssignments
                .filter(a => a.user_id === coach.id)
                .map(a => a.event_id);
              const coachStaffEvents = staffEvents.filter(ev => coachEventIds.includes(ev.id));

              // Convert ISO timestamps to slot indices
              const entries = coachStaffEvents.map(ev => {
                const start = new Date(ev.start_at);
                const end = new Date(ev.end_at);
                const startIdx = (start.getHours() - 6) * 4 + Math.floor(start.getMinutes() / 15);
                const endIdx = (end.getHours() - 6) * 4 + Math.floor(end.getMinutes() / 15);
                return { startIdx: Math.max(startIdx, 0), span: Math.max(endIdx - startIdx, 1), event: ev };
              }).filter(e => e.startIdx >= 0 && e.startIdx < timeSlots.length);

              const tracks = assignTracks(entries);
              const renderTracks = tracks.length === 0 ? [[]] : tracks;

              return renderTracks.map((track, trackIdx) => (
                <tr key={`staff-${coach.id}-${trackIdx}`}>
                  {trackIdx === 0 && (
                    <td
                      rowSpan={renderTracks.length}
                      className="border border-indigo-200 bg-indigo-50 px-2 py-2 text-xs font-semibold text-indigo-700 sticky left-0 z-10"
                      style={{ width: 130, minWidth: 130 }}
                    >
                      {coach.full_name.split(' ')[0]}
                    </td>
                  )}
                  {timeSlots.map((slot, slotIdx) => {
                    const entry = track.find(e => e.startIdx === slotIdx);
                    if (entry) {
                      return (
                        <td
                          key={slot}
                          colSpan={entry.span}
                          className="border border-indigo-200 p-0.5 align-top"
                          style={{ width: SLOT_WIDTH * entry.span }}
                        >
                          <div className="bg-indigo-100 text-indigo-800 border border-indigo-300 rounded px-1 py-1 h-full w-full text-left">
                            <div className="font-semibold truncate text-xs">{entry.event.title}</div>
                            <div className="truncate text-[10px] opacity-80">
                              {new Date(entry.event.start_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                              {entry.event.end_at ? `–${new Date(entry.event.end_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}
                            </div>
                          </div>
                        </td>
                      );
                    }
                    const covered = track.some(e => slotIdx > e.startIdx && slotIdx < e.startIdx + e.span);
                    if (covered) return null;
                    const isHour = slot.endsWith(':00');
                    return (
                      <td
                        key={slot}
                        className={`border border-indigo-100 ${isHour ? 'bg-indigo-50/30' : ''}`}
                        style={{ width: SLOT_WIDTH, minWidth: SLOT_WIDTH, height: 40 }}
                      />
                    );
                  })}
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================
// ADD EVENT PANEL
// ============================================

export function AddEventPanel({ date, view, teamId, playerIds = [], onClose, onSuccess }) {
  const [eventType, setEventType] = useState(null); // 'team-event', 'workout', 'meal'
  const [workoutType, setWorkoutType] = useState(null); // 'single-day', 'program'
  const [mealType, setMealType] = useState(null); // 'single-meal', 'plan'
  
  const LANE_OPTIONS = ['Lane 1', 'Lane 2', 'Lane 3', 'Lane 4', 'Lane 5', 'Lane 6', 'Lane 7', 'Turf Field', 'Main Weight Room', 'Top Weight Room', 'Speed & Agility'];
  const [teamEventData, setTeamEventData] = useState({
    event_type: 'practice',
    opponent: '',
    event_time: '',
    location: '',
    address: '',
    home_away: null,
    is_optional: false,
    notes: '',
    lanes: []
  });
  const [timeTBD, setTimeTBD] = useState(false);

  const [trainingPrograms, setTrainingPrograms] = useState([]);
  const [trainingDays, setTrainingDays] = useState([]);
  const [meals, setMeals] = useState([]);
  const [mealPlans, setMealPlans] = useState([]);
  const [selectedProgramId, setSelectedProgramId] = useState('');
  const [selectedDayId, setSelectedDayId] = useState('');
  const [selectedMealId, setSelectedMealId] = useState('');
  const [selectedMealPlanId, setSelectedMealPlanId] = useState('');
  const [mealsPerDay, setMealsPerDay] = useState(3);
  const [workoutSelectionMode, setWorkoutSelectionMode] = useState(null); // 'existing' or 'create'
  const [mealSelectionMode, setMealSelectionMode] = useState(null); // 'existing' or 'create'
  const [newWorkoutData, setNewWorkoutData] = useState({ title: '', notes: '', program: 'No Program', folder: '', exercises: [{ name: '', sets: '', reps: '', rest: '', load: '', link: '' }] });
  const [workoutTemplates, setWorkoutTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [newMealData, setNewMealData] = useState({ 
    name: '', 
    description: '', 
    meal_type: 'breakfast',
    calories: '',
    protein_g: '',
    carbs_g: '',
    fat_g: ''
  });
  const [programEndDate, setProgramEndDate] = useState('');
  const [programWeekdays, setProgramWeekdays] = useState([false, true, true, true, true, true, false]); // Mon-Fri default
  const [loading, setLoading] = useState(false);

  // Lesson / assessment booking (#214)
  const [lessonData, setLessonData] = useState({
    lesson_type: 'lesson', // 'lesson' or 'assessment'
    coach_id: '',
    event_time: '',
    event_end_time: '',
    location: '',
    notes: '',
  });
  const [coaches, setCoaches] = useState([]);

  useEffect(() => {
    if (eventType === 'workout') {
      fetchTrainingPrograms();
      fetchWorkoutTemplates();
    } else if (eventType === 'meal') {
      fetchMeals();
      fetchMealPlans();
    } else if (eventType === 'lesson') {
      fetchCoaches();
    }
  }, [eventType]);

  const fetchCoaches = async () => {
    const { data } = await supabase
      .from('users')
      .select('id, full_name')
      .in('role', ['admin', 'coach'])
      .order('full_name');
    setCoaches(data || []);
  };

  const fetchWorkoutTemplates = async () => {
    const { data } = await supabase
      .from('workout_templates')
      .select('*')
      .order('created_at');
    // Group by program, then training-cycle order within each (month → week → day type) (#158)
    const sorted = (data || []).sort((a, b) => {
      const pa = a.program || '', pb = b.program || '';
      if (pa !== pb) return pa.localeCompare(pb);
      return compareTemplates(a, b);
    });
    setWorkoutTemplates(sorted);
  };

  useEffect(() => {
    if (selectedProgramId) {
      fetchTrainingDays(selectedProgramId);
    }
  }, [selectedProgramId]);

  const fetchTrainingPrograms = async () => {
    const { data } = await supabase
      .from('training_programs')
      .select('id, name, description')
      .order('created_at'); // build order, not alphabetical (#158)
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

    // Normalize the date prop (Date object or string) to a local YYYY-MM-DD string
    // to avoid the toISOString UTC drift that shifts dates by a day.
    const dateStr = (() => {
      if (typeof date === 'string') return date;
      if (date instanceof Date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      }
      return date;
    })();

    try {
      // For meal/workout events on a team, expand to every team member.
      if ((eventType === 'workout' || eventType === 'meal') && playerIds.length === 0 && view === 'team' && teamId) {
        const { data: members, error: membersErr } = await supabase
          .from('team_members')
          .select('user_id')
          .eq('team_id', teamId);
        if (membersErr) throw membersErr;
        playerIds = (members || []).map(m => m.user_id).filter(Boolean);
        if (playerIds.length === 0) {
          throw new Error('This team has no members. Add players to the team before scheduling.');
        }
      }

      // Guard: meal/workout events require at least one player
      if ((eventType === 'workout' || eventType === 'meal') && playerIds.length === 0) {
        throw new Error('No player selected. Please select a player first.');
      }

      if (eventType === 'lesson') {
        // Book a lesson or assessment for the selected player(s) (#214)
        if (playerIds.length === 0) {
          throw new Error('No player selected. Please select a player first.');
        }
        const coach = coaches.find(c => c.id === lessonData.coach_id);
        const typeLabel = lessonData.lesson_type === 'assessment' ? 'Assessment' : 'Lesson';
        const title = coach ? `${typeLabel} with ${coach.full_name}` : typeLabel;
        const rows = playerIds.map(pid => ({
          player_id: pid,
          event_type: lessonData.lesson_type, // 'lesson' or 'assessment'
          event_date: dateStr,
          event_time: timeTBD ? null : (lessonData.event_time || null),
          event_end_time: lessonData.event_end_time || null,
          title,
          location: lessonData.location || null,
          notes: lessonData.notes || null,
        }));
        const { error } = await supabase.from('schedule_events').insert(rows);
        if (error) throw error;

      } else if (eventType === 'team-event') {
        // Create team event
        const { error } = await supabase
          .from('schedule_events')
          .insert({
            team_id: teamId,
            team_ids: [teamId],
            event_type: teamEventData.event_type,
            opponent: teamEventData.opponent,
            event_date: dateStr,
            event_time: timeTBD ? null : (teamEventData.event_time || null),
            location: teamEventData.location,
            address: teamEventData.address || null,
            home_away: teamEventData.event_type === 'game' ? teamEventData.home_away : null,
            is_optional: teamEventData.is_optional,
            notes: teamEventData.notes || null,
            lanes: teamEventData.lanes.length > 0 ? teamEventData.lanes : null
          });

        if (error) throw error;

      } else if (eventType === 'workout') {
        if (workoutType === 'single-day') {
          if (workoutSelectionMode === 'create') {
            // Create new workout with exercises
            const filteredExercises = (newWorkoutData.exercises || []).filter(ex => ex.name.trim());
            const notesWithExercises = [
              newWorkoutData.notes || '',
              filteredExercises.length > 0 ? '\n--- Exercises ---\n' + filteredExercises.map(ex =>
                [ex.name, ex.sets && ex.reps ? `${ex.sets}x${ex.reps}` : (ex.sets || ''), ex.rest || '', ex.load || '', ex.link || ''].join(' | ')
              ).join('\n') : ''
            ].filter(Boolean).join('\n');

            const rows = playerIds.map(pid => ({
              player_id: pid,
              event_type: 'workout',
              event_date: dateStr,
              title: newWorkoutData.title,
              notes: notesWithExercises || null
            }));
            const { error } = await supabase.from('schedule_events').insert(rows);

            if (error) {
              console.error('Error creating new workout:', error);
              throw error;
            }
          } else if (workoutSelectionMode === 'template') {
            // Apply workout template to calendar
            const template = workoutTemplates.find(t => t.id === selectedTemplateId);
            if (template) {
              const exercises = template.exercises || [];
              const notesWithExercises = [
                template.notes || '',
                exercises.length > 0 ? '\n--- Exercises ---\n' + exercises.map(ex =>
                  [ex.name, ex.sets && ex.reps ? `${ex.sets}x${ex.reps}` : (ex.sets || ''), ex.rest || '', ex.load || '', ex.link || ''].join(' | ')
                ).join('\n') : ''
              ].filter(Boolean).join('\n');

              const rows = playerIds.map(pid => ({
                player_id: pid,
                event_type: 'workout',
                event_date: dateStr,
                title: template.name,
                notes: notesWithExercises || null
              }));
              const { error } = await supabase.from('schedule_events').insert(rows);
              if (error) throw error;
            }
          } else {
            // Create single workout day event from existing program
            const day = trainingDays.find(d => d.id === selectedDayId);
            const rows = playerIds.map(pid => ({
              player_id: pid,
              event_type: 'workout',
              event_date: dateStr,
              title: day?.title || `Day ${day?.day_number}`,
              training_day_id: selectedDayId
            }));
            const { error } = await supabase.from('schedule_events').insert(rows);

            if (error) {
              console.error('Error creating workout event:', error);
              throw error;
            }
          }
        } else if (workoutType === 'program') {
          // Assign full training program to all selected players
          const { data: { user } } = await supabase.auth.getUser();
          const endDateVal = programEndDate || null;
          const assignRows = playerIds.map(pid => ({
            program_id: selectedProgramId,
            player_id: pid,
            start_date: dateStr,
            end_date: endDateVal,
            assigned_by: user?.id
          }));
          const { error } = await supabase.from('training_program_assignments').insert(assignRows);

          if (error) throw error;

          // Generate calendar events if end date and weekdays are set
          if (programEndDate && programWeekdays.some(Boolean)) {
            const { data: days } = await supabase
              .from('training_days')
              .select('id, day_number, title')
              .eq('program_id', selectedProgramId)
              .order('day_number');
            const sortedDays = days || [];
            if (sortedDays.length > 0) {
              const program = trainingPrograms.find(p => p.id === selectedProgramId);
              const start = new Date(dateStr + 'T00:00:00');
              const end = new Date(programEndDate + 'T00:00:00');
              const matchingDates = [];
              for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                if (programWeekdays[d.getDay()]) matchingDates.push(fmtLocalDate(d));
              }
              const rows = [];
              matchingDates.forEach((ds, idx) => {
                const day = sortedDays[idx % sortedDays.length];
                playerIds.forEach(pid => {
                  rows.push({
                    player_id: pid,
                    event_type: 'workout',
                    event_date: ds,
                    title: day.title || `${program?.name || 'Program'} - Day ${day.day_number}`,
                    training_program_id: selectedProgramId,
                    training_day_id: day.id,
                  });
                });
              });
              if (rows.length > 0) {
                const BATCH = 500;
                for (let i = 0; i < rows.length; i += BATCH) {
                  const { error: insErr } = await supabase.from('schedule_events').insert(rows.slice(i, i + BATCH));
                  if (insErr) throw insErr;
                }
              }
            }
          }
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

            // Now create schedule events referencing the new meal for all selected players
            const mealEventRows = playerIds.map(pid => ({
              player_id: pid,
              event_type: 'meal',
              event_date: dateStr,
              title: newMeal.name,
              meal_id: newMeal.id
            }));
            const { error: scheduleError } = await supabase.from('schedule_events').insert(mealEventRows);

            if (scheduleError) {
              console.error('Error creating meal event:', scheduleError);
              throw scheduleError;
            }
          } else {
            // Create single meal event from existing meal for all selected players
            const meal = meals.find(m => m.id === selectedMealId);
            const mealRows = playerIds.map(pid => ({
              player_id: pid,
              event_type: 'meal',
              event_date: dateStr,
              title: meal?.name,
              meal_id: selectedMealId
            }));
            const { error } = await supabase.from('schedule_events').insert(mealRows);

            if (error) {
              console.error('Error creating meal event:', error);
              throw error;
            }
          }
        } else if (mealType === 'plan') {
          // Assign full meal plan to all selected players
          const { data: { user } } = await supabase.auth.getUser();
          const planRows = playerIds.map(pid => ({
            meal_plan_id: selectedMealPlanId,
            player_id: pid,
            start_date: dateStr,
            assigned_by: user?.id,
            meals_per_day: mealsPerDay,
          }));
          const { error } = await supabase.from('meal_plan_assignments').insert(planRows);

          if (error) throw error;
        }
      }

      // Success! Close modal and refresh
      const playerCount = (eventType === 'workout' || eventType === 'meal') ? playerIds.length : 1;
      alert(playerCount > 1 ? `Event added for ${playerCount} players!` : 'Event added successfully!');
      onSuccess();
    } catch (error) {
      console.error('Error in handleSubmit:', error);
      alert('Error creating event: ' + formatUserError(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
        <div className="bg-white border-b border-gray-200 p-6 flex items-center justify-between flex-shrink-0">
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

        <div className="p-6 space-y-6 overflow-y-auto flex-1 min-h-0">
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
                    onClick={() => setEventType('lesson')}
                    className="w-full p-4 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition text-left"
                  >
                    <div className="flex items-center space-x-3">
                      <UserCheck className="text-blue-600" size={24} />
                      <div>
                        <div className="font-semibold text-gray-900">Lesson / Assessment</div>
                        <div className="text-sm text-gray-600">Book a lesson or assessment with a coach</div>
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => setEventType('workout')}
                    className="w-full p-4 border-2 border-gray-200 rounded-lg hover:border-purple-500 hover:bg-purple-50 transition text-left"
                  >
                    <div className="flex items-center space-x-3">
                      <Dumbbell className="text-purple-600" size={24} />
                      <div>
                        <div className="font-semibold text-gray-900">Workout</div>
                        <div className="text-sm text-gray-600">Add a single workout day</div>
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
                        <div className="text-sm text-gray-600">Add a single meal</div>
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => { setEventType('workout'); setWorkoutType('program'); }}
                    className="w-full p-4 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition text-left"
                  >
                    <div className="flex items-center space-x-3">
                      <ClipboardList className="text-blue-600" size={24} />
                      <div>
                        <div className="font-semibold text-gray-900">Assign Training Program</div>
                        <div className="text-sm text-gray-600">Assign a full multi-day program</div>
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => { setEventType('meal'); setMealType('plan'); }}
                    className="w-full p-4 border-2 border-gray-200 rounded-lg hover:border-green-500 hover:bg-green-50 transition text-left"
                  >
                    <div className="flex items-center space-x-3">
                      <Apple className="text-green-600" size={24} />
                      <div>
                        <div className="font-semibold text-gray-900">Assign Meal Plan</div>
                        <div className="text-sm text-gray-600">Assign a full meal plan</div>
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
                  <label className="block text-sm font-medium text-gray-700 mb-2">Time {!timeTBD && '*'}</label>
                  <input
                    type="time"
                    required={!timeTBD}
                    disabled={timeTBD}
                    value={timeTBD ? '' : teamEventData.event_time}
                    onChange={(e) => setTeamEventData({...teamEventData, event_time: e.target.value})}
                    className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${timeTBD ? 'bg-gray-100 text-gray-400' : ''}`}
                  />
                  <label className="flex items-center space-x-2 mt-2">
                    <input
                      type="checkbox"
                      checked={timeTBD}
                      onChange={(e) => setTimeTBD(e.target.checked)}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-xs text-gray-600">TBD (set later)</span>
                  </label>
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

                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Reserved Lanes</label>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {LANE_OPTIONS.map(lane => (
                      <label key={lane} className="flex items-center space-x-2 text-sm">
                        <input type="checkbox" checked={teamEventData.lanes.includes(lane)} onChange={(e) => {
                          const updated = e.target.checked ? [...teamEventData.lanes, lane] : teamEventData.lanes.filter(l => l !== lane);
                          setTeamEventData({...teamEventData, lanes: updated});
                        }} className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500" />
                        <span className="text-gray-700">{lane}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Workout Selection — auto-route to single-day when clicking "Workout" */}
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
                <div className="text-sm text-gray-600">Add one workout to this date</div>
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
                      <div className="font-semibold text-gray-900">From Training Program</div>
                      <div className="text-sm text-gray-600">Choose a day from a training program</div>
                    </button>
                    <button
                      onClick={() => setWorkoutSelectionMode('template')}
                      className="w-full p-3 border-2 border-gray-200 rounded-lg hover:border-purple-500 hover:bg-purple-50 transition text-left"
                    >
                      <div className="font-semibold text-gray-900">From Saved Templates</div>
                      <div className="text-sm text-gray-600">Choose from your workout templates</div>
                    </button>
                    <button
                      onClick={() => setWorkoutSelectionMode('create')}
                      className="w-full p-3 border-2 border-gray-200 rounded-lg hover:border-purple-500 hover:bg-purple-50 transition text-left"
                    >
                      <div className="font-semibold text-gray-900">Create New Workout</div>
                      <div className="text-sm text-gray-600">Build a custom workout with exercises</div>
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
                    <label className="block text-sm font-medium text-gray-700 mb-2">Workout Name *</label>
                    <input
                      type="text"
                      placeholder="e.g., Upper Body Day, Hitting Focus"
                      value={newWorkoutData.title}
                      onChange={(e) => setNewWorkoutData({ ...newWorkoutData, title: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Program</label>
                      <select
                        value={newWorkoutData.program}
                        onChange={(e) => setNewWorkoutData({ ...newWorkoutData, program: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {['No Program', 'Pitching', 'Hitting', 'Pitching/Hitting', 'Strength', 'Academy', 'Rehab'].map(o => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Folder</label>
                      <input
                        type="text"
                        placeholder="No Folder"
                        value={newWorkoutData.folder}
                        onChange={(e) => setNewWorkoutData({ ...newWorkoutData, folder: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Workout Notes</label>
                    <textarea
                      placeholder="Any special instructions or details..."
                      value={newWorkoutData.notes}
                      onChange={(e) => setNewWorkoutData({ ...newWorkoutData, notes: e.target.value })}
                      rows="2"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {/* Exercises Table */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Exercises</label>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                          <th className="pb-2 pr-2">Name</th>
                          <th className="pb-2 pr-2 w-16">Sets</th>
                          <th className="pb-2 pr-2 w-16">Reps</th>
                          <th className="pb-2 pr-2 w-16">Rest</th>
                          <th className="pb-2 pr-2 w-16">Load</th>
                          <th className="pb-2 pr-2">Link</th>
                          <th className="pb-2 w-8"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {newWorkoutData.exercises.map((ex, i) => (
                          <tr key={i} className="border-b border-gray-100">
                            <td className="py-1.5 pr-2">
                              <input type="text" placeholder="Exercise name" value={ex.name}
                                onChange={(e) => {
                                  const updated = [...newWorkoutData.exercises];
                                  updated[i] = { ...updated[i], name: e.target.value };
                                  setNewWorkoutData({ ...newWorkoutData, exercises: updated });
                                }}
                                className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </td>
                            <td className="py-1.5 pr-2">
                              <input type="text" placeholder="3" value={ex.sets}
                                onChange={(e) => {
                                  const updated = [...newWorkoutData.exercises];
                                  updated[i] = { ...updated[i], sets: e.target.value };
                                  setNewWorkoutData({ ...newWorkoutData, exercises: updated });
                                }}
                                className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </td>
                            <td className="py-1.5 pr-2">
                              <input type="text" placeholder="10" value={ex.reps}
                                onChange={(e) => {
                                  const updated = [...newWorkoutData.exercises];
                                  updated[i] = { ...updated[i], reps: e.target.value };
                                  setNewWorkoutData({ ...newWorkoutData, exercises: updated });
                                }}
                                className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </td>
                            <td className="py-1.5 pr-2">
                              <input type="text" placeholder="Rest" value={ex.rest || ''}
                                onChange={(e) => {
                                  const updated = [...newWorkoutData.exercises];
                                  updated[i] = { ...updated[i], rest: e.target.value };
                                  setNewWorkoutData({ ...newWorkoutData, exercises: updated });
                                }}
                                className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </td>
                            <td className="py-1.5 pr-2">
                              <input type="text" placeholder="Load" value={ex.load || ''}
                                onChange={(e) => {
                                  const updated = [...newWorkoutData.exercises];
                                  updated[i] = { ...updated[i], load: e.target.value };
                                  setNewWorkoutData({ ...newWorkoutData, exercises: updated });
                                }}
                                className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </td>
                            <td className="py-1.5 pr-2">
                              <input type="url" placeholder="https://..." value={ex.link}
                                onChange={(e) => {
                                  const updated = [...newWorkoutData.exercises];
                                  updated[i] = { ...updated[i], link: e.target.value };
                                  setNewWorkoutData({ ...newWorkoutData, exercises: updated });
                                }}
                                className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            </td>
                            <td className="py-1.5">
                              <button type="button" onClick={() => {
                                const updated = newWorkoutData.exercises.filter((_, idx) => idx !== i);
                                setNewWorkoutData({ ...newWorkoutData, exercises: updated.length ? updated : [{ name: '', sets: '', reps: '', rest: '', load: '', link: '' }] });
                              }} className="text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <button type="button" onClick={() => setNewWorkoutData({ ...newWorkoutData, exercises: [...newWorkoutData.exercises, { name: '', sets: '', reps: '', rest: '', load: '', link: '' }] })}
                      className="mt-2 text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center space-x-1">
                      <Plus size={14} /><span>Add Exercise</span>
                    </button>
                  </div>

                  {/* Save as Template button */}
                  <button
                    type="button"
                    onClick={async () => {
                      if (!newWorkoutData.title) { alert('Enter a workout name first'); return; }
                      const { data: { user } } = await supabase.auth.getUser();
                      const filteredExercises = (newWorkoutData.exercises || []).filter(ex => ex.name.trim());
                      const { error } = await supabase.from('workout_templates').insert({
                        name: newWorkoutData.title,
                        program: newWorkoutData.program || null,
                        folder: newWorkoutData.folder || null,
                        notes: newWorkoutData.notes || null,
                        exercises: filteredExercises,
                        created_by: user?.id,
                      });
                      if (error) { alert('Error saving template: ' + formatUserError(error)); }
                      else { alert('Workout saved as template!'); }
                    }}
                    className="w-full border-2 border-dashed border-blue-300 text-blue-600 py-2 rounded-lg text-sm font-medium hover:bg-blue-50 transition"
                  >
                    Save as Template
                  </button>
                </div>
              )}

              {/* Select from Saved Templates */}
              {workoutSelectionMode === 'template' && (
                <div className="space-y-4">
                  <button
                    onClick={() => setWorkoutSelectionMode(null)}
                    className="text-sm text-blue-600 hover:text-blue-800 flex items-center space-x-1"
                  >
                    <ChevronLeft size={16} />
                    <span>Back</span>
                  </button>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Select Workout Template *</label>
                    <select
                      value={selectedTemplateId}
                      onChange={(e) => setSelectedTemplateId(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Choose a template...</option>
                      {workoutTemplates.map(t => (
                        <option key={t.id} value={t.id}>{t.name}{t.program && t.program !== 'No Program' ? ` (${t.program})` : ''}</option>
                      ))}
                    </select>
                  </div>

                  {selectedTemplateId && (() => {
                    const tmpl = workoutTemplates.find(t => t.id === selectedTemplateId);
                    const exercises = tmpl?.exercises || [];
                    return exercises.length > 0 ? (
                      <div className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs font-medium text-gray-500 mb-2">Exercises ({exercises.length})</p>
                        {exercises.map((ex, i) => (
                          <div key={i} className="text-sm text-gray-700 py-1">
                            {ex.name}{ex.sets ? ` - ${ex.sets} sets` : ''}{ex.reps ? ` x ${ex.reps}` : ''}
                          </div>
                        ))}
                      </div>
                    ) : null;
                  })()}
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
                  Program starts on {(typeof date === 'string' ? new Date(date + 'T00:00:00') : date).toLocaleDateString()}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">End Date *</label>
                <input
                  type="date"
                  value={programEndDate}
                  onChange={(e) => setProgramEndDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                <p className="text-sm font-medium text-gray-700 mb-2">Repeat on:</p>
                <div className="flex flex-wrap gap-1.5">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, i) => (
                    <button
                      type="button"
                      key={label}
                      onClick={() => setProgramWeekdays(prev => { const next = [...prev]; next[i] = !next[i]; return next; })}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${programWeekdays[i] ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-2">Cycles through the program's days; loops back to Day 1 when it runs out.</p>
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
                  Plan will start on {(typeof date === 'string' ? new Date(date + 'T00:00:00') : date).toLocaleDateString()}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Meals / Snacks per day *</label>
                <select
                  value={mealsPerDay}
                  onChange={(e) => setMealsPerDay(parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value={2}>2 meals/snacks per day</option>
                  <option value={3}>3 meals/snacks per day</option>
                  <option value={4}>4 meals/snacks per day</option>
                  <option value={5}>5 meals/snacks per day</option>
                  <option value={6}>6 meals/snacks per day</option>
                </select>
              </div>
            </div>
          )}

          {/* Lesson / Assessment Form (#214) */}
          {eventType === 'lesson' && (
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
                  <label className="block text-sm font-medium text-gray-700 mb-2">Type *</label>
                  <select
                    value={lessonData.lesson_type}
                    onChange={(e) => setLessonData({ ...lessonData, lesson_type: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="lesson">Lesson</option>
                    <option value="assessment">Assessment</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Coach *</label>
                  <select
                    value={lessonData.coach_id}
                    onChange={(e) => setLessonData({ ...lessonData, coach_id: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select a coach…</option>
                    {coaches.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Start Time {!timeTBD && '*'}</label>
                  <input
                    type="time"
                    disabled={timeTBD}
                    value={timeTBD ? '' : lessonData.event_time}
                    onChange={(e) => setLessonData({ ...lessonData, event_time: e.target.value })}
                    className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${timeTBD ? 'bg-gray-100 text-gray-400' : ''}`}
                  />
                  <label className="flex items-center space-x-2 mt-2">
                    <input
                      type="checkbox"
                      checked={timeTBD}
                      onChange={(e) => setTimeTBD(e.target.checked)}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-xs text-gray-600">TBD (set later)</span>
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">End Time</label>
                  <input
                    type="time"
                    disabled={timeTBD}
                    value={timeTBD ? '' : lessonData.event_end_time}
                    onChange={(e) => setLessonData({ ...lessonData, event_end_time: e.target.value })}
                    className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${timeTBD ? 'bg-gray-100 text-gray-400' : ''}`}
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Location</label>
                  <input
                    type="text"
                    placeholder="e.g., Cage 2, Main Field"
                    value={lessonData.location}
                    onChange={(e) => setLessonData({ ...lessonData, location: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Notes</label>
                  <textarea
                    rows={3}
                    placeholder="Focus areas, what to bring, etc."
                    value={lessonData.notes}
                    onChange={(e) => setLessonData({ ...lessonData, notes: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="border-t border-gray-200 p-6 flex space-x-3 flex-shrink-0">
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
              (eventType === 'workout' && !workoutType) ||
              (eventType === 'workout' && workoutType === 'single-day' && workoutSelectionMode === 'existing' && !selectedDayId) ||
              (eventType === 'workout' && workoutType === 'single-day' && workoutSelectionMode === 'create' && !newWorkoutData.title) ||
              (eventType === 'workout' && workoutType === 'single-day' && workoutSelectionMode === 'template' && !selectedTemplateId) ||
              (eventType === 'workout' && workoutType === 'program' && (!selectedProgramId || !programEndDate)) ||
              (eventType === 'meal' && !mealType) ||
              (eventType === 'meal' && mealType === 'single-meal' && !mealSelectionMode) ||
              (eventType === 'meal' && mealType === 'single-meal' && mealSelectionMode === 'existing' && !selectedMealId) ||
              (eventType === 'meal' && mealType === 'single-meal' && mealSelectionMode === 'create' && !newMealData.name) ||
              (eventType === 'meal' && mealType === 'plan' && !selectedMealPlanId) ||
              (eventType === 'lesson' && (!lessonData.coach_id || (!timeTBD && !lessonData.event_time)))
            }
            className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
          >
            {loading ? 'Saving...' : eventType === 'workout' ? 'Save Programming' : eventType === 'lesson' ? 'Book' : 'Add Event'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// EXERCISE NOTES PARSER
// ============================================

function parseExerciseNotes(notes) {
  if (!notes) return { general: '', exercises: [] };
  const delimiter = '--- Exercises ---';
  const idx = notes.indexOf(delimiter);
  if (idx === -1) return { general: notes.trim(), exercises: [] };
  const general = notes.slice(0, idx).trim();
  const exerciseBlock = notes.slice(idx + delimiter.length).trim();
  const exercises = exerciseBlock.split('\n').filter(Boolean).map(line => {
    if (line.includes('|')) {
      // New pipe-delimited format: Name | 3x10 | rest | load | link
      const parts = line.split('|').map(s => s.trim());
      const name = parts[0] || '';
      let sets = '', reps = '', rest = '', load = '', link = '';
      if (parts[1]) {
        const match = parts[1].match(/(\d+)\s*x\s*(\d+)/i);
        if (match) { sets = match[1]; reps = match[2]; } else { sets = parts[1]; }
      }
      if (parts[2]) rest = parts[2];
      if (parts[3]) load = parts[3];
      if (parts[4]) link = parts[4];
      return { name, sets, reps, rest, load, link };
    } else {
      // Legacy format: Name - 3 sets x 10 reps (link) — reps may be a range like 12-15
      const name = line.replace(/ - \d.*$/, '').replace(/ \(https?:.*$/, '').trim();
      let sets = '', reps = '', link = '';
      const srMatch = line.match(/(\d+)\s*sets?\s*x\s*(\d+(?:\s*-\s*\d+)?)\s*reps?/i);
      if (srMatch) { sets = srMatch[1]; reps = srMatch[2].replace(/\s+/g, ''); }
      const linkMatch = line.match(/\((https?:\/\/[^\s)]+)\)/);
      if (linkMatch) link = linkMatch[1];
      return { name, sets, reps, rest: '', load: '', link };
    }
  }).filter(e => e.name);
  return { general, exercises };
}

// ============================================
// WORKOUT DETAIL MODAL — Traq-style structured workout view
// ============================================

const CATEGORY_LABEL = {
  warmup: 'Warm-up',
  hitting: 'Hitting',
  pitching: 'Pitching',
  fielding: 'Fielding',
  conditioning: 'Conditioning',
  recovery: 'Recovery',
  strength: 'Strength',
  mobility: 'Mobility',
  other: 'Other',
  general: 'Workout',
};

// Aligned with ProgramLibrarySidebar FOLDER_COLORS so the color a coach sees in the
// program library matches what the athlete sees on their workout view (#179).
const CATEGORY_BAR = {
  warmup: 'bg-purple-500',
  hitting: 'bg-blue-500',
  pitching: 'bg-green-500',
  fielding: 'bg-green-500',
  conditioning: 'bg-yellow-500',
  recovery: 'bg-purple-500',
  strength: 'bg-orange-500',
  mobility: 'bg-purple-500',
  other: 'bg-gray-500',
  general: 'bg-gray-500',
};

const WORKOUT_HEADER_COLOR = {
  hitting:  { bg: 'bg-blue-100',   text: 'text-blue-600' },
  pitching: { bg: 'bg-green-100',  text: 'text-green-600' },
  warmup:   { bg: 'bg-purple-100', text: 'text-purple-600' },
  general:  { bg: 'bg-orange-100', text: 'text-orange-600' },
};

function WorkoutDetailModal({ event, onClose, onDelete, userRole }) {
  useModalTracking('WorkoutDetailModal');
  const [exercises, setExercises] = useState([]);
  const [trainingDay, setTrainingDay] = useState(null);
  const [program, setProgram] = useState(null);
  const [generalNotes, setGeneralNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canManage = userRole === 'admin' || userRole === 'coach';

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      let loadedExercises = [];
      if (event.training_day_id) {
        const { data: day } = await supabase
          .from('training_days')
          .select('id, day_number, title, notes, program_id, training_programs(id, name, description)')
          .eq('id', event.training_day_id)
          .single();
        if (day) {
          setTrainingDay(day);
          setProgram(day.training_programs || null);
          if (day.notes) setGeneralNotes(day.notes);
        }
        const { data: ex } = await supabase
          .from('training_exercises')
          .select('id, day_id, category, name, description, sets, reps, weight, video_url, image_url, sort_order, rest, load, super_set')
          .eq('day_id', event.training_day_id)
          .order('sort_order', { ascending: true });
        loadedExercises = ex || [];
      }
      if (loadedExercises.length === 0 && event.notes) {
        const parsed = parseExerciseNotes(event.notes);
        if (parsed.general) setGeneralNotes(parsed.general);
        loadedExercises = (parsed.exercises || []).map((e, i) => ({
          id: `n-${i}`,
          name: e.name,
          sets: e.sets,
          reps: e.reps,
          rest: e.rest,
          load: e.load,
          video_url: e.link,
          category: 'general',
        }));
      }
      setExercises(loadedExercises);
      setLoading(false);
    };
    load();
  }, [event]);

  const groupedByCategory = useMemo(() => {
    const groups = {};
    exercises.forEach(ex => {
      const cat = (ex.category || 'general').toLowerCase();
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(ex);
    });
    return groups;
  }, [exercises]);

  const handleDelete = async () => {
    setDeleting(true);
    const { error } = await supabase.from('schedule_events').delete().eq('id', event.id);
    setDeleting(false);
    if (error) {
      alert('Could not delete: ' + formatUserError(error));
      return;
    }
    onDelete && onDelete();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col">
        <div className="border-b border-gray-200 p-5 flex items-start justify-between flex-shrink-0">
          <div className="flex items-start space-x-3 min-w-0">
            {(() => { const hc = WORKOUT_HEADER_COLOR[getWorkoutCategory(event.title)] || WORKOUT_HEADER_COLOR.general; return (
              <div className={`p-2 ${hc.bg} rounded-lg flex-shrink-0`}>
                <Dumbbell size={22} className={hc.text} />
              </div>
            ); })()}
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-gray-900 truncate">{event.title || 'Workout'}</h2>
              <div className="text-sm text-gray-600 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>{new Date(event.event_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span>
                {event.event_time && <span>• {formatTimeDisplay(event.event_time)}</span>}
                {program?.name && <span>• {program.name}{trainingDay?.day_number ? ` — Day ${trainingDay.day_number}` : ''}</span>}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
            <X size={22} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          {loading ? (
            <div className="text-center py-10 text-gray-500 text-sm">Loading workout...</div>
          ) : (
            <>
              {generalNotes && (
                <div className="mb-5 p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">Notes</div>
                  <div className="text-sm text-gray-800 whitespace-pre-wrap">{generalNotes}</div>
                </div>
              )}

              {exercises.length === 0 ? (
                <div className="text-center py-10 text-gray-400 text-sm">No exercises in this workout.</div>
              ) : (
                Object.entries(groupedByCategory).map(([cat, exs]) => {
                  const label = CATEGORY_LABEL[cat] || cat.charAt(0).toUpperCase() + cat.slice(1);
                  const bar = CATEGORY_BAR[cat] || 'bg-gray-500';
                  return (
                    <div key={cat} className="mb-5">
                      <div className="flex items-center mb-2">
                        <div className={`w-1.5 h-5 rounded-sm mr-2 ${bar}`} />
                        <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wide">{label}</h3>
                        <span className="ml-2 text-xs text-gray-400">({exs.length})</span>
                      </div>
                      <div className="sm:hidden space-y-2">
                        {exs.map((ex, i) => {
                          const sr = ex.sets && ex.reps ? `${ex.sets} × ${ex.reps}` : (ex.sets || ex.reps || '');
                          const loadVal = ex.load || ex.weight;
                          const meta = [sr, loadVal, ex.rest].filter(Boolean);
                          return (
                            <div key={ex.id || i} className="border border-gray-200 rounded-lg p-3 bg-white">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-start min-w-0 flex-1">
                                  {ex.super_set && (
                                    <span className="mr-2 mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded bg-indigo-100 text-indigo-700 text-[10px] font-bold uppercase flex-shrink-0">
                                      {ex.super_set}
                                    </span>
                                  )}
                                  <div className="min-w-0">
                                    <div className="font-semibold text-gray-900 break-words">{ex.name}</div>
                                    {ex.description && <div className="text-xs text-gray-500 mt-0.5 break-words">{ex.description}</div>}
                                  </div>
                                </div>
                                {ex.video_url && (
                                  <a href={ex.video_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-50 text-blue-600 text-xs font-medium hover:bg-blue-100 flex-shrink-0" title="Open video">
                                    <ExternalLink size={12} />
                                    Video
                                  </a>
                                )}
                              </div>
                              <div className="mt-2 text-sm text-gray-700 tabular-nums">
                                {meta.length > 0 ? meta.join(' · ') : <span className="text-gray-400 italic">Sets/reps not set</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="hidden sm:block border border-gray-200 rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50">
                            <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                              <th className="px-3 py-2">Exercise</th>
                              <th className="px-3 py-2 w-16 text-center">Sets</th>
                              <th className="px-3 py-2 w-20 text-center">Reps</th>
                              <th className="px-3 py-2 w-24 text-center">Load</th>
                              <th className="px-3 py-2 w-20 text-center">Rest</th>
                              <th className="px-3 py-2 w-12 text-center">Video</th>
                            </tr>
                          </thead>
                          <tbody>
                            {exs.map((ex, i) => (
                              <tr key={ex.id || i} className="border-t border-gray-100 hover:bg-gray-50">
                                <td className="px-3 py-2">
                                  <div className="flex items-center">
                                    {ex.super_set && (
                                      <span className="mr-2 inline-flex items-center justify-center w-5 h-5 rounded bg-indigo-100 text-indigo-700 text-[10px] font-bold uppercase">
                                        {ex.super_set}
                                      </span>
                                    )}
                                    <div>
                                      <div className="font-medium text-gray-900">{ex.name}</div>
                                      {ex.description && <div className="text-xs text-gray-500 mt-0.5">{ex.description}</div>}
                                    </div>
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-center text-gray-700 tabular-nums">{ex.sets || '—'}</td>
                                <td className="px-3 py-2 text-center text-gray-700 tabular-nums">{ex.reps || '—'}</td>
                                <td className="px-3 py-2 text-center text-gray-700">{ex.load || ex.weight || '—'}</td>
                                <td className="px-3 py-2 text-center text-gray-700">{ex.rest || '—'}</td>
                                <td className="px-3 py-2 text-center">
                                  {ex.video_url ? (
                                    <a href={ex.video_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center text-blue-500 hover:text-blue-700" title="Open video">
                                      <ExternalLink size={14} />
                                    </a>
                                  ) : (
                                    <span className="text-gray-300">—</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>

        <div className="border-t border-gray-200 p-4 flex space-x-3 flex-shrink-0">
          <button onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 py-2 px-4 rounded-lg font-medium hover:bg-gray-50 transition">
            Close
          </button>
          {canManage && (
            <button onClick={() => setConfirmDelete(true)} disabled={deleting} className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition disabled:opacity-50 flex items-center space-x-2">
              <Trash2 size={16} />
              <span>{deleting ? 'Deleting...' : 'Delete'}</span>
            </button>
          )}
        </div>

        {confirmDelete && (
          <div className="absolute inset-0 bg-black bg-opacity-75 flex items-center justify-center rounded-lg">
            <div className="bg-white rounded-lg p-6 max-w-sm mx-4">
              <h3 className="text-lg font-bold text-gray-900 mb-2">Delete workout?</h3>
              <p className="text-gray-700 text-sm mb-4">"{event.title || 'Workout'}" will be removed from the calendar. The underlying training program is not affected.</p>
              <div className="flex space-x-3">
                <button onClick={() => setConfirmDelete(false)} className="flex-1 border border-gray-300 text-gray-700 py-2 px-4 rounded-lg font-medium hover:bg-gray-50 transition">
                  Cancel
                </button>
                <button onClick={() => { setConfirmDelete(false); handleDelete(); }} disabled={deleting} className="flex-1 bg-red-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-red-700 transition disabled:opacity-50">
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
// EVENT DETAIL/EDIT/DELETE MODAL - COMPLETE VERSION
// ============================================

function EventDetailModal({ event, onClose, onDelete, onUpdate, userRole, userId }) {
  useModalTracking('EventDetailModal');
  console.log('🔵 EventDetailModal rendered with event:', event);

  const isOwnGame = event.player_id === userId && event.event_type === 'game';
  const canManage = userRole === 'admin' || userRole === 'coach' || isOwnGame;
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
    setDeleting(true);
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        throw new Error('Not authenticated. Please log in again.');
      }

      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .single();
      if (userError || !userData) {
        throw new Error('Could not verify user permissions.');
      }
      if (!['admin', 'coach'].includes(userData.role) && !isOwnGame) {
        throw new Error('You do not have permission to delete events.');
      }

      const { data: deleteData, error: deleteError } = await supabase
        .from('schedule_events')
        .delete()
        .eq('id', event.id)
        .select();
      if (deleteError) throw deleteError;
      if (!deleteData || deleteData.length === 0) {
        throw new Error('Event could not be deleted. It may have already been removed or you lack permission.');
      }

      alert('Event deleted successfully!');
      onDelete();
    } catch (error) {
      alert('Error deleting event: ' + formatUserError(error));
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
      if (event.team_id || (Array.isArray(event.team_ids) && event.team_ids.length > 0)) {
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
      alert('Error updating event: ' + formatUserError(error));
    } finally {
      setLoading(false);
    }
  };

  const getEventColor = (ev) => {
    const eventType = typeof ev === 'string' ? ev : ev?.event_type;
    if (eventType === 'workout') {
      const cat = (typeof ev === 'object' && ev?.category) || getWorkoutCategory(typeof ev === 'string' ? '' : ev?.title);
      switch(cat) {
        case 'hitting': return 'from-blue-50 to-blue-100 border-blue-200';
        case 'pitching': return 'from-green-50 to-green-100 border-green-200';
        case 'fielding': return 'from-green-50 to-green-100 border-green-200';
        case 'strength': return 'from-orange-50 to-orange-100 border-orange-200';
        case 'recovery': return 'from-purple-50 to-purple-100 border-purple-200';
        case 'warmup': return 'from-purple-50 to-purple-100 border-purple-200';
        case 'mobility': return 'from-purple-50 to-purple-100 border-purple-200';
        case 'conditioning': return 'from-yellow-50 to-yellow-100 border-yellow-200';
        default: return 'from-gray-50 to-gray-100 border-gray-200';
      }
    }
    switch(eventType) {
      case 'game': return 'from-slate-50 to-slate-100 border-slate-200';
      case 'practice': return 'from-green-50 to-green-100 border-green-200';
      case 'meal': return 'from-yellow-50 to-yellow-100 border-yellow-200';
      default: return 'from-gray-50 to-gray-100 border-gray-200';
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] flex flex-col">
        <div className={`bg-gradient-to-br ${getEventColor(event)} border-2 p-6 rounded-t-lg flex-shrink-0`}>
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

        <div className="p-6 space-y-4 overflow-y-auto flex-1 min-h-0">
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

                  {(event.team_id || (Array.isArray(event.team_ids) && event.team_ids.length > 0)) && (
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
                  {new Date(event.event_date + 'T00:00:00').toLocaleDateString('en-US', {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric'
                  })}
                </span>
              </div>

              <div className="flex items-center space-x-3 text-sm">
                <span className="text-gray-400 font-medium">Time:</span>
                <span className={event.event_time ? 'text-gray-900' : 'text-yellow-700 font-medium'}>{formatTimeDisplay(event.event_time) || 'TBD'}</span>
              </div>

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

              {event.notes && (() => {
                const { general, exercises } = parseExerciseNotes(event.notes);
                return (
                  <div className="mt-4 space-y-3">
                    {general && (
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <div className="text-xs font-semibold text-gray-600 mb-1">Notes</div>
                        <div className="text-sm text-gray-900 whitespace-pre-wrap">{general}</div>
                      </div>
                    )}
                    {exercises.length > 0 && (
                      <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
                        <div className="text-xs font-semibold text-blue-700 mb-2">Exercises</div>
                        <div className="space-y-2">
                          {exercises.map((ex, i) => (
                            <div key={i} className="bg-white rounded-md p-2.5 border border-blue-100 flex items-center justify-between">
                              <div>
                                <div className="text-sm font-medium text-gray-900">{ex.name}</div>
                                <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                                  {(ex.sets || ex.reps) && (
                                    <span>{ex.sets && ex.reps ? `${ex.sets} × ${ex.reps}` : ex.sets}</span>
                                  )}
                                  {ex.rest && <span>Rest: {ex.rest}</span>}
                                  {ex.load && <span>Load: {ex.load}</span>}
                                </div>
                              </div>
                              {ex.link && (
                                <a href={ex.link} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700 ml-2 flex-shrink-0">
                                  <ExternalLink size={14} />
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {!general && exercises.length === 0 && (
                      <div className="p-3 bg-gray-50 rounded-lg">
                        <div className="text-xs font-semibold text-gray-600 mb-1">Notes</div>
                        <div className="text-sm text-gray-900 whitespace-pre-wrap">{event.notes}</div>
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="flex space-x-3 pt-4 border-t border-gray-200">
                <button
                  onClick={onClose}
                  className="flex-1 border border-gray-300 text-gray-700 py-2 px-4 rounded-lg font-medium hover:bg-gray-50 transition"
                >
                  Close
                </button>
                {!event._isMealPlan && canManage && (
                  <>
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
                  </>
                )}
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
// FACILITY EVENT COLOR PALETTE
// ============================================

const FACILITY_EVENT_COLORS = [
  { key: 'teal',   label: 'Teal',   month: 'bg-teal-100 text-teal-700 border-teal-200',     week: 'border-l-4 border-teal-500 bg-teal-50',     lane: 'bg-teal-100 border border-teal-300 text-teal-900',     detail: 'bg-gradient-to-br from-teal-50 to-teal-100 border-2 border-teal-200',     dot: 'bg-teal-500' },
  { key: 'blue',   label: 'Blue',   month: 'bg-blue-100 text-blue-700 border-blue-200',     week: 'border-l-4 border-blue-500 bg-blue-50',     lane: 'bg-blue-100 border border-blue-300 text-blue-900',     detail: 'bg-gradient-to-br from-blue-50 to-blue-100 border-2 border-blue-200',     dot: 'bg-blue-500' },
  { key: 'purple', label: 'Purple', month: 'bg-purple-100 text-purple-700 border-purple-200', week: 'border-l-4 border-purple-500 bg-purple-50', lane: 'bg-purple-100 border border-purple-300 text-purple-900', detail: 'bg-gradient-to-br from-purple-50 to-purple-100 border-2 border-purple-200', dot: 'bg-purple-500' },
  { key: 'pink',   label: 'Pink',   month: 'bg-pink-100 text-pink-700 border-pink-200',     week: 'border-l-4 border-pink-500 bg-pink-50',     lane: 'bg-pink-100 border border-pink-300 text-pink-900',     detail: 'bg-gradient-to-br from-pink-50 to-pink-100 border-2 border-pink-200',     dot: 'bg-pink-500' },
  { key: 'red',    label: 'Red',    month: 'bg-red-100 text-red-700 border-red-200',        week: 'border-l-4 border-red-500 bg-red-50',       lane: 'bg-red-100 border border-red-300 text-red-900',        detail: 'bg-gradient-to-br from-red-50 to-red-100 border-2 border-red-200',        dot: 'bg-red-500' },
  { key: 'orange', label: 'Orange', month: 'bg-orange-100 text-orange-700 border-orange-200', week: 'border-l-4 border-orange-500 bg-orange-50', lane: 'bg-orange-100 border border-orange-300 text-orange-900', detail: 'bg-gradient-to-br from-orange-50 to-orange-100 border-2 border-orange-200', dot: 'bg-orange-500' },
  { key: 'yellow', label: 'Yellow', month: 'bg-yellow-100 text-yellow-700 border-yellow-200', week: 'border-l-4 border-yellow-500 bg-yellow-50', lane: 'bg-yellow-100 border border-yellow-300 text-yellow-900', detail: 'bg-gradient-to-br from-yellow-50 to-yellow-100 border-2 border-yellow-200', dot: 'bg-yellow-500' },
  { key: 'green',  label: 'Green',  month: 'bg-green-100 text-green-700 border-green-200',  week: 'border-l-4 border-green-500 bg-green-50',   lane: 'bg-green-100 border border-green-300 text-green-900',  detail: 'bg-gradient-to-br from-green-50 to-green-100 border-2 border-green-200',  dot: 'bg-green-500' },
  { key: 'gray',   label: 'Gray',   month: 'bg-gray-100 text-gray-700 border-gray-200',     week: 'border-l-4 border-gray-500 bg-gray-50',     lane: 'bg-gray-100 border border-gray-300 text-gray-900',     detail: 'bg-gradient-to-br from-gray-50 to-gray-100 border-2 border-gray-200',     dot: 'bg-gray-500' },
];

function getFacilityColorClasses(colorKey, variant = 'month') {
  const c = FACILITY_EVENT_COLORS.find(x => x.key === colorKey) || FACILITY_EVENT_COLORS[0];
  return c[variant];
}

const PLAYER_OVERLAY_PALETTE = [
  { month: 'bg-blue-100 text-blue-700 border-blue-300',     week: 'border-l-4 border-blue-500 bg-blue-50',     dot: 'bg-blue-500' },
  { month: 'bg-rose-100 text-rose-700 border-rose-300',     week: 'border-l-4 border-rose-500 bg-rose-50',     dot: 'bg-rose-500' },
  { month: 'bg-amber-100 text-amber-800 border-amber-300',  week: 'border-l-4 border-amber-500 bg-amber-50',   dot: 'bg-amber-500' },
  { month: 'bg-violet-100 text-violet-700 border-violet-300', week: 'border-l-4 border-violet-500 bg-violet-50', dot: 'bg-violet-500' },
  { month: 'bg-emerald-100 text-emerald-700 border-emerald-300', week: 'border-l-4 border-emerald-500 bg-emerald-50', dot: 'bg-emerald-500' },
  { month: 'bg-pink-100 text-pink-700 border-pink-300',     week: 'border-l-4 border-pink-500 bg-pink-50',     dot: 'bg-pink-500' },
  { month: 'bg-cyan-100 text-cyan-700 border-cyan-300',     week: 'border-l-4 border-cyan-500 bg-cyan-50',     dot: 'bg-cyan-500' },
  { month: 'bg-orange-100 text-orange-700 border-orange-300', week: 'border-l-4 border-orange-500 bg-orange-50', dot: 'bg-orange-500' },
];

// ============================================
// ADD FACILITY EVENT PANEL
// ============================================

function AddFacilityEventPanel({ date, onClose, onSuccess }) {
  const LANE_OPTIONS = ['Lane 1', 'Lane 2', 'Lane 3', 'Lane 4', 'Lane 5', 'Lane 6', 'Lane 7', 'Turf Field', 'Main Weight Room', 'Top Weight Room', 'Speed & Agility'];

  const prefill = (() => {
    if (date && typeof date === 'object' && !(date instanceof Date)) {
      return { date: date.date, startTime: date.startTime, endTime: date.endTime, lane: date.lane };
    }
    if (date instanceof Date) {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return { date: `${y}-${m}-${d}` };
    }
    if (typeof date === 'string' && date !== 'new') return { date };
    return {};
  })();

  const [title, setTitle] = useState('');
  const [eventDate, setEventDate] = useState(prefill.date || fmtLocalDate(new Date()));
  const [startTime, setStartTime] = useState(prefill.startTime || '09:00');
  const [endTime, setEndTime] = useState(prefill.endTime || '10:00');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [lanes, setLanes] = useState(prefill.lane ? [prefill.lane] : []);
  const [recurrence, setRecurrence] = useState('none');
  const [customRule, setCustomRule] = useState({ freq: 'weekly', interval: 1, byDay: [], endType: 'never', count: 10, until: '' });
  const [color, setColor] = useState('teal');
  const [loading, setLoading] = useState(false);
  const [athleteId, setAthleteId] = useState('');
  const [coachIds, setCoachIds] = useState([]);
  const [athletes, setAthletes] = useState([]);
  const [coaches, setCoaches] = useState([]);

  useEffect(() => {
    (async () => {
      const [aRes, cRes] = await Promise.all([
        supabase.from('users').select('id, full_name').eq('role', 'player').order('full_name'),
        supabase.from('users').select('id, full_name').in('role', ['admin', 'coach']).order('full_name'),
      ]);
      setAthletes(aRes.data || []);
      setCoaches(cRes.data || []);
    })();
  }, []);

  const handleSave = async () => {
    if (!title.trim()) return alert('Title is required');
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const isRecurring = recurrence !== 'none';
      let recurrenceRule = null;
      if (isRecurring) {
        if (recurrence === 'custom') {
          const r = { ...customRule };
          if (r.endType === 'never') { delete r.count; delete r.until; }
          else if (r.endType === 'count') { delete r.until; }
          else if (r.endType === 'until') { delete r.count; }
          recurrenceRule = r;
        } else {
          recurrenceRule = { freq: recurrence, interval: 1, endType: 'never' };
        }
      }
      const { error } = await supabase.from('facility_events').insert({
        title: title.trim(), description: description || null, event_date: eventDate,
        start_time: startTime || null, end_time: endTime || null, location: location || null,
        is_recurring: isRecurring, recurrence_rule: recurrenceRule, created_by: user?.id,
        lanes: lanes.length > 0 ? lanes : null,
        color,
        athlete_id: athleteId || null,
        coach_id: coachIds[0] || null,
        coach_ids: coachIds.length > 0 ? coachIds : null,
      });
      if (error) throw error;
      onSuccess();
    } catch (err) {
      alert('Error creating event: ' + formatUserError(err));
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
          <div className="flex items-start space-x-3 mb-4">
            <AlignLeft size={20} className="text-gray-400 mt-2" />
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Add description" rows="3" className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <div className="flex items-center space-x-3 mb-4">
            <User size={20} className="text-gray-400 flex-shrink-0" />
            <select value={athleteId} onChange={(e) => setAthleteId(e.target.value)} className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
              <option value="">Athlete (optional)</option>
              {athletes.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
            </select>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Coaches</label>
            <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2">
              {coaches.map(c => (
                <label key={c.id} className="flex items-center space-x-2 text-sm py-0.5">
                  <input type="checkbox" checked={coachIds.includes(c.id)} onChange={(e) => {
                    setCoachIds(e.target.checked ? [...coachIds, c.id] : coachIds.filter(id => id !== c.id));
                  }} className="w-4 h-4 text-teal-600 border-gray-300 rounded focus:ring-teal-500" />
                  <span className="text-gray-700 truncate">{c.full_name}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">Reserved Lanes</label>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {LANE_OPTIONS.map(lane => (
                <label key={lane} className="flex items-center space-x-2 text-sm">
                  <input type="checkbox" checked={lanes.includes(lane)} onChange={(e) => {
                    setLanes(e.target.checked ? [...lanes, lane] : lanes.filter(l => l !== lane));
                  }} className="w-4 h-4 text-teal-600 border-gray-300 rounded focus:ring-teal-500" />
                  <span className="text-gray-700">{lane}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">Event Color</label>
            <div className="flex flex-wrap gap-2">
              {FACILITY_EVENT_COLORS.map(c => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setColor(c.key)}
                  title={c.label}
                  className={`w-8 h-8 rounded-full ${c.dot} ${color === c.key ? 'ring-2 ring-offset-2 ring-gray-800' : ''}`}
                />
              ))}
            </div>
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

function FacilityEventDetail({ event, userId, userRole, onClose, onUpdate, onDelete, coaches = [] }) {
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({ title: event.title, description: event.description || '', start_time: event.start_time || '', end_time: event.end_time || '', location: event.location || '', color: event.color || 'teal' });

  const isStaff = userRole === 'admin' || userRole === 'coach';
  const isPlayer = userRole === 'player';
  const eventMasterId = event._master_id || event.id;
  const occurrenceDate = event.event_date;

  const [signups, setSignups] = useState([]);
  const [mySignup, setMySignup] = useState(null);
  const [signupNotes, setSignupNotes] = useState('');
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupsLoading, setSignupsLoading] = useState(true);

  const fetchSignups = async () => {
    setSignupsLoading(true);
    if (isStaff) {
      const { data, error } = await supabase
        .from('event_signups')
        .select('id, notes, created_at, user_id, users:user_id(id, full_name, avatar_url)')
        .eq('event_id', eventMasterId)
        .eq('event_date', occurrenceDate)
        .order('created_at', { ascending: true });
      if (!error) setSignups(data || []);
      const myRow = (data || []).find(r => r.user_id === userId);
      setMySignup(myRow || null);
    } else {
      const { data } = await supabase
        .from('event_signups')
        .select('id, notes, created_at')
        .eq('event_id', eventMasterId)
        .eq('event_date', occurrenceDate)
        .eq('user_id', userId)
        .maybeSingle();
      setMySignup(data || null);
    }
    setSignupsLoading(false);
  };

  useEffect(() => {
    fetchSignups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventMasterId, occurrenceDate]);

  const handleSignup = async () => {
    setSignupLoading(true);
    try {
      const { error } = await supabase.from('event_signups').insert({
        event_id: eventMasterId,
        event_date: occurrenceDate,
        user_id: userId,
        notes: signupNotes.trim() || null,
      });
      if (error) throw error;
      setSignupNotes('');
      await fetchSignups();
    } catch (err) {
      alert('Error signing up: ' + formatUserError(err));
    } finally {
      setSignupLoading(false);
    }
  };

  const handleCancelSignup = async (signupId) => {
    if (!window.confirm('Cancel your sign up for this event?')) return;
    setSignupLoading(true);
    try {
      const { error } = await supabase.from('event_signups').delete().eq('id', signupId);
      if (error) throw error;
      await fetchSignups();
    } catch (err) {
      alert('Error: ' + formatUserError(err));
    } finally {
      setSignupLoading(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.from('facility_events').update({ title: formData.title, description: formData.description || null, start_time: formData.start_time || null, end_time: formData.end_time || null, location: formData.location || null, color: formData.color || null }).eq('id', eventMasterId);
      if (error) throw error;
      onUpdate();
    } catch (err) { alert('Error: ' + formatUserError(err)); } finally { setLoading(false); }
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this event?')) return;
    try {
      const { error } = await supabase.from('facility_events').delete().eq('id', eventMasterId);
      if (error) throw error;
      onDelete();
    } catch (err) { alert('Error: ' + formatUserError(err)); }
  };

  const headerColorKey = (editing ? formData.color : event.color) || 'teal';
  const headerPalette = FACILITY_EVENT_COLORS.find(c => c.key === headerColorKey) || FACILITY_EVENT_COLORS[0];
  const headerBg = headerPalette.detail;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className={`${headerBg} p-6 rounded-t-lg`}>
          <div className="flex items-center justify-between">
            <div className="flex items-start space-x-3">
              <span className={`w-3 h-3 rounded-full ${headerPalette.dot} mt-1.5 flex-shrink-0`} />
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-700 mb-1">Facility Event</div>
                <h3 className="text-xl font-bold text-gray-900">{event.title}</h3>
              </div>
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
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Color</label>
                <div className="flex flex-wrap gap-2">
                  {FACILITY_EVENT_COLORS.map(c => (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setFormData({ ...formData, color: c.key })}
                      title={c.label}
                      className={`w-8 h-8 rounded-full ${c.dot} ${formData.color === c.key ? 'ring-2 ring-offset-2 ring-gray-800' : ''}`}
                    />
                  ))}
                </div>
              </div>
              <div className="flex space-x-3 pt-2">
                <button onClick={() => setEditing(false)} className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-50 transition">Cancel</button>
                <button onClick={handleSave} disabled={loading} className="flex-1 bg-teal-600 text-white py-2 rounded-lg hover:bg-teal-700 transition disabled:opacity-50">{loading ? 'Saving...' : 'Save'}</button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center space-x-3 text-sm"><CalendarIcon size={16} className="text-gray-400" /><span>{new Date(event.event_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span></div>
              {(event.start_time || event.end_time) && <div className="flex items-center space-x-3 text-sm"><Clock size={16} className="text-gray-400" /><span>{formatTimeDisplay(event.start_time)}{event.end_time ? ` - ${formatTimeDisplay(event.end_time)}` : ''}</span></div>}
              {event.location && <div className="flex items-center space-x-3 text-sm"><MapPin size={16} className="text-gray-400" /><span>{event.location}</span></div>}
              {event.is_recurring && <div className="flex items-center space-x-3 text-sm"><Repeat size={16} className="text-gray-400" /><span className="text-gray-500">Recurring event</span></div>}
              {event.description && <div className="mt-3 p-3 bg-gray-50 rounded-lg text-sm text-gray-900">{event.description}</div>}
              {(() => {
                const coachNames = (event.coach_ids || []).map(cid => coaches.find(c => c.id === cid)?.full_name).filter(Boolean);
                if (!coachNames.length && event.coach?.full_name) coachNames.push(event.coach.full_name);
                const hasInfo = event.athlete?.full_name || coachNames.length > 0;
                if (!hasInfo) return null;
                return (
                  <div className="flex items-start flex-wrap gap-3 text-sm">
                    {event.athlete?.full_name && <div className="flex items-center space-x-1.5"><User size={14} className="text-gray-400" /><span className="text-gray-700">Athlete: <span className="font-medium text-gray-900">{event.athlete.full_name}</span></span></div>}
                    {coachNames.length > 0 && <div className="flex items-center space-x-1.5"><UserCheck size={14} className="text-gray-400" /><span className="text-gray-700">{coachNames.length === 1 ? 'Coach' : 'Coaches'}: <span className="font-medium text-gray-900">{coachNames.join(', ')}</span></span></div>}
                  </div>
                );
              })()}

              {isPlayer && (
                <div className="pt-4 border-t border-gray-200">
                  {signupsLoading ? (
                    <p className="text-sm text-gray-500">Loading…</p>
                  ) : mySignup ? (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-2">
                      <div className="flex items-center space-x-2 text-green-700 text-sm font-semibold">
                        <Check size={16} />
                        <span>You're signed up</span>
                      </div>
                      {mySignup.notes && <p className="text-xs text-gray-700 whitespace-pre-wrap">Notes: {mySignup.notes}</p>}
                      <button
                        onClick={() => handleCancelSignup(mySignup.id)}
                        disabled={signupLoading}
                        className="text-xs text-red-600 hover:text-red-700 font-medium disabled:opacity-50"
                      >
                        {signupLoading ? 'Cancelling…' : 'Cancel sign up'}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-gray-900">Would you like to sign up for this event?</p>
                      <textarea
                        value={signupNotes}
                        onChange={(e) => setSignupNotes(e.target.value)}
                        placeholder="Notes (optional)"
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm"
                      />
                      <div className="flex space-x-2">
                        <button
                          onClick={onClose}
                          className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-50 transition text-sm"
                        >
                          No
                        </button>
                        <button
                          onClick={handleSignup}
                          disabled={signupLoading}
                          className="flex-1 bg-teal-600 text-white py-2 rounded-lg hover:bg-teal-700 transition disabled:opacity-50 text-sm"
                        >
                          {signupLoading ? 'Signing up…' : 'Yes, sign me up'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {isStaff && (
                <div className="pt-4 border-t border-gray-200">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                    Sign ups {signups.length > 0 && <span className="ml-1 text-gray-700">({signups.length})</span>}
                  </h4>
                  {signupsLoading ? (
                    <p className="text-sm text-gray-500">Loading…</p>
                  ) : signups.length === 0 ? (
                    <p className="text-sm text-gray-500 italic">No sign ups yet.</p>
                  ) : (
                    <ul className="space-y-2 max-h-40 overflow-y-auto">
                      {signups.map(s => (
                        <li key={s.id} className="flex items-start space-x-2 bg-gray-50 rounded-lg p-2">
                          {s.users?.avatar_url ? (
                            <img src={s.users.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0"><User size={14} className="text-gray-500" /></div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{s.users?.full_name || 'Unknown'}</p>
                            {s.notes && <p className="text-xs text-gray-600 mt-0.5 whitespace-pre-wrap">{s.notes}</p>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="flex space-x-3 pt-4 border-t border-gray-200">
                <button onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-50 transition">Close</button>
                {isStaff && (
                  <>
                    <button onClick={() => setEditing(true)} className="flex-1 bg-teal-600 text-white py-2 rounded-lg hover:bg-teal-700 transition flex items-center justify-center space-x-1"><Edit2 size={16} /><span>Edit</span></button>
                    <button onClick={handleDelete} className="flex-1 bg-red-600 text-white py-2 rounded-lg hover:bg-red-700 transition flex items-center justify-center space-x-1"><Trash2 size={16} /><span>Delete</span></button>
                  </>
                )}
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

function CoachSlotsWeekView({ selectedDate, slots, reservations, coach, userId, userRole, canManage, onAddSlot, onReserve, onConfirm, onDecline, selecting, selectedIds, onToggleSelect, onEventContextMenu, onSlotDrop }) {
  const startOfWeek = new Date(selectedDate);
  startOfWeek.setDate(selectedDate.getDate() - selectedDate.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  const weekDays = [];
  for (let i = 0; i < 7; i++) { const d = new Date(startOfWeek); d.setDate(startOfWeek.getDate() + i); weekDays.push(d); }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const isOwnSlots = coach.id === userId;
  const formatLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

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
    <div className="border border-gray-200 rounded-lg overflow-x-auto">
      <div className="grid grid-cols-7 divide-x divide-gray-200 min-w-[840px]">
        {weekDays.map((date, idx) => {
          const dateStr = formatLocal(date);
          const daySlots = slots.filter(s => s.slot_date === dateStr);
          const isToday = date.getTime() === today.getTime();
          return (
            <div
              key={idx}
              className="min-h-[400px] bg-white"
              onDragOver={(e) => { if (canManage && onSlotDrop && !selecting) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
              onDrop={(e) => {
                if (!canManage || !onSlotDrop || selecting) return;
                e.preventDefault();
                const slotId = e.dataTransfer.getData('application/x-slot-id');
                if (slotId) onSlotDrop(slotId, dateStr);
              }}
            >
              <div
                className={`p-3 border-b border-gray-200 text-center ${isToday ? 'bg-teal-50' : 'bg-gray-50'} ${canManage && !selecting ? 'cursor-pointer hover:bg-teal-100 transition' : ''}`}
                onClick={canManage && !selecting ? () => onAddSlot(dateStr) : undefined}
                title={canManage && !selecting ? 'Click to add a training slot' : undefined}
              >
                <div className="text-xs font-medium text-gray-600">{date.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                <div className={`text-lg font-semibold ${isToday ? 'text-teal-600' : 'text-gray-900'}`}>{date.getDate()}</div>
                {canManage && <div className="text-[10px] text-teal-700 mt-0.5">+ Add slot</div>}
              </div>
              <div className="p-2 space-y-2">
                {daySlots.map((slot, si) => {
                  const slotRes = reservations.filter(r => r.slot_id === slot.id && r.slot_date === dateStr && r.status !== 'cancelled');
                  const isBooked = slotRes.length >= (slot.max_players || 1);
                  const userRes = slotRes.find(r => r.player_id === userId);
                  const endTime = getEndTime(slot.start_time, slot.duration_minutes);
                  const isSel = selecting && selectedIds && selectedIds.has(String(slot.id));
                  return (
                    <div
                      key={`${slot.id}-${si}`}
                      draggable={canManage && !selecting && !slot._is_virtual && !!onSlotDrop}
                      onDragStart={(e) => {
                        if (!canManage || selecting || slot._is_virtual || !onSlotDrop) return;
                        e.stopPropagation();
                        e.dataTransfer.setData('application/x-slot-id', String(slot.id));
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onClick={(e) => { if (selecting && onToggleSelect) { e.stopPropagation(); onToggleSelect({ ...slot, slot_date: dateStr, id: slot.id }); } }}
                      onContextMenu={(e) => { if (onEventContextMenu && canManage) { e.preventDefault(); e.stopPropagation(); onEventContextMenu({ ...slot, slot_date: dateStr }, e); } }}
                      className={`p-2 rounded-lg border text-xs ${isBooked ? 'bg-gray-100 border-gray-200' : 'bg-teal-50 border-teal-200'} ${isSel ? 'ring-2 ring-blue-500' : ''} ${canManage && !selecting && !slot._is_virtual ? 'cursor-grab' : ''}`}
                    >
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
                {daySlots.length === 0 && (
                  canManage ? (
                    <button onClick={() => onAddSlot(dateStr)} className="w-full text-center py-4 text-gray-400 text-xs border border-dashed border-gray-200 rounded-lg hover:border-teal-400 hover:text-teal-600 transition">+ Add slot</button>
                  ) : (
                    <div className="text-center py-4 text-gray-400 text-xs">No slots</div>
                  )
                )}
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

function CreateSlotPanel({ onClose, onSuccess, coachId, coachName, initialDate, existingSlot }) {
  const isEdit = !!existingSlot;
  const initialDateStr = existingSlot?.slot_date || initialDate || fmtLocalDate(new Date());
  const initialDow = new Date(initialDateStr + 'T00:00:00').getDay();
  const [slotDate, setSlotDate] = useState(initialDateStr);
  const [startTime, setStartTime] = useState(existingSlot?.start_time || '09:00');
  const [duration, setDuration] = useState(existingSlot?.duration_minutes || 60);
  const [autoConfirm, setAutoConfirm] = useState(existingSlot?.auto_confirm || false);
  const [repeatWeekly, setRepeatWeekly] = useState(existingSlot?.repeat_weekly || false);
  const [repeatEndDate, setRepeatEndDate] = useState(existingSlot?.repeat_end_date || '');
  // When creating: default to the weekday of slotDate. When editing: locked to existing weekday.
  const [repeatDows, setRepeatDows] = useState(() => new Set([initialDow]));
  const [maxPlayers, setMaxPlayers] = useState(existingSlot?.max_players || 1);
  const [notes, setNotes] = useState(existingSlot?.notes || '');
  const [loading, setLoading] = useState(false);

  // Keep the slot's own weekday selected when slotDate changes.
  useEffect(() => {
    if (isEdit) return;
    const dow = new Date(slotDate + 'T00:00:00').getDay();
    setRepeatDows(prev => prev.has(dow) ? prev : new Set([...prev, dow]));
  }, [slotDate, isEdit]);

  const toggleDow = (dow) => {
    setRepeatDows(prev => {
      const next = new Set(prev);
      if (next.has(dow)) next.delete(dow); else next.add(dow);
      return next;
    });
  };

  const firstDateOnOrAfter = (fromDateStr, targetDow) => {
    const d = new Date(fromDateStr + 'T00:00:00');
    const offset = (targetDow - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + offset);
    return fmtLocalDate(d);
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      if (isEdit) {
        const payload = {
          coach_id: coachId, slot_date: slotDate, start_time: startTime, duration_minutes: duration,
          auto_confirm: autoConfirm, repeat_weekly: repeatWeekly,
          repeat_end_date: repeatWeekly && repeatEndDate ? repeatEndDate : null, max_players: maxPlayers, notes: notes || null
        };
        const { error } = await supabase.from('training_slots').update(payload).eq('id', existingSlot.id);
        if (error) throw error;
      } else if (repeatWeekly && repeatDows.size > 1) {
        // Create one master slot per selected weekday, anchored to the first occurrence on/after slotDate.
        const baseDow = new Date(slotDate + 'T00:00:00').getDay();
        const rows = [...repeatDows].sort().map(dow => ({
          coach_id: coachId,
          slot_date: dow === baseDow ? slotDate : firstDateOnOrAfter(slotDate, dow),
          start_time: startTime,
          duration_minutes: duration,
          auto_confirm: autoConfirm,
          repeat_weekly: true,
          repeat_end_date: repeatEndDate || null,
          max_players: maxPlayers,
          notes: notes || null,
        }));
        const { error } = await supabase.from('training_slots').insert(rows);
        if (error) throw error;
      } else {
        const payload = {
          coach_id: coachId, slot_date: slotDate, start_time: startTime, duration_minutes: duration,
          auto_confirm: autoConfirm, repeat_weekly: repeatWeekly,
          repeat_end_date: repeatWeekly && repeatEndDate ? repeatEndDate : null, max_players: maxPlayers, notes: notes || null
        };
        const { error } = await supabase.from('training_slots').insert(payload);
        if (error) throw error;
      }
      onSuccess();
    } catch (err) { alert('Error ' + (isEdit ? 'updating' : 'creating') + ' slot: ' + formatUserError(err)); } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="border-b border-gray-200 p-6 flex items-center justify-between">
          <h3 className="text-xl font-bold text-gray-900">{isEdit ? 'Edit' : 'Create'} Training Slot{coachName ? ` for ${coachName}` : ''}</h3>
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
          {repeatWeekly && (
            <>
              {!isEdit && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Days of week</label>
                  <div className="flex flex-wrap gap-1.5">
                    {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((label, dow) => {
                      const selected = repeatDows.has(dow);
                      return (
                        <button
                          type="button"
                          key={dow}
                          onClick={() => toggleDow(dow)}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${
                            selected ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">First occurrence of each weekday on/after the start date becomes the master slot.</p>
                </div>
              )}
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Repeat until</label><input type="date" value={repeatEndDate} onChange={(e) => setRepeatEndDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" /></div>
            </>
          )}
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g., Hitting session, Pitching mechanics" rows="2" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500" /></div>
          <div className="flex space-x-3 pt-2">
            <button onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-50 transition">Cancel</button>
            <button onClick={handleSave} disabled={loading} className="flex-1 bg-teal-600 text-white py-2 rounded-lg hover:bg-teal-700 transition disabled:opacity-50">{loading ? (isEdit ? 'Updating...' : 'Creating...') : (isEdit ? 'Update Slot' : 'Create Slot')}</button>
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
    } catch (err) { alert('Error: ' + formatUserError(err)); } finally { setLoading(false); }
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
              <div>{new Date(slot.slot_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
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

// ============================================
// PLAYER ADD GAME MODAL — players self-upload games to their schedule
// ============================================

function PlayerAddGameModal({ userId, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    title: '',
    event_date: fmtLocalDate(new Date()),
    event_time: '',
    event_end_time: '',
    location: '',
    address: '',
    notes: '',
  });
  const [timeTBD, setTimeTBD] = useState(false);
  // #190: repeat options. 'none' (default), 'weekly', 'biweekly', 'monthly'.
  const [repeat, setRepeat] = useState('none');
  const [repeatEnd, setRepeatEnd] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const buildOccurrenceDates = (startDateStr, freq, endDateStr) => {
    if (freq === 'none' || !endDateStr) return [startDateStr];
    const start = new Date(startDateStr + 'T00:00:00');
    const end = new Date(endDateStr + 'T00:00:00');
    if (end < start) return [startDateStr];
    const stepDays = freq === 'weekly' ? 7 : freq === 'biweekly' ? 14 : 0;
    const stepMonths = freq === 'monthly' ? 1 : 0;
    const out = [];
    const cap = 104; // hard cap so a wrong end date can't insert thousands
    let d = new Date(start);
    while (d <= end && out.length < cap) {
      out.push(fmtLocalDate(d));
      if (stepDays) d.setDate(d.getDate() + stepDays);
      else if (stepMonths) d.setMonth(d.getMonth() + stepMonths);
      else break;
    }
    return out;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    if (repeat !== 'none' && !repeatEnd) {
      setError('Pick a "Repeat until" date to use a repeating game.');
      setLoading(false);
      return;
    }
    const dates = buildOccurrenceDates(formData.event_date, repeat, repeatEnd);
    const baseRow = {
      title: formData.title,
      opponent: formData.title,
      event_type: 'game',
      event_time: timeTBD ? null : (formData.event_time || null),
      event_end_time: timeTBD ? null : (formData.event_end_time || null),
      location: formData.location || null,
      address: formData.address || null,
      notes: formData.notes || null,
      player_id: userId,
      team_id: null,
      training_program_id: null,
      meal_plan_id: null,
    };
    const rows = dates.map(d => ({ ...baseRow, event_date: d }));
    const { error: insertError } = await supabase.from('schedule_events').insert(rows);
    if (insertError) { setError(insertError.message); setLoading(false); return; }
    setLoading(false);
    onSuccess();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
        <div className="border-b border-gray-200 p-6 flex items-center justify-between">
          <h3 className="text-xl font-bold text-gray-900">Add a Game to My Schedule</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={24} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title / Opponent *</label>
            <input
              type="text"
              required
              placeholder="e.g., vs. Hawks"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
              <input
                type="date"
                required
                value={formData.event_date}
                onChange={(e) => setFormData({ ...formData, event_date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Time {!timeTBD && '*'}</label>
              <input
                type="time"
                required={!timeTBD}
                disabled={timeTBD}
                value={timeTBD ? '' : formData.event_time}
                onChange={(e) => setFormData({ ...formData, event_time: e.target.value })}
                className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${timeTBD ? 'bg-gray-100 text-gray-400' : ''}`}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
              <input
                type="time"
                disabled={timeTBD}
                value={timeTBD ? '' : formData.event_end_time}
                onChange={(e) => setFormData({ ...formData, event_end_time: e.target.value })}
                className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${timeTBD ? 'bg-gray-100 text-gray-400' : ''}`}
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={timeTBD}
                  onChange={(e) => setTimeTBD(e.target.checked)}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Time TBD</span>
              </label>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
            <input
              type="text"
              placeholder="e.g., Smith Park Field 3"
              value={formData.location}
              onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
            <input
              type="text"
              placeholder="Full address"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              rows={3}
              placeholder="Anything else (tournament name, uniform, etc.)"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="border-t border-gray-200 pt-3">
            <div className="flex items-center gap-2 mb-2 text-sm font-medium text-gray-700">
              <Repeat size={16} className="text-gray-400" />
              <span>Repeat</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <select
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="none">Does not repeat</option>
                  <option value="weekly">Every week</option>
                  <option value="biweekly">Every 2 weeks</option>
                  <option value="monthly">Every month</option>
                </select>
              </div>
              <div>
                <input
                  type="date"
                  value={repeatEnd}
                  onChange={(e) => setRepeatEnd(e.target.value)}
                  disabled={repeat === 'none'}
                  min={formData.event_date}
                  placeholder="Repeat until"
                  className={`w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${repeat === 'none' ? 'bg-gray-100 text-gray-400' : ''}`}
                />
              </div>
            </div>
            {repeat !== 'none' && (
              <p className="text-xs text-gray-500 mt-1">Creates one game per occurrence between the start date and "Repeat until" (max 104 occurrences).</p>
            )}
          </div>
          <div className="flex space-x-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 transition">Cancel</button>
            <button type="submit" disabled={loading} className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50">{loading ? 'Saving...' : 'Add to Schedule'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
