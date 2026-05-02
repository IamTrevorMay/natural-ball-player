import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { CheckCircle, ChevronDown, ChevronUp, Plus, Trash2, Save } from 'lucide-react';

const SECTIONS = [
  'Athlete Identification',
  'Emergency Contacts',
  'Healthcare Providers & Insurance',
  'Current Health Status',
  'Medications & Supplements',
  'Allergies',
  'Personal Medical History',
  'Nutrition, Hydration & Body Composition',
  'Mental & Behavioral Health',
  'Lifestyle & Substance Use',
  'Family Medical History',
  'Consent & Attestation',
];

const CONDITIONS_LIST = [
  'Asthma', 'Diabetes', 'Epilepsy / Seizures', 'Heart Condition', 'High Blood Pressure',
  'Migraines / Chronic Headaches', 'Concussion', 'Heat Illness', 'Sickle Cell Trait',
  'Bleeding Disorder', 'Anemia', 'Thyroid Disorder', 'Kidney Problems', 'Liver Problems',
  'Chronic Fatigue', 'Mononucleosis', 'Depression', 'Anxiety Disorder', 'ADHD',
  'Eating Disorder', 'Sleep Disorder', 'Vision Problems', 'Hearing Problems',
  'Dental / Orthodontic Issues', 'Other',
];

const DIETARY_PATTERNS = ['No Restrictions', 'Vegetarian', 'Vegan', 'Gluten-Free', 'Dairy-Free', 'Keto', 'Paleo', 'Other'];
const HEALTH_RATINGS = ['Excellent', 'Good', 'Fair', 'Poor'];
const SEX_OPTIONS = ['Male', 'Female', 'Other', 'Prefer not to say'];
const DOMINANCE_OPTIONS = ['Right', 'Left', 'Both'];
const YES_NO = ['Yes', 'No'];
const FREQUENCY_OPTIONS = ['Never', 'Rarely', 'Occasionally', 'Frequently', 'Daily'];

