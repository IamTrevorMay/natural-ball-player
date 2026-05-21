import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import { Mail, Phone, Ruler, Scale, Edit2, Save, X, Shirt, Camera, Plus, Trash2, Instagram, Twitter, Building2, ArrowLeft, CheckCircle, XCircle, ShoppingBag, ExternalLink, Users, FileText, ClipboardList, ChevronDown, ChevronUp, Eye, Calendar, ChevronLeft, ChevronRight, Paperclip } from 'lucide-react';
import AttendanceRings from './AttendanceRings';
import MedicalHistoryForm from './MedicalHistoryForm';
import EmailComposeModal from './EmailComposeModal';
import { AddEventPanel } from './Schedule';
import WhoopTab from './WhoopTab';

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
  { key: 'athletes', label: 'Athletes', viewedRoles: ['coach', 'admin'] },
  { key: 'programming', label: 'Programming', roles: ['admin', 'coach'] },
  { key: 'schedule', label: 'Schedule', roles: ['admin', 'coach'] },
  { key: 'trackman', label: 'Trackman' },
  { key: 'whoop', label: 'Whoop', roles: ['admin', 'coach'] },
  { key: 'hittrax', label: 'Hittrax' },
  { key: 'assessment', label: 'Assessment' },
  { key: 'armcare', label: 'Arm Care' },
  { key: 'pt', label: 'Physical Therapy' },
  { key: 'recruitment', label: 'Recruitment', roles: ['admin', 'coach'] },
  { key: 'documents', label: 'Documents' },
  { key: 'codes', label: 'Codes' },
  { key: 'goals', label: 'Goals' },
  { key: 'notes', label: 'Notes', roles: ['admin', 'coach'] },
  { key: 'attendance', label: 'Attendance', roles: ['admin', 'coach'] },
  { key: 'communication', label: 'Communication', roles: ['admin', 'coach'] },
];

const PT_STATUS_OPTIONS = ['Active', 'Pending Eval', 'In Treatment', 'Maintenance', 'Discharged'];
const PT_STATUS_COLORS = {
  'Active': 'bg-blue-100 text-blue-700',
  'Pending Eval': 'bg-yellow-100 text-yellow-700',
  'In Treatment': 'bg-orange-100 text-orange-700',
  'Maintenance': 'bg-green-100 text-green-700',
  'Discharged': 'bg-gray-100 text-gray-700',
};
const PT_VISIT_TYPES = ['Evaluation', 'Treatment', 'Follow-up', 'Re-evaluation', 'Discharge'];
const PT_BODY_AREAS = ['Shoulder', 'Elbow', 'Forearm/Wrist', 'Lower back', 'Hip', 'Knee', 'Ankle/Foot', 'Core', 'Other'];

const RECRUITMENT_LEVEL_OPTIONS = ['D1', 'D2', 'D3', 'NAIA', 'JUCO', 'Independent', 'Affiliate'];
const RECRUITMENT_STATUS_OPTIONS = ['Interested', 'Talking To', 'Offered', 'Committed'];

const NOTE_CATEGORIES = [
  { value: 'general', label: 'General', color: 'bg-gray-100 text-gray-700' },
  { value: 'practice', label: 'Practice', color: 'bg-blue-100 text-blue-700' },
  { value: 'game', label: 'Game', color: 'bg-green-100 text-green-700' },
  { value: 'skill_session', label: 'Skill Session', color: 'bg-purple-100 text-purple-700' },
  { value: 'disciplinary', label: 'Disciplinary', color: 'bg-red-100 text-red-700' },
  { value: 'hitting', label: 'Hitting', color: 'bg-amber-100 text-amber-800' },
  { value: 'pitching', label: 'Pitching', color: 'bg-cyan-100 text-cyan-800' },
];

const NOTE_CONTEXT_OPTIONS = ['game', 'lives', 'scrimmage', 'bullpen', 'practice'];
const PITCH_TYPE_OPTIONS = ['Fastball', '4-Seam', '2-Seam', 'Cutter', 'Sinker', 'Slider', 'Curveball', 'Changeup', 'Splitter', 'Knuckle', 'Other'];
const PITCH_LOCATION_OPTIONS = [
  'Up & In', 'Up Middle', 'Up & Away',
  'Middle In', 'Middle Middle', 'Middle Away',
  'Down & In', 'Down Middle', 'Down & Away',
  'Way Out',
];
const HITTING_RESULT_OPTIONS = ['Take - Ball', 'Take - Strike', 'Swing & Miss', 'Foul', 'Weak Contact', 'Hard Contact', 'In Play - Out', 'In Play - Hit', 'HR'];
const PITCHING_RESULT_OPTIONS = ['Ball', 'Called Strike', 'Swing & Miss', 'Foul', 'Weak Contact', 'Hard Contact', 'In Play - Out', 'In Play - Hit', 'HR'];

const isPitchCategory = (cat) => cat === 'hitting' || cat === 'pitching';

