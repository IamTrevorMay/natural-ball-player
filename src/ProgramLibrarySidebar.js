import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient';
import { ChevronRight, ChevronDown, Dumbbell, Utensils, Search, Folder } from 'lucide-react';

const DRAG_MIME = 'application/x-program-item';

function getWorkoutCategory(title) {
  const t = (title || '').toLowerCase();
  if (t.includes('pitch') || t.includes('throw') || t.includes('mound') || t.includes('bullpen') || t.includes('long toss') || t.includes('velo')) return 'Pitching';
  if (t.includes('hit') || t.includes('tee') || t.includes('batting') || t.includes('swing')) return 'Hitting';
  if (t.includes('warm') || t.includes('mobil') || t.includes('stretch') || t.includes('recovery')) return 'Warmup';
  return 'General';
}

export default function ProgramLibrarySidebar({ collapsed, onToggle }) {
  const [templates, setTemplates] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [mealPlans, setMealPlans] = useState([]);
  const [meals, setMeals] = useState([]);
  const [openFolders, setOpenFolders] = useState({ Workouts: true, Meals: true });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [tplRes, progRes, mpRes, mealRes] = await Promise.all([
        supabase.from('workout_templates').select('id, name, folder, program, notes').order('name'),
        supabase.from('training_programs').select('id, name, description, duration_weeks').order('name'),
        supabase.from('meal_plans').select('id, name, description').order('name'),
        supabase.from('meals').select('id, name, meal_type, calories').order('name'),
      ]);
      if (cancelled) return;
      setTemplates(tplRes.data || []);
      setPrograms(progRes.data || []);
      setMealPlans(mpRes.data || []);
      setMeals(mealRes.data || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const match = (s) => !q || (s || '').toLowerCase().includes(q);

    const tplByFolder = {};
    templates.forEach((t) => {
      if (!match(t.name) && !match(t.folder) && !match(t.program)) return;
      const folder = t.folder || t.program || getWorkoutCategory(t.name);
      if (!tplByFolder[folder]) tplByFolder[folder] = [];
      tplByFolder[folder].push(t);
    });

    const mealsByType = {};
    meals.forEach((m) => {
      if (!match(m.name) && !match(m.meal_type)) return;
      const type = m.meal_type || 'Other';
      const label = type.charAt(0).toUpperCase() + type.slice(1);
      if (!mealsByType[label]) mealsByType[label] = [];
      mealsByType[label].push(m);
    });

    return {
      tplByFolder,
      programs: programs.filter((p) => match(p.name) || match(p.description)),
      mealPlans: mealPlans.filter((p) => match(p.name) || match(p.description)),
      mealsByType,
    };
  }, [templates, programs, mealPlans, meals, search]);

  const toggleFolder = (key) => setOpenFolders((s) => ({ ...s, [key]: !s[key] }));

  const startDrag = (e, kind, item) => {
    const payload = { kind, id: item.id, name: item.name };
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
    e.dataTransfer.setData('text/plain', item.name);
    e.dataTransfer.effectAllowed = 'copy';
  };

  if (collapsed) {
    return (
      <div className="w-12 bg-gray-50 border-r border-gray-200 flex-shrink-0">
        <button onClick={onToggle} className="w-full p-4 hover:bg-gray-100 transition" title="Open program library">
          <Dumbbell size={18} className="text-gray-600 mx-auto" />
        </button>
      </div>
    );
  }

  return (
    <div className="w-72 bg-gray-50 border-r border-gray-200 flex-shrink-0 flex flex-col" style={{ maxHeight: 'calc(100vh - 200px)' }}>
      <button onClick={onToggle} className="p-4 border-b border-gray-200 flex items-center justify-between hover:bg-gray-100 transition">
        <div className="text-left">
          <h3 className="font-semibold text-gray-900 text-sm">Program Library</h3>
          <p className="text-xs text-gray-500 mt-0.5">Drag onto the calendar</p>
        </div>
        <ChevronRight size={16} className="text-gray-500 rotate-180" />
      </button>
      <div className="p-2 border-b border-gray-200">
        <div className="relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search programs..."
            className="w-full pl-7 pr-2 py-1.5 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>
      {loading ? (
        <div className="p-4 text-center text-gray-400 text-sm">Loading...</div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <TopFolder label="Workouts" icon={<Dumbbell size={14} />} open={openFolders.Workouts} onToggle={() => toggleFolder('Workouts')}>
            <SubFolder label="Templates" count={Object.values(grouped.tplByFolder).reduce((a, b) => a + b.length, 0)}>
              {Object.entries(grouped.tplByFolder).sort(([a], [b]) => a.localeCompare(b)).map(([folder, items]) => (
                <CategoryFolder key={folder} label={folder} count={items.length}>
                  {items.map((t) => (
                    <DragItem key={t.id} label={t.name} subtitle={t.notes} onDragStart={(e) => startDrag(e, 'template', t)} />
                  ))}
                </CategoryFolder>
              ))}
              {Object.keys(grouped.tplByFolder).length === 0 && <EmptyHint>No templates</EmptyHint>}
            </SubFolder>
            <SubFolder label="Programs" count={grouped.programs.length}>
              {grouped.programs.map((p) => (
                <DragItem key={p.id} label={p.name} subtitle={p.duration_weeks ? `${p.duration_weeks} wk` : p.description} onDragStart={(e) => startDrag(e, 'program', p)} />
              ))}
              {grouped.programs.length === 0 && <EmptyHint>No programs</EmptyHint>}
            </SubFolder>
          </TopFolder>
          <TopFolder label="Meals" icon={<Utensils size={14} />} open={openFolders.Meals} onToggle={() => toggleFolder('Meals')}>
            <SubFolder label="Plans" count={grouped.mealPlans.length}>
              {grouped.mealPlans.map((p) => (
                <DragItem key={p.id} label={p.name} subtitle={p.description} onDragStart={(e) => startDrag(e, 'meal_plan', p)} />
              ))}
              {grouped.mealPlans.length === 0 && <EmptyHint>No meal plans</EmptyHint>}
            </SubFolder>
            <SubFolder label="Individual Meals" count={Object.values(grouped.mealsByType).reduce((a, b) => a + b.length, 0)}>
              {Object.entries(grouped.mealsByType).sort(([a], [b]) => a.localeCompare(b)).map(([type, items]) => (
                <CategoryFolder key={type} label={type} count={items.length}>
                  {items.map((m) => (
                    <DragItem key={m.id} label={m.name} subtitle={m.calories ? `${m.calories} cal` : null} onDragStart={(e) => startDrag(e, 'meal', m)} />
                  ))}
                </CategoryFolder>
              ))}
              {Object.keys(grouped.mealsByType).length === 0 && <EmptyHint>No meals</EmptyHint>}
            </SubFolder>
          </TopFolder>
        </div>
      )}
    </div>
  );
}