export default function MedicalHistoryForm({ userId, userRole }) {
  const [responses, setResponses] = useState({});
  const [existingRecord, setExistingRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedSections, setExpandedSections] = useState(new Set([0]));
  const [readOnly, setReadOnly] = useState(false);

  useEffect(() => {
    fetchMedicalHistory();
  }, [userId]);

  const fetchMedicalHistory = async () => {
    try {
      const { data, error } = await supabase
        .from('medical_history')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      if (data) {
        setExistingRecord(data);
        setResponses(data.responses || {});
        setReadOnly(true);
      }
    } catch (error) {
      console.error('Error fetching medical history:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleSection = (index) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const set = (key, value) => {
    setResponses(prev => ({ ...prev, [key]: value }));
  };

  const addRow = (key) => {
    const current = responses[key] || [];
    setResponses(prev => ({ ...prev, [key]: [...current, {}] }));
  };

  const removeRow = (key, index) => {
    const current = responses[key] || [];
    setResponses(prev => ({ ...prev, [key]: current.filter((_, i) => i !== index) }));
  };

  const updateRow = (key, index, field, value) => {
    const current = responses[key] || [];
    const updated = current.map((row, i) => i === index ? { ...row, [field]: value } : row);
    setResponses(prev => ({ ...prev, [key]: updated }));
  };

  const handleSubmit = async () => {
    // Validate required fields
    const missing = [];
    if (!responses.first_name?.trim()) missing.push('First Name');
    if (!responses.last_name?.trim()) missing.push('Last Name');
    if (!responses.dob) missing.push('Date of Birth');
    if (!responses.phone?.trim()) missing.push('Phone');
    if (!responses.email?.trim()) missing.push('Email');
    if (!responses.consent_accurate) missing.push('Consent checkbox 1');
    if (!responses.consent_release) missing.push('Consent checkbox 2');
    if (!responses.signature?.trim()) missing.push('Signature');
    if (!responses.signature_date) missing.push('Signature Date');

    if (missing.length > 0) {
      alert('Please fill in required fields: ' + missing.join(', '));
      return;
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      if (existingRecord) {
        const { error } = await supabase
          .from('medical_history')
          .update({ responses, signed_at: now, updated_at: now })
          .eq('id', existingRecord.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('medical_history')
          .insert({ user_id: userId, responses, signed_at: now });
        if (error) throw error;
      }
      await fetchMedicalHistory();
      alert('Medical history saved successfully!');
    } catch (error) {
      console.error('Error saving medical history:', error);
      alert('Error saving: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-gray-500 text-sm py-4">Loading...</div>;

  const canEdit = userRole === 'admin' || userRole === 'coach' || !existingRecord;

  // Helper components
  const Field = ({ label, fieldKey, type = 'text', required, placeholder, className = '' }) => (
    <div className={className}>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {readOnly ? (
        <p className="text-sm text-gray-900 bg-gray-50 px-3 py-2 rounded-lg min-h-[36px]">{responses[fieldKey] || <span className="text-gray-400 italic">Not provided</span>}</p>
      ) : (
        <input
          type={type}
          value={responses[fieldKey] || ''}
          onChange={(e) => set(fieldKey, e.target.value)}
          placeholder={placeholder}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      )}
    </div>
  );

  const TextArea = ({ label, fieldKey, rows = 3, placeholder }) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {readOnly ? (
        <p className="text-sm text-gray-900 bg-gray-50 px-3 py-2 rounded-lg whitespace-pre-wrap min-h-[36px]">{responses[fieldKey] || <span className="text-gray-400 italic">Not provided</span>}</p>
      ) : (
        <textarea
          value={responses[fieldKey] || ''}
          onChange={(e) => set(fieldKey, e.target.value)}
          rows={rows}
          placeholder={placeholder}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      )}
    </div>
  );

  const Select = ({ label, fieldKey, options, required }) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {readOnly ? (
        <p className="text-sm text-gray-900 bg-gray-50 px-3 py-2 rounded-lg">{responses[fieldKey] || <span className="text-gray-400 italic">Not provided</span>}</p>
      ) : (
        <select
          value={responses[fieldKey] || ''}
          onChange={(e) => set(fieldKey, e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white"
        >
          <option value="">Select...</option>
          {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      )}
    </div>
  );

  const YesNoField = ({ label, fieldKey }) => (
    <div className="flex items-start space-x-3 py-2">
      <div className="flex-1">
        <label className="text-sm text-gray-700">{label}</label>
      </div>
      {readOnly ? (
        <span className={`text-sm font-medium ${responses[fieldKey] === 'Yes' ? 'text-red-600' : 'text-green-600'}`}>
          {responses[fieldKey] || <span className="text-gray-400 italic">—</span>}
        </span>
      ) : (
        <div className="flex space-x-2 flex-shrink-0">
          {YES_NO.map(opt => (
            <button
              key={opt}
              type="button"
              onClick={() => set(fieldKey, opt)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                responses[fieldKey] === opt
                  ? opt === 'Yes' ? 'bg-red-100 text-red-700 ring-1 ring-red-300' : 'bg-green-100 text-green-700 ring-1 ring-green-300'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const YesNoDetail = ({ label, fieldKey, detailKey }) => (
    <div className="space-y-1">
      <YesNoField label={label} fieldKey={fieldKey} />
      {responses[fieldKey] === 'Yes' && (
        <div className="ml-4">
          {readOnly ? (
            <p className="text-sm text-gray-700 bg-gray-50 px-3 py-2 rounded-lg">{responses[detailKey] || <span className="text-gray-400 italic">No details</span>}</p>
          ) : (
            <textarea
              value={responses[detailKey] || ''}
              onChange={(e) => set(detailKey, e.target.value)}
              placeholder="Please provide details..."
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )}
        </div>
      )}
    </div>
  );

  const renderSection = (index) => {
    switch (index) {
      case 0: // Athlete Identification
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="First Name" fieldKey="first_name" required placeholder="First name" />
              <Field label="Last Name" fieldKey="last_name" required placeholder="Last name" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Date of Birth" fieldKey="dob" type="date" required />
              <Select label="Sex" fieldKey="sex" options={SEX_OPTIONS} />
              <Field label="Sport(s)" fieldKey="sport" placeholder="e.g. Baseball" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Level of Competition" fieldKey="competition_level" placeholder="e.g. High School Varsity" />
              <Field label="Years Training" fieldKey="years_training" placeholder="e.g. 5" />
              <Field label="Team / Organization" fieldKey="team_org" placeholder="Team name" />
            </div>
            <Field label="Address" fieldKey="address" placeholder="Street address, city, state, zip" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Phone" fieldKey="phone" type="tel" required placeholder="(555) 555-5555" />
              <Field label="Email" fieldKey="email" type="email" required placeholder="athlete@email.com" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Height" fieldKey="height" placeholder="e.g. 6'2&quot;" />
              <Field label="Weight" fieldKey="weight" placeholder="e.g. 185 lbs" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Select label="Dominant Hand" fieldKey="dominant_hand" options={DOMINANCE_OPTIONS} />
              <Select label="Dominant Foot" fieldKey="dominant_foot" options={DOMINANCE_OPTIONS} />
              <Select label="Dominant Eye" fieldKey="dominant_eye" options={DOMINANCE_OPTIONS} />
            </div>
          </div>
        );

      case 1: // Emergency Contacts
        return (
          <div className="space-y-6">
            <div>
              <h5 className="text-sm font-semibold text-gray-800 mb-3">Primary Emergency Contact</h5>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Name" fieldKey="emergency1_name" placeholder="Full name" />
                <Field label="Relationship" fieldKey="emergency1_relationship" placeholder="e.g. Mother" />
                <Field label="Phone" fieldKey="emergency1_phone" type="tel" placeholder="(555) 555-5555" />
                <Field label="Alternate Phone" fieldKey="emergency1_alt_phone" type="tel" placeholder="(555) 555-5555" />
              </div>
            </div>
            <div>
              <h5 className="text-sm font-semibold text-gray-800 mb-3">Secondary Emergency Contact</h5>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Name" fieldKey="emergency2_name" placeholder="Full name" />
                <Field label="Relationship" fieldKey="emergency2_relationship" placeholder="e.g. Father" />
                <Field label="Phone" fieldKey="emergency2_phone" type="tel" placeholder="(555) 555-5555" />
                <Field label="Alternate Phone" fieldKey="emergency2_alt_phone" type="tel" placeholder="(555) 555-5555" />
              </div>
            </div>
            <div>
              <h5 className="text-sm font-semibold text-gray-800 mb-3">Legal Guardian (if different from above)</h5>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="Name" fieldKey="guardian_name" placeholder="Full name" />
                <Field label="Relationship" fieldKey="guardian_relationship" placeholder="e.g. Guardian" />
                <Field label="Phone" fieldKey="guardian_phone" type="tel" placeholder="(555) 555-5555" />
              </div>
            </div>
          </div>
        );

      case 2: // Healthcare Providers & Insurance
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Primary Care Physician" fieldKey="pcp_name" placeholder="Dr. Name" />
              <Field label="PCP Phone" fieldKey="pcp_phone" type="tel" placeholder="(555) 555-5555" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Specialist (if any)" fieldKey="specialist_name" placeholder="Dr. Name / Specialty" />
              <Field label="Preferred Hospital" fieldKey="preferred_hospital" placeholder="Hospital name" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Insurance Provider" fieldKey="insurer" placeholder="e.g. Blue Cross" />
              <Field label="Policy / Member ID" fieldKey="policy_id" placeholder="Policy ID" />
              <Field label="Group Number" fieldKey="group_number" placeholder="Group #" />
            </div>
            <Field label="Date of Last Physical Exam" fieldKey="last_physical" type="date" />
          </div>
        );

      case 3: // Current Health Status
        return (
          <div className="space-y-4">
            <Select label="How would you rate your current health?" fieldKey="health_rating" options={HEALTH_RATINGS} />
            <TextArea label="Describe any current health issues, injuries, or conditions" fieldKey="current_issues" placeholder="List any current concerns..." />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Resting Heart Rate (bpm)" fieldKey="resting_hr" placeholder="e.g. 65" />
              <Field label="Blood Pressure" fieldKey="blood_pressure" placeholder="e.g. 120/80" />
            </div>
          </div>
        );

      case 4: // Medications & Supplements
        return (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">List all medications, supplements, and vitamins you currently take.</p>
            {(responses.medications || []).map((med, i) => (
              <div key={i} className="border border-gray-200 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-500">Medication #{i + 1}</span>
                  {!readOnly && (
                    <button type="button" onClick={() => removeRow('medications', i)} className="text-gray-400 hover:text-red-600">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Name</label>
                    {readOnly ? (
                      <p className="text-sm text-gray-900 bg-gray-50 px-3 py-2 rounded-lg">{med.name || '—'}</p>
                    ) : (
                      <input type="text" value={med.name || ''} onChange={(e) => updateRow('medications', i, 'name', e.target.value)}
                        placeholder="Medication name" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    )}
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Dose</label>
                    {readOnly ? (
                      <p className="text-sm text-gray-900 bg-gray-50 px-3 py-2 rounded-lg">{med.dose || '—'}</p>
                    ) : (
                      <input type="text" value={med.dose || ''} onChange={(e) => updateRow('medications', i, 'dose', e.target.value)}
                        placeholder="e.g. 200mg" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    )}
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Reason / Frequency</label>
                    {readOnly ? (
                      <p className="text-sm text-gray-900 bg-gray-50 px-3 py-2 rounded-lg">{med.reason || '—'}</p>
                    ) : (
                      <input type="text" value={med.reason || ''} onChange={(e) => updateRow('medications', i, 'reason', e.target.value)}
                        placeholder="e.g. Daily for asthma" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    )}
                  </div>
                </div>
              </div>
            ))}
            {!readOnly && (
              <button type="button" onClick={() => addRow('medications')}
                className="text-sm text-blue-600 hover:text-blue-800 flex items-center space-x-1">
                <Plus size={14} /><span>Add Medication / Supplement</span>
              </button>
            )}
            {readOnly && (responses.medications || []).length === 0 && (
              <p className="text-sm text-gray-400 italic">None listed</p>
            )}
          </div>
        );

      case 5: // Allergies
        return (
          <div className="space-y-3">
            <YesNoDetail label="Do you have any medication allergies?" fieldKey="allergy_medication" detailKey="allergy_medication_detail" />
            <YesNoDetail label="Do you have any food allergies?" fieldKey="allergy_food" detailKey="allergy_food_detail" />
            <YesNoDetail label="Do you have any environmental allergies (pollen, dust, mold)?" fieldKey="allergy_environmental" detailKey="allergy_environmental_detail" />
            <YesNoDetail label="Do you have any insect sting/bite allergies?" fieldKey="allergy_insect" detailKey="allergy_insect_detail" />
            <YesNoDetail label="Have you ever experienced anaphylaxis?" fieldKey="anaphylaxis" detailKey="anaphylaxis_detail" />
            <YesNoField label="Do you carry an EpiPen?" fieldKey="epipen" />
          </div>
        );

      case 6: // Personal Medical History
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Have you ever been diagnosed with any of the following?</label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {CONDITIONS_LIST.map(condition => {
                  const key = `condition_${condition.toLowerCase().replace(/[\s/()]/g, '_')}`;
                  return (
                    <label key={condition} className="flex items-center space-x-2 text-sm">
                      {readOnly ? (
                        <>
                          <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${responses[key] ? 'bg-red-100 border-red-300' : 'border-gray-300'}`}>
                            {responses[key] && <span className="text-red-600 text-xs">&#10003;</span>}
                          </span>
                          <span className={responses[key] ? 'text-red-700 font-medium' : 'text-gray-600'}>{condition}</span>
                        </>
                      ) : (
                        <>
                          <input type="checkbox" checked={!!responses[key]} onChange={(e) => set(key, e.target.checked)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                          <span className="text-gray-700">{condition}</span>
                        </>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
            <TextArea label="Additional details about conditions checked above" fieldKey="conditions_notes" placeholder="Provide any relevant details..." />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Hospitalizations / Surgeries</label>
              {(responses.surgeries || []).map((s, i) => (
                <div key={i} className="border border-gray-200 rounded-lg p-3 mb-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-500">#{i + 1}</span>
                    {!readOnly && (
                      <button type="button" onClick={() => removeRow('surgeries', i)} className="text-gray-400 hover:text-red-600">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Procedure</label>
                      {readOnly ? (
                        <p className="text-sm text-gray-900 bg-gray-50 px-3 py-2 rounded-lg">{s.procedure || '—'}</p>
                      ) : (
                        <input type="text" value={s.procedure || ''} onChange={(e) => updateRow('surgeries', i, 'procedure', e.target.value)}
                          placeholder="Procedure name" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      )}
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Date</label>
                      {readOnly ? (
                        <p className="text-sm text-gray-900 bg-gray-50 px-3 py-2 rounded-lg">{s.date || '—'}</p>
                      ) : (
                        <input type="text" value={s.date || ''} onChange={(e) => updateRow('surgeries', i, 'date', e.target.value)}
                          placeholder="e.g. June 2024" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      )}
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Outcome</label>
                      {readOnly ? (
                        <p className="text-sm text-gray-900 bg-gray-50 px-3 py-2 rounded-lg">{s.outcome || '—'}</p>
                      ) : (
                        <input type="text" value={s.outcome || ''} onChange={(e) => updateRow('surgeries', i, 'outcome', e.target.value)}
                          placeholder="e.g. Full recovery" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {!readOnly && (
                <button type="button" onClick={() => addRow('surgeries')}
                  className="text-sm text-blue-600 hover:text-blue-800 flex items-center space-x-1">
                  <Plus size={14} /><span>Add Hospitalization / Surgery</span>
                </button>
              )}
              {readOnly && (responses.surgeries || []).length === 0 && (
                <p className="text-sm text-gray-400 italic">None listed</p>
              )}
            </div>
          </div>
        );

      case 7: // Nutrition, Hydration & Body Composition
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Daily Water Intake (oz)" fieldKey="water_intake" placeholder="e.g. 80" />
              <Field label="Meals Per Day" fieldKey="meals_per_day" placeholder="e.g. 3" />
              <Select label="Dietary Pattern" fieldKey="dietary_pattern" options={DIETARY_PATTERNS} />
            </div>
            <Select label="Do you currently work with a nutritionist?" fieldKey="nutritionist" options={YES_NO} />
            <div className="space-y-2">
              <YesNoField label="Do you track your caloric intake?" fieldKey="track_calories" />
              <YesNoField label="Have you ever had issues with rapid weight gain or loss?" fieldKey="weight_issues" />
              <YesNoField label="Do you use any weight-management strategies?" fieldKey="weight_management" />
              <YesNoField label="Have you ever felt pressure to change your body weight/composition?" fieldKey="body_pressure" />
              <YesNoField label="Do you take any performance-enhancing supplements?" fieldKey="performance_supplements" />
            </div>
          </div>
        );

      case 8: // Mental & Behavioral Health
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <YesNoField label="Have you ever been diagnosed with a mental health condition?" fieldKey="mental_health_dx" />
              <YesNoField label="Are you currently seeing a therapist, counselor, or psychologist?" fieldKey="seeing_therapist" />
              <YesNoField label="Have you ever felt persistently sad, hopeless, or lost interest in activities?" fieldKey="persistent_sadness" />
              <YesNoField label="Have you ever had thoughts of self-harm or suicide?" fieldKey="self_harm_thoughts" />
              <YesNoField label="Do you feel excessive worry or nervousness that interferes with daily life?" fieldKey="excessive_worry" />
              <YesNoField label="Have you ever experienced a panic attack?" fieldKey="panic_attack" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Average Hours of Sleep Per Night" fieldKey="avg_sleep" placeholder="e.g. 7.5" />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Current Stress Level (1-10)</label>
                {readOnly ? (
                  <p className="text-sm text-gray-900 bg-gray-50 px-3 py-2 rounded-lg">{responses.stress_level || <span className="text-gray-400 italic">Not provided</span>}</p>
                ) : (
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={responses.stress_level || 5}
                    onChange={(e) => set('stress_level', e.target.value)}
                    className="w-full mt-1"
                  />
                )}
                {!readOnly && <div className="flex justify-between text-xs text-gray-400 mt-1"><span>1 (Low)</span><span className="font-medium text-gray-700">{responses.stress_level || 5}</span><span>10 (High)</span></div>}
              </div>
            </div>
          </div>
        );

      case 9: // Lifestyle & Substance Use
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Select label="Tobacco / Nicotine Use" fieldKey="tobacco_use" options={FREQUENCY_OPTIONS} />
              <Select label="Alcohol Use" fieldKey="alcohol_use" options={FREQUENCY_OPTIONS} />
              <Select label="Recreational Drug Use" fieldKey="drug_use" options={FREQUENCY_OPTIONS} />
              <Select label="Caffeine Use" fieldKey="caffeine_use" options={FREQUENCY_OPTIONS} />
            </div>
            <div className="space-y-2">
              <YesNoField label="Do you use any performance-enhancing drugs (PEDs)?" fieldKey="ped_use" />
              <YesNoField label="Have you ever been treated for substance abuse?" fieldKey="substance_treatment" />
              <YesNoField label="Do you regularly use screens (phone/computer) within 1 hour of bedtime?" fieldKey="screens_bedtime" />
            </div>
          </div>
        );

      case 10: // Family Medical History
        return (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">Has anyone in your immediate family (parent, sibling, grandparent) been diagnosed with:</p>
            <YesNoDetail label="Heart disease or sudden cardiac death" fieldKey="family_cardiac" detailKey="family_cardiac_detail" />
            <YesNoDetail label="High blood pressure" fieldKey="family_hbp" detailKey="family_hbp_detail" />
            <YesNoDetail label="High cholesterol" fieldKey="family_cholesterol" detailKey="family_cholesterol_detail" />
            <YesNoDetail label="Diabetes (Type 1 or Type 2)" fieldKey="family_diabetes" detailKey="family_diabetes_detail" />
            <YesNoDetail label="Stroke" fieldKey="family_stroke" detailKey="family_stroke_detail" />
            <YesNoDetail label="Cancer" fieldKey="family_cancer" detailKey="family_cancer_detail" />
            <YesNoDetail label="Asthma or respiratory conditions" fieldKey="family_asthma" detailKey="family_asthma_detail" />
            <YesNoDetail label="Blood disorders (sickle cell, clotting)" fieldKey="family_blood" detailKey="family_blood_detail" />
            <YesNoDetail label="Mental health conditions" fieldKey="family_mental" detailKey="family_mental_detail" />
            <YesNoDetail label="Autoimmune conditions" fieldKey="family_autoimmune" detailKey="family_autoimmune_detail" />
            <YesNoDetail label="Substance abuse disorders" fieldKey="family_substance" detailKey="family_substance_detail" />
          </div>
        );

      case 11: // Consent & Attestation
        return (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900 space-y-3">
              <p>By signing below, I acknowledge and agree to the following:</p>
              <label className="flex items-start space-x-3">
                {readOnly ? (
                  <span className={`w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 mt-0.5 ${responses.consent_accurate ? 'bg-green-100 border-green-300' : 'border-gray-300'}`}>
                    {responses.consent_accurate && <span className="text-green-600 text-xs">&#10003;</span>}
                  </span>
                ) : (
                  <input type="checkbox" checked={!!responses.consent_accurate} onChange={(e) => set('consent_accurate', e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 mt-0.5" />
                )}
                <span>I certify that the information provided in this form is accurate and complete to the best of my knowledge. <span className="text-red-500">*</span></span>
              </label>
              <label className="flex items-start space-x-3">
                {readOnly ? (
                  <span className={`w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 mt-0.5 ${responses.consent_release ? 'bg-green-100 border-green-300' : 'border-gray-300'}`}>
                    {responses.consent_release && <span className="text-green-600 text-xs">&#10003;</span>}
                  </span>
                ) : (
                  <input type="checkbox" checked={!!responses.consent_release} onChange={(e) => set('consent_release', e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 mt-0.5" />
                )}
                <span>I authorize the release of the above medical information to coaching staff and athletic trainers for the purpose of ensuring my health and safety during athletic activities. <span className="text-red-500">*</span></span>
              </label>
              <label className="flex items-start space-x-3">
                {readOnly ? (
                  <span className={`w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 mt-0.5 ${responses.consent_emergency ? 'bg-green-100 border-green-300' : 'border-gray-300'}`}>
                    {responses.consent_emergency && <span className="text-green-600 text-xs">&#10003;</span>}
                  </span>
                ) : (
                  <input type="checkbox" checked={!!responses.consent_emergency} onChange={(e) => set('consent_emergency', e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 mt-0.5" />
                )}
                <span>I consent to emergency medical treatment if needed and I am unable to provide consent at the time of the emergency.</span>
              </label>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Signature (typed full name)" fieldKey="signature" required placeholder="Type your full legal name" />
              <Field label="Date" fieldKey="signature_date" type="date" required />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Parent/Guardian Signature (if minor)" fieldKey="guardian_signature" placeholder="Type guardian full name" />
              <Field label="Guardian Signature Date" fieldKey="guardian_signature_date" type="date" />
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      {/* Status banner */}
      {existingRecord && readOnly && (
        <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          <div className="flex items-center space-x-2">
            <CheckCircle className="text-green-600" size={18} />
            <span className="text-green-700 font-medium text-sm">Completed</span>
            {existingRecord.signed_at && (
              <span className="text-green-600 text-sm">
                on {new Date(existingRecord.signed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
              </span>
            )}
          </div>
          {canEdit && (
            <button
              onClick={() => { setReadOnly(false); setExpandedSections(new Set([0])); }}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              Edit Responses
            </button>
          )}
        </div>
      )}

      {/* Sections */}
      {SECTIONS.map((section, i) => (
        <div key={i} className="border border-gray-200 rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => toggleSection(i)}
            className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition text-left"
          >
            <div className="flex items-center space-x-3">
              <span className="text-xs font-bold text-gray-400 bg-gray-200 rounded-full w-6 h-6 flex items-center justify-center">{i + 1}</span>
              <span className="text-sm font-semibold text-gray-800">{section}</span>
            </div>
            {expandedSections.has(i) ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
          </button>
          {expandedSections.has(i) && (
            <div className="px-4 py-4 border-t border-gray-200">
              {renderSection(i)}
            </div>
          )}
        </div>
      ))}

      {/* Submit button */}
      {!readOnly && (
        <div className="flex justify-end pt-2">
          {existingRecord && (
            <button
              type="button"
              onClick={() => { setReadOnly(true); setResponses(existingRecord.responses || {}); }}
              className="mr-3 px-6 py-2.5 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition text-sm"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 flex items-center space-x-2 text-sm"
          >
            <Save size={16} />
            <span>{saving ? 'Saving...' : existingRecord ? 'Update Medical History' : 'Submit Medical History'}</span>
          </button>
        </div>
      )}
    </div>
  );
}
