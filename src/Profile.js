import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { User, Edit2, Save, X, Mail, Phone, Calendar, TrendingUp, Dumbbell, Utensils, Target, Award, Users, Plus, Trash2, Upload } from 'lucide-react';

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

      const profileData = { ...userData };

      const { data: playerProfile } = await supabase
        .from('player_profiles')
        .select('*')
        .eq('user_id', userId);
      profileData.player_profiles = playerProfile || [];

      const { data: teamMembers } = await supabase
        .from('team_members')
        .select(`team_id, role, teams(id, name, description)`)
        .eq('user_id', userId);
      profileData.team_members = teamMembers || [];

      const { data: trainingAssignments } = await supabase
        .from('training_program_assignments')
        .select(`id, start_date, end_date, training_programs(id, name, description, duration_weeks)`)
        .eq('player_id', userId);
      profileData.training_program_assignments = trainingAssignments || [];

      const { data: mealAssignments } = await supabase
        .from('meal_plan_assignments')
        .select(`id, start_date, end_date, meal_plans(id, name, description)`)
        .eq('player_id', userId);
      profileData.meal_plan_assignments = mealAssignments || [];

      const { data: contactData } = await supabase
        .from('user_contacts')
        .select('*')
        .eq('user_id', userId)
        .order('contact_type')
        .order('sort_order');
      profileData.contacts = contactData || [];

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
      <div className="bg-gradient-to-r from-blue-600 to-blue-800 rounded-lg shadow-lg p-8 text-white">
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-6">
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt={profile.full_name} className="w-24 h-24 rounded-full object-cover border-4 border-white/20" />
            ) : (
              <div className="w-24 h-24 bg-white/20 rounded-full flex items-center justify-center text-4xl font-bold border-4 border-white/20">
                {profile.player_profiles?.[0]?.jersey_number || profile.full_name.charAt(0)}
              </div>
            )}
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
          <button onClick={() => setEditing(!editing)} className="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg font-medium transition flex items-center space-x-2">
            {editing ? <X size={18} /> : <Edit2 size={18} />}
            <span>{editing ? 'Cancel' : 'Edit Profile'}</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8 px-6">
            {visibleTabs.map(tab => {
              const Icon = tab.icon;
              return (
                <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={`py-4 px-1 border-b-2 font-medium text-sm transition flex items-center space-x-2 ${activeTab === tab.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>
                  <Icon size={16} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-6">
          {activeTab === 'overview' && <OverviewTab profile={profile} editing={editing} onSave={() => { setEditing(false); fetchProfile(); }} />}
          {activeTab === 'performance' && <PerformanceTab userId={userId} />}
          {activeTab === 'training' && <TrainingTab assignments={profile.training_program_assignments || []} />}
          {activeTab === 'nutrition' && <NutritionTab assignments={profile.meal_plan_assignments || []} />}
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
    jersey_number: profile.player_profiles?.[0]?.jersey_number || '',
    position: profile.player_profiles?.[0]?.position || '',
    grade: profile.player_profiles?.[0]?.grade || '',
    height: profile.player_profiles?.[0]?.height || '',
    weight: profile.player_profiles?.[0]?.weight || '',
    bats: profile.player_profiles?.[0]?.bats || 'Right',
    throws: profile.player_profiles?.[0]?.throws || 'Right',
  });

  const [contacts, setContacts] = useState(profile.contacts || []);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }
    setUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${profile.id}-${Date.now()}.${fileExt}`;
      const filePath = `avatars/${fileName}`;
      const { error: uploadError } = await supabase.storage.from('avatars').upload(filePath, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(filePath);
      const { error: updateError } = await supabase.from('users').update({ avatar_url: publicUrl }).eq('id', profile.id);
      if (updateError) throw updateError;
      alert('Avatar updated successfully!');
      onSave();
    } catch (err) {
      alert('Error uploading avatar: ' + err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleAddContact = (type) => {
    const currentTypeContacts = contacts.filter(c => c.contact_type === type);
    if (currentTypeContacts.length >= 3) {
      alert(`Maximum 3 ${type} contacts allowed`);
      return;
    }
    const newContact = { id: `temp-${Date.now()}`, user_id: profile.id, contact_type: type, value: '', label: '', sort_order: currentTypeContacts.length, isNew: true };
    setContacts([...contacts, newContact]);
  };

  const handleUpdateContact = (id, field, value) => {
    setContacts(contacts.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const handleDeleteContact = async (id) => {
    if (id.toString().startsWith('temp-')) {
      setContacts(contacts.filter(c => c.id !== id));
    } else {
      const { error } = await supabase.from('user_contacts').delete().eq('id', id);
      if (error) {
        alert('Error deleting contact: ' + error.message);
      } else {
        setContacts(contacts.filter(c => c.id !== id));
      }
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error: userError } = await supabase.from('users').update({ full_name: formData.full_name, phone: formData.phone || null }).eq('id', profile.id);
      if (userError) throw userError;
      if (profile.player_profiles?.[0]) {
        const { error: profileError } = await supabase.from('player_profiles').update({
          jersey_number: formData.jersey_number || null,
          position: formData.position || null,
          grade: formData.grade || null,
          height: formData.height || null,
          weight: formData.weight || null,
          bats: formData.bats,
          throws: formData.throws,
        }).eq('user_id', profile.id);
        if (profileError) throw profileError;
      }
      for (const contact of contacts) {
        if (contact.isNew && contact.value) {
          const { error } = await supabase.from('user_contacts').insert({ user_id: profile.id, contact_type: contact.contact_type, value: contact.value, label: contact.label || null, sort_order: contact.sort_order });
          if (error) throw error;
        } else if (!contact.isNew) {
          const { error } = await supabase.from('user_contacts').update({ value: contact.value, label: contact.label || null }).eq('id', contact.id);
          if (error) throw error;
        }
      }
      alert('Profile updated successfully!');
      onSave();
    } catch (error) {
      alert('Error saving profile: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const emailContacts = contacts.filter(c => c.contact_type === 'email');
  const phoneContacts = contacts.filter(c => c.contact_type === 'phone');

  if (editing) {
    return (
      <div className="space-y-6">
        <div className="pb-6 border-b border-gray-200">
          <label className="cursor-pointer inline-flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
            <Upload size={18} />
            <span>{uploading ? 'Uploading...' : 'Upload Avatar Photo'}</span>
            <input type="file" accept="image/*" onChange={handleAvatarUpload} disabled={uploading} className="hidden" />
          </label>
          <p className="text-xs text-gray-500 mt-2">Upload a profile photo or team logo</p>
        </div>

        <div>
          <h4 className="text-lg font-semibold text-gray-900 mb-4">Basic Information</h4>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Full Name *</label>
              <input type="text" value={formData.full_name} onChange={(e) => setFormData({ ...formData, full_name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
              <input type="email" value={formData.email} disabled className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600" />
              <p className="text-xs text-gray-500 mt-1">Email cannot be changed</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Phone (Primary)</label>
              <input type="tel" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
        </div>

        {profile.player_profiles?.[0] && (
          <div>
            <h4 className="text-lg font-semibold text-gray-900 mb-4">Player Details</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Jersey Number</label>
                <input type="text" value={formData.jersey_number} onChange={(e) => setFormData({ ...formData, jersey_number: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Position</label>
                <input type="text" placeholder="e.g., SS, P, OF" value={formData.position} onChange={(e) => setFormData({ ...formData, position: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Grade</label>
                <input type="text" placeholder="e.g., 8th, 10th" value={formData.grade} onChange={(e) => setFormData({ ...formData, grade: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Height</label>
                <input type="text" placeholder="e.g., 5'10&quot;" value={formData.height} onChange={(e) => setFormData({ ...formData, height: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Weight</label>
                <input type="text" placeholder="e.g., 165 lbs" value={formData.weight} onChange={(e) => setFormData({ ...formData, weight: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Bats</label>
                <select value={formData.bats} onChange={(e) => setFormData({ ...formData, bats: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="Right">Right</option>
                  <option value="Left">Left</option>
                  <option value="Switch">Switch</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Throws</label>
                <select value={formData.throws} onChange={(e) => setFormData({ ...formData, throws: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="Right">Right</option>
                  <option value="Left">Left</option>
                </select>
              </div>
            </div>
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-lg font-semibold text-gray-900">Additional Email Addresses</h4>
            {emailContacts.length < 3 && (
              <button onClick={() => handleAddContact('email')} className="text-blue-600 hover:text-blue-800 flex items-center space-x-1 text-sm font-medium">
                <Plus size={16} />
                <span>Add Email</span>
              </button>
            )}
          </div>
          <div className="space-y-3">
            {emailContacts.map((contact) => (
              <div key={contact.id} className="flex items-center space-x-3">
                <div className="flex-1 grid grid-cols-2 gap-3">
                  <div>
                    <input type="email" placeholder="email@example.com" value={contact.value} onChange={(e) => handleUpdateContact(contact.id, 'value', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <input type="text" placeholder="Label (e.g., Parent, Guardian)" value={contact.label || ''} onChange={(e) => handleUpdateContact(contact.id, 'label', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
                <button onClick={() => handleDeleteContact(contact.id)} className="text-red-600 hover:text-red-800 p-2">
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
            {emailContacts.length === 0 && <p className="text-sm text-gray-500 italic">No additional email addresses</p>}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-lg font-semibold text-gray-900">Additional Phone Numbers</h4>
            {phoneContacts.length < 3 && (
              <button onClick={() => handleAddContact('phone')} className="text-blue-600 hover:text-blue-800 flex items-center space-x-1 text-sm font-medium">
                <Plus size={16} />
                <span>Add Phone</span>
              </button>
            )}
          </div>
          <div className="space-y-3">
            {phoneContacts.map((contact) => (
              <div key={contact.id} className="flex items-center space-x-3">
                <div className="flex-1 grid grid-cols-2 gap-3">
                  <div>
                    <input type="tel" placeholder="(555) 123-4567" value={contact.value} onChange={(e) => handleUpdateContact(contact.id, 'value', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <input type="text" placeholder="Label (e.g., Parent, Sibling)" value={contact.label || ''} onChange={(e) => handleUpdateContact(contact.id, 'label', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
                <button onClick={() => handleDeleteContact(contact.id)} className="text-red-600 hover:text-red-800 p-2">
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
            {phoneContacts.length === 0 && <p className="text-sm text-gray-500 italic">No additional phone numbers</p>}
          </div>
        </div>

        <div className="pt-4 border-t border-gray-200">
          <button onClick={handleSave} disabled={saving} className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 flex items-center space-x-2">
            <Save size={18} />
            <span>{saving ? 'Saving...' : 'Save Changes'}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Contact Information</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex items-center space-x-3 bg-gray-50 p-4 rounded-lg">
            <Mail className="text-gray-400" size={20} />
            <div>
              <div className="text-sm text-gray-600">Email (Primary)</div>
              <div className="font-medium text-gray-900">{profile.email}</div>
            </div>
          </div>
          {profile.phone && (
            <div className="flex items-center space-x-3 bg-gray-50 p-4 rounded-lg">
              <Phone className="text-gray-400" size={20} />
              <div>
                <div className="text-sm text-gray-600">Phone (Primary)</div>
                <div className="font-medium text-gray-900">{profile.phone}</div>
              </div>
            </div>
          )}
        </div>

        {(emailContacts.length > 0 || phoneContacts.length > 0) && (
          <div className="mt-4">
            <h4 className="text-sm font-semibold text-gray-700 mb-3">Additional Contacts</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {emailContacts.map((contact) => (
                <div key={contact.id} className="flex items-center space-x-3 bg-blue-50 p-3 rounded-lg border border-blue-200">
                  <Mail className="text-blue-600" size={16} />
                  <div className="flex-1">
                    <div className="text-xs text-blue-700 font-medium">{contact.label || 'Email'}</div>
                    <div className="text-sm text-gray-900">{contact.value}</div>
                  </div>
                </div>
              ))}
              {phoneContacts.map((contact) => (
                <div key={contact.id} className="flex items-center space-x-3 bg-green-50 p-3 rounded-lg border border-green-200">
                  <Phone className="text-green-600" size={16} />
                  <div className="flex-1">
                    <div className="text-xs text-green-700 font-medium">{contact.label || 'Phone'}</div>
                    <div className="text-sm text-gray-900">{contact.value}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {profile.player_profiles?.[0] && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Player Information</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="text-sm text-gray-600">Jersey Number</div>
              <div className="font-medium text-gray-900 text-lg">#{profile.player_profiles[0].jersey_number || 'Not set'}</div>
            </div>
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="text-sm text-gray-600">Position</div>
              <div className="font-medium text-gray-900 text-lg">{profile.player_profiles[0].position || 'Not set'}</div>
            </div>
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="text-sm text-gray-600">Grade</div>
              <div className="font-medium text-gray-900 text-lg">{profile.player_profiles[0].grade || 'Not set'}</div>
            </div>
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="text-sm text-gray-600">Height / Weight</div>
              <div className="font-medium text-gray-900 text-lg">{profile.player_profiles[0].height || '-'} / {profile.player_profiles[0].weight || '-'}</div>
            </div>
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="text-sm text-gray-600">Bats</div>
              <div className="font-medium text-gray-900 text-lg">{profile.player_profiles[0].bats}</div>
            </div>
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="text-sm text-gray-600">Throws</div>
              <div className="font-medium text-gray-900 text-lg">{profile.player_profiles[0].throws}</div>
            </div>
          </div>
        </div>
      )}

      {profile.team_members && profile.team_members.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Teams</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {profile.team_members.map((membership, idx) => (
              <div key={idx} className="flex items-center space-x-3 bg-blue-50 p-4 rounded-lg border border-blue-200">
                <Users className="text-blue-600" size={20} />
                <div>
                  <div className="font-medium text-blue-900">{membership.teams.name}</div>
                  <div className="text-sm text-blue-700 capitalize">{membership.role}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PerformanceTab({ userId }) {
  const [stats, setStats] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, [userId]);

  const fetchStats = async () => {
    const { data } = await supabase.from('performance_stats').select('*').eq('player_id', userId).order('date', { ascending: false });
    setStats(data || []);
    setLoading(false);
  };

  if (loading) return <div className="text-gray-600">Loading performance data...</div>;
  const latestStats = stats[0];

  return (
    <div className="space-y-6">
      {latestStats ? (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Latest Performance</h3>
            <div className="text-sm text-gray-600">{new Date(latestStats.date).toLocaleDateString()}</div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-6 border-2 border-blue-200">
              <div className="flex items-center space-x-2 mb-4">
                <TrendingUp size={20} className="text-blue-600" />
                <h4 className="font-semibold text-blue-900">Trackman Data</h4>
              </div>
              <div className="space-y-3">
                {latestStats.exit_velocity && (
                  <div>
                    <div className="text-sm text-blue-700">Exit Velocity</div>
                    <div className="text-2xl font-bold text-blue-900">{latestStats.exit_velocity} <span className="text-lg">mph</span></div>
                  </div>
                )}
                {latestStats.launch_angle && (
                  <div>
                    <div className="text-sm text-blue-700">Launch Angle</div>
                    <div className="text-2xl font-bold text-blue-900">{latestStats.launch_angle}°</div>
                  </div>
                )}
                {latestStats.spin_rate && (
                  <div>
                    <div className="text-sm text-blue-700">Spin Rate</div>
                    <div className="text-2xl font-bold text-blue-900">{latestStats.spin_rate} <span className="text-lg">rpm</span></div>
                  </div>
                )}
              </div>
            </div>
            <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg p-6 border-2 border-orange-200">
              <div className="flex items-center space-x-2 mb-4">
                <Target size={20} className="text-orange-600" />
                <h4 className="font-semibold text-orange-900">HitTrax Stats</h4>
              </div>
              <div className="space-y-3">
                {latestStats.avg_distance && (
                  <div>
                    <div className="text-sm text-orange-700">Avg Distance</div>
                    <div className="text-2xl font-bold text-orange-900">{latestStats.avg_distance} <span className="text-lg">ft</span></div>
                  </div>
                )}
                {latestStats.hard_hit_rate && (
                  <div>
                    <div className="text-sm text-orange-700">Hard Hit Rate</div>
                    <div className="text-2xl font-bold text-orange-900">{latestStats.hard_hit_rate}%</div>
                  </div>
                )}
                {latestStats.line_drive_rate && (
                  <div>
                    <div className="text-sm text-orange-700">Line Drive Rate</div>
                    <div className="text-2xl font-bold text-orange-900">{latestStats.line_drive_rate}%</div>
                  </div>
                )}
              </div>
            </div>
            <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-6 border-2 border-purple-200">
              <div className="flex items-center space-x-2 mb-4">
                <Award size={20} className="text-purple-600" />
                <h4 className="font-semibold text-purple-900">WHOOP Recovery</h4>
              </div>
              <div className="space-y-3">
                {latestStats.recovery_score && (
                  <div>
                    <div className="text-sm text-purple-700">Recovery Score</div>
                    <div className="text-2xl font-bold text-purple-900">{latestStats.recovery_score}%</div>
                  </div>
                )}
                {latestStats.strain && (
                  <div>
                    <div className="text-sm text-purple-700">Strain</div>
                    <div className="text-2xl font-bold text-purple-900">{latestStats.strain}</div>
                  </div>
                )}
                {latestStats.sleep_hours && (
                  <div>
                    <div className="text-sm text-purple-700">Sleep</div>
                    <div className="text-2xl font-bold text-purple-900">{latestStats.sleep_hours} <span className="text-lg">hrs</span></div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-gray-50 rounded-lg p-12 text-center">
          <TrendingUp size={48} className="mx-auto mb-4 text-gray-300" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No Performance Data</h3>
          <p className="text-gray-600">Your coach will add performance stats from training sessions</p>
        </div>
      )}

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
                    <td className="px-6 py-4 text-sm text-gray-900">{new Date(stat.date).toLocaleDateString()}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{stat.exit_velocity || '-'} {stat.exit_velocity && 'mph'}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{stat.avg_distance || '-'} {stat.avg_distance && 'ft'}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{stat.recovery_score || '-'}{stat.recovery_score && '%'}</td>
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
  const activeAssignments = assignments.filter(a => !a.end_date || new Date(a.end_date) >= new Date());
  const completedAssignments = assignments.filter(a => a.end_date && new Date(a.end_date) < new Date());

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
                  <h4 className="font-semibold text-blue-900">{assignment.training_programs.name}</h4>
                </div>
                {assignment.training_programs.description && <p className="text-sm text-blue-700 mb-3">{assignment.training_programs.description}</p>}
                <div className="space-y-1 text-sm">
                  {assignment.training_programs.duration_weeks && <div className="text-blue-700">Duration: {assignment.training_programs.duration_weeks} weeks</div>}
                  {assignment.start_date && <div className="text-blue-700">Started: {new Date(assignment.start_date).toLocaleDateString()}</div>}
                  {assignment.end_date && <div className="text-blue-700">Ends: {new Date(assignment.end_date).toLocaleDateString()}</div>}
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
                    <div className="font-medium text-gray-900">{assignment.training_programs.name}</div>
                    <div className="text-sm text-gray-500">Completed: {new Date(assignment.end_date).toLocaleDateString()}</div>
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
  const activeAssignments = assignments.filter(a => !a.end_date || new Date(a.end_date) >= new Date());
  const completedAssignments = assignments.filter(a => a.end_date && new Date(a.end_date) < new Date());

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
                  <h4 className="font-semibold text-green-900">{assignment.meal_plans.name}</h4>
                </div>
                {assignment.meal_plans.description && <p className="text-sm text-green-700 mb-3">{assignment.meal_plans.description}</p>}
                <div className="space-y-1 text-sm">
                  {assignment.start_date && <div className="text-green-700">Started: {new Date(assignment.start_date).toLocaleDateString()}</div>}
                  {assignment.end_date && <div className="text-green-700">Ends: {new Date(assignment.end_date).toLocaleDateString()}</div>}
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
                    <div className="font-medium text-gray-900">{assignment.meal_plans.name}</div>
                    <div className="text-sm text-gray-500">Completed: {new Date(assignment.end_date).toLocaleDateString()}</div>
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