function TopFolder({ label, icon, open, onToggle, children }) {
  return (
    <div className="border-b border-gray-100">
      <button onClick={onToggle} className="w-full px-3 py-2 flex items-center justify-between hover:bg-gray-100 transition">
        <div className="flex items-center space-x-2">
          {open ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
          <span className="text-gray-600">{icon}</span>
          <span className="text-sm font-semibold text-gray-900">{label}</span>
        </div>
      </button>
      {open && <div className="pb-1">{children}</div>}
    </div>
  );
}

function SubFolder({ label, count, children }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="ml-4 border-l border-gray-200">
      <button onClick={() => setOpen((s) => !s)} className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-gray-100 transition">
        <div className="flex items-center space-x-1.5">
          {open ? <ChevronDown size={12} className="text-gray-400" /> : <ChevronRight size={12} className="text-gray-400" />}
          <Folder size={12} className="text-gray-400" />
          <span className="text-xs font-medium text-gray-700">{label}</span>
        </div>
        <span className="text-[10px] text-gray-400">{count}</span>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

function CategoryFolder({ label, count, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ml-4">
      <button onClick={() => setOpen((s) => !s)} className="w-full px-3 py-1 flex items-center justify-between hover:bg-gray-100 transition">
        <div className="flex items-center space-x-1.5">
          {open ? <ChevronDown size={11} className="text-gray-400" /> : <ChevronRight size={11} className="text-gray-400" />}
          <span className="text-xs text-gray-600">{label}</span>
        </div>
        <span className="text-[10px] text-gray-400">{count}</span>
      </button>
      {open && <div className="ml-5">{children}</div>}
    </div>
  );
}

function DragItem({ label, subtitle, onDragStart }) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="px-3 py-1.5 cursor-grab hover:bg-blue-50 active:cursor-grabbing border-l-2 border-transparent hover:border-blue-400 transition"
      title="Drag onto a date to schedule"
    >
      <div className="text-xs font-medium text-gray-900 truncate">{label}</div>
      {subtitle && <div className="text-[10px] text-gray-500 truncate">{subtitle}</div>}
    </div>
  );
}

function EmptyHint({ children }) {
  return <div className="px-4 py-2 text-[10px] text-gray-400 italic">{children}</div>;
}

export { DRAG_MIME };
