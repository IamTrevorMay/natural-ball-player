import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import { Mail, Phone, Ruler, Scale, Edit2, Save, X, Shirt, Camera } from 'lucide-react';

const EQUIPMENT_FIELDS = [
  { key: 'shirt', label: 'Shirt' },
  { key: 'shorts', label: 'Shorts' },
  { key: 'pants', label: 'Pants' },
  { key: 'shoe', label: 'Shoe' },
  { key: 'belt', label: 'Belt' },
  { key: 'hat', label: 'Hat' },
  { key: 'helmet', label: 'Helmet' },
  { key: 'batting_gloves', label: 'Batting Gloves' },
  { key: 'bat', label: 'Bat' },
];

const PROGRAM_OPTIONS = ['Pitching', 'Hitting', 'Pitching/Hitting', 'Strength', 'Academy', 'Rehab', 'No Program'];
const LEVEL_OPTIONS = ['Independent', 'Affiliate', 'High School', 'Professional', 'College', 'Youth', 'Pro - D', 'Pro - ND', '9U', '10U', '11U', '12U', '13U', '14U', '15U', '16U', '17U', '18U', 'AAA', 'AA', 'A+', 'A', 'MLB', 'Complex', 'NPB', 'KBO', 'MiLB', 'No Level'];
const STATUS_OPTIONS = ['On-Site', 'Remote', 'Active', 'Inactive', 'Archived'];

const PROFILE_TABS = [
  { key: 'general', label: 'General' },
  { key: 'trackman', label: 'Trackman' },
  { key: 'whoop', label: 'Whoop' },
  { key: 'hittrax', label: 'Hittrax' },
  { key: 'assessment', label: 'Assessment' },
  { key: 'armcare', label: 'Arm Care' },
];

