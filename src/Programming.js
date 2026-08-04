import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { Dumbbell, Utensils, Zap, Target, FolderOpen, Wand2 } from 'lucide-react';
import { TrainingTab, MealsTab } from './CoachTools';
import ProgramGenerator from './ProgramGenerator';
import ThrowingGenerator from './ThrowingGenerator';
import HittingGenerator from './HittingGenerator';
import NutritionGenerator from './NutritionGenerator';

/* --------------------------------------------------------------------------- *
 *  Programming — unified staff hub for training/meal libraries + the generators.
 *
 *  Two top-level views:
 *    • Programs  — the Training Programs & Meal Plans libraries (moved out of
 *                  Coach Tools; TrainingTab / MealsTab are shared components).
 *    • Generate  — the four assessment/data-driven generators (S&C, Throwing,
 *                  Hitting, Nutrition), each on its own sub-tab.
 * --------------------------------------------------------------------------- */

export default function Programming({ userId, userRole }) {
  const [teams, setTeams] = useState([]);
  const [players, setPlayers] = useState([]);

  const [view, setView] = useState('programs'); // 'programs' | 'generate'
  const [programsTab, setProgramsTab] = useState('training'); // 'training' | 'meals'
  const [genTab, setGenTab] = useState('sc'); // 'sc' | 'throwing' | 'hitting' | 'nutrition'

  // Teams + players power the Training/Meal library tabs (mirrors CoachTools).
  useEffect(() => {
    (async () => {
      const { data: t } = await supabase.from('teams').select('*').order('name');
      setTeams(t || []);
      const { data: p } = await supabase
        .from('users')
        .select('id, full_name, email, player_profiles!player_profiles_user_id_fkey(position, jersey_number, level), team_members(team_id, teams(name))')
        .or('role.eq.player,role.eq.coach,role.eq.admin,secondary_role.eq.player')
        .order('full_name');
      setPlayers(p || []);
    })();
  }, []);

  const programsSubTabs = [
    { key: 'training', icon: Dumbbell, label: 'Training Programs' },
    { key: 'meals', icon: Utensils, label: 'Meal Plans' },
  ];
  const genSubTabs = [
    { key: 'sc', icon: Dumbbell, label: 'S&C' },
    { key: 'throwing', icon: Zap, label: 'Throwing' },
    { key: 'hitting', icon: Target, label: 'Hitting' },
    { key: 'nutrition', icon: Utensils, label: 'Nutrition' },
  ];

  const viewBtn = (key, icon, label) => {
    const Icon = icon;
    const active = view === key;
    return (
      <button
        key={key}
        onClick={() => setView(key)}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${
          active ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
        }`}
      >
        <Icon size={16} />{label}
      </button>
    );
  };

  const subTab = (tab, current, setter) => (
    <button
      key={tab.key}
      onClick={() => setter(tab.key)}
      className={`py-3 px-1 border-b-2 font-medium text-sm transition whitespace-nowrap ${
        current === tab.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
      }`}
    >
      <tab.icon size={16} className="inline mr-2" />{tab.label}
    </button>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-gray-900">Programming</h2>
        <p className="text-gray-600 mt-1">Training &amp; meal-plan libraries and the assessment-driven generators.</p>
      </div>

      {/* View toggle: Programs | Generate */}
      <div className="flex gap-2">
        {viewBtn('programs', FolderOpen, 'Programs')}
        {viewBtn('generate', Wand2, 'Generate')}
      </div>

      {view === 'programs' && (
        <div className="bg-white rounded-lg shadow">
          <div className="border-b border-gray-200">
            <nav className="flex space-x-8 px-6 overflow-x-auto">
              {programsSubTabs.map((tab) => subTab(tab, programsTab, setProgramsTab))}
            </nav>
          </div>
          <div className="p-6">
            {programsTab === 'training' && <TrainingTab teams={teams} players={players} />}
            {programsTab === 'meals' && <MealsTab teams={teams} players={players} />}
          </div>
        </div>
      )}

      {view === 'generate' && (
        <div className="bg-white rounded-lg shadow">
          <div className="border-b border-gray-200">
            <nav className="flex space-x-8 px-6 overflow-x-auto">
              {genSubTabs.map((tab) => subTab(tab, genTab, setGenTab))}
            </nav>
          </div>
          <div>
            {genTab === 'sc' && <ProgramGenerator userId={userId} userRole={userRole} />}
            {genTab === 'throwing' && <ThrowingGenerator userId={userId} userRole={userRole} />}
            {genTab === 'hitting' && <HittingGenerator userId={userId} userRole={userRole} />}
            {genTab === 'nutrition' && <NutritionGenerator userId={userId} userRole={userRole} />}
          </div>
        </div>
      )}
    </div>
  );
}