export default function Profile({ userId, userRole, onBack, loggedInUserId, onNavigateToProfile }) {
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
  const [contractData, setContractData] = useState(null);
  const [loiData, setLoiData] = useState(null);
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
  const [assessmentTemplates, setAssessmentTemplates] = useState([]);
  const [assessmentSubmissions, setAssessmentSubmissions] = useState([]);
  const [medicalHistory, setMedicalHistory] = useState(null);
  const [showMedicalForm, setShowMedicalForm] = useState(false);
  const [expandedSubmission, setExpandedSubmission] = useState(null);
  const [assessmentFormTemplate, setAssessmentFormTemplate] = useState(null);
  const [ptVisits, setPtVisits] = useState([]);
  const [editingPtVisitId, setEditingPtVisitId] = useState(null);
  const [ptDraft, setPtDraft] = useState({ visit_date: '', visit_type: 'Treatment', body_area: '', pain_level: '', content: '', exercises: [], follow_up_at: '' });
  const [savingPtVisit, setSavingPtVisit] = useState(false);
  const [scheduleEvents, setScheduleEvents] = useState([]);
  const [scheduleDate, setScheduleDate] = useState(new Date());
  const [programmingData, setProgrammingData] = useState({ programs: [], mealPlans: [], assessments: [], loading: false });
  const [scheduleSelectedDay, setScheduleSelectedDay] = useState(null);
  const [showAddWorkout, setShowAddWorkout] = useState(false);
  const [showEmailCompose, setShowEmailCompose] = useState(false);
  const [communicationLogs, setCommunicationLogs] = useState([]);
  const [loadingComms, setLoadingComms] = useState(false);
  const [coachAthletes, setCoachAthletes] = useState([]);
  const [trainerName, setTrainerName] = useState(null);
  const [allCoaches, setAllCoaches] = useState([]);
  const [sportInput, setSportInput] = useState('');
  const avatarInputRef = useRef(null);

  useEffect(() => {
    fetchUserData();
    fetchRecruitmentTeams();
    fetchDiscountCodes();
    fetchWaiverData();
    fetchContractData();
    fetchLoiData();
    fetchArmCareRoutines();
    fetchGoals();
    fetchPlayerNotes();
    fetchAssessmentData();
    fetchPtVisits();
    fetchCommunicationLogs();
    supabase.from('users').select('id, full_name').in('role', ['coach', 'admin']).order('full_name').then(({ data }) => setAllCoaches(data || []));
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [userId]);

  useEffect(() => {
    if (userData && userData.role === 'player') fetchAttendanceData();
    if (userData && (userData.role === 'coach' || userData.role === 'admin')) fetchCoachAthletes();
    // Fetch trainer name if player has one assigned
    const trainerId = userData?._profile?.trainer_id;
    if (trainerId) {
      supabase.from('users').select('full_name').eq('id', trainerId).single().then(({ data }) => {
        if (data) setTrainerName(data.full_name);
      });
    } else {
      setTrainerName(null);
    }
    setSportInput(userData?._profile?.sport || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userData]);

  const fetchUserData = async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select(`
          *,
          player_profiles!player_profiles_user_id_fkey(*),
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
        date_of_birth: data.date_of_birth || '',
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
          date_of_birth: editForm.date_of_birth || null,
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
      date_of_birth: userData.date_of_birth || '',
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
    setNoteDraft({ category: 'general', content: '', context: '', pitches: [] });
  };

  const startEditNote = (note) => {
    setEditingNoteId(note.id);
    setNoteDraft({
      category: note.category,
      content: note.content || '',
      context: note.context || '',
      pitches: Array.isArray(note.pitches) ? note.pitches : [],
    });
  };

  const cancelEditNote = () => {
    setEditingNoteId(null);
    setNoteDraft({ category: 'general', content: '', context: '', pitches: [] });
  };

  const updateDraftPitch = (idx, field, value) => {
    setNoteDraft(prev => ({
      ...prev,
      pitches: (prev.pitches || []).map((p, i) => i === idx ? { ...p, [field]: value } : p),
    }));
  };

  const addDraftPitch = () => {
    setNoteDraft(prev => ({
      ...prev,
      pitches: [...(prev.pitches || []), { pitch_type: '', location: '', result: '', notes: '' }],
    }));
  };

  const removeDraftPitch = (idx) => {
    setNoteDraft(prev => ({
      ...prev,
      pitches: (prev.pitches || []).filter((_, i) => i !== idx),
    }));
  };

  const saveNote = async () => {
    const isPitch = isPitchCategory(noteDraft.category);
    const hasContent = noteDraft.content.trim().length > 0;
    const hasPitches = isPitch && (noteDraft.pitches || []).some(p => p.pitch_type || p.location || p.result || p.notes);
    if (!hasContent && !hasPitches) return;
    setSavingNote(true);
    try {
      const payload = {
        category: noteDraft.category,
        content: noteDraft.content.trim(),
        context: isPitch ? (noteDraft.context || null) : null,
        pitches: isPitch
          ? (noteDraft.pitches || []).filter(p => p.pitch_type || p.location || p.result || p.notes)
          : null,
      };
      if (editingNoteId === 'new') {
        const { error } = await supabase
          .from('player_notes')
          .insert({
            player_id: userId,
            created_by: loggedInUserId,
            ...payload,
          });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('player_notes')
          .update({ ...payload, updated_at: new Date().toISOString() })
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

  const fetchPtVisits = async () => {
    try {
      const { data, error } = await supabase
        .from('pt_visits')
        .select('*, author:created_by(full_name)')
        .eq('player_id', userId)
        .order('visit_date', { ascending: false });
      if (error) throw error;
      setPtVisits(data || []);
    } catch (error) {
      console.error('Error fetching PT visits:', error);
    }
  };

  const fetchCommunicationLogs = async () => {
    setLoadingComms(true);
    try {
      const { data, error } = await supabase
        .from('communication_logs')
        .select('*, sender:sent_by(full_name)')
        .eq('player_id', userId)
        .order('sent_at', { ascending: false });
      if (error) throw error;
      setCommunicationLogs(data || []);
    } catch (error) {
      console.error('Error fetching communication logs:', error);
    } finally {
      setLoadingComms(false);
    }
  };

  const fetchCoachAthletes = async () => {
    try {
      // Get the coach's teams
      const { data: teamRows } = await supabase
        .from('team_members')
        .select('team_id, teams(name)')
        .eq('user_id', userId);
      const teamIds = (teamRows || []).map(r => r.team_id);
      if (teamIds.length === 0) { setCoachAthletes([]); return; }

      // Get all player members of those teams
      const { data: members } = await supabase
        .from('team_members')
        .select('team_id, user_id, users(full_name, email, avatar_url, role), teams(name)')
        .in('team_id', teamIds)
        .neq('user_id', userId);

      // Also get athletes explicitly assigned via trainer_id
      const { data: assigned } = await supabase
        .from('player_profiles')
        .select('user_id, users!player_profiles_user_id_fkey(full_name, email, avatar_url)')
        .eq('trainer_id', userId);

      // Merge: group by team, only include players
      const teamMap = {};
      for (const tm of (teamRows || [])) {
        teamMap[tm.team_id] = { name: tm.teams?.name || 'Unknown Team', members: [] };
      }
      const seen = new Set();
      for (const m of (members || [])) {
        if (m.users?.role !== 'player') continue;
        if (seen.has(m.user_id)) continue;
        seen.add(m.user_id);
        if (teamMap[m.team_id]) {
          teamMap[m.team_id].members.push({ id: m.user_id, full_name: m.users.full_name, email: m.users.email, avatar_url: m.users.avatar_url });
        }
      }

      // Add directly assigned athletes that aren't already in a team
      const directAssigned = [];
      for (const a of (assigned || [])) {
        if (!seen.has(a.user_id)) {
          directAssigned.push({ id: a.user_id, full_name: a.users?.full_name, email: a.users?.email, avatar_url: a.users?.avatar_url });
          seen.add(a.user_id);
        }
      }

      const result = Object.entries(teamMap).map(([id, t]) => ({ teamId: id, teamName: t.name, members: t.members })).filter(t => t.members.length > 0);
      if (directAssigned.length > 0) {
        result.push({ teamId: 'direct', teamName: 'Directly Assigned', members: directAssigned });
      }
      setCoachAthletes(result);
    } catch (error) {
      console.error('Error fetching coach athletes:', error);
    }
  };

  const fetchScheduleEvents = async (refDate) => {
    try {
      const d = refDate || scheduleDate;
      const year = d.getFullYear();
      const month = d.getMonth();
      const start = new Date(year, month, 1).toISOString().split('T')[0];
      const end = new Date(year, month + 1, 0).toISOString().split('T')[0];
      const { data: teamRows } = await supabase
        .from('team_members')
        .select('team_id')
        .eq('user_id', userId);
      const teamIds = (teamRows || []).map(r => r.team_id);
      const playerQuery = supabase
        .from('schedule_events')
        .select('*')
        .eq('player_id', userId)
        .gte('event_date', start)
        .lte('event_date', end);
      const teamQuery = teamIds.length > 0
        ? supabase
            .from('schedule_events')
            .select('*')
            .overlaps('team_ids', teamIds)
            .gte('event_date', start)
            .lte('event_date', end)
        : Promise.resolve({ data: [] });
      const [playerRes, teamRes] = await Promise.all([playerQuery, teamQuery]);
      const merged = [...(playerRes.data || []), ...(teamRes.data || [])];
      const dedup = Array.from(new Map(merged.map(e => [e.id, e])).values())
        .sort((a, b) => (a.event_date || '').localeCompare(b.event_date || ''));
      setScheduleEvents(dedup);
    } catch (error) {
      console.error('Error fetching schedule events:', error);
    }
  };

  const fetchProgrammingData = async () => {
    setProgrammingData(prev => ({ ...prev, loading: true }));
    try {
      const { data: teamRows } = await supabase
        .from('team_members')
        .select('team_id')
        .eq('user_id', userId);
      const teamIds = (teamRows || []).map(r => r.team_id);

      const programPlayerQ = supabase
        .from('training_program_assignments')
        .select('id, program_id, team_id, start_date, end_date, created_at, training_programs(id, name, description, duration_weeks)')
        .eq('player_id', userId);
      const programTeamQ = teamIds.length > 0
        ? supabase
            .from('training_program_assignments')
            .select('id, program_id, team_id, start_date, end_date, created_at, training_programs(id, name, description, duration_weeks)')
            .in('team_id', teamIds)
        : Promise.resolve({ data: [] });

      const mealPlayerQ = supabase
        .from('meal_plan_assignments')
        .select('id, meal_plan_id, team_id, start_date, end_date, created_at, meal_plans(id, name, description)')
        .eq('player_id', userId);
      const mealTeamQ = teamIds.length > 0
        ? supabase
            .from('meal_plan_assignments')
            .select('id, meal_plan_id, team_id, start_date, end_date, created_at, meal_plans(id, name, description)')
            .in('team_id', teamIds)
        : Promise.resolve({ data: [] });

      const assessmentsQ = supabase
        .from('assessment_submissions')
        .select('id, template_id, assessment_date, notes, created_at, assessment_templates(id, name, short_name)')
        .eq('player_id', userId)
        .order('assessment_date', { ascending: false })
        .limit(10);

      const [pPlayer, pTeam, mPlayer, mTeam, aRes] = await Promise.all([
        programPlayerQ, programTeamQ, mealPlayerQ, mealTeamQ, assessmentsQ,
      ]);

      const programs = Array.from(new Map(
        [...(pPlayer.data || []), ...(pTeam.data || [])].map(r => [r.id, r])
      ).values()).sort((a, b) => (b.start_date || '').localeCompare(a.start_date || ''));

      const mealPlans = Array.from(new Map(
        [...(mPlayer.data || []), ...(mTeam.data || [])].map(r => [r.id, r])
      ).values()).sort((a, b) => (b.start_date || '').localeCompare(a.start_date || ''));

      setProgrammingData({ programs, mealPlans, assessments: aRes.data || [], loading: false });
    } catch (error) {
      console.error('Error fetching programming data:', error);
      setProgrammingData(prev => ({ ...prev, loading: false }));
    }
  };

  useEffect(() => {
    if (activeProfileTab === 'schedule') fetchScheduleEvents();
    if (activeProfileTab === 'programming') fetchProgrammingData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfileTab, scheduleDate, userId]);

  const parseExerciseNotesProfile = (notes) => {
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
        // Legacy format: Name - 3 sets x 10 reps (link)
        const name = line.replace(/ - \d.*$/, '').replace(/ \(https?:.*$/, '').trim();
        let sets = '', reps = '', link = '';
        const srMatch = line.match(/(\d+)\s*sets?\s*x\s*(\d+)\s*reps?/i);
        if (srMatch) { sets = srMatch[1]; reps = srMatch[2]; }
        const linkMatch = line.match(/\((https?:\/\/[^\s)]+)\)/);
        if (linkMatch) link = linkMatch[1];
        return { name, sets, reps, rest: '', load: '', link };
      }
    }).filter(e => e.name);
    return { general, exercises };
  };

  const startNewPtVisit = () => {
    setEditingPtVisitId('new');
    const today = new Date().toISOString().split('T')[0];
    setPtDraft({ visit_date: today, visit_type: 'Treatment', body_area: '', pain_level: '', content: '', exercises: [], follow_up_at: '' });
  };

  const startEditPtVisit = (visit) => {
    setEditingPtVisitId(visit.id);
    setPtDraft({
      visit_date: visit.visit_date || '',
      visit_type: visit.visit_type || 'Treatment',
      body_area: visit.body_area || '',
      pain_level: visit.pain_level == null ? '' : String(visit.pain_level),
      content: visit.content || '',
      exercises: Array.isArray(visit.exercises) ? visit.exercises : [],
      follow_up_at: visit.follow_up_at || '',
    });
  };

  const cancelEditPtVisit = () => {
    setEditingPtVisitId(null);
    setPtDraft({ visit_date: '', visit_type: 'Treatment', body_area: '', pain_level: '', content: '', exercises: [], follow_up_at: '' });
  };

  const updatePtExercise = (idx, field, value) => {
    setPtDraft(prev => ({
      ...prev,
      exercises: (prev.exercises || []).map((ex, i) => i === idx ? { ...ex, [field]: value } : ex),
    }));
  };

  const addPtExercise = () => {
    setPtDraft(prev => ({
      ...prev,
      exercises: [...(prev.exercises || []), { name: '', sets: '', reps: '', notes: '' }],
    }));
  };

  const removePtExercise = (idx) => {
    setPtDraft(prev => ({
      ...prev,
      exercises: (prev.exercises || []).filter((_, i) => i !== idx),
    }));
  };

  const savePtVisit = async () => {
    if (!ptDraft.visit_date) return;
    setSavingPtVisit(true);
    try {
      const exercises = (ptDraft.exercises || []).filter(ex => ex.name || ex.sets || ex.reps || ex.notes);
      const payload = {
        visit_date: ptDraft.visit_date,
        visit_type: ptDraft.visit_type || null,
        body_area: ptDraft.body_area || null,
        pain_level: ptDraft.pain_level === '' ? null : Math.max(0, Math.min(10, parseInt(ptDraft.pain_level, 10) || 0)),
        content: ptDraft.content || null,
        exercises: exercises.length > 0 ? exercises : null,
        follow_up_at: ptDraft.follow_up_at || null,
      };
      if (editingPtVisitId === 'new') {
        const { error } = await supabase.from('pt_visits').insert({
          ...payload,
          player_id: userId,
          created_by: loggedInUserId,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('pt_visits')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', editingPtVisitId);
        if (error) throw error;
      }
      await fetchPtVisits();
      cancelEditPtVisit();
    } catch (error) {
      console.error('Error saving PT visit:', error);
      alert('Error saving PT visit: ' + error.message);
    } finally {
      setSavingPtVisit(false);
    }
  };

  const deletePtVisit = async (id) => {
    if (!window.confirm('Delete this PT visit?')) return;
    try {
      const { error } = await supabase.from('pt_visits').delete().eq('id', id);
      if (error) throw error;
      await fetchPtVisits();
    } catch (error) {
      alert('Error deleting visit: ' + error.message);
    }
  };

  const updatePtStatus = async (newStatus) => {
    if (!userData?._profile?.id) return;
    const { error } = await supabase
      .from('player_profiles')
      .update({ pt_status: newStatus || null })
      .eq('id', userData._profile.id);
    if (error) {
      alert('Could not update PT status: ' + error.message);
      return;
    }
    setUserData(prev => ({ ...prev, _profile: { ...prev._profile, pt_status: newStatus || null } }));
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
          .select('id, event_type, event_date, opponent, title, team_id, team_ids')
          .overlaps('team_ids', teamIds)
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

  const fetchContractData = async () => {
    try {
      const { data, error } = await supabase
        .from('player_contracts')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      setContractData(data);
    } catch (error) {
      console.error('Error fetching contract data:', error);
    }
  };

  const fetchLoiData = async () => {
    try {
      const { data, error } = await supabase
        .from('player_letters_of_intent')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      setLoiData(data);
    } catch (error) {
      console.error('Error fetching LOI data:', error);
    }
  };

  const fetchAssessmentData = async () => {
    try {
      // Fetch assessment templates visible to athlete
      const { data: templates } = await supabase
        .from('assessment_templates')
        .select('*')
        .eq('status', 'active')
        .eq('show_to_athlete', true)
        .order('name');
      setAssessmentTemplates(templates || []);

      // Fetch completed submissions for this player
      const { data: subs } = await supabase
        .from('assessment_submissions')
        .select('*, assessment_templates(name, schema), assessor:users!assessment_submissions_assessed_by_fkey(full_name)')
        .eq('player_id', userId)
        .order('created_at', { ascending: false });
      setAssessmentSubmissions(subs || []);

      // Fetch medical history status
      const { data: mh } = await supabase
        .from('medical_history')
        .select('id, signed_at')
        .eq('user_id', userId)
        .maybeSingle();
      setMedicalHistory(mh);
    } catch (error) {
      console.error('Error fetching assessment data:', error);
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
        <p className="text-gray-600 mb-4">Unable to load profile data. This may be caused by an expired session.</p>
        <div className="flex items-center justify-center space-x-3">
          <button
            onClick={() => { setLoading(true); fetchUserData(); }}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 transition"
          >
            Retry
          </button>
          <button
            onClick={async () => { await supabase.auth.signOut(); window.location.reload(); }}
            className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-50 transition"
          >
            Log Out &amp; Re-Login
          </button>
        </div>
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
        <div className="flex items-center space-x-2">
          {onBack && userData.email && (userRole === 'admin' || userRole === 'coach') && (
            <button
              onClick={() => setShowEmailCompose(true)}
              className="bg-green-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-700 transition flex items-center space-x-2"
            >
              <Mail size={18} />
              <span>Email Player</span>
            </button>
          )}
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
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-500">
                {profile?.sport && <span>Sport: <span className="text-gray-700 font-medium">{profile.sport}</span></span>}
                {trainerName && <span>Trainer: <span className="text-gray-700 font-medium">{trainerName}</span></span>}
                {userData.date_of_birth && (() => {
                  const age = Math.floor((new Date() - new Date(userData.date_of_birth + 'T00:00:00')) / (365.25 * 24 * 60 * 60 * 1000));
                  return <span>Age: <span className="text-gray-700 font-medium">{age}</span></span>;
                })()}
                {userData.created_at && <span>Member since: <span className="text-gray-700 font-medium">{new Date(userData.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span></span>}
              </div>
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
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-3">Sport</p>
                  <div className="border-t border-gray-200 pt-3">
                    <input
                      type="text"
                      value={sportInput}
                      onChange={(e) => setSportInput(e.target.value)}
                      onBlur={() => { if (sportInput !== (profile.sport || '')) handleDropdownChange('sport', sportInput); }}
                      disabled={!canEditProfile}
                      placeholder="e.g., Baseball"
                      className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white ${!canEditProfile ? 'opacity-75 cursor-not-allowed' : ''}`}
                    />
                  </div>
                </div>
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
                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-3">Trainer</p>
                  <div className="border-t border-gray-200 pt-3">
                    <select
                      value={profile.trainer_id || ''}
                      onChange={(e) => handleDropdownChange('trainer_id', e.target.value)}
                      disabled={!canEditProfile}
                      className={`w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white ${!canEditProfile ? 'opacity-75 cursor-not-allowed' : ''}`}
                    >
                      <option value="">No Trainer</option>
                      {allCoaches.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab Bar */}
          <div className="border-b border-gray-200 mb-6 -mx-2 px-2 overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
            <nav className="flex md:flex-wrap gap-1 pb-2 min-w-0">
              {PROFILE_TABS.filter(tab => {
                if (tab.roles && !tab.roles.includes(userRole)) return false;
                if (tab.viewedRoles && (!userData || !tab.viewedRoles.includes(userData.role))) return false;
                return true;
              }).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveProfileTab(tab.key)}
                  className={`py-2 px-3 rounded-lg font-medium text-xs text-center transition whitespace-nowrap ${
                    activeProfileTab === tab.key
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-gray-50 text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {activeProfileTab !== 'general' && activeProfileTab !== 'athletes' && activeProfileTab !== 'recruitment' && activeProfileTab !== 'codes' && activeProfileTab !== 'documents' && activeProfileTab !== 'armcare' && activeProfileTab !== 'goals' && activeProfileTab !== 'notes' && activeProfileTab !== 'attendance' && activeProfileTab !== 'assessment' && activeProfileTab !== 'pt' && activeProfileTab !== 'schedule' && activeProfileTab !== 'programming' && activeProfileTab !== 'communication' && activeProfileTab !== 'whoop' && (
            <div className="py-12 text-center">
              <p className="text-gray-500 text-lg">Coming Soon</p>
            </div>
          )}

          {activeProfileTab === 'athletes' && (
            <div className="space-y-6">
              {coachAthletes.length === 0 ? (
                <div className="py-12 text-center">
                  <Users className="mx-auto mb-3 text-gray-300" size={48} />
                  <p className="text-gray-500">No athletes assigned yet.</p>
                  <p className="text-gray-400 text-sm mt-1">Athletes will appear here once team assignments or trainer assignments are made.</p>
                </div>
              ) : (
                coachAthletes.map(team => (
                  <div key={team.teamId} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                      <h3 className="font-semibold text-gray-900">{team.teamName}</h3>
                      <p className="text-xs text-gray-500">{team.members.length} athlete{team.members.length !== 1 ? 's' : ''}</p>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {team.members.map(athlete => (
                        <div key={athlete.id} className="px-4 py-3 flex items-center space-x-3 hover:bg-gray-50">
                          {athlete.avatar_url ? (
                            <img src={athlete.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                          ) : (
                            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 text-xs font-bold">
                              {athlete.full_name?.charAt(0) || '?'}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{athlete.full_name}</p>
                            {athlete.email && <p className="text-xs text-gray-500 truncate">{athlete.email}</p>}
                          </div>
                          {onNavigateToProfile && (
                            <button
                              onClick={() => onNavigateToProfile(athlete.id)}
                              className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                            >
                              View Profile
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeProfileTab === 'whoop' && (
            <WhoopTab userId={userId} userRole={userRole} />
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

          {activeProfileTab === 'assessment' && (
            <div className="space-y-6">
              {/* Assessment Templates */}
              {assessmentTemplates.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center space-x-2">
                    <ClipboardList size={16} className="text-gray-400" />
                    <span>Available Assessments</span>
                  </h4>
                  <div className="space-y-2">
                    {assessmentTemplates.map(template => {
                      const completedCount = assessmentSubmissions.filter(s => s.template_id === template.id).length;
                      const latestSub = assessmentSubmissions.find(s => s.template_id === template.id);
                      const canSubmit = userRole === 'admin' || userRole === 'coach';
                      return (
                        <div key={template.id} className="border border-gray-200 rounded-lg overflow-hidden">
                          <div className="flex items-center justify-between px-4 py-3">
                            <div className="flex items-center space-x-3">
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${completedCount > 0 ? 'bg-blue-100' : 'bg-gray-100'}`}>
                                <ClipboardList size={16} className={completedCount > 0 ? 'text-blue-600' : 'text-gray-400'} />
                              </div>
                              <div>
                                <p className="text-sm font-medium text-gray-900">{template.name}</p>
                                <p className="text-xs text-gray-500">
                                  {completedCount > 0 ? `${completedCount} completed submission${completedCount !== 1 ? 's' : ''}` : 'No submissions yet'}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center space-x-2">
                              {canSubmit && (
                                <button
                                  onClick={() => setAssessmentFormTemplate(template)}
                                  className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center space-x-1"
                                >
                                  <Plus size={14} />
                                  <span>Submit</span>
                                </button>
                              )}
                              {latestSub && (
                                <button
                                  onClick={() => setExpandedSubmission(expandedSubmission === latestSub.id ? null : latestSub.id)}
                                  className="text-sm text-gray-500 hover:text-gray-700 font-medium flex items-center space-x-1"
                                >
                                  <Eye size={14} />
                                  <span>View Latest</span>
                                </button>
                              )}
                            </div>
                          </div>
                          {latestSub && expandedSubmission === latestSub.id && (
                            <div className="border-t border-gray-200 p-4 bg-gray-50">
                              <div className="text-xs text-gray-500 mb-3">
                                {latestSub.assessment_date} &middot; Assessed by {latestSub.assessor?.full_name || 'Unknown'}
                              </div>
                              <SubmissionView submission={latestSub} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* All Completed Submissions */}
              {assessmentSubmissions.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center space-x-2">
                    <CheckCircle size={16} className="text-gray-400" />
                    <span>Completed Assessments ({assessmentSubmissions.length})</span>
                  </h4>
                  <div className="space-y-2">
                    {assessmentSubmissions.map(sub => (
                      <div key={sub.id} className="border border-gray-200 rounded-lg overflow-hidden">
                        <button
                          onClick={() => setExpandedSubmission(expandedSubmission === sub.id ? null : sub.id)}
                          className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition text-left"
                        >
                          <div className="flex items-center space-x-3">
                            <CheckCircle size={16} className="text-green-500" />
                            <div>
                              <p className="text-sm font-medium text-gray-900">{sub.assessment_templates?.name || 'Assessment'}</p>
                              <p className="text-xs text-gray-500">
                                {sub.assessment_date} &middot; Assessed by {sub.assessor?.full_name || 'Unknown'}
                              </p>
                            </div>
                          </div>
                          {expandedSubmission === sub.id ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                        </button>
                        {expandedSubmission === sub.id && (
                          <div className="border-t border-gray-200 p-4 bg-gray-50">
                            <SubmissionView submission={sub} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {assessmentTemplates.length === 0 && assessmentSubmissions.length === 0 && (
                <div className="text-center py-8">
                  <ClipboardList size={40} className="mx-auto mb-3 text-gray-300" />
                  <p className="text-gray-500">No assessments available yet.</p>
                </div>
              )}
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
                  <NoteEditor
                    draft={noteDraft}
                    setDraft={setNoteDraft}
                    addPitch={addDraftPitch}
                    updatePitch={updateDraftPitch}
                    removePitch={removeDraftPitch}
                  />
                  <div className="flex justify-end space-x-2 mt-3">
                    <button onClick={cancelEditNote} className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition text-sm">Cancel</button>
                    <button onClick={saveNote} disabled={savingNote} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 text-sm">
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
                            <NoteEditor
                              draft={noteDraft}
                              setDraft={setNoteDraft}
                              addPitch={addDraftPitch}
                              updatePitch={updateDraftPitch}
                              removePitch={removeDraftPitch}
                            />
                            <div className="flex justify-end space-x-2 mt-3">
                              <button onClick={cancelEditNote} className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition text-sm">Cancel</button>
                              <button onClick={saveNote} disabled={savingNote} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 text-sm">
                                {savingNote ? 'Saving...' : 'Save'}
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center space-x-2 flex-wrap">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${catInfo.color}`}>{catInfo.label}</span>
                                {note.context && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 capitalize">{note.context}</span>}
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
                            {note.content && <p className="text-sm text-gray-800 whitespace-pre-wrap">{note.content}</p>}
                            {Array.isArray(note.pitches) && note.pitches.length > 0 && (
                              <div className="mt-2 overflow-x-auto">
                                <table className="w-full text-xs border-collapse">
                                  <thead className="bg-gray-50">
                                    <tr>
                                      <th className="text-left px-2 py-1 font-semibold text-gray-600 uppercase tracking-wide w-8">#</th>
                                      <th className="text-left px-2 py-1 font-semibold text-gray-600 uppercase tracking-wide">Pitch</th>
                                      <th className="text-left px-2 py-1 font-semibold text-gray-600 uppercase tracking-wide">Location</th>
                                      <th className="text-left px-2 py-1 font-semibold text-gray-600 uppercase tracking-wide">Result</th>
                                      <th className="text-left px-2 py-1 font-semibold text-gray-600 uppercase tracking-wide">Notes</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {note.pitches.map((p, i) => (
                                      <tr key={i} className="border-t border-gray-100">
                                        <td className="px-2 py-1 text-gray-500">{i + 1}</td>
                                        <td className="px-2 py-1 text-gray-900">{p.pitch_type || '—'}</td>
                                        <td className="px-2 py-1 text-gray-700">{p.location || '—'}</td>
                                        <td className="px-2 py-1 text-gray-700">{p.result || '—'}</td>
                                        <td className="px-2 py-1 text-gray-600">{p.notes || ''}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
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

          {activeProfileTab === 'pt' && (
            <div className="space-y-6">
              {/* PT Status */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center space-x-3">
                    <h4 className="text-sm font-semibold text-gray-700">PT Status:</h4>
                    {userData?._profile?.pt_status ? (
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${PT_STATUS_COLORS[userData._profile.pt_status] || 'bg-gray-100 text-gray-700'}`}>
                        {userData._profile.pt_status}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-500 italic">Not set</span>
                    )}
                  </div>
                  {(userRole === 'admin' || userRole === 'coach') && (
                    <select
                      value={userData?._profile?.pt_status || ''}
                      onChange={(e) => updatePtStatus(e.target.value)}
                      className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      <option value="">Not set</option>
                      {PT_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Powered by NBP × LW Physical Therapy. Logging visits helps track development, recovery, and onboarding history.
                </p>
              </div>

              {/* Add Visit Button */}
              {(userRole === 'admin' || userRole === 'coach') && editingPtVisitId !== 'new' && (
                <div className="flex justify-between items-center">
                  <h4 className="text-sm font-semibold text-gray-700">Visit Log ({ptVisits.length})</h4>
                  <button
                    onClick={startNewPtVisit}
                    className="bg-blue-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-blue-700 transition flex items-center space-x-1 text-sm"
                  >
                    <Plus size={14} />
                    <span>Add Visit</span>
                  </button>
                </div>
              )}

              {/* New Visit Form */}
              {editingPtVisitId === 'new' && (
                <div className="border border-blue-300 rounded-lg p-4 bg-blue-50">
                  <PtVisitEditor
                    draft={ptDraft}
                    setDraft={setPtDraft}
                    addExercise={addPtExercise}
                    updateExercise={updatePtExercise}
                    removeExercise={removePtExercise}
                  />
                  <div className="flex justify-end space-x-2 mt-3">
                    <button onClick={cancelEditPtVisit} className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition text-sm">Cancel</button>
                    <button onClick={savePtVisit} disabled={savingPtVisit} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 text-sm">
                      {savingPtVisit ? 'Saving...' : 'Save Visit'}
                    </button>
                  </div>
                </div>
              )}

              {/* Visit List */}
              {ptVisits.length === 0 && editingPtVisitId !== 'new' && (
                <div className="text-center py-10 text-gray-500">
                  <p className="text-sm">No PT visits logged yet.</p>
                </div>
              )}
              <div className="space-y-3">
                {ptVisits.map(v => {
                  const canModify = (userRole === 'admin' || userRole === 'coach');
                  return (
                    <div key={v.id} className="border border-gray-200 rounded-lg p-4">
                      {editingPtVisitId === v.id ? (
                        <>
                          <PtVisitEditor
                            draft={ptDraft}
                            setDraft={setPtDraft}
                            addExercise={addPtExercise}
                            updateExercise={updatePtExercise}
                            removeExercise={removePtExercise}
                          />
                          <div className="flex justify-end space-x-2 mt-3">
                            <button onClick={cancelEditPtVisit} className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition text-sm">Cancel</button>
                            <button onClick={savePtVisit} disabled={savingPtVisit} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 text-sm">
                              {savingPtVisit ? 'Saving...' : 'Save'}
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex items-start justify-between mb-2 flex-wrap gap-2">
                            <div className="flex items-center space-x-2 flex-wrap">
                              <span className="text-sm font-semibold text-gray-900">
                                {v.visit_date ? new Date(v.visit_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                              </span>
                              {v.visit_type && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">{v.visit_type}</span>}
                              {v.body_area && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">{v.body_area}</span>}
                              {v.pain_level != null && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Pain {v.pain_level}/10</span>}
                              <span className="text-xs text-gray-500">{v.author?.full_name || 'Unknown'}</span>
                            </div>
                            {canModify && (
                              <div className="flex items-center space-x-1">
                                <button onClick={() => startEditPtVisit(v)} className="text-gray-400 hover:text-blue-600 transition" title="Edit">
                                  <Edit2 size={14} />
                                </button>
                                <button onClick={() => deletePtVisit(v.id)} className="text-gray-400 hover:text-red-600 transition" title="Delete">
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            )}
                          </div>
                          {v.content && <p className="text-sm text-gray-800 whitespace-pre-wrap">{v.content}</p>}
                          {Array.isArray(v.exercises) && v.exercises.length > 0 && (
                            <div className="mt-2 overflow-x-auto">
                              <table className="w-full text-xs border-collapse">
                                <thead className="bg-gray-50">
                                  <tr>
                                    <th className="text-left px-2 py-1 font-semibold text-gray-600 uppercase tracking-wide">Exercise</th>
                                    <th className="text-left px-2 py-1 font-semibold text-gray-600 uppercase tracking-wide w-20">Sets</th>
                                    <th className="text-left px-2 py-1 font-semibold text-gray-600 uppercase tracking-wide w-20">Reps</th>
                                    <th className="text-left px-2 py-1 font-semibold text-gray-600 uppercase tracking-wide">Notes</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {v.exercises.map((ex, i) => (
                                    <tr key={i} className="border-t border-gray-100">
                                      <td className="px-2 py-1 text-gray-900">{ex.name || '—'}</td>
                                      <td className="px-2 py-1 text-gray-700">{ex.sets || '—'}</td>
                                      <td className="px-2 py-1 text-gray-700">{ex.reps || '—'}</td>
                                      <td className="px-2 py-1 text-gray-600">{ex.notes || ''}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                          {v.follow_up_at && (
                            <p className="text-xs text-blue-700 mt-2">
                              Follow-up: {new Date(v.follow_up_at + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </p>
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
              <div className="flex flex-wrap gap-1.5 mb-6">
                {['Starter', 'Reliever', 'Closer', 'Infielder', 'Outfielder', 'Catching', 'Hitting'].map(type => (
                  <button
                    key={type}
                    onClick={() => addArmCareRoutine(type)}
                    className="bg-blue-600 text-white px-2.5 py-1 rounded-md font-medium hover:bg-blue-700 transition flex items-center space-x-1 text-xs"
                  >
                    <Plus size={12} />
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

          {activeProfileTab === 'documents' && (
            <div className="space-y-4">
              {/* Waiver */}
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedSubmission(expandedSubmission === 'doc-waiver' ? null : 'doc-waiver')}
                  className="w-full flex items-center justify-between px-4 py-4 hover:bg-gray-50 transition text-left"
                >
                  <div className="flex items-center space-x-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${waiverData ? 'bg-green-100' : 'bg-gray-100'}`}>
                      <FileText size={20} className={waiverData ? 'text-green-600' : 'text-gray-400'} />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900">Waiver</h4>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {waiverData ? (
                          <span className="text-green-600 font-medium">
                            Signed on {new Date(waiverData.signed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                        ) : 'Not yet signed'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {waiverData ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Complete</span> : <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Incomplete</span>}
                    {expandedSubmission === 'doc-waiver' ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
                  </div>
                </button>
                {expandedSubmission === 'doc-waiver' && (
                  <div className="border-t border-gray-200 p-4">
                    {waiverData ? (
                      <div className="space-y-4">
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
                          <div className="border-t border-gray-200 pt-4">
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
                      <div className="text-center py-4">
                        <p className="text-sm text-gray-500">Waiver not yet signed.</p>
                        {!onBack && <p className="text-xs text-gray-400 mt-1">Go to the Waiver page from the sidebar to sign.</p>}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Player Contract */}
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedSubmission(expandedSubmission === 'doc-contract' ? null : 'doc-contract')}
                  className="w-full flex items-center justify-between px-4 py-4 hover:bg-gray-50 transition text-left"
                >
                  <div className="flex items-center space-x-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${contractData ? 'bg-green-100' : 'bg-gray-100'}`}>
                      <FileText size={20} className={contractData ? 'text-green-600' : 'text-gray-400'} />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900">Player Contract</h4>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {contractData ? (
                          <span className="text-green-600 font-medium">
                            Signed on {new Date(contractData.signed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                        ) : 'Not yet signed'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {contractData ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Complete</span> : <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Incomplete</span>}
                    {expandedSubmission === 'doc-contract' ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
                  </div>
                </button>
                {expandedSubmission === 'doc-contract' && (
                  <div className="border-t border-gray-200 p-4">
                    {contractData ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div>
                            <p className="text-sm text-gray-600">Player Name</p>
                            <p className="text-gray-900 font-medium">{contractData.player_name}</p>
                          </div>
                          {contractData.positions?.length > 0 && (
                            <div>
                              <p className="text-sm text-gray-600">Positions</p>
                              <p className="text-gray-900 font-medium">{contractData.positions.join(', ')}</p>
                            </div>
                          )}
                          {contractData.bats_throws && (
                            <div>
                              <p className="text-sm text-gray-600">Bats/Throws</p>
                              <p className="text-gray-900 font-medium">{contractData.bats_throws}</p>
                            </div>
                          )}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <p className="text-sm text-gray-600 mb-1">Player Signature</p>
                            <img src={contractData.player_signature_url} alt="Player Signature" className="border border-gray-200 rounded bg-white max-h-20" />
                          </div>
                          <div>
                            <p className="text-sm text-gray-600 mb-1">Parent Signature</p>
                            <img src={contractData.parent_signature_url} alt="Parent Signature" className="border border-gray-200 rounded bg-white max-h-20" />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-4">
                        <p className="text-sm text-gray-500">Contract not yet signed.</p>
                        {!onBack && <p className="text-xs text-gray-400 mt-1">Go to the Player Contract page from the sidebar to sign.</p>}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Letter of Intent */}
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedSubmission(expandedSubmission === 'doc-loi' ? null : 'doc-loi')}
                  className="w-full flex items-center justify-between px-4 py-4 hover:bg-gray-50 transition text-left"
                >
                  <div className="flex items-center space-x-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${loiData ? 'bg-green-100' : 'bg-gray-100'}`}>
                      <FileText size={20} className={loiData ? 'text-green-600' : 'text-gray-400'} />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900">Letter of Intent</h4>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {loiData ? (
                          <span className="text-green-600 font-medium">
                            Signed on {new Date(loiData.signed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                        ) : 'Not yet signed'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {loiData ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Complete</span> : <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Incomplete</span>}
                    {expandedSubmission === 'doc-loi' ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
                  </div>
                </button>
                {expandedSubmission === 'doc-loi' && (
                  <div className="border-t border-gray-200 p-4">
                    {loiData ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div>
                            <p className="text-sm text-gray-600">Player Name</p>
                            <p className="text-gray-900 font-medium">{loiData.player_name}</p>
                          </div>
                          {loiData.positions?.length > 0 && (
                            <div>
                              <p className="text-sm text-gray-600">Positions</p>
                              <p className="text-gray-900 font-medium">{loiData.positions.join(', ')}</p>
                            </div>
                          )}
                          {loiData.grad_year && (
                            <div>
                              <p className="text-sm text-gray-600">Grad Year</p>
                              <p className="text-gray-900 font-medium">{loiData.grad_year}</p>
                            </div>
                          )}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <p className="text-sm text-gray-600 mb-1">Player Signature</p>
                            <img src={loiData.player_signature_url} alt="Player Signature" className="border border-gray-200 rounded bg-white max-h-20" />
                          </div>
                          <div>
                            <p className="text-sm text-gray-600 mb-1">Parent Signature</p>
                            <img src={loiData.parent_signature_url} alt="Parent Signature" className="border border-gray-200 rounded bg-white max-h-20" />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-4">
                        <p className="text-sm text-gray-500">Letter of Intent not yet signed.</p>
                        {!onBack && <p className="text-xs text-gray-400 mt-1">Go to the Letter of Intent page from the sidebar to sign.</p>}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Medical History */}
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => setShowMedicalForm(!showMedicalForm)}
                  className="w-full flex items-center justify-between px-4 py-4 hover:bg-gray-50 transition text-left"
                >
                  <div className="flex items-center space-x-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${medicalHistory ? 'bg-green-100' : 'bg-gray-100'}`}>
                      <FileText size={20} className={medicalHistory ? 'text-green-600' : 'text-gray-400'} />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900">Medical History / Athlete Intake Form</h4>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {medicalHistory ? (
                          <span className="text-green-600 font-medium">
                            Completed {medicalHistory.signed_at ? `on ${new Date(medicalHistory.signed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
                          </span>
                        ) : 'Not yet completed'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {medicalHistory ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Complete</span> : <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Incomplete</span>}
                    {showMedicalForm ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
                  </div>
                </button>
                {showMedicalForm && (
                  <div className="border-t border-gray-200 p-4">
                    <MedicalHistoryForm userId={userId} userRole={userRole} />
                  </div>
                )}
              </div>
            </div>
          )}

          {activeProfileTab === 'schedule' && (() => {
            const year = scheduleDate.getFullYear();
            const month = scheduleDate.getMonth();
            const firstDay = new Date(year, month, 1).getDay();
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const calendarCells = [];
            for (let i = 0; i < firstDay; i++) calendarCells.push(null);
            for (let d = 1; d <= daysInMonth; d++) calendarCells.push(d);
            const eventsByDay = {};
            scheduleEvents.forEach(ev => {
              const day = parseInt(ev.event_date?.split('-')[2], 10);
              if (!eventsByDay[day]) eventsByDay[day] = [];
              eventsByDay[day].push(ev);
            });
            const dotColor = (type) => {
              switch (type) {
                case 'workout': return 'bg-orange-400';
                case 'game': return 'bg-slate-500';
                case 'practice': return 'bg-green-400';
                case 'meal': return 'bg-yellow-400';
                default: return 'bg-blue-400';
              }
            };
            const today = new Date();
            const isToday = (d) => d && today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;

            return (
              <div className="space-y-4">
                {/* Month Navigation */}
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => { const nd = new Date(year, month - 1, 1); setScheduleDate(nd); setScheduleSelectedDay(null); }}
                    className="p-1 rounded hover:bg-gray-100"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <h4 className="text-lg font-semibold text-gray-900">
                    {scheduleDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  </h4>
                  <div className="flex items-center space-x-2">
                    {canEditProfile && (
                      <button
                        onClick={() => setShowAddWorkout(true)}
                        className="flex items-center space-x-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 transition"
                      >
                        <Plus size={14} />
                        <span>Assign Workout</span>
                      </button>
                    )}
                    <button
                      onClick={() => { const nd = new Date(year, month + 1, 1); setScheduleDate(nd); setScheduleSelectedDay(null); }}
                      className="p-1 rounded hover:bg-gray-100"
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                </div>

                {/* Calendar Grid */}
                <div className="grid grid-cols-7 gap-px bg-gray-200 rounded-lg overflow-hidden border border-gray-200">
                  {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
                    <div key={d} className="bg-gray-50 text-center text-xs font-semibold text-gray-500 py-2">{d}</div>
                  ))}
                  {calendarCells.map((day, i) => {
                    const dayEvents = day ? (eventsByDay[day] || []) : [];
                    const selected = scheduleSelectedDay === day;
                    return (
                      <div
                        key={i}
                        onClick={() => day && setScheduleSelectedDay(day === scheduleSelectedDay ? null : day)}
                        className={`bg-white min-h-[72px] p-1 cursor-pointer transition ${
                          !day ? 'bg-gray-50' : ''
                        } ${selected ? 'ring-2 ring-blue-500 ring-inset' : ''} ${
                          isToday(day) ? 'bg-blue-50' : 'hover:bg-gray-50'
                        }`}
                      >
                        {day && (
                          <>
                            <div className={`text-xs font-medium ${isToday(day) ? 'text-blue-700 font-bold' : 'text-gray-700'}`}>{day}</div>
                            {dayEvents.length > 0 && (
                              <div className="mt-0.5 space-y-0.5">
                                {dayEvents.slice(0, 3).map((ev, j) => (
                                  <div key={j} className={`flex items-center gap-1 rounded px-1 py-0.5 text-[10px] leading-tight truncate ${
                                    ev.event_type === 'workout' ? 'bg-orange-50 text-orange-700' :
                                    ev.event_type === 'game' ? 'bg-slate-100 text-slate-700' :
                                    ev.event_type === 'practice' ? 'bg-green-50 text-green-700' :
                                    ev.event_type === 'meal' ? 'bg-yellow-50 text-yellow-700' :
                                    'bg-blue-50 text-blue-700'
                                  }`}>
                                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColor(ev.event_type)}`} />
                                    <span className="truncate">{ev.title || ev.opponent || ev.event_type}</span>
                                  </div>
                                ))}
                                {dayEvents.length > 3 && <span className="text-[9px] text-gray-400 pl-1">+{dayEvents.length - 3} more</span>}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Selected Day Events */}
                {scheduleSelectedDay && (
                  <div className="space-y-2">
                    <h5 className="text-sm font-semibold text-gray-700">
                      {new Date(year, month, scheduleSelectedDay).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                    </h5>
                    {(eventsByDay[scheduleSelectedDay] || []).length === 0 ? (
                      <p className="text-sm text-gray-400 py-4 text-center">No events scheduled</p>
                    ) : (
                      (eventsByDay[scheduleSelectedDay] || []).map((ev, i) => {
                        const { general, exercises } = parseExerciseNotesProfile(ev.notes);
                        return (
                          <div key={i} className="border border-gray-200 rounded-lg p-3 space-y-2">
                            <div className="flex items-center space-x-2">
                              <div className={`w-2.5 h-2.5 rounded-full ${dotColor(ev.event_type)}`} />
                              <span className="font-medium text-sm text-gray-900">{ev.title || ev.opponent || ev.event_type}</span>
                              <span className="text-xs text-gray-400 capitalize">{ev.event_type}</span>
                            </div>
                            {ev.start_time && (
                              <div className="text-xs text-gray-500">
                                {ev.start_time}{ev.end_time ? ` – ${ev.end_time}` : ''}
                              </div>
                            )}
                            {general && (
                              <div className="text-xs text-gray-600 bg-gray-50 rounded p-2 whitespace-pre-wrap">{general}</div>
                            )}
                            {exercises.length > 0 && (
                              <div className="p-2 bg-blue-50 rounded border border-blue-100 space-y-1.5">
                                <div className="text-xs font-semibold text-blue-700">Exercises</div>
                                {exercises.map((ex, j) => (
                                  <div key={j} className="bg-white rounded p-2 border border-blue-100 flex items-center justify-between text-xs">
                                    <div>
                                      <span className="font-medium text-gray-900">{ex.name}</span>
                                      <div className="flex items-center gap-2 text-gray-500 mt-0.5">
                                        {(ex.sets || ex.reps) && (
                                          <span>{ex.sets && ex.reps ? `${ex.sets} × ${ex.reps}` : ex.sets}</span>
                                        )}
                                        {ex.rest && <span>Rest: {ex.rest}</span>}
                                        {ex.load && <span>Load: {ex.load}</span>}
                                      </div>
                                    </div>
                                    {ex.link && (
                                      <a href={ex.link} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700 ml-2">
                                        <ExternalLink size={12} />
                                      </a>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {scheduleEvents.length === 0 && !scheduleSelectedDay && (
                  <p className="text-center text-gray-400 text-sm py-4">No events this month</p>
                )}
              </div>
            );
          })()}

          {showAddWorkout && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center overflow-y-auto pt-8 pb-8">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl mx-4">
                <AddEventPanel
                  date={scheduleSelectedDay ? `${scheduleDate.getFullYear()}-${String(scheduleDate.getMonth() + 1).padStart(2, '0')}-${String(scheduleSelectedDay).padStart(2, '0')}` : new Date().toISOString().split('T')[0]}
                  view="player"
                  teamId={null}
                  playerIds={[userId]}
                  onClose={() => setShowAddWorkout(false)}
                  onSuccess={() => { setShowAddWorkout(false); fetchScheduleEvents(); }}
                />
              </div>
            </div>
          )}

          {activeProfileTab === 'programming' && (() => {
            const today = new Date().toISOString().split('T')[0];
            const isActive = (a) => {
              if (!a.start_date && !a.end_date) return true;
              if (a.start_date && a.start_date > today) return false;
              if (a.end_date && a.end_date < today) return false;
              return true;
            };
            const activePrograms = (programmingData.programs || []).filter(isActive);
            const pastPrograms = (programmingData.programs || []).filter(p => !isActive(p));
            const activeMealPlans = (programmingData.mealPlans || []).filter(isActive);
            const fmtDate = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

            return (
              <div className="space-y-6">
                {programmingData.loading && (
                  <p className="text-sm text-gray-500">Loading programming...</p>
                )}

                {profile?.program && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-1">Primary Program</div>
                    <div className="text-lg font-bold text-blue-900">{profile.program}</div>
                  </div>
                )}

                <div>
                  <h4 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
                    <ClipboardList size={18} className="mr-2 text-gray-500" />
                    Active Training Programs
                    <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-normal">{activePrograms.length}</span>
                  </h4>
                  {activePrograms.length === 0 ? (
                    <p className="text-sm text-gray-400 py-3">No active training programs.</p>
                  ) : (
                    <div className="space-y-2">
                      {activePrograms.map(a => (
                        <div key={a.id} className="border border-gray-200 rounded-lg p-3 bg-white">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-medium text-gray-900">{a.training_programs?.name || 'Untitled program'}</div>
                              {a.training_programs?.description && <div className="text-xs text-gray-500 mt-0.5">{a.training_programs.description}</div>}
                            </div>
                            <div className="text-right text-xs text-gray-500 flex-shrink-0">
                              <div>{fmtDate(a.start_date)} – {fmtDate(a.end_date)}</div>
                              {a.team_id && <div className="mt-0.5 inline-block px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">Team</div>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
                    <Calendar size={18} className="mr-2 text-gray-500" />
                    Active Meal Plans
                    <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-normal">{activeMealPlans.length}</span>
                  </h4>
                  {activeMealPlans.length === 0 ? (
                    <p className="text-sm text-gray-400 py-3">No active meal plans.</p>
                  ) : (
                    <div className="space-y-2">
                      {activeMealPlans.map(a => (
                        <div key={a.id} className="border border-gray-200 rounded-lg p-3 bg-white">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-medium text-gray-900">{a.meal_plans?.name || 'Untitled meal plan'}</div>
                              {a.meal_plans?.description && <div className="text-xs text-gray-500 mt-0.5">{a.meal_plans.description}</div>}
                            </div>
                            <div className="text-right text-xs text-gray-500 flex-shrink-0">
                              <div>{fmtDate(a.start_date)} – {fmtDate(a.end_date)}</div>
                              {a.team_id && <div className="mt-0.5 inline-block px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">Team</div>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
                    <FileText size={18} className="mr-2 text-gray-500" />
                    Recent Assessments
                    <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-normal">{(programmingData.assessments || []).length}</span>
                  </h4>
                  {(programmingData.assessments || []).length === 0 ? (
                    <p className="text-sm text-gray-400 py-3">No assessments submitted.</p>
                  ) : (
                    <div className="space-y-2">
                      {programmingData.assessments.map(a => (
                        <div key={a.id} className="border border-gray-200 rounded-lg p-3 bg-white">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="font-medium text-gray-900">{a.assessment_templates?.name || a.assessment_templates?.short_name || 'Assessment'}</div>
                              {a.notes && <div className="text-xs text-gray-500 mt-0.5 whitespace-pre-wrap line-clamp-2">{a.notes}</div>}
                            </div>
                            <div className="text-xs text-gray-500 flex-shrink-0">{fmtDate(a.assessment_date)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {pastPrograms.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-500 mb-2 uppercase tracking-wide">Past Programs</h4>
                    <div className="space-y-1.5">
                      {pastPrograms.map(a => (
                        <div key={a.id} className="text-xs text-gray-500 px-3 py-1.5 border border-gray-100 rounded bg-gray-50">
                          {a.training_programs?.name || 'Untitled'} — {fmtDate(a.start_date)} to {fmtDate(a.end_date)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {activeProfileTab === 'communication' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Communication History</h3>
                {userData.email && (
                  <button
                    onClick={() => setShowEmailCompose(true)}
                    className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition flex items-center space-x-1"
                  >
                    <Mail size={16} />
                    <span>New Email</span>
                  </button>
                )}
              </div>

              {loadingComms ? (
                <p className="text-gray-500 text-sm text-center py-8">Loading communication history...</p>
              ) : communicationLogs.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <Mail size={40} className="mx-auto mb-3 text-gray-300" />
                  <p>No emails sent yet.</p>
                  <p className="text-sm mt-1">Use the "New Email" button to send the first email.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {communicationLogs.map(log => (
                    <div key={log.id} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-1">
                            <h4 className="font-semibold text-gray-900 text-sm">{log.subject}</h4>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              log.status === 'sent' ? 'bg-green-100 text-green-700' :
                              log.status === 'delivered' ? 'bg-blue-100 text-blue-700' :
                              'bg-red-100 text-red-700'
                            }`}>
                              {log.status}
                            </span>
                          </div>
                          <p className="text-sm text-gray-600 whitespace-pre-wrap">{log.body}</p>
                          {log.attachment_names && log.attachment_names.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-2">
                              {log.attachment_names.map((name, i) => (
                                <span key={i} className="inline-flex items-center bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full">
                                  <Paperclip size={10} className="mr-1" />{name}
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="flex items-center space-x-3 mt-2 text-xs text-gray-400">
                            <span>To: {log.recipient_name} &lt;{log.recipient_email}&gt;</span>
                            <span>By: {log.sender?.full_name || 'Unknown'}</span>
                            <span>{new Date(log.sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
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

              <div className="flex items-center space-x-3">
                <Calendar className="text-gray-400" size={20} />
                <div className="flex-1">
                  <p className="text-sm text-gray-600">Date of Birth</p>
                  {editing ? (
                    <input
                      type="date"
                      value={editForm.date_of_birth}
                      onChange={(e) => setEditForm({...editForm, date_of_birth: e.target.value})}
                      className="w-full border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  ) : (
                    <p className="text-gray-900">
                      {userData.date_of_birth
                        ? `${new Date(userData.date_of_birth + 'T00:00:00').toLocaleDateString()} (${Math.floor((new Date() - new Date(userData.date_of_birth + 'T00:00:00')) / 31557600000)} yrs)`
                        : 'Not set'}
                    </p>
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

      {showEmailCompose && userData.email && (
        <EmailComposeModal
          recipientName={userData.full_name}
          recipientEmail={userData.email}
          playerId={userData.id}
          onClose={() => setShowEmailCompose(false)}
          onSent={() => fetchCommunicationLogs()}
        />
      )}

      {assessmentFormTemplate && (
        <AssessmentFormModal
          template={assessmentFormTemplate}
          playerId={userId}
          onClose={() => setAssessmentFormTemplate(null)}
          onSubmitted={() => { fetchAssessmentData(); setAssessmentFormTemplate(null); }}
        />
      )}
    </div>
  );
}

function SubmissionView({ submission }) {
  const schema = submission.assessment_templates?.schema || [];
  const responses = submission.responses || {};

  if (schema.length === 0) {
    return <p className="text-sm text-gray-500 italic">No template schema available.</p>;
  }

  return (
    <div className="space-y-3">
      {schema.sort((a, b) => a.sort_order - b.sort_order).map(el => (
        <div key={el.id} className="space-y-1">
          <label className="block text-xs font-semibold text-gray-700">{el.label || el.type}</label>
          {(el.type === 'text_field' || el.type === 'text_area' || el.type === 'notes') && (
            <p className="text-sm text-gray-800 bg-white px-3 py-2 rounded border border-gray-200">{responses[el.id] || <span className="text-gray-400 italic">No response</span>}</p>
          )}
          {el.type === 'combo_box' && (
            <p className="text-sm text-gray-800 bg-white px-3 py-2 rounded border border-gray-200">{responses[el.id] || <span className="text-gray-400 italic">No selection</span>}</p>
          )}
          {el.type === 'date' && (
            <p className="text-sm text-gray-800 bg-white px-3 py-2 rounded border border-gray-200">{responses[el.id] || <span className="text-gray-400 italic">No date</span>}</p>
          )}
          {el.type === 'table' && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border border-gray-300">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="border border-gray-300 px-3 py-1.5 text-left text-xs font-medium text-gray-600"></th>
                    {(el.columns || []).map(col => (
                      <th key={col} className="border border-gray-300 px-3 py-1.5 text-left text-xs font-medium text-gray-600">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(el.rows || []).map(row => (
                    <tr key={row}>
                      <td className="border border-gray-300 px-3 py-1.5 font-medium text-gray-700 bg-gray-50 text-xs">{row}</td>
                      {(el.columns || []).map(col => (
                        <td key={col} className="border border-gray-300 px-3 py-1.5 text-gray-700 text-xs">
                          {responses[el.id]?.[row]?.[col] || '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
      {submission.notes && (
        <div>
          <label className="block text-xs font-semibold text-gray-700">Additional Notes</label>
          <p className="text-sm text-gray-800 bg-white px-3 py-2 rounded border border-gray-200">{submission.notes}</p>
        </div>
      )}
    </div>
  );
}

function AssessmentFormModal({ template, playerId, onClose, onSubmitted }) {
  const [responses, setResponses] = useState({});
  const [notes, setNotes] = useState('');
  const [assessmentDate, setAssessmentDate] = useState(new Date().toISOString().split('T')[0]);
  const [saving, setSaving] = useState(false);

  const schema = (template.schema || []).sort((a, b) => a.sort_order - b.sort_order);

  const updateResponse = (elId, value) => {
    setResponses(prev => ({ ...prev, [elId]: value }));
  };

  const updateTableCell = (elId, row, col, value) => {
    setResponses(prev => ({
      ...prev,
      [elId]: { ...(prev[elId] || {}), [row]: { ...(prev[elId]?.[row] || {}), [col]: value } }
    }));
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('assessment_submissions').insert({
        template_id: template.id,
        player_id: playerId,
        assessed_by: user.id,
        assessment_date: assessmentDate,
        responses,
        notes: notes.trim() || null,
      });
      if (error) throw error;
      onSubmitted();
    } catch (err) {
      alert('Error submitting assessment: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
        <div className="border-b border-gray-200 p-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">{template.name}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={24} /></button>
        </div>

        <div className="p-4 space-y-4 flex-1 overflow-y-auto">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Assessment Date</label>
            <input
              type="date"
              value={assessmentDate}
              onChange={(e) => setAssessmentDate(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {schema.map(el => (
            <div key={el.id} className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">{el.label || el.type}</label>

              {el.type === 'text_field' && (
                <input
                  type="text"
                  value={responses[el.id] || ''}
                  onChange={(e) => updateResponse(el.id, e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}

              {(el.type === 'text_area' || el.type === 'notes') && (
                <textarea
                  value={responses[el.id] || ''}
                  onChange={(e) => updateResponse(el.id, e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              )}

              {el.type === 'combo_box' && (
                <select
                  value={responses[el.id] || ''}
                  onChange={(e) => updateResponse(el.id, e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">Select...</option>
                  {(el.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              )}

              {el.type === 'date' && (
                <input
                  type="date"
                  value={responses[el.id] || ''}
                  onChange={(e) => updateResponse(el.id, e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}

              {el.type === 'table' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border border-gray-300">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="border border-gray-300 px-3 py-1.5 text-left text-xs font-medium text-gray-600"></th>
                        {(el.columns || []).map(col => (
                          <th key={col} className="border border-gray-300 px-3 py-1.5 text-left text-xs font-medium text-gray-600">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(el.rows || []).map(row => (
                        <tr key={row}>
                          <td className="border border-gray-300 px-3 py-1.5 font-medium text-gray-700 bg-gray-50 text-xs">{row}</td>
                          {(el.columns || []).map(col => (
                            <td key={col} className="border border-gray-300 px-1 py-0.5">
                              <input
                                type="text"
                                value={responses[el.id]?.[row]?.[col] || ''}
                                onChange={(e) => updateTableCell(el.id, row, col, e.target.value)}
                                className="w-full px-2 py-1 text-xs border-0 focus:outline-none focus:ring-1 focus:ring-blue-500 rounded"
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Additional Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Optional notes..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
        </div>

        <div className="border-t border-gray-200 p-4 flex justify-end space-x-3">
          <button onClick={onClose} className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-50 transition">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 transition disabled:opacity-50 flex items-center space-x-2"
          >
            <Save size={16} />
            <span>{saving ? 'Submitting...' : 'Submit Assessment'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function NoteEditor({ draft, setDraft, addPitch, updatePitch, removePitch }) {
  const isPitch = isPitchCategory(draft.category);
  const isPitchingCat = draft.category === 'pitching';
  const resultOptions = isPitchingCat ? PITCHING_RESULT_OPTIONS : HITTING_RESULT_OPTIONS;
  const pitches = draft.pitches || [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center space-x-2">
          <label className="text-sm font-medium text-gray-700">Category:</label>
          <select
            value={draft.category}
            onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {NOTE_CATEGORIES.map(cat => (
              <option key={cat.value} value={cat.value}>{cat.label}</option>
            ))}
          </select>
        </div>
        {isPitch && (
          <div className="flex items-center space-x-2">
            <label className="text-sm font-medium text-gray-700">Context:</label>
            <select
              value={draft.context || ''}
              onChange={(e) => setDraft({ ...draft, context: e.target.value })}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select…</option>
              {NOTE_CONTEXT_OPTIONS.map(c => (
                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <textarea
        value={draft.content}
        onChange={(e) => setDraft({ ...draft, content: e.target.value })}
        placeholder={isPitch
          ? (isPitchingCat ? 'Notes (overall outing, opponent, conditions...)' : 'Notes (how you were pitched, opponent, conditions...)')
          : 'Write a note...'}
        rows={3}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
      />

      {isPitch && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-gray-700">
              {isPitchingCat ? 'Pitches Thrown' : 'Pitches Seen'} ({pitches.length})
            </span>
            <button
              type="button"
              onClick={addPitch}
              className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition flex items-center space-x-1"
            >
              <Plus size={12} />
              <span>Add pitch</span>
            </button>
          </div>
          {pitches.length === 0 ? (
            <p className="text-xs text-gray-500 italic">No pitches logged yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-2 py-1 text-left font-semibold text-gray-600 uppercase tracking-wide w-8">#</th>
                    <th className="px-2 py-1 text-left font-semibold text-gray-600 uppercase tracking-wide">Pitch</th>
                    <th className="px-2 py-1 text-left font-semibold text-gray-600 uppercase tracking-wide">Location</th>
                    <th className="px-2 py-1 text-left font-semibold text-gray-600 uppercase tracking-wide">Result</th>
                    <th className="px-2 py-1 text-left font-semibold text-gray-600 uppercase tracking-wide">Notes</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {pitches.map((p, i) => (
                    <tr key={i} className="border-t border-gray-200">
                      <td className="px-2 py-1 text-gray-500">{i + 1}</td>
                      <td className="px-1 py-1">
                        <select
                          value={p.pitch_type || ''}
                          onChange={(e) => updatePitch(i, 'pitch_type', e.target.value)}
                          className="w-full px-1 py-1 border border-gray-200 rounded text-xs bg-white"
                        >
                          <option value="">—</option>
                          {PITCH_TYPE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </td>
                      <td className="px-1 py-1">
                        <select
                          value={p.location || ''}
                          onChange={(e) => updatePitch(i, 'location', e.target.value)}
                          className="w-full px-1 py-1 border border-gray-200 rounded text-xs bg-white"
                        >
                          <option value="">—</option>
                          {PITCH_LOCATION_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </td>
                      <td className="px-1 py-1">
                        <select
                          value={p.result || ''}
                          onChange={(e) => updatePitch(i, 'result', e.target.value)}
                          className="w-full px-1 py-1 border border-gray-200 rounded text-xs bg-white"
                        >
                          <option value="">—</option>
                          {resultOptions.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </td>
                      <td className="px-1 py-1">
                        <input
                          type="text"
                          value={p.notes || ''}
                          onChange={(e) => updatePitch(i, 'notes', e.target.value)}
                          placeholder="(optional)"
                          className="w-full px-1 py-1 border border-gray-200 rounded text-xs bg-white"
                        />
                      </td>
                      <td className="px-1 py-1 text-right">
                        <button
                          type="button"
                          onClick={() => removePitch(i)}
                          className="text-gray-400 hover:text-red-600"
                          title="Remove pitch"
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PtVisitEditor({ draft, setDraft, addExercise, updateExercise, removeExercise }) {
  const exercises = draft.exercises || [];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Visit date *</label>
          <input
            type="date"
            value={draft.visit_date}
            onChange={(e) => setDraft({ ...draft, visit_date: e.target.value })}
            className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Visit type</label>
          <select
            value={draft.visit_type || ''}
            onChange={(e) => setDraft({ ...draft, visit_type: e.target.value })}
            className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">—</option>
            {PT_VISIT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Body area</label>
          <select
            value={draft.body_area || ''}
            onChange={(e) => setDraft({ ...draft, body_area: e.target.value })}
            className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">—</option>
            {PT_BODY_AREAS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Pain (0–10)</label>
          <input
            type="number"
            min="0"
            max="10"
            value={draft.pain_level}
            onChange={(e) => setDraft({ ...draft, pain_level: e.target.value })}
            placeholder="—"
            className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
        <textarea
          value={draft.content}
          onChange={(e) => setDraft({ ...draft, content: e.target.value })}
          rows={3}
          placeholder="Treatment notes, range of motion, observations..."
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-700">Exercises / Home Plan ({exercises.length})</span>
          <button
            type="button"
            onClick={addExercise}
            className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition flex items-center space-x-1"
          >
            <Plus size={12} />
            <span>Add exercise</span>
          </button>
        </div>
        {exercises.length === 0 ? (
          <p className="text-xs text-gray-500 italic">No exercises added.</p>
        ) : (
          <div className="space-y-2">
            {exercises.map((ex, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <input
                  type="text"
                  placeholder="Exercise name"
                  value={ex.name || ''}
                  onChange={(e) => updateExercise(i, 'name', e.target.value)}
                  className="col-span-4 px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <input
                  type="text"
                  placeholder="Sets"
                  value={ex.sets || ''}
                  onChange={(e) => updateExercise(i, 'sets', e.target.value)}
                  className="col-span-2 px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <input
                  type="text"
                  placeholder="Reps"
                  value={ex.reps || ''}
                  onChange={(e) => updateExercise(i, 'reps', e.target.value)}
                  className="col-span-2 px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <input
                  type="text"
                  placeholder="Notes (optional)"
                  value={ex.notes || ''}
                  onChange={(e) => updateExercise(i, 'notes', e.target.value)}
                  className="col-span-3 px-2 py-1.5 border border-gray-200 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => removeExercise(i)}
                  className="col-span-1 text-gray-400 hover:text-red-600"
                  title="Remove exercise"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Follow-up date (optional)</label>
        <input
          type="date"
          value={draft.follow_up_at}
          onChange={(e) => setDraft({ ...draft, follow_up_at: e.target.value })}
          className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
    </div>
  );
}