export default function Profile({ userId, userRole }) {
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [equipmentSizes, setEquipmentSizes] = useState({});
  const [editEquipment, setEditEquipment] = useState({});
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [activeProfileTab, setActiveProfileTab] = useState('general');
  const avatarInputRef = useRef(null);

  useEffect(() => {
    fetchUserData();
  }, [userId]);

  const fetchUserData = async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select(`
          *,
          player_profiles(*),
          team_members(
            team_id,
            teams(name)
          )
        `)
        .eq('id', userId)
        .single();

      if (error) throw error;

      // Normalize: player_profiles may be object (unique FK) or array
      const pp = data.player_profiles;
      data._profile = Array.isArray(pp) ? pp[0] : pp;

      setUserData(data);

      const profile = data._profile;
      setEditForm({
        full_name: data.full_name || '',
        email: data.email || '',
        phone: data.phone || '',
        height: data.height || '',
        weight: data.weight || '',
        sport: profile?.sport || '',
      });

      // Fetch equipment sizes
      const { data: eqData } = await supabase
        .from('equipment_sizes')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      const eq = eqData || {};
      setEquipmentSizes(eq);
      setEditEquipment({
        shirt: eq.shirt || '',
        shorts: eq.shorts || '',
        pants: eq.pants || '',
        shoe: eq.shoe || '',
        belt: eq.belt || '',
        hat: eq.hat || '',
        helmet: eq.helmet || '',
        batting_gloves: eq.batting_gloves || '',
        bat: eq.bat || '',
      });
    } catch (error) {
      console.error('Error fetching user data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Update users table
      const { error } = await supabase
        .from('users')
        .update({
          full_name: editForm.full_name,
          phone: editForm.phone || null,
          height: editForm.height || null,
          weight: editForm.weight || null,
        })
        .eq('id', userId);

      if (error) throw error;

      // Update sport in player_profiles
      const profile = userData._profile;
      if (profile) {
        const { error: profileError } = await supabase
          .from('player_profiles')
          .update({ sport: editForm.sport || null })
          .eq('user_id', userId);

        if (profileError) throw profileError;
      }

      // Upsert equipment sizes
      const { error: eqError } = await supabase
        .from('equipment_sizes')
        .upsert({
          user_id: userId,
          shirt: editEquipment.shirt || null,
          shorts: editEquipment.shorts || null,
          pants: editEquipment.pants || null,
          shoe: editEquipment.shoe || null,
          belt: editEquipment.belt || null,
          hat: editEquipment.hat || null,
          helmet: editEquipment.helmet || null,
          batting_gloves: editEquipment.batting_gloves || null,
          bat: editEquipment.bat || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

      if (eqError) throw eqError;

      await fetchUserData();
      setEditing(false);
      alert('Profile updated successfully!');
    } catch (error) {
      console.error('Error updating profile:', error);
      alert('Error updating profile: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    const profile = userData._profile;
    setEditForm({
      full_name: userData.full_name || '',
      email: userData.email || '',
      phone: userData.phone || '',
      height: userData.height || '',
      weight: userData.weight || '',
      sport: profile?.sport || '',
    });
    setEditEquipment({
      shirt: equipmentSizes.shirt || '',
      shorts: equipmentSizes.shorts || '',
      pants: equipmentSizes.pants || '',
      shoe: equipmentSizes.shoe || '',
      belt: equipmentSizes.belt || '',
      hat: equipmentSizes.hat || '',
      helmet: equipmentSizes.helmet || '',
      batting_gloves: equipmentSizes.batting_gloves || '',
      bat: equipmentSizes.bat || '',
    });
    setEditing(false);
  };

  const handleDropdownChange = async (field, value) => {
    try {
      const { error } = await supabase
        .from('player_profiles')
        .update({ [field]: value || null })
        .eq('user_id', userId);
      if (error) throw error;
      await fetchUserData();
    } catch (error) {
      console.error(`Error updating ${field}:`, error);
      alert(`Error updating ${field}: ` + error.message);
    }
  };

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const fileExt = file.name.split('.').pop();
      const filePath = `${userId}/${Date.now()}.${fileExt}`;
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);
      const { error: updateError } = await supabase
        .from('users')
        .update({ avatar_url: publicUrl })
        .eq('id', userId);
      if (updateError) throw updateError;
      await fetchUserData();
    } catch (error) {
      console.error('Error uploading avatar:', error);
      alert('Error uploading avatar: ' + error.message);
    } finally {
      setUploadingAvatar(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Loading profile...</p>
      </div>
    );
  }

  if (!userData) {
    return (
      <div className="bg-white rounded-lg shadow p-12 text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Profile Not Found</h2>
        <p className="text-gray-600">Unable to load profile data.</p>
      </div>
    );
  }

  const profile = userData._profile;
  const canEditProfile = userRole === 'coach' || userRole === 'admin';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">My Profile</h2>
          <p className="text-gray-600 mt-1">Manage your personal information</p>
        </div>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition flex items-center space-x-2"
          >
            <Edit2 size={18} />
            <span>Edit Profile</span>
          </button>
        )}
      </div>

      {/* Profile Card */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-6">
          {/* Avatar and Name */}
          <div className="flex items-center space-x-6 mb-6 pb-6 border-b border-gray-200">
            <div
              className="relative w-24 h-24 rounded-full cursor-pointer group"
              onClick={() => avatarInputRef.current?.click()}
            >
              {userData.avatar_url ? (
                <img src={userData.avatar_url} alt="Avatar" className="w-24 h-24 rounded-full object-cover" />
              ) : (
                <div className="w-24 h-24 bg-blue-600 rounded-full flex items-center justify-center text-white text-3xl font-bold">
                  {userData.full_name.charAt(0)}
                </div>
              )}
              <div className="absolute inset-0 bg-black bg-opacity-40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                {uploadingAvatar ? (
                  <span className="text-white text-xs">Uploading...</span>
                ) : (
                  <Camera className="text-white" size={24} />
                )}
              </div>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarUpload}
              />
            </div>
            <div>
              {editing ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={editForm.full_name}
                    onChange={(e) => setEditForm({...editForm, full_name: e.target.value})}
                    className="text-2xl font-bold border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ) : (
                <h3 className="text-2xl font-bold text-gray-900">{userData.full_name}</h3>
              )}
              <p className="text-gray-600 capitalize mt-1">{userData.role}</p>
              {userData.team_members && userData.team_members.length > 0 && (
                <p className="text-sm text-blue-600 mt-1">
                  {userData.team_members.map(tm => tm.teams.name).join(', ')}
                </p>
              )}
            </div>
          </div>

          {profile && (
            <div className="mb-6 pb-6 border-b border-gray-200">
              <div className="grid grid-cols-3 gap-6">
                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-3">Program</p>
                  <div className="border-t border-gray-200 pt-3">
                    <select
                      value={profile.program || ''}
                      onChange={(e) => handleDropdownChange('program', e.target.value)}
                      disabled={!canEditProfile}
                      className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white ${!canEditProfile ? 'opacity-75 cursor-not-allowed' : ''}`}
                    >
                      <option value="">No Program</option>
                      {PROGRAM_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-3">Level</p>
                  <div className="border-t border-gray-200 pt-3">
                    <select
                      value={profile.level || ''}
                      onChange={(e) => handleDropdownChange('level', e.target.value)}
                      disabled={!canEditProfile}
                      className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white ${!canEditProfile ? 'opacity-75 cursor-not-allowed' : ''}`}
                    >
                      <option value="">No Level</option>
                      {LEVEL_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-3">Status</p>
                  <div className="border-t border-gray-200 pt-3">
                    <select
                      value={profile.status || ''}
                      onChange={(e) => handleDropdownChange('status', e.target.value)}
                      disabled={!canEditProfile}
                      className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white ${!canEditProfile ? 'opacity-75 cursor-not-allowed' : ''}`}
                    >
                      <option value="">Active</option>
                      {STATUS_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab Bar */}
          <div className="border-b border-gray-200 mb-6">
            <nav className="flex space-x-8 overflow-x-auto">
              {PROFILE_TABS.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveProfileTab(tab.key)}
                  className={`py-3 px-1 border-b-2 font-medium text-sm whitespace-nowrap transition ${
                    activeProfileTab === tab.key
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {activeProfileTab !== 'general' && (
            <div className="py-12 text-center">
              <p className="text-gray-500 text-lg">Coming Soon</p>
            </div>
          )}

          {activeProfileTab === 'general' && (
          <>
          {/* Contact Information */}
          <div className="mb-6">
            <h4 className="text-lg font-semibold text-gray-900 mb-4">Contact Information</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center space-x-3">
                <Mail className="text-gray-400" size={20} />
                <div className="flex-1">
                  <p className="text-sm text-gray-600">Email</p>
                  <p className="text-gray-900">{userData.email}</p>
                </div>
              </div>

              <div className="flex items-center space-x-3">
                <Phone className="text-gray-400" size={20} />
                <div className="flex-1">
                  <p className="text-sm text-gray-600">Phone</p>
                  {editing ? (
                    <input
                      type="tel"
                      value={editForm.phone}
                      onChange={(e) => setEditForm({...editForm, phone: e.target.value})}
                      placeholder="Enter phone number"
                      className="w-full border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  ) : (
                    <p className="text-gray-900">{userData.phone || 'Not set'}</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Physical Information */}
          <div className="mb-6">
            <h4 className="text-lg font-semibold text-gray-900 mb-4">Physical Information</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center space-x-3">
                <Ruler className="text-gray-400" size={20} />
                <div className="flex-1">
                  <p className="text-sm text-gray-600">Height</p>
                  {editing ? (
                    <input
                      type="text"
                      value={editForm.height}
                      onChange={(e) => setEditForm({...editForm, height: e.target.value})}
                      placeholder="e.g., 6'2&quot;, 72 in"
                      className="w-full border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  ) : (
                    <p className="text-gray-900">{userData.height || 'Not set'}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-3">
                <Scale className="text-gray-400" size={20} />
                <div className="flex-1">
                  <p className="text-sm text-gray-600">Weight</p>
                  {editing ? (
                    <input
                      type="text"
                      value={editForm.weight}
                      onChange={(e) => setEditForm({...editForm, weight: e.target.value})}
                      placeholder="e.g., 185 lbs"
                      className="w-full border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  ) : (
                    <p className="text-gray-900">{userData.weight || 'Not set'}</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Player-Specific Information */}
          {profile && (
            <div className="mb-6">
              <h4 className="text-lg font-semibold text-gray-900 mb-4">Player Information</h4>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Sport</p>
                  {editing ? (
                    <input
                      type="text"
                      value={editForm.sport}
                      onChange={(e) => setEditForm({...editForm, sport: e.target.value})}
                      placeholder="e.g., Baseball"
                      className="w-full border border-gray-300 rounded px-2 py-1 mt-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  ) : (
                    <p className="text-gray-900 font-medium">{profile.sport || 'Not set'}</p>
                  )}
                </div>
                <div>
                  <p className="text-sm text-gray-600">Jersey Number</p>
                  <p className="text-gray-900 font-medium">{profile.jersey_number || 'Not set'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Position</p>
                  <p className="text-gray-900 font-medium">{profile.position || 'Not set'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Grade</p>
                  <p className="text-gray-900 font-medium">{profile.grade || 'Not set'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Bats / Throws</p>
                  <p className="text-gray-900 font-medium">{profile.bats} / {profile.throws}</p>
                </div>
              </div>
            </div>
          )}

          {/* Equipment Sizes */}
          <div className="mb-6">
            <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center space-x-2">
              <Shirt className="text-gray-400" size={20} />
              <span>Equipment Sizes</span>
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {EQUIPMENT_FIELDS.map(({ key, label }) => (
                <div key={key}>
                  <p className="text-sm text-gray-600">{label}</p>
                  {editing ? (
                    <input
                      type="text"
                      value={editEquipment[key]}
                      onChange={(e) => setEditEquipment({...editEquipment, [key]: e.target.value})}
                      placeholder={`Enter ${label.toLowerCase()} size`}
                      className="w-full border border-gray-300 rounded px-2 py-1 mt-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  ) : (
                    <p className="text-gray-900 font-medium">{equipmentSizes[key] || 'Not set'}</p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          {editing && (
            <div className="flex space-x-3 pt-4 border-t border-gray-200">
              <button
                onClick={handleCancel}
                className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-lg font-medium hover:bg-gray-50 transition flex items-center justify-center space-x-2"
              >
                <X size={18} />
                <span>Cancel</span>
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 flex items-center justify-center space-x-2"
              >
                <Save size={18} />
                <span>{saving ? 'Saving...' : 'Save Changes'}</span>
              </button>
            </div>
          )}
          </>
          )}
        </div>
      </div>
    </div>
  );
}
