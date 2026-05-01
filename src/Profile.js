import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import { Mail, Phone, Ruler, Scale, Edit2, Save, X, Shirt, Camera, Plus, Trash2, Instagram, Twitter, Building2, ArrowLeft, CheckCircle, XCircle, ShoppingBag, ExternalLink, Users } from 'lucide-react';
import AttendanceRings from './AttendanceRings';

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
  { key: 'recruitment', label: 'Recruitment', roles: ['admin', 'coach'] },
  { key: 'waiver', label: 'Waiver' },
  { key: 'codes', label: 'Codes' },
  { key: 'goals', label: 'Goals' },
  { key: 'notes', label: 'Notes', roles: ['admin', 'coach'] },
  { key: 'attendance', label: 'Attendance', roles: ['admin', 'coach'] },
];

const RECRUITMENT_LEVEL_OPTIONS = ['D1', 'D2', 'D3', 'NAIA', 'JUCO', 'Independent', 'Affiliate'];
const RECRUITMENT_STATUS_OPTIONS = ['Interested', 'Talking To', 'Offered', 'Committed'];

const NOTE_CATEGORIES = [
  { value: 'general', label: 'General', color: 'bg-gray-100 text-gray-700' },
  { value: 'practice', label: 'Practice', color: 'bg-blue-100 text-blue-700' },
  { value: 'game', label: 'Game', color: 'bg-green-100 text-green-700' },
  { value: 'skill_session', label: 'Skill Session', color: 'bg-purple-100 text-purple-700' },
  { value: 'disciplinary', label: 'Disciplinary', color: 'bg-red-100 text-red-700' },
];

