import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { User, Edit2, Save, X, Mail, Phone, Calendar, TrendingUp, Dumbbell, Utensils, Target, Award, Users } from 'lucide-react';

export default function Profile({ userId, userRole }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    fetchProfile();
  }, [userId]);

  const fetchProfile = async () => {
    try {
      // First get basic user data
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (userError) {
        console.error('Error fetching user:', userError);
        setLoading(false);
        return;
      }

      if (!userData) {
        console.log('No user found with id:', userId);
        setLoading(false);
        return;
      }

      // Start with basic user data
      const profileData = { ...userData };

      // Get player profile if it exists
      const { data: playerProfile } = await supabase
        .from('player_profiles')
        .select('*')
        .eq('user_id', userId);
      
      profileData.player_profiles = playerProfile || [];

      // Get team memberships
      const { data: teamMembers } = await supabase
        .from('team_members')
        .select(`
          team_id,
          role,
          teams(id, name, description)
        `)
        .eq('user_id', userId);
      
      profileData.team_members = teamMembers || [];

      // Get training program assignments
      const { data: trainingAssignments } = await supabase
        .from('training_program_assignments')
        .select(`
          id,
          start_date,
          end_date,
          training_programs(id, name, description, duration_weeks)
        `)
        .eq('player_id', userId);
      
      profileData.training_program_assignments = trainingAssignments || [];

      // Get meal plan assignments
      const { data: mealAssignments } = await supabase
        .from('meal_plan_assignments')
        .select(`
          id,
          start_date,
          end_date,
          meal_plans(id, name, description)
        `)
        .eq('player_id', userId);
      
      profileData.meal_plan_assignments = mealAssignments || [];

      console.log('Complete profile data:', profileData);
      setProfile(profileData);
    } catch (err) {
      console.error('Error in fetchProfile:', err);
    }
    
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Loading profile...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="bg-white rounded-lg shadow p-12 text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Profile Not Found</h2>
        <p className="text-gray-600">Unable to load profile data.</p>
      </div>
    );
  }

  const tabs = [
    { key: 'overview', label: 'Overview', icon: User },
    { key: 'performance', label: 'Performance', icon: TrendingUp, playerOnly: true },
    { key: 'training', label: 'Training', icon: Dumbbell, playerOnly: true },
    { key: 'nutrition', label: 'Nutrition', icon: Utensils, playerOnly: true },
  ];

  const visibleTabs = tabs.filter(tab => !tab.playerOnly || userRole === 'player');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-800 rounded-lg shadow-lg p-8 text-white">
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-6">
            <div className="w-24 h-24 bg-white/20 rounded-full flex items-center justify-center text-4xl font-bold">
              {profile.player_profiles?.[0]?.jersey_number || profile.full_name.charAt(0)}
            </div>
            <div>
              <h1 className="text-3xl font-bold">{profile.full_name}</h1>
              <p className="text-blue-100 mt-1 capitalize">{profile.role}</p>
              {profile.player_profiles?.[0] && (
                <div className="flex items-center space-x-4 mt-3 text-sm text-blue-100">
                  <span>Position: {profile.player_profiles[0].position || 'Not set'}</span>
                  <span>•</span>
                  <span>Grade: {profile.player_profiles[0].grade || 'Not set'}</span>
                  <span>•</span>
                  <span>Bats: {profile.player_profiles[0].bats}</span>
                  <span>•</span>
                  <span>Throws: {profile.player_profiles[0].throws}</span>
                </div>
              )}
            </div>
          </div>
          <button
            onClick={() => setEditing(!editing)}
            className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg font-medium transition flex items-center space-x-2"
          >
            {editing ? <X size={18} /> : <Edit2 size={18} />}
            <span>{editing ? 'Cancel' : 'Edit Profile'}</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-lg shadow">
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8 px-6">
            {visibleTabs.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`py-4 px-1 border-b-2 font-medium text-sm transition flex items-center space-x-2 ${
                    activeTab === tab.key
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <Icon size={16} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-6">
          {activeTab === 'overview' && (
            <OverviewTab
              profile={profile}
              editing={editing}
              onSave={() => {
                setEditing(false);
                fetchProfile();
              }}
            />
          )}
          {activeTab === 'performance' && <PerformanceTab userId={userId} />}
          {activeTab === 'training' && (
            <TrainingTab assignments={profile.training_program_assignments || []} />
          )}
          {activeTab === 'nutrition' && (
            <NutritionTab assignments={profile.meal_plan_assignments || []} />
          )}
        </div>
      </div>
    </div>
  );
}

function OverviewTab({ profile, editing, onSave }) {
  const [formData, setFormData] = useState({
    full_name: profile.full_name,
    email: profile.email,
    phone: profile.phone || '',
    // Player-specific fields
    jersey_number: profile.player_profiles?.[0]?.jersey_number || '',
    position: profile.player_profiles?.[0]?.position || '',
    grade: profile.player_profiles?.[0]?.grade || '',
    height: profile.player_profiles?.[0]?.height || '',
    weight: profile.player_profiles?.[0]?.weight || '',
    bats: profile.player_profiles?.[0]?.bats || 'Right',
    throws: profile.player_profiles?.[0]?.throws || 'Right',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');

    try {
      // Update users table
      const { error: userError } = await supabase
        .from('users')
        .update({
          full_name: formData.full_name,
          phone: formData.phone || null,
        })
        .eq('id', profile.id);

      if (userError) throw userError;

      // Update player profile if exists
      if (profile.player_profiles?.[0]) {
        const { error: profileError } = await supabase
          .from('player_profiles')
          .update({
            jersey_number: formData.jersey_number || null,
            position: formData.position || null,
            grade: formData.grade || null,
            height: formData.height || null,
            weight: formData.weight || null,
            bats: formData.bats,
            throws: formData.throws,
          })
          .eq('user_id', profile.id);

        if (profileError) throw profileError;
      }

      onSave();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  const teams = profile.team_members || [];
  const isPlayer = profile.role === 'player';

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Personal Information */}
        <div className="lg:col-span-2 space-y-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Personal Information</h3>
            <div className="bg-gray-50 rounded-lg p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Full Name
                  </label>
                  {editing ? (
                    <input
                      type="text"
                      value={formData.full_name}
                      onChange={(e) => setFormData({...formData, full_name: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  ) : (
                    <p className="text-gray-900">{profile.full_name}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Email
                  </label>
                  <p className="text-gray-900 flex items-center space-x-2">
                    <Mail size={16} className="text-gray-400" />
                    <span>{profile.email}</span>
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Phone
                  </label>
                  {editing ? (
                    <input
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData({...formData, phone: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  ) : (
                    <p className="text-gray-900 flex items-center space-x-2">
                      <Phone size={16} className="text-gray-400" />
                      <span>{profile.phone || 'Not set'}</span>
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Member Since
                  </label>
                  <p className="text-gray-900 flex items-center space-x-2">
                    <Calendar size={16} className="text-gray-400" />
                    <span>{new Date(profile.created_at).toLocaleDateString()}</span>
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Player-specific fields */}
          {isPlayer && (
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Player Details</h3>
              <div className="bg-gray-50 rounded-lg p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Jersey Number
                    </label>
                    {editing ? (
                      <input
                        type="text"
                        value={formData.jersey_number}
                        onChange={(e) => setFormData({...formData, jersey_number: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    ) : (
                      <p className="text-gray-900">{formData.jersey_number || 'Not set'}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Position
                    </label>
                    {editing ? (
                      <input
                        type="text"
                        value={formData.position}
                        onChange={(e) => setFormData({...formData, position: e.target.value})}
                        placeholder="e.g., SS, P, OF"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    ) : (
                      <p className="text-gray-900">{formData.position || 'Not set'}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Grade
                    </label>
                    {editing ? (
                      <input
                        type="text"
                        value={formData.grade}
                        onChange={(e) => setFormData({...formData, grade: e.target.value})}
                        placeholder="e.g., 8th, 10th"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    ) : (
                      <p className="text-gray-900">{formData.grade || 'Not set'}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Height
                    </label>
                    {editing ? (
                      <input
                        type="text"
                        value={formData.height}
                        onChange={(e) => setFormData({...formData, height: e.target.value})}
                        placeholder="e.g., 5'10 or 6'2"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    ) : (
                      <p className="text-gray-900">{formData.height || 'Not set'}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Weight
                    </label>
                    {editing ? (
                      <input
                        type="text"
                        value={formData.weight}
                        onChange={(e) => setFormData({...formData, weight: e.target.value})}
                        placeholder="e.g., 165 lbs"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    ) : (
                      <p className="text-gray-900">{formData.weight || 'Not set'}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Bats
                    </label>
                    {editing ? (
                      <select
                        value={formData.bats}
                        onChange={(e) => setFormData({...formData, bats: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="Right">Right</option>
                        <option value="Left">Left</option>
                        <option value="Switch">Switch</option>
                      </select>
                    ) : (
                      <p className="text-gray-900">{formData.bats}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Throws
                    </label>
                    {editing ? (
                      <select
                        value={formData.throws}
                        onChange={(e) => setFormData({...formData, throws: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="Right">Right</option>
                        <option value="Left">Left</option>
                      </select>
                    ) : (
                      <p className="text-gray-900">{formData.throws}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {editing && (
            <div className="flex justify-end">
              <button
                onClick={handleSave}
                disabled={saving}
                className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 flex items-center space-x-2"
              >
                <Save size={18} />
                <span>{saving ? 'Saving...' : 'Save Changes'}</span>
              </button>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Teams */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <div className="flex items-center space-x-2 mb-4">
              <Users size={20} className="text-blue-600" />
              <h3 className="text-lg font-semibold text-gray-900">Teams</h3>
            </div>
            {teams.length === 0 ? (
              <p className="text-sm text-gray-500">Not on any teams</p>
            ) : (
              <div className="space-y-3">
                {teams.map((tm) => (
                  <div key={tm.team_id} className="bg-blue-50 rounded-lg p-3">
                    <div className="font-semibold text-blue-900">{tm.teams.name}</div>
                    {tm.teams.description && (
                      <p className="text-xs text-blue-700 mt-1">{tm.teams.description}</p>
                    )}
                    <div className="text-xs text-blue-600 mt-1 capitalize">
                      Role: {tm.role}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick Stats */}
          {isPlayer && (
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <div className="flex items-center space-x-2 mb-4">
                <Award size={20} className="text-orange-600" />
                <h3 className="text-lg font-semibold text-gray-900">Quick Stats</h3>
              </div>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Position</span>
                  <span className="font-medium text-gray-900">
                    {formData.position || 'Not set'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Jersey #</span>
                  <span className="font-medium text-gray-900">
                    {formData.jersey_number || 'N/A'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Grade</span>
                  <span className="font-medium text-gray-900">
                    {formData.grade || 'Not set'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PerformanceTab({ userId }) {
  const [stats, setStats] = useState([]);
  const [benchmarks, setBenchmarks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPerformanceData();
  }, [userId]);

  const fetchPerformanceData = async () => {
    // Fetch recent stats
    const { data: statsData } = await supabase
      .from('performance_stats')
      .select('*')
      .eq('player_id', userId)
      .order('date', { ascending: false })
      .limit(5);

    // Fetch benchmarks
    const { data: benchmarksData } = await supabase
      .from('benchmarks')
      .select('*')
      .eq('player_id', userId)
      .order('measured_at', { ascending: false });

    setStats(statsData || []);
    setBenchmarks(benchmarksData || []);
    setLoading(false);
  };

  if (loading) {
    return <div className="text-center text-gray-600">Loading performance data...</div>;
  }

  const latestStats = stats[0];

  return (
    <div className="space-y-6">
      {/* Latest Performance Stats */}
      {latestStats ? (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Latest Performance</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Trackman */}
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-6">
              <h4 className="font-semibold text-blue-900 mb-4">Trackman</h4>
              <div className="space-y-3">
                <div>
                  <div className="text-sm text-blue-700">Exit Velocity</div>
                  <div className="text-2xl font-bold text-blue-900">
                    {latestStats.exit_velocity || 'N/A'} {latestStats.exit_velocity && 'mph'}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-blue-700">Launch Angle</div>
                  <div className="text-xl font-bold text-blue-900">
                    {latestStats.launch_angle || 'N/A'}{latestStats.launch_angle && '°'}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-blue-700">Spin Rate</div>
                  <div className="text-xl font-bold text-blue-900">
                    {latestStats.spin_rate || 'N/A'}{latestStats.spin_rate && ' rpm'}
                  </div>
                </div>
              </div>
              <div className="text-xs text-blue-600 mt-4">
                {new Date(latestStats.date).toLocaleDateString()}
              </div>
            </div>

            {/* HitTrax */}
            <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg p-6">
              <h4 className="font-semibold text-orange-900 mb-4">HitTrax</h4>
              <div className="space-y-3">
                <div>
                  <div className="text-sm text-orange-700">Avg Distance</div>
                  <div className="text-2xl font-bold text-orange-900">
                    {latestStats.avg_distance || 'N/A'}{latestStats.avg_distance && ' ft'}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-orange-700">Hard Hit %</div>
                  <div className="text-xl font-bold text-orange-900">
                    {latestStats.hard_hit_rate || 'N/A'}{latestStats.hard_hit_rate && '%'}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-orange-700">Line Drive %</div>
                  <div className="text-xl font-bold text-orange-900">
                    {latestStats.line_drive_rate || 'N/A'}{latestStats.line_drive_rate && '%'}
                  </div>
                </div>
              </div>
            </div>

            {/* WHOOP */}
            <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-6">
              <h4 className="font-semibold text-purple-900 mb-4">WHOOP</h4>
              <div className="space-y-3">
                <div>
                  <div className="text-sm text-purple-700">Recovery</div>
                  <div className="text-2xl font-bold text-purple-900">
                    {latestStats.recovery_score || 'N/A'}{latestStats.recovery_score && '%'}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-purple-700">Strain</div>
                  <div className="text-xl font-bold text-purple-900">
                    {latestStats.strain || 'N/A'}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-purple-700">Sleep</div>
                  <div className="text-xl font-bold text-purple-900">
                    {latestStats.sleep_hours || 'N/A'}{latestStats.sleep_hours && ' hrs'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-gray-50 rounded-lg p-12 text-center">
          <TrendingUp size={48} className="mx-auto mb-4 text-gray-300" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No Performance Data</h3>
          <p className="text-gray-600">Your coach will add stats from training sessions</p>
        </div>
      )}

      {/* Benchmarks */}
      {benchmarks.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Benchmarks</h3>
          <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-200">
            {benchmarks.map((benchmark) => (
              <div key={benchmark.id} className="p-4 flex items-center justify-between">
                <div>
                  <div className="font-medium text-gray-900 capitalize">
                    {benchmark.benchmark_type.replace(/_/g, ' ')}
                  </div>
                  <div className="text-sm text-gray-500">
                    {new Date(benchmark.measured_at).toLocaleDateString()}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-gray-900">
                    {benchmark.value} {benchmark.unit}
                  </div>
                  {benchmark.target && (
                    <div className="text-sm text-gray-500">
                      Target: {benchmark.target} {benchmark.unit}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats History */}
      {stats.length > 1 && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Performance History</h3>
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Exit Vel</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Avg Dist</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Recovery</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {stats.map((stat) => (
                  <tr key={stat.id}>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {new Date(stat.date).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {stat.exit_velocity || '-'} {stat.exit_velocity && 'mph'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {stat.avg_distance || '-'} {stat.avg_distance && 'ft'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {stat.recovery_score || '-'}{stat.recovery_score && '%'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function TrainingTab({ assignments }) {
  const activeAssignments = assignments.filter(a => {
    if (!a.end_date) return true;
    return new Date(a.end_date) >= new Date();
  });

  const completedAssignments = assignments.filter(a => {
    if (!a.end_date) return false;
    return new Date(a.end_date) < new Date();
  });

  return (
    <div className="space-y-6">
      {activeAssignments.length > 0 ? (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Active Programs</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {activeAssignments.map((assignment) => (
              <div key={assignment.id} className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-6 border-2 border-blue-200">
                <div className="flex items-center space-x-2 mb-3">
                  <Dumbbell size={20} className="text-blue-600" />
                  <h4 className="font-semibold text-blue-900">
                    {assignment.training_programs.name}
                  </h4>
                </div>
                {assignment.training_programs.description && (
                  <p className="text-sm text-blue-700 mb-3">
                    {assignment.training_programs.description}
                  </p>
                )}
                <div className="space-y-1 text-sm">
                  {assignment.training_programs.duration_weeks && (
                    <div className="text-blue-700">
                      Duration: {assignment.training_programs.duration_weeks} weeks
                    </div>
                  )}
                  {assignment.start_date && (
                    <div className="text-blue-700">
                      Started: {new Date(assignment.start_date).toLocaleDateString()}
                    </div>
                  )}
                  {assignment.end_date && (
                    <div className="text-blue-700">
                      Ends: {new Date(assignment.end_date).toLocaleDateString()}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-gray-50 rounded-lg p-12 text-center">
          <Dumbbell size={48} className="mx-auto mb-4 text-gray-300" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No Active Programs</h3>
          <p className="text-gray-600">Your coach will assign training programs when available</p>
        </div>
      )}

      {completedAssignments.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Completed Programs</h3>
          <div className="space-y-2">
            {completedAssignments.map((assignment) => (
              <div key={assignment.id} className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-gray-900">
                      {assignment.training_programs.name}
                    </div>
                    <div className="text-sm text-gray-500">
                      Completed: {new Date(assignment.end_date).toLocaleDateString()}
                    </div>
                  </div>
                  <Target className="text-green-600" size={20} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NutritionTab({ assignments }) {
  const activeAssignments = assignments.filter(a => {
    if (!a.end_date) return true;
    return new Date(a.end_date) >= new Date();
  });

  const completedAssignments = assignments.filter(a => {
    if (!a.end_date) return false;
    return new Date(a.end_date) < new Date();
  });

  return (
    <div className="space-y-6">
      {activeAssignments.length > 0 ? (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Active Meal Plans</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {activeAssignments.map((assignment) => (
              <div key={assignment.id} className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-6 border-2 border-green-200">
                <div className="flex items-center space-x-2 mb-3">
                  <Utensils size={20} className="text-green-600" />
                  <h4 className="font-semibold text-green-900">
                    {assignment.meal_plans.name}
                  </h4>
                </div>
                {assignment.meal_plans.description && (
                  <p className="text-sm text-green-700 mb-3">
                    {assignment.meal_plans.description}
                  </p>
                )}
                <div className="space-y-1 text-sm">
                  {assignment.start_date && (
                    <div className="text-green-700">
                      Started: {new Date(assignment.start_date).toLocaleDateString()}
                    </div>
                  )}
                  {assignment.end_date && (
                    <div className="text-green-700">
                      Ends: {new Date(assignment.end_date).toLocaleDateString()}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-gray-50 rounded-lg p-12 text-center">
          <Utensils size={48} className="mx-auto mb-4 text-gray-300" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No Active Meal Plans</h3>
          <p className="text-gray-600">Your coach will assign meal plans when available</p>
        </div>
      )}

      {completedAssignments.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Completed Plans</h3>
          <div className="space-y-2">
            {completedAssignments.map((assignment) => (
              <div key={assignment.id} className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-gray-900">
                      {assignment.meal_plans.name}
                    </div>
                    <div className="text-sm text-gray-500">
                      Completed: {new Date(assignment.end_date).toLocaleDateString()}
                    </div>
                  </div>
                  <Target className="text-green-600" size={20} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
