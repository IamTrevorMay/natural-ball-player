import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { Home, Calendar, Dumbbell, LogOut, ChevronRight, ChevronLeft, Check, Play } from 'lucide-react';

const fmtLocalDate = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

const formatTime = (time) => {
  if (!time) return '';
  const [h, m] = time.split(':');
  const hour = parseInt(h);
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
};

const TABS = [
  { id: 'dashboard', label: 'Today', Icon: Home },
  { id: 'schedule', label: 'Schedule', Icon: Calendar },
  { id: 'program', label: 'Program', Icon: Dumbbell },
];

export default function MobileShell({ userId, userName, userAvatar, onLogout }) {
  const [tab, setTab] = useState('dashboard');

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="sticky top-0 z-20 bg-white border-b px-4 py-3 flex items-center gap-3">
        {userAvatar ? (
          <img src={userAvatar} alt="" className="w-9 h-9 rounded-full object-cover" />
        ) : (
          <div className="w-9 h-9 bg-blue-600 rounded-full flex items-center justify-center text-white text-sm font-bold">
            {userName?.charAt(0) || '?'}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-500 leading-tight">Signed in as</p>
          <p className="text-sm font-semibold text-gray-900 truncate">{userName || 'Player'}</p>
        </div>
        <button
          onClick={onLogout}
          className="p-2 text-gray-500 hover:text-gray-900"
          aria-label="Sign out"
        >
          <LogOut size={18} />
        </button>
      </header>

      <main className="flex-1 overflow-y-auto pb-20">
        {tab === 'dashboard' && <MobileDashboard userId={userId} userName={userName} />}
        {tab === 'schedule' && <MobileSchedule userId={userId} />}
        {tab === 'program' && <MobileProgram userId={userId} />}
      </main>

      <nav className="fixed bottom-0 inset-x-0 bg-white border-t z-30 grid grid-cols-3">
        {TABS.map(({ id, label, Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex flex-col items-center gap-0.5 py-2.5 ${active ? 'text-blue-600' : 'text-gray-500'}`}
            >
              <Icon size={22} strokeWidth={active ? 2.5 : 2} />
              <span className={`text-[11px] ${active ? 'font-semibold' : 'font-medium'}`}>{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}


function MobileDashboard({ userId, userName }) {
  const [loading, setLoading] = useState(true);
  const [scheduleItems, setScheduleItems] = useState([]);
  const [facilityItems, setFacilityItems] = useState([]);
  const [program, setProgram] = useState(null);
  const [mealPlan, setMealPlan] = useState(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const today = fmtLocalDate(new Date());

      // Player's teams
      const { data: tmRows } = await supabase
        .from('team_members')
        .select('team_id')
        .eq('user_id', userId);
      const teamIds = (tmRows || []).map(r => r.team_id).filter(Boolean);

      // 1) schedule_events for today (direct + team)
      const [{ data: directEvents }, { data: teamEvents }] = await Promise.all([
        supabase
          .from('schedule_events')
          .select('*')
          .eq('player_id', userId)
          .eq('event_date', today),
        teamIds.length > 0
          ? supabase
              .from('schedule_events')
              .select('*')
              .overlaps('team_ids', teamIds)
              .eq('event_date', today)
          : Promise.resolve({ data: [] }),
      ]);
      const dedup = new Map();
      [...(directEvents || []), ...(teamEvents || [])].forEach(e => dedup.set(e.id, e));
      const scheduleList = Array.from(dedup.values()).sort((a, b) =>
        (a.event_time || '').localeCompare(b.event_time || '')
      );

      // 2) facility_events the player is signed up for, today
      const { data: signups } = await supabase
        .from('event_signups')
        .select('event_id, event_date, response, facility_events:event_id(id, title, event_type, start_time, end_time, location)')
        .eq('user_id', userId)
        .eq('event_date', today);
      const facilityList = (signups || [])
        .filter(s => s.facility_events && s.response !== 'no')
        .map(s => ({
          id: s.event_id,
          title: s.facility_events.title || s.facility_events.event_type || 'Facility event',
          time: s.facility_events.start_time,
          location: s.facility_events.location,
        }))
        .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

      // 3) active training program assignment (today between start_date and end_date)
      const [{ data: progPlayer }, { data: progTeam }] = await Promise.all([
        supabase
          .from('training_program_assignments')
          .select('id, program_id, start_date, end_date, training_programs(id, name, description, duration_weeks)')
          .eq('player_id', userId)
          .lte('start_date', today)
          .or(`end_date.is.null,end_date.gte.${today}`)
          .order('start_date', { ascending: false })
          .limit(1),
        teamIds.length > 0
          ? supabase
              .from('training_program_assignments')
              .select('id, program_id, start_date, end_date, training_programs(id, name, description, duration_weeks)')
              .in('team_id', teamIds)
              .lte('start_date', today)
              .or(`end_date.is.null,end_date.gte.${today}`)
              .order('start_date', { ascending: false })
              .limit(1)
          : Promise.resolve({ data: [] }),
      ]);
      const programAssignment = (progPlayer && progPlayer[0]) || (progTeam && progTeam[0]) || null;

      let programSummary = null;
      if (programAssignment?.training_programs) {
        const { data: days } = await supabase
          .from('training_days')
          .select('id, day_number, title, training_exercises(id)')
          .eq('program_id', programAssignment.program_id)
          .order('day_number', { ascending: true });
        const totalDays = (days || []).length;
        const totalExercises = (days || []).reduce(
          (sum, d) => sum + (d.training_exercises?.length || 0),
          0
        );
        programSummary = {
          name: programAssignment.training_programs.name,
          description: programAssignment.training_programs.description,
          totalDays,
          totalExercises,
        };
      }

      // 4) active meal plan assignment
      const [{ data: mealPlayer }, { data: mealTeam }] = await Promise.all([
        supabase
          .from('meal_plan_assignments')
          .select('id, meal_plan_id, start_date, end_date, meal_plans(id, name, description)')
          .eq('player_id', userId)
          .lte('start_date', today)
          .or(`end_date.is.null,end_date.gte.${today}`)
          .order('start_date', { ascending: false })
          .limit(1),
        teamIds.length > 0
          ? supabase
              .from('meal_plan_assignments')
              .select('id, meal_plan_id, start_date, end_date, meal_plans(id, name, description)')
              .in('team_id', teamIds)
              .lte('start_date', today)
              .or(`end_date.is.null,end_date.gte.${today}`)
              .order('start_date', { ascending: false })
              .limit(1)
          : Promise.resolve({ data: [] }),
      ]);
      const mealAssignment = (mealPlayer && mealPlayer[0]) || (mealTeam && mealTeam[0]) || null;

      if (cancelled) return;
      setScheduleItems(scheduleList);
      setFacilityItems(facilityList);
      setProgram(programSummary);
      setMealPlan(mealAssignment?.meal_plans || null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const today = new Date();
  const dateLabel = today.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
  const greeting = (() => {
    const h = today.getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  })();
  const firstName = (userName || '').split(' ')[0] || 'Player';

  if (loading) {
    return (
      <div className="p-6 text-center text-gray-500 text-sm">Loading your day…</div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-gray-500">{dateLabel}</p>
        <h1 className="text-2xl font-bold text-gray-900 leading-tight">
          {greeting}, {firstName}
        </h1>
      </div>

      <Section title="Team Schedule" empty="No team events today">
        {scheduleItems.map(e => (
          <Row
            key={e.id}
            title={e.opponent || e.event_type || 'Event'}
            subtitle={[formatTime(e.event_time), e.location].filter(Boolean).join(' · ')}
          />
        ))}
      </Section>

      <Section title="Facility Events" empty="No facility sign-ups today">
        {facilityItems.map(e => (
          <Row
            key={e.id}
            title={e.title}
            subtitle={[formatTime(e.time), e.location].filter(Boolean).join(' · ')}
          />
        ))}
      </Section>

      <Section title="Workout" empty="No active program assigned">
        {program && (
          <Row
            title={program.name}
            subtitle={`${program.totalDays} ${program.totalDays === 1 ? 'day' : 'days'} · ${program.totalExercises} exercises`}
            cta="Open"
          />
        )}
      </Section>

      <Section title="Meal Plan" empty="No active meal plan assigned">
        {mealPlan && (
          <Row
            title={mealPlan.name}
            subtitle={mealPlan.description || ''}
            cta="View"
          />
        )}
      </Section>
    </div>
  );
}

function Section({ title, empty, children }) {
  const hasChildren = React.Children.toArray(children).filter(Boolean).length > 0;
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2 px-1">
        {title}
      </h2>
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden divide-y divide-gray-100">
        {hasChildren ? children : (
          <div className="px-4 py-5 text-sm text-gray-400">{empty}</div>
        )}
      </div>
    </section>
  );
}

function Row({ title, subtitle, cta, badge }) {
  return (
    <div className="px-4 py-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-gray-900 truncate">{title}</p>
          {badge && (
            <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 flex-shrink-0">
              {badge}
            </span>
          )}
        </div>
        {subtitle && <p className="text-xs text-gray-500 truncate mt-0.5">{subtitle}</p>}
      </div>
      {cta && (
        <span className="text-xs font-semibold text-blue-600 flex items-center gap-0.5">
          {cta}
          <ChevronRight size={14} />
        </span>
      )}
    </div>
  );
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function MobileSchedule({ userId }) {
  const [loading, setLoading] = useState(true);
  const [itemsByDate, setItemsByDate] = useState({});

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      const startStr = fmtLocalDate(start);
      const endStr = fmtLocalDate(end);

      const dateRange = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        dateRange.push(fmtLocalDate(d));
      }
      const inRange = (s) => s >= startStr && s <= endStr;

      // Player's teams
      const { data: tmRows } = await supabase
        .from('team_members')
        .select('team_id')
        .eq('user_id', userId);
      const teamIds = (tmRows || []).map(r => r.team_id).filter(Boolean);

      // schedule_events for 7-day window (direct + team)
      const [{ data: directEvents }, { data: teamEvents }] = await Promise.all([
        supabase
          .from('schedule_events')
          .select('*')
          .eq('player_id', userId)
          .gte('event_date', startStr)
          .lte('event_date', endStr),
        teamIds.length > 0
          ? supabase
              .from('schedule_events')
              .select('*')
              .overlaps('team_ids', teamIds)
              .gte('event_date', startStr)
              .lte('event_date', endStr)
          : Promise.resolve({ data: [] }),
      ]);
      const seenSchedule = new Map();
      [...(directEvents || []), ...(teamEvents || [])].forEach(e => seenSchedule.set(e.id, e));

      // facility_events from event_signups in window
      const { data: signups } = await supabase
        .from('event_signups')
        .select('event_id, event_date, response, facility_events:event_id(id, title, event_type, start_time, end_time, location)')
        .eq('user_id', userId)
        .gte('event_date', startStr)
        .lte('event_date', endStr);

      // training slot reservations (confirmed) in window — includes recurring expansion
      const { data: reservations } = await supabase
        .from('slot_reservations')
        .select('*, training_slots(*)')
        .eq('player_id', userId)
        .eq('status', 'confirmed');

      const slotsByDate = {};
      (reservations || []).forEach(r => {
        const slot = r.training_slots;
        if (!slot) return;
        if (slot.slot_date && inRange(slot.slot_date)) {
          (slotsByDate[slot.slot_date] = slotsByDate[slot.slot_date] || []).push({ slot, reservation: r });
          return;
        }
        // weekly recurrence expansion
        if (slot.repeat_weekly && slot.slot_date) {
          const seedDow = new Date(slot.slot_date + 'T00:00:00').getDay();
          dateRange.forEach(ds => {
            const dow = new Date(ds + 'T00:00:00').getDay();
            if (dow !== seedDow) return;
            if (ds < slot.slot_date) return;
            if (slot.repeat_end_date && ds > slot.repeat_end_date) return;
            (slotsByDate[ds] = slotsByDate[ds] || []).push({ slot, reservation: r });
          });
        }
      });

      // Bucket everything by date
      const buckets = {};
      const addItem = (dateStr, item) => {
        if (!inRange(dateStr)) return;
        (buckets[dateStr] = buckets[dateStr] || []).push(item);
      };

      Array.from(seenSchedule.values()).forEach(e => {
        addItem(e.event_date, {
          key: `se-${e.id}`,
          title: e.opponent || e.event_type || 'Event',
          time: e.event_time,
          subtitle: [formatTime(e.event_time), e.location].filter(Boolean).join(' · '),
          badge: e.event_type ? e.event_type.charAt(0).toUpperCase() + e.event_type.slice(1) : null,
        });
      });

      (signups || []).forEach(s => {
        const ev = s.facility_events;
        if (!ev || s.response === 'no') return;
        addItem(s.event_date, {
          key: `fe-${s.event_id}-${s.event_date}`,
          title: ev.title || ev.event_type || 'Facility event',
          time: ev.start_time,
          subtitle: [formatTime(ev.start_time), ev.location].filter(Boolean).join(' · '),
          badge: 'Facility',
        });
      });

      Object.entries(slotsByDate).forEach(([ds, list]) => {
        list.forEach(({ slot, reservation }) => {
          addItem(ds, {
            key: `slot-${reservation.id}-${ds}`,
            title: slot.title || 'Training session',
            time: slot.start_time,
            subtitle: [formatTime(slot.start_time), slot.location].filter(Boolean).join(' · '),
            badge: 'Lesson',
          });
        });
      });

      // Sort items within each day by time
      Object.keys(buckets).forEach(d => {
        buckets[d].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
      });

      if (cancelled) return;
      setItemsByDate(buckets);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  if (loading) {
    return <div className="p-6 text-center text-gray-500 text-sm">Loading schedule…</div>;
  }

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }

  const totalItems = Object.values(itemsByDate).reduce((sum, arr) => sum + arr.length, 0);

  return (
    <div className="p-4 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-gray-500">Next 7 days</p>
        <h1 className="text-2xl font-bold text-gray-900 leading-tight">Schedule</h1>
      </div>

      {totalItems === 0 && (
        <div className="bg-white rounded-2xl shadow-sm p-6 text-center text-sm text-gray-400">
          Nothing scheduled this week
        </div>
      )}

      {days.map((d, idx) => {
        const ds = fmtLocalDate(d);
        const list = itemsByDate[ds] || [];
        if (list.length === 0) return null;
        const dow = DAY_LABELS[d.getDay()];
        const isToday = idx === 0;
        return (
          <section key={ds}>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2 px-1 flex items-center gap-2">
              <span>{isToday ? 'Today' : dow}, {MONTH_LABELS[d.getMonth()]} {d.getDate()}</span>
              {isToday && <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">Today</span>}
            </h2>
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden divide-y divide-gray-100">
              {list.map(item => (
                <Row
                  key={item.key}
                  title={item.title}
                  subtitle={item.subtitle}
                  badge={item.badge}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function MobileProgram({ userId }) {
  const [subTab, setSubTab] = useState('workouts');
  return (
    <div className="p-4 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-gray-500">Your assigned plan</p>
        <h1 className="text-2xl font-bold text-gray-900 leading-tight">Program</h1>
      </div>

      <div className="bg-gray-200 rounded-xl p-1 grid grid-cols-2 text-sm font-semibold">
        {['workouts', 'meals'].map(s => (
          <button
            key={s}
            onClick={() => setSubTab(s)}
            className={`py-2 rounded-lg transition ${subTab === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {subTab === 'workouts' && <MobileWorkouts userId={userId} />}
      {subTab === 'meals' && <MobileMeals userId={userId} />}
    </div>
  );
}

function MobileWorkouts({ userId }) {
  const [loading, setLoading] = useState(true);
  const [program, setProgram] = useState(null);
  const [days, setDays] = useState([]);
  const [openDay, setOpenDay] = useState(null);
  const [openExercise, setOpenExercise] = useState(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const today = fmtLocalDate(new Date());
      const { data: tmRows } = await supabase
        .from('team_members')
        .select('team_id')
        .eq('user_id', userId);
      const teamIds = (tmRows || []).map(r => r.team_id).filter(Boolean);

      const [{ data: progPlayer }, { data: progTeam }] = await Promise.all([
        supabase
          .from('training_program_assignments')
          .select('id, program_id, start_date, end_date, training_programs(id, name, description, duration_weeks)')
          .eq('player_id', userId)
          .lte('start_date', today)
          .or(`end_date.is.null,end_date.gte.${today}`)
          .order('start_date', { ascending: false })
          .limit(1),
        teamIds.length > 0
          ? supabase
              .from('training_program_assignments')
              .select('id, program_id, start_date, end_date, training_programs(id, name, description, duration_weeks)')
              .in('team_id', teamIds)
              .lte('start_date', today)
              .or(`end_date.is.null,end_date.gte.${today}`)
              .order('start_date', { ascending: false })
              .limit(1)
          : Promise.resolve({ data: [] }),
      ]);
      const assignment = (progPlayer && progPlayer[0]) || (progTeam && progTeam[0]) || null;

      if (cancelled) return;
      if (!assignment) {
        setProgram(null);
        setDays([]);
        setLoading(false);
        return;
      }

      const { data: dayRows } = await supabase
        .from('training_days')
        .select('id, day_number, title, notes, training_exercises(id, category, name, description, sets, reps, weight, video_url, image_url, sort_order, rest, load, super_set)')
        .eq('program_id', assignment.program_id)
        .order('day_number', { ascending: true });

      const sortedDays = (dayRows || []).map(d => ({
        ...d,
        training_exercises: (d.training_exercises || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
      }));

      if (cancelled) return;
      setProgram(assignment.training_programs);
      setDays(sortedDays);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  if (loading) return <div className="p-6 text-center text-gray-500 text-sm">Loading workouts…</div>;
  if (!program) {
    return (
      <div className="bg-white rounded-2xl shadow-sm p-6 text-center text-sm text-gray-400">
        No active program assigned
      </div>
    );
  }

  if (openExercise) {
    return (
      <ExerciseDetail
        userId={userId}
        exercise={openExercise}
        onBack={() => setOpenExercise(null)}
      />
    );
  }

  if (openDay) {
    return (
      <DayDetail
        day={openDay}
        onBack={() => setOpenDay(null)}
        onOpenExercise={(ex) => setOpenExercise(ex)}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <p className="text-sm font-bold text-gray-900">{program.name}</p>
        {program.description && (
          <p className="text-xs text-gray-500 mt-1">{program.description}</p>
        )}
        <p className="text-xs text-gray-400 mt-2">
          {days.length} {days.length === 1 ? 'day' : 'days'} · {days.reduce((s, d) => s + (d.training_exercises?.length || 0), 0)} exercises
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden divide-y divide-gray-100">
        {days.map(d => (
          <button
            key={d.id}
            onClick={() => setOpenDay(d)}
            className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50"
          >
            <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold flex-shrink-0">
              {d.day_number}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">
                {d.title || `Day ${d.day_number}`}
              </p>
              <p className="text-xs text-gray-500">
                {(d.training_exercises?.length || 0)} exercises
              </p>
            </div>
            <ChevronRight size={16} className="text-gray-400" />
          </button>
        ))}
      </div>
    </div>
  );
}

function DayDetail({ day, onBack, onOpenExercise }) {
  const exercises = day.training_exercises || [];
  return (
    <div className="space-y-3">
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-sm font-semibold text-blue-600"
      >
        <ChevronLeft size={16} />
        Back to days
      </button>

      <div className="bg-white rounded-2xl shadow-sm p-4">
        <p className="text-xs uppercase tracking-wide text-gray-500">Day {day.day_number}</p>
        <p className="text-lg font-bold text-gray-900 leading-tight">{day.title || `Day ${day.day_number}`}</p>
        {day.notes && <p className="text-xs text-gray-500 mt-2">{day.notes}</p>}
      </div>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden divide-y divide-gray-100">
        {exercises.length === 0 && (
          <div className="px-4 py-5 text-sm text-gray-400">No exercises in this day</div>
        )}
        {exercises.map(ex => (
          <button
            key={ex.id}
            onClick={() => onOpenExercise(ex)}
            className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-gray-50"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-gray-900 truncate">{ex.name}</p>
                {ex.category && (
                  <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 flex-shrink-0">
                    {ex.category}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                {[ex.sets && `${ex.sets}×${ex.reps || '—'}`, ex.load, ex.rest].filter(Boolean).join(' · ')}
              </p>
            </div>
            <ChevronRight size={16} className="text-gray-400" />
          </button>
        ))}
      </div>
    </div>
  );
}

function ExerciseDetail({ userId, exercise, onBack }) {
  const setsCount = Math.max(1, parseInt(exercise.sets) || 1);
  const today = fmtLocalDate(new Date());
  const [logs, setLogs] = useState(() =>
    Array.from({ length: setsCount }, (_, i) => ({
      id: null,
      set_number: i + 1,
      reps_actual: '',
      load_actual: '',
      notes: '',
    }))
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('player_workout_logs')
        .select('id, set_number, reps_actual, load_actual, notes')
        .eq('player_id', userId)
        .eq('training_exercise_id', exercise.id)
        .eq('log_date', today)
        .order('set_number', { ascending: true });

      if (cancelled) return;
      const byNumber = new Map((data || []).map(r => [r.set_number, r]));
      setLogs(prev =>
        prev.map(row => {
          const found = byNumber.get(row.set_number);
          return found
            ? {
                id: found.id,
                set_number: found.set_number,
                reps_actual: found.reps_actual ?? '',
                load_actual: found.load_actual ?? '',
                notes: found.notes ?? '',
              }
            : row;
        })
      );
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId, exercise.id, today]);

  const updateRow = (idx, patch) => {
    setLogs(prev => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const saveSet = async (idx) => {
    const row = logs[idx];
    setSaving(true);
    const payload = {
      player_id: userId,
      training_exercise_id: exercise.id,
      log_date: today,
      set_number: row.set_number,
      reps_actual: row.reps_actual === '' ? null : parseInt(row.reps_actual),
      load_actual: row.load_actual || null,
      notes: row.notes || null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from('player_workout_logs')
      .upsert(payload, { onConflict: 'player_id,training_exercise_id,log_date,set_number' })
      .select('id')
      .single();
    setSaving(false);
    if (error) {
      alert('Could not save set: ' + error.message);
      return;
    }
    if (data?.id && !row.id) {
      updateRow(idx, { id: data.id });
    }
    setSavedAt(new Date());
  };

  const addSet = () => {
    setLogs(prev => [
      ...prev,
      {
        id: null,
        set_number: prev.length + 1,
        reps_actual: '',
        load_actual: '',
        notes: '',
      },
    ]);
  };

  const videoUrl = exercise.video_url;

  return (
    <div className="space-y-3">
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-sm font-semibold text-blue-600"
      >
        <ChevronLeft size={16} />
        Back
      </button>

      <div className="bg-white rounded-2xl shadow-sm p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {exercise.category && (
                <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                  {exercise.category}
                </span>
              )}
            </div>
            <p className="text-lg font-bold text-gray-900 leading-tight">{exercise.name}</p>
            {exercise.description && (
              <p className="text-sm text-gray-600 mt-1">{exercise.description}</p>
            )}
          </div>
          {videoUrl && (
            <a
              href={videoUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-xs font-semibold text-blue-600 flex-shrink-0"
            >
              <Play size={14} />
              Video
            </a>
          )}
        </div>

        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Stat label="Sets" value={exercise.sets || '—'} />
          <Stat label="Reps" value={exercise.reps || '—'} />
          <Stat label="Load" value={exercise.load || '—'} />
        </dl>
        {(exercise.rest || exercise.super_set) && (
          <p className="text-xs text-gray-500 mt-2">
            {[exercise.rest && `Rest ${exercise.rest}`, exercise.super_set && `Superset: ${exercise.super_set}`]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <p className="text-sm font-bold text-gray-900">Log your sets</p>
          {savedAt && (
            <span className="text-[11px] text-green-600 flex items-center gap-1">
              <Check size={12} /> Saved
            </span>
          )}
        </div>
        {loading ? (
          <div className="p-6 text-center text-sm text-gray-400">Loading…</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {logs.map((row, idx) => (
              <div key={row.set_number} className="px-4 py-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-500 w-12">Set {row.set_number}</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    placeholder="Reps"
                    value={row.reps_actual}
                    onChange={(e) => updateRow(idx, { reps_actual: e.target.value })}
                    className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="text"
                    placeholder="Load"
                    value={row.load_actual}
                    onChange={(e) => updateRow(idx, { load_actual: e.target.value })}
                    className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={() => saveSet(idx)}
                    disabled={saving}
                    className="px-3 py-2 bg-blue-600 text-white text-xs font-semibold rounded-lg disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="Notes (optional)"
                  value={row.notes}
                  onChange={(e) => updateRow(idx, { notes: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            ))}
          </div>
        )}
        <button
          onClick={addSet}
          className="w-full px-4 py-3 text-sm font-semibold text-blue-600 border-t hover:bg-gray-50"
        >
          + Add set
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-gray-50 rounded-lg py-2">
      <p className="text-[10px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-sm font-bold text-gray-900">{value}</p>
    </div>
  );
}

function MobileMeals({ userId }) {
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState(null);
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const today = fmtLocalDate(new Date());
      const { data: tmRows } = await supabase
        .from('team_members')
        .select('team_id')
        .eq('user_id', userId);
      const teamIds = (tmRows || []).map(r => r.team_id).filter(Boolean);

      const [{ data: mealPlayer }, { data: mealTeam }] = await Promise.all([
        supabase
          .from('meal_plan_assignments')
          .select('id, meal_plan_id, start_date, end_date, meal_plans(id, name, description)')
          .eq('player_id', userId)
          .lte('start_date', today)
          .or(`end_date.is.null,end_date.gte.${today}`)
          .order('start_date', { ascending: false })
          .limit(1),
        teamIds.length > 0
          ? supabase
              .from('meal_plan_assignments')
              .select('id, meal_plan_id, start_date, end_date, meal_plans(id, name, description)')
              .in('team_id', teamIds)
              .lte('start_date', today)
              .or(`end_date.is.null,end_date.gte.${today}`)
              .order('start_date', { ascending: false })
              .limit(1)
          : Promise.resolve({ data: [] }),
      ]);
      const assignment = (mealPlayer && mealPlayer[0]) || (mealTeam && mealTeam[0]) || null;

      if (cancelled) return;
      if (!assignment) {
        setPlan(null);
        setItems([]);
        setLoading(false);
        return;
      }

      const { data: itemRows } = await supabase
        .from('meal_plan_items')
        .select('id, sort_order, meal_id, meals(id, name, description, meal_type, calories, protein_g, carbs_g, fat_g)')
        .eq('meal_plan_id', assignment.meal_plan_id)
        .order('sort_order', { ascending: true });

      if (cancelled) return;
      setPlan(assignment.meal_plans);
      setItems((itemRows || []).filter(r => r.meals));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  if (loading) return <div className="p-6 text-center text-gray-500 text-sm">Loading meals…</div>;
  if (!plan) {
    return (
      <div className="bg-white rounded-2xl shadow-sm p-6 text-center text-sm text-gray-400">
        No active meal plan assigned
      </div>
    );
  }

  const totals = items.reduce(
    (acc, it) => {
      const m = it.meals;
      acc.cal += m.calories || 0;
      acc.p += parseFloat(m.protein_g) || 0;
      acc.c += parseFloat(m.carbs_g) || 0;
      acc.f += parseFloat(m.fat_g) || 0;
      return acc;
    },
    { cal: 0, p: 0, c: 0, f: 0 }
  );

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl shadow-sm p-4">
        <p className="text-sm font-bold text-gray-900">{plan.name}</p>
        {plan.description && (
          <p className="text-xs text-gray-500 mt-1">{plan.description}</p>
        )}
        {items.length > 0 && (
          <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
            <Stat label="kcal" value={Math.round(totals.cal)} />
            <Stat label="P" value={`${Math.round(totals.p)}g`} />
            <Stat label="C" value={`${Math.round(totals.c)}g`} />
            <Stat label="F" value={`${Math.round(totals.f)}g`} />
          </dl>
        )}
      </div>

      {items.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm p-6 text-center text-sm text-gray-400">
          No meals in this plan yet
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden divide-y divide-gray-100">
          {items.map(it => {
            const m = it.meals;
            const macros = [
              m.calories && `${m.calories} kcal`,
              m.protein_g && `P ${m.protein_g}g`,
              m.carbs_g && `C ${m.carbs_g}g`,
              m.fat_g && `F ${m.fat_g}g`,
            ].filter(Boolean).join(' · ');
            return (
              <div key={it.id} className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-gray-900 flex-1 min-w-0 truncate">{m.name}</p>
                  {m.meal_type && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 flex-shrink-0">
                      {m.meal_type}
                    </span>
                  )}
                </div>
                {m.description && (
                  <p className="text-xs text-gray-500 mt-0.5">{m.description}</p>
                )}
                {macros && (
                  <p className="text-[11px] text-gray-400 mt-1">{macros}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