export default function Profile({ userId, userRole, onBack, loggedInUserId }) {
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [equipmentSizes, setEquipmentSizes] = useState({});
  const [editEquipment, setEditEquipment] = useState({});
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [activeProfileTab, setActiveProfileTab] = useState('general');
  const [recruitmentTeams, setRecruitmentTeams] = useState([]);
  const [savingRecruitment, setSavingRecruitment] = useState({});
  const [discountCodes, setDiscountCodes] = useState([]);
  const [waiverData, setWaiverData] = useState(null);
  const [armCareRoutines, setArmCareRoutines] = useState([]);
  const [editingRoutineId, setEditingRoutineId] = useState(null);
  const [routineDraft, setRoutineDraft] = useState({ title: '', content: '' });
  const [savingRoutine, setSavingRoutine] = useState(false);
  const [goals, setGoals] = useState([]);
  const [editingGoalId, setEditingGoalId] = useState(null);
  const [goalDraft, setGoalDraft] = useState({ goal_type: 'short_term', content: '' });
  const [savingGoal, setSavingGoal] = useState(false);
  const [playerNotes, setPlayerNotes] = useState([]);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [noteDraft, setNoteDraft] = useState({ category: 'general', content: '' });
  const [savingNote, setSavingNote] = useState(false);
  const [noteFilter, setNoteFilter] = useState('all');
  const [attendanceStats, setAttendanceStats] = useState(null);
  const [attendanceEvents, setAttendanceEvents] = useState([]);
  const [attendanceMap, setAttendanceMap] = useState({});
  const [attendanceFilter, setAttendanceFilter] = useState('all');
  const [savingAttendance, setSavingAttendance] = useState({});
  const avatarInputRef = useRef(null);

  useEffect(() => {
    fetchUserData();
    fetchRecruitmentTeams();
    fetchDiscountCodes();
    fetchWaiverData();
    fetchArmCareRoutines();
    fetchGoals();
    fetchPlayerNotes();
  }, [userId]);

  useEffect(() => {
    if (userData && userData.role === 'player') fetchAttendanceData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userData]);

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
        instagram: data.instagram || '',
        twitter: data.twitter || '',
        organization: data.organization || '',
        parent1_name: data.parent1_name || '',
        parent1_email: data.parent1_email || '',
        parent2_name: data.parent2_name || '',
        parent2_email: data.parent2_email || '',
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
          instagram: editForm.instagram || null,
          twitter: editForm.twitter || null,
          organization: editForm.organization || null,
          parent1_name: editForm.parent1_name || null,
          parent1_email: editForm.parent1_email || null,
          parent2_name: editForm.parent2_name || null,
          parent2_email: editForm.parent2_email || null,
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
      instagram: userData.instagram || '',
      twitter: userData.twitter || '',
      organization: userData.organization || '',
      parent1_name: userData.parent1_name || '',
      parent1_email: userData.parent1_email || '',
      parent2_name: userData.parent2_name || '',
      parent2_email: userData.parent2_email || '',
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

  const fetchRecruitmentTeams = async () => {
    try {
      const { data, error } = await supabase
        .from('recruitment_teams')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setRecruitmentTeams(data || []);
    } catch (error) {
      console.error('Error fetching recruitment teams:', error);
    }
  };

  const fetchDiscountCodes = async () => {
    try {
      const { data, error } = await supabase
        .from('discount_codes')
        .select('*')
        .order('created_at', { ascending: true });
      if (error) throw error;
      setDiscountCodes(data || []);
    } catch (error) {
      console.error('Error fetching discount codes:', error);
    }
  };

  const fetchArmCareRoutines = async () => {
    try {
      const { data, error } = await supabase
        .from('arm_care_routines')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setArmCareRoutines(data || []);
    } catch (error) {
      console.error('Error fetching arm care routines:', error);
    }
  };

  const addArmCareRoutine = (routineType) => {
    setEditingRoutineId('new');
    setRoutineDraft({ title: `${routineType} Routine`, content: '', routine_type: routineType });
  };

  const startEditRoutine = (routine) => {
    setEditingRoutineId(routine.id);
    setRoutineDraft({ title: routine.title || '', content: routine.content || '', routine_type: routine.routine_type });
  };

  const cancelEditRoutine = () => {
    setEditingRoutineId(null);
    setRoutineDraft({ title: '', content: '' });
  };

  const saveRoutine = async () => {
    setSavingRoutine(true);
    try {
      if (editingRoutineId === 'new') {
        const { error } = await supabase
          .from('arm_care_routines')
          .insert({
            user_id: userId,
            routine_type: routineDraft.routine_type,
            title: routineDraft.title || null,
            content: routineDraft.content || null,
          });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('arm_care_routines')
          .update({
            title: routineDraft.title || null,
            content: routineDraft.content || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingRoutineId);
        if (error) throw error;
      }
      await fetchArmCareRoutines();
      cancelEditRoutine();
    } catch (error) {
      console.error('Error saving routine:', error);
      alert('Error saving routine: ' + error.message);
    } finally {
      setSavingRoutine(false);
    }
  };

  const deleteRoutine = async (id) => {
    if (!window.confirm('Delete this routine?')) return;
    try {
      const { error } = await supabase.from('arm_care_routines').delete().eq('id', id);
      if (error) throw error;
      await fetchArmCareRoutines();
    } catch (error) {
      console.error('Error deleting routine:', error);
      alert('Error deleting routine: ' + error.message);
    }
  };

  const fetchGoals = async () => {
    try {
      const { data, error } = await supabase
        .from('user_goals')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      setGoals(data || []);
    } catch (error) {
      console.error('Error fetching goals:', error);
    }
  };

  const addGoal = (goalType) => {
    setEditingGoalId('new');
    setGoalDraft({ goal_type: goalType, content: '' });
  };

  const startEditGoal = (goal) => {
    setEditingGoalId(goal.id);
    setGoalDraft({ goal_type: goal.goal_type, content: goal.content || '' });
  };

  const cancelEditGoal = () => {
    setEditingGoalId(null);
    setGoalDraft({ goal_type: 'short_term', content: '' });
  };

  const saveGoal = async () => {
    if (!goalDraft.content.trim()) return;
    setSavingGoal(true);
    try {
      if (editingGoalId === 'new') {
        const { error } = await supabase
          .from('user_goals')
          .insert({ user_id: userId, goal_type: goalDraft.goal_type, content: goalDraft.content.trim() });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('user_goals')
          .update({ content: goalDraft.content.trim(), updated_at: new Date().toISOString() })
          .eq('id', editingGoalId);
        if (error) throw error;
      }
      await fetchGoals();
      cancelEditGoal();
    } catch (error) {
      console.error('Error saving goal:', error);
      alert('Error saving goal: ' + error.message);
    } finally {
      setSavingGoal(false);
    }
  };

  const deleteGoal = async (id) => {
    if (!window.confirm('Delete this goal?')) return;
    try {
      const { error } = await supabase.from('user_goals').delete().eq('id', id);
      if (error) throw error;
      await fetchGoals();
    } catch (error) {
      console.error('Error deleting goal:', error);
      alert('Error deleting goal: ' + error.message);
    }
  };

  const fetchPlayerNotes = async () => {
    try {
      const { data, error } = await supabase
        .from('player_notes')
        .select('*, author:created_by(full_name)')
        .eq('player_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setPlayerNotes(data || []);
    } catch (error) {
      console.error('Error fetching player notes:', error);
    }
  };

  const startNewNote = () => {
    setEditingNoteId('new');
    setNoteDraft({ category: 'general', content: '' });
  };

  const startEditNote = (note) => {
    setEditingNoteId(note.id);
    setNoteDraft({ category: note.category, content: note.content || '' });
  };

  const cancelEditNote = () => {
    setEditingNoteId(null);
    setNoteDraft({ category: 'general', content: '' });
  };

  const saveNote = async () => {
    if (!noteDraft.content.trim()) return;
    setSavingNote(true);
    try {
      if (editingNoteId === 'new') {
        const { error } = await supabase
          .from('player_notes')
          .insert({
            player_id: userId,
            created_by: loggedInUserId,
            category: noteDraft.category,
            content: noteDraft.content.trim(),
          });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('player_notes')
          .update({
            category: noteDraft.category,
            content: noteDraft.content.trim(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingNoteId);
        if (error) throw error;
      }
      await fetchPlayerNotes();
      cancelEditNote();
    } catch (error) {
      console.error('Error saving note:', error);
      alert('Error saving note: ' + error.message);
    } finally {
      setSavingNote(false);
    }
  };

  const deleteNote = async (id) => {
    if (!window.confirm('Delete this note?')) return;
    try {
      const { error } = await supabase.from('player_notes').delete().eq('id', id);
      if (error) throw error;
      await fetchPlayerNotes();
    } catch (error) {
      console.error('Error deleting note:', error);
      alert('Error deleting note: ' + error.message);
    }
  };

  const fetchAttendanceData = async () => {
    try {
      const teamIds = (userData.team_members || []).map(tm => tm.team_id);
      const today = new Date().toISOString().split('T')[0];

      let allEvents = [];

      // Fetch past team events (games + practices)
      if (teamIds.length > 0) {
        const { data: teamEvents } = await supabase
          .from('schedule_events')
          .select('id, event_type, event_date, opponent, title, team_id')
          .in('team_id', teamIds)
          .is('player_id', null)
          .in('event_type', ['game', 'practice'])
          .lte('event_date', today);
        if (teamEvents) allEvents = [...allEvents, ...teamEvents];
      }

      // Fetch past player-specific workouts
      const { data: workoutEvents } = await supabase
        .from('schedule_events')
        .select('id, event_type, event_date, title, player_id')
        .eq('player_id', userId)
        .eq('event_type', 'workout')
        .lte('event_date', today);
      if (workoutEvents) allEvents = [...allEvents, ...workoutEvents];

      // Sort by date descending
      allEvents.sort((a, b) => b.event_date.localeCompare(a.event_date));
      setAttendanceEvents(allEvents);

      if (allEvents.length === 0) {
        setAttendanceStats({ practice: { attended: 0, total: 0 }, game: { attended: 0, total: 0 }, workout: { attended: 0, total: 0 } });
        setAttendanceMap({});
        return;
      }

      // Fetch attendance records for this player
      const eventIds = allEvents.map(e => e.id);
      const { data: records } = await supabase
        .from('event_attendance')
        .select('*')
        .eq('player_id', userId)
        .in('event_id', eventIds);

      const recMap = {};
      (records || []).forEach(r => { recMap[r.event_id] = r; });
      setAttendanceMap(recMap);

      // Compute stats per type
      const stats = { practice: { attended: 0, total: 0 }, game: { attended: 0, total: 0 }, workout: { attended: 0, total: 0 } };
      allEvents.forEach(ev => {
        const rec = recMap[ev.id];
        if (!rec) return; // unmarked events don't count
        if (rec.status === 'excused') return; // excused excluded entirely
        const type = ev.event_type;
        if (stats[type]) {
          stats[type].total += 1;
          if (rec.status === 'present') stats[type].attended += 1;
        }
      });
      setAttendanceStats(stats);
    } catch (error) {
      console.error('Error fetching attendance data:', error);
    }
  };

  const handleMarkAttendance = async (eventId, status) => {
    setSavingAttendance(prev => ({ ...prev, [eventId]: true }));
    try {
      const existing = attendanceMap[eventId];
      if (existing && existing.status === status) {
        // Toggle off — delete the record
        const { error } = await supabase
          .from('event_attendance')
          .delete()
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        // Upsert
        const { error } = await supabase
          .from('event_attendance')
          .upsert({
            event_id: eventId,
            player_id: userId,
            status,
            marked_by: loggedInUserId,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'event_id,player_id' });
        if (error) throw error;
      }
      await fetchAttendanceData();
    } catch (error) {
      console.error('Error marking attendance:', error);
      alert('Error marking attendance: ' + error.message);
    } finally {
      setSavingAttendance(prev => ({ ...prev, [eventId]: false }));
    }
  };

  const fetchWaiverData = async () => {
    try {
      const { data, error } = await supabase
        .from('waiver_signatures')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      setWaiverData(data);
    } catch (error) {
      console.error('Error fetching waiver data:', error);
    }
  };

  const addRecruitmentTeam = async () => {
    try {
      const { data, error } = await supabase
        .from('recruitment_teams')
        .insert({ user_id: userId })
        .select()
        .single();
      if (error) throw error;
      setRecruitmentTeams([...recruitmentTeams, data]);
    } catch (error) {
      console.error('Error adding recruitment team:', error);
      alert('Error adding team: ' + error.message);
    }
  };

  const updateRecruitmentTeam = async (teamId, field, value) => {
    setSavingRecruitment(prev => ({ ...prev, [teamId + field]: true }));
    try {
      const { error } = await supabase
        .from('recruitment_teams')
        .update({ [field]: value || null, updated_at: new Date().toISOString() })
        .eq('id', teamId);
      if (error) throw error;
      setRecruitmentTeams(prev =>
        prev.map(t => t.id === teamId ? { ...t, [field]: value } : t)
      );
    } catch (error) {
      console.error('Error updating recruitment team:', error);
    } finally {
      setSavingRecruitment(prev => ({ ...prev, [teamId + field]: false }));
    }
  };

  const deleteRecruitmentTeam = async (teamId) => {
    if (!window.confirm('Delete this recruitment entry?')) return;
    try {
      const { error } = await supabase
        .from('recruitment_teams')
        .delete()
        .eq('id', teamId);
      if (error) throw error;
      setRecruitmentTeams(prev => prev.filter(t => t.id !== teamId));
    } catch (error) {
      console.error('Error deleting recruitment team:', error);
      alert('Error deleting team: ' + error.message);
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
        <div className="flex items-center space-x-3">
          {onBack && (
            <button onClick={onBack} className="text-gray-500 hover:text-gray-700 transition">
              <ArrowLeft size={24} />
            </button>
          )}
          <div>
            <h2 className="text-3xl font-bold text-gray-900">{onBack ? `${userData.full_name}'s Profile` : 'My Profile'}</h2>
            <p className="text-gray-600 mt-1">{onBack ? 'Viewing player profile' : 'Manage your personal information'}</p>
          </div>
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
            {userData.role === 'player' && attendanceStats && (
              <div className="ml-auto flex items-center">
                <AttendanceRings
                  practices={attendanceStats.practice}
                  games={attendanceStats.game}
                  lifts={attendanceStats.workout}
                  onToggleLog={() => setActiveProfileTab('attendance')}
                  canEdit={canEditProfile}
                />
              </div>
            )}
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
              {PROFILE_TABS.filter(tab => !tab.roles || tab.roles.includes(userRole)).map(tab => (
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

          {activeProfileTab !== 'general' && activeProfileTab !== 'recruitment' && activeProfileTab !== 'codes' && activeProfileTab !== 'waiver' && activeProfileTab !== 'armcare' && activeProfileTab !== 'goals' && activeProfileTab !== 'notes' && activeProfileTab !== 'attendance' && (
            <div className="py-12 text-center">
              <p className="text-gray-500 text-lg">Coming Soon</p>
            </div>
          )}

          {activeProfileTab === 'attendance' && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {[
                  { value: 'all', label: 'All' },
                  { value: 'practice', label: 'Practices', color: 'bg-green-100 text-green-700' },
                  { value: 'game', label: 'Games', color: 'bg-blue-100 text-blue-700' },
                  { value: 'workout', label: 'Lifts', color: 'bg-amber-100 text-amber-700' },
                ].map(f => (
                  <button
                    key={f.value}
                    onClick={() => setAttendanceFilter(f.value)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
                      attendanceFilter === f.value
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                {attendanceEvents
                  .filter(ev => attendanceFilter === 'all' || ev.event_type === attendanceFilter)
                  .length === 0 && (
                  <p className="text-sm text-gray-500 italic text-center py-8">No past events found.</p>
                )}
                {attendanceEvents
                  .filter(ev => attendanceFilter === 'all' || ev.event_type === attendanceFilter)
                  .map(ev => {
                    const rec = attendanceMap[ev.id];
                    const currentStatus = rec?.status || null;
                    const isSaving = savingAttendance[ev.id];
                    const typeBadge = ev.event_type === 'practice'
                      ? 'bg-green-100 text-green-700'
                      : ev.event_type === 'game'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-amber-100 text-amber-700';
                    const typeLabel = ev.event_type === 'practice' ? 'Practice' : ev.event_type === 'game' ? 'Game' : 'Lift';
                    const displayName = ev.title || ev.opponent || typeLabel;
                    const dateStr = new Date(ev.event_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

                    return (
                      <div key={ev.id} className="flex items-center justify-between border border-gray-200 rounded-lg p-3">
                        <div className="flex items-center space-x-3 min-w-0">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${typeBadge}`}>{typeLabel}</span>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{displayName}</p>
                            <p className="text-xs text-gray-500">{dateStr}</p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-1 flex-shrink-0">
                          <button
                            onClick={() => handleMarkAttendance(ev.id, 'present')}
                            disabled={isSaving}
                            className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                              currentStatus === 'present'
                                ? 'bg-green-600 text-white'
                                : 'bg-gray-100 text-gray-600 hover:bg-green-100 hover:text-green-700'
                            } disabled:opacity-50`}
                          >
                            Present
                          </button>
                          <button
                            onClick={() => handleMarkAttendance(ev.id, 'absent')}
                            disabled={isSaving}
                            className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                              currentStatus === 'absent'
                                ? 'bg-red-600 text-white'
                                : 'bg-gray-100 text-gray-600 hover:bg-red-100 hover:text-red-700'
                            } disabled:opacity-50`}
                          >
                            Absent
                          </button>
                          <button
                            onClick={() => handleMarkAttendance(ev.id, 'excused')}
                            disabled={isSaving}
                            className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                              currentStatus === 'excused'
                                ? 'bg-yellow-500 text-white'
                                : 'bg-gray-100 text-gray-600 hover:bg-yellow-100 hover:text-yellow-700'
                            } disabled:opacity-50`}
                          >
                            Excused
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {activeProfileTab === 'goals' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[
                { type: 'short_term', label: 'Short-Term Goals' },
                { type: 'long_term', label: 'Long-Term Goals' },
              ].map(({ type, label }) => {
                const items = goals.filter(g => g.goal_type === type);
                return (
                  <div key={type}>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-lg font-semibold text-gray-900">{label}</h4>
                      <button
                        onClick={() => addGoal(type)}
                        className="bg-blue-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-blue-700 transition flex items-center space-x-1 text-sm"
                      >
                        <Plus size={14} />
                        <span>Add</span>
                      </button>
                    </div>
                    {editingGoalId === 'new' && goalDraft.goal_type === type && (
                      <div className="border border-blue-300 rounded-lg p-3 mb-3 bg-blue-50">
                        <textarea
                          value={goalDraft.content}
                          onChange={(e) => setGoalDraft({ ...goalDraft, content: e.target.value })}
                          placeholder={`What's a ${label.toLowerCase().replace(' goals', ' goal')}?`}
                          rows={3}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                        />
                        <div className="flex justify-end space-x-2 mt-2">
                          <button onClick={cancelEditGoal} className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition text-sm">Cancel</button>
                          <button onClick={saveGoal} disabled={savingGoal || !goalDraft.content.trim()} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 text-sm">
                            {savingGoal ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="space-y-2">
                      {items.length === 0 && editingGoalId !== 'new' && (
                        <p className="text-sm text-gray-500 italic">No {label.toLowerCase()} yet.</p>
                      )}
                      {items.map(goal => (
                        <div key={goal.id} className="border border-gray-200 rounded-lg p-3">
                          {editingGoalId === goal.id ? (
                            <>
                              <textarea
                                value={goalDraft.content}
                                onChange={(e) => setGoalDraft({ ...goalDraft, content: e.target.value })}
                                rows={3}
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                              />
                              <div className="flex justify-end space-x-2 mt-2">
                                <button onClick={cancelEditGoal} className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition text-sm">Cancel</button>
                                <button onClick={saveGoal} disabled={savingGoal || !goalDraft.content.trim()} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 text-sm">
                                  {savingGoal ? 'Saving...' : 'Save'}
                                </button>
                              </div>
                            </>
                          ) : (
                            <div className="flex justify-between items-start">
                              <p className="text-sm text-gray-800 whitespace-pre-wrap flex-1">{goal.content}</p>
                              <div className="flex items-center space-x-1 ml-3 flex-shrink-0">
                                <button onClick={() => startEditGoal(goal)} className="text-gray-400 hover:text-blue-600 transition" title="Edit">
                                  <Edit2 size={14} />
                                </button>
                                <button onClick={() => deleteGoal(goal.id)} className="text-gray-400 hover:text-red-600 transition" title="Delete">
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {activeProfileTab === 'notes' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex flex-wrap gap-2">
                  {[{ value: 'all', label: 'All' }, ...NOTE_CATEGORIES].map(cat => (
                    <button
                      key={cat.value}
                      onClick={() => setNoteFilter(cat.value)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
                        noteFilter === cat.value
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={startNewNote}
                  className="bg-blue-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-blue-700 transition flex items-center space-x-1 text-sm"
                >
                  <Plus size={14} />
                  <span>Add Note</span>
                </button>
              </div>

              {editingNoteId === 'new' && (
                <div className="border border-blue-300 rounded-lg p-4 bg-blue-50">
                  <div className="flex items-center space-x-3 mb-3">
                    <label className="text-sm font-medium text-gray-700">Category:</label>
                    <select
                      value={noteDraft.category}
                      onChange={(e) => setNoteDraft({ ...noteDraft, category: e.target.value })}
                      className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {NOTE_CATEGORIES.map(cat => (
                        <option key={cat.value} value={cat.value}>{cat.label}</option>
                      ))}
                    </select>
                  </div>
                  <textarea
                    value={noteDraft.content}
                    onChange={(e) => setNoteDraft({ ...noteDraft, content: e.target.value })}
                    placeholder="Write a note..."
                    rows={4}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                  <div className="flex justify-end space-x-2 mt-2">
                    <button onClick={cancelEditNote} className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition text-sm">Cancel</button>
                    <button onClick={saveNote} disabled={savingNote || !noteDraft.content.trim()} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 text-sm">
                      {savingNote ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {playerNotes
                  .filter(n => noteFilter === 'all' || n.category === noteFilter)
                  .length === 0 && editingNoteId !== 'new' && (
                  <p className="text-sm text-gray-500 italic text-center py-6">No notes yet.</p>
                )}
                {playerNotes
                  .filter(n => noteFilter === 'all' || n.category === noteFilter)
                  .map(note => {
                    const catInfo = NOTE_CATEGORIES.find(c => c.value === note.category) || NOTE_CATEGORIES[0];
                    const canModify = note.created_by === loggedInUserId || userRole === 'admin';
                    return (
                      <div key={note.id} className="border border-gray-200 rounded-lg p-4">
                        {editingNoteId === note.id ? (
                          <>
                            <div className="flex items-center space-x-3 mb-3">
                              <label className="text-sm font-medium text-gray-700">Category:</label>
                              <select
                                value={noteDraft.category}
                                onChange={(e) => setNoteDraft({ ...noteDraft, category: e.target.value })}
                                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                {NOTE_CATEGORIES.map(cat => (
                                  <option key={cat.value} value={cat.value}>{cat.label}</option>
                                ))}
                              </select>
                            </div>
                            <textarea
                              value={noteDraft.content}
                              onChange={(e) => setNoteDraft({ ...noteDraft, content: e.target.value })}
                              rows={4}
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                            />
                            <div className="flex justify-end space-x-2 mt-2">
                              <button onClick={cancelEditNote} className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition text-sm">Cancel</button>
                              <button onClick={saveNote} disabled={savingNote || !noteDraft.content.trim()} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 text-sm">
                                {savingNote ? 'Saving...' : 'Save'}
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center space-x-2">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${catInfo.color}`}>{catInfo.label}</span>
                                <span className="text-xs text-gray-500">{note.author?.full_name || 'Unknown'}</span>
                                <span className="text-xs text-gray-400">{new Date(note.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                              </div>
                              {canModify && (
                                <div className="flex items-center space-x-1">
                                  <button onClick={() => startEditNote(note)} className="text-gray-400 hover:text-blue-600 transition" title="Edit">
                                    <Edit2 size={14} />
                                  </button>
                                  <button onClick={() => deleteNote(note.id)} className="text-gray-400 hover:text-red-600 transition" title="Delete">
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              )}
                            </div>
                            <p className="text-sm text-gray-800 whitespace-pre-wrap">{note.content}</p>
                            {note.updated_at && note.updated_at !== note.created_at && (
                              <p className="text-xs text-gray-400 mt-2 italic">Edited {new Date(note.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {activeProfileTab === 'armcare' && (
            <div>
              <div className="flex flex-wrap gap-2 mb-6">
                {['Starter', 'Reliever', 'Closer', 'Infielder', 'Outfielder'].map(type => (
                  <button
                    key={type}
                    onClick={() => addArmCareRoutine(type)}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition flex items-center space-x-2 text-sm"
                  >
                    <Plus size={16} />
                    <span>{type} Routine</span>
                  </button>
                ))}
              </div>

              {editingRoutineId === 'new' && (
                <div className="border border-blue-300 rounded-lg p-4 mb-4 bg-blue-50">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-semibold text-blue-900">New {routineDraft.routine_type} Routine</span>
                  </div>
                  <input
                    type="text"
                    value={routineDraft.title}
                    onChange={(e) => setRoutineDraft({ ...routineDraft, title: e.target.value })}
                    placeholder="Routine title"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                  <textarea
                    value={routineDraft.content}
                    onChange={(e) => setRoutineDraft({ ...routineDraft, content: e.target.value })}
                    placeholder="Describe the routine in detail..."
                    rows={8}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                  <div className="flex justify-end space-x-2 mt-3">
                    <button
                      onClick={cancelEditRoutine}
                      className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition text-sm"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={saveRoutine}
                      disabled={savingRoutine}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 text-sm"
                    >
                      {savingRoutine ? 'Saving...' : 'Save Routine'}
                    </button>
                  </div>
                </div>
              )}

              {armCareRoutines.length === 0 && editingRoutineId !== 'new' && (
                <div className="text-center py-8 text-gray-500">
                  <p>No routines yet. Click a button above to add one.</p>
                </div>
              )}

              <div className="space-y-3">
                {armCareRoutines.map(routine => (
                  <div key={routine.id} className="border border-gray-200 rounded-lg p-4">
                    {editingRoutineId === routine.id ? (
                      <>
                        <span className="text-xs font-semibold text-blue-700 bg-blue-100 rounded px-2 py-0.5">{routine.routine_type}</span>
                        <input
                          type="text"
                          value={routineDraft.title}
                          onChange={(e) => setRoutineDraft({ ...routineDraft, title: e.target.value })}
                          placeholder="Routine title"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-2 mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                        />
                        <textarea
                          value={routineDraft.content}
                          onChange={(e) => setRoutineDraft({ ...routineDraft, content: e.target.value })}
                          placeholder="Describe the routine in detail..."
                          rows={8}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                        />
                        <div className="flex justify-end space-x-2 mt-3">
                          <button onClick={cancelEditRoutine} className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition text-sm">Cancel</button>
                          <button onClick={saveRoutine} disabled={savingRoutine} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 text-sm">
                            {savingRoutine ? 'Saving...' : 'Save'}
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center space-x-2">
                            <span className="text-xs font-semibold text-blue-700 bg-blue-100 rounded px-2 py-0.5">{routine.routine_type}</span>
                            {routine.title && <span className="text-sm font-semibold text-gray-900">{routine.title}</span>}
                          </div>
                          <div className="flex items-center space-x-1">
                            <button onClick={() => startEditRoutine(routine)} className="text-gray-400 hover:text-blue-600 transition" title="Edit">
                              <Edit2 size={16} />
                            </button>
                            <button onClick={() => deleteRoutine(routine.id)} className="text-gray-400 hover:text-red-600 transition" title="Delete">
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                        {routine.content && (
                          <p className="text-sm text-gray-700 whitespace-pre-wrap">{routine.content}</p>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeProfileTab === 'recruitment' && (
            <div>
              {recruitmentTeams.map((team) => (
                <div key={team.id} className="border border-gray-200 rounded-lg p-4 mb-4">
                  <div className="flex justify-between items-start mb-3">
                    <h4 className="text-sm font-semibold text-gray-700">
                      {team.organization_name || 'New Team'}
                    </h4>
                    <button
                      onClick={() => deleteRecruitmentTeam(team.id)}
                      className="text-red-400 hover:text-red-600 transition"
                      title="Delete"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Level</label>
                      <select
                        value={team.level || ''}
                        onChange={(e) => updateRecruitmentTeam(team.id, 'level', e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white"
                      >
                        <option value="">Select Level</option>
                        {RECRUITMENT_LEVEL_OPTIONS.map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Organization Name</label>
                      <input
                        type="text"
                        defaultValue={team.organization_name || ''}
                        onBlur={(e) => updateRecruitmentTeam(team.id, 'organization_name', e.target.value)}
                        placeholder="Organization name"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Contact Person</label>
                      <input
                        type="text"
                        defaultValue={team.contact_person || ''}
                        onBlur={(e) => updateRecruitmentTeam(team.id, 'contact_person', e.target.value)}
                        placeholder="Contact person"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Role / Position</label>
                      <input
                        type="text"
                        defaultValue={team.role_position || ''}
                        onBlur={(e) => updateRecruitmentTeam(team.id, 'role_position', e.target.value)}
                        placeholder="Role or position"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Contact Email</label>
                      <input
                        type="email"
                        defaultValue={team.contact_email || ''}
                        onBlur={(e) => updateRecruitmentTeam(team.id, 'contact_email', e.target.value)}
                        placeholder="Email address"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Contact Phone</label>
                      <input
                        type="text"
                        defaultValue={team.contact_phone || ''}
                        onBlur={(e) => updateRecruitmentTeam(team.id, 'contact_phone', e.target.value)}
                        placeholder="Phone number"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Status</label>
                      <select
                        value={team.status || ''}
                        onChange={(e) => updateRecruitmentTeam(team.id, 'status', e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white"
                      >
                        <option value="">Select Status</option>
                        {RECRUITMENT_STATUS_OPTIONS.map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </div>
                    <div className="md:col-span-2 lg:col-span-4">
                      <label className="block text-xs text-gray-500 mb-1">Notes</label>
                      <textarea
                        defaultValue={team.notes || ''}
                        onBlur={(e) => updateRecruitmentTeam(team.id, 'notes', e.target.value)}
                        placeholder="Additional notes..."
                        rows={2}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-vertical"
                      />
                    </div>
                  </div>
                </div>
              ))}
              <button
                onClick={addRecruitmentTeam}
                className="mt-2 bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition flex items-center space-x-2"
              >
                <Plus size={18} />
                <span>Add a Team</span>
              </button>
            </div>
          )}

          {activeProfileTab === 'codes' && (
            <div>
              <h4 className="text-lg font-semibold text-gray-900 mb-4">Discount Codes</h4>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Vendor</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Code</th>
                  </tr>
                </thead>
                <tbody>
                  {discountCodes.map(c => (
                    <tr key={c.id} className="border-b border-gray-100">
                      <td className="py-3 px-4 text-sm text-gray-900">{c.vendor || '—'}</td>
                      <td className="py-3 px-4 text-sm text-gray-900 font-mono">{c.code || '—'}</td>
                    </tr>
                  ))}
                  {discountCodes.length === 0 && (
                    <tr>
                      <td colSpan={2} className="py-8 text-center text-gray-500">No discount codes available.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {activeProfileTab === 'waiver' && (
            <div>
              {waiverData ? (
                <div className="space-y-4">
                  <div className="flex items-center space-x-2 mb-4">
                    <CheckCircle className="text-green-600" size={20} />
                    <span className="font-semibold text-green-700">Waiver Signed</span>
                    <span className="text-sm text-gray-500 ml-2">
                      on {new Date(waiverData.signed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-600">Participant Name</p>
                      <p className="text-gray-900 font-medium">{waiverData.participant_name}</p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Participant Signature</p>
                      <img src={waiverData.participant_signature_url} alt="Signature" className="border border-gray-200 rounded bg-white max-h-20" />
                    </div>
                  </div>
                  {waiverData.is_minor && (
                    <div className="border-t border-gray-200 pt-4 mt-4">
                      <p className="text-sm font-semibold text-gray-700 mb-3">Parent / Guardian</p>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <p className="text-sm text-gray-600">Guardian Name</p>
                          <p className="text-gray-900 font-medium">{waiverData.guardian_name}</p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600">Relationship</p>
                          <p className="text-gray-900 font-medium">{waiverData.guardian_relationship}</p>
                        </div>
                        {waiverData.emergency_phone && (
                          <div>
                            <p className="text-sm text-gray-600">Emergency Phone</p>
                            <p className="text-gray-900 font-medium">{waiverData.emergency_phone}</p>
                          </div>
                        )}
                      </div>
                      <div className="mt-3">
                        <p className="text-sm text-gray-600 mb-1">Guardian Signature</p>
                        <img src={waiverData.guardian_signature_url} alt="Guardian Signature" className="border border-gray-200 rounded bg-white max-h-20" />
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <XCircle className="mx-auto text-gray-300 mb-3" size={36} />
                  <p className="text-gray-500">Waiver not yet signed</p>
                  {!onBack && (
                    <p className="text-sm text-gray-400 mt-1">Go to the Waiver page from the sidebar to sign.</p>
                  )}
                </div>
              )}
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

              <div className="flex items-center space-x-3">
                <Users className="text-gray-400" size={20} />
                <div className="flex-1">
                  <p className="text-sm text-gray-600">Parent 1 Name</p>
                  {editing ? (
                    <input
                      type="text"
                      value={editForm.parent1_name}
                      onChange={(e) => setEditForm({...editForm, parent1_name: e.target.value})}
                      placeholder="Enter parent name"
                      className="w-full border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  ) : (
                    <p className="text-gray-900">{userData.parent1_name || 'Not set'}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-3">
                <Mail className="text-gray-400" size={20} />
                <div className="flex-1">
                  <p className="text-sm text-gray-600">Parent 1 Email</p>
                  {editing ? (
                    <input
                      type="email"
                      value={editForm.parent1_email}
                      onChange={(e) => setEditForm({...editForm, parent1_email: e.target.value})}
                      placeholder="Enter parent email"
                      className="w-full border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  ) : (
                    <p className="text-gray-900">{userData.parent1_email || 'Not set'}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-3">
                <Users className="text-gray-400" size={20} />
                <div className="flex-1">
                  <p className="text-sm text-gray-600">Parent 2 Name</p>
                  {editing ? (
                    <input
                      type="text"
                      value={editForm.parent2_name}
                      onChange={(e) => setEditForm({...editForm, parent2_name: e.target.value})}
                      placeholder="Enter parent name"
                      className="w-full border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  ) : (
                    <p className="text-gray-900">{userData.parent2_name || 'Not set'}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-3">
                <Mail className="text-gray-400" size={20} />
                <div className="flex-1">
                  <p className="text-sm text-gray-600">Parent 2 Email</p>
                  {editing ? (
                    <input
                      type="email"
                      value={editForm.parent2_email}
                      onChange={(e) => setEditForm({...editForm, parent2_email: e.target.value})}
                      placeholder="Enter parent email"
                      className="w-full border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  ) : (
                    <p className="text-gray-900">{userData.parent2_email || 'Not set'}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-3">
                <Instagram className="text-gray-400" size={20} />
                <div className="flex-1">
                  <p className="text-sm text-gray-600">Instagram</p>
                  {editing ? (
                    <input
                      type="text"
                      value={editForm.instagram}
                      onChange={(e) => setEditForm({...editForm, instagram: e.target.value})}
                      placeholder="@username"
                      className="w-full border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  ) : (
                    <p className="text-gray-900">{userData.instagram || 'Not set'}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-3">
                <Twitter className="text-gray-400" size={20} />
                <div className="flex-1">
                  <p className="text-sm text-gray-600">Twitter</p>
                  {editing ? (
                    <input
                      type="text"
                      value={editForm.twitter}
                      onChange={(e) => setEditForm({...editForm, twitter: e.target.value})}
                      placeholder="@username"
                      className="w-full border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  ) : (
                    <p className="text-gray-900">{userData.twitter || 'Not set'}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-3">
                <Building2 className="text-gray-400" size={20} />
                <div className="flex-1">
                  <p className="text-sm text-gray-600">Organization</p>
                  {editing ? (
                    <input
                      type="text"
                      value={editForm.organization}
                      onChange={(e) => setEditForm({...editForm, organization: e.target.value})}
                      placeholder="Enter organization"
                      className="w-full border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  ) : (
                    <p className="text-gray-900">{userData.organization || 'Not set'}</p>
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

          {/* Gear Stores */}
          <div className="mb-6">
            <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center space-x-2">
              <ShoppingBag className="text-gray-400" size={20} />
              <span>Gear Stores</span>
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <a
                href="https://naturalballplayer.myshopify.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between bg-blue-600 text-white px-4 py-3 rounded-lg font-medium hover:bg-blue-700 transition"
              >
                <span>Natural Ballplayer Store</span>
                <ExternalLink size={18} />
              </a>
              <a
                href="https://www.dudesbaseball.club/product/gear/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between bg-gray-900 text-white px-4 py-3 rounded-lg font-medium hover:bg-gray-800 transition"
              >
                <span>NBP Dudes Store</span>
                <ExternalLink size={18} />
              </a>
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
