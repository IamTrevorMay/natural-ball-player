import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { CheckCircle, AlertTriangle, Eraser } from 'lucide-react';

const CONDUCT_ITEMS = [
  'I will attend all practices and games unless excused by the coaching staff.',
  'I will arrive on time and prepared for all team activities.',
  'I will maintain a positive attitude and demonstrate good sportsmanship at all times.',
  'I will respect all coaches, teammates, opponents, umpires, and spectators.',
  'I will refrain from the use of profanity, inappropriate language, or gestures.',
  'I will not engage in bullying, hazing, or any form of harassment.',
  'I will take care of all team equipment and return it in good condition.',
  'I will represent the Dudes Baseball organization with pride and integrity.',
  'I will communicate any conflicts or absences to the coaching staff in advance.',
  'I will maintain satisfactory academic standing during the season.',
  'I will not use or possess alcohol, tobacco, or illegal substances.',
  'I will follow all facility rules and safety guidelines.',
  'I will support and encourage my teammates at all times.',
  'I will accept coaching decisions regarding playing time, positions, and strategy.',
  'I will refrain from negative social media posts about the team, coaches, or opponents.',
  'I will dress appropriately and wear the proper uniform during games and team events.',
  'I will hustle and give maximum effort during all practices and games.',
  'I will not throw equipment or display unsportsmanlike conduct.',
  'I will resolve conflicts in a mature and respectful manner.',
  'I understand that violations may result in disciplinary action up to and including dismissal from the team.',
  'I have read, understand, and agree to abide by all terms of this code of conduct.'
];

const VIOLATION_TABLE = [
  { offense: '1st Offense', consequence: 'Verbal warning and meeting with coaching staff' },
  { offense: '2nd Offense', consequence: 'One-game suspension and parent/guardian notification' },
  { offense: '3rd Offense', consequence: 'Multi-game suspension and mandatory parent/guardian meeting' },
  { offense: '4th Offense', consequence: 'Dismissal from the team (no refund)' },
];

const MEDICAL_RELEASE_TEXT = `MEDICAL RELEASE & LIABILITY WAIVER

I, the undersigned parent/guardian, hereby give my consent for my child to participate in all activities associated with the Dudes Baseball 2026-2027 season, including but not limited to practices, games, tournaments, and travel.

I understand that participation in baseball involves inherent risks of injury. I voluntarily assume all risks associated with my child's participation and release the Dudes Baseball organization, its coaches, staff, volunteers, and affiliates from any and all liability for injuries sustained during team activities.

In the event of an emergency, I authorize the coaching staff to seek and obtain emergency medical treatment for my child. I understand that I am financially responsible for any medical expenses incurred.

PHOTO/MEDIA RELEASE: I grant permission for photographs, videos, and other media of my child taken during team activities to be used for promotional, educational, and social media purposes by the Dudes Baseball organization.

COMMUNICATION CONSENT: I consent to receive communications from the Dudes Baseball organization via email, text message, and phone regarding team activities, schedules, and important updates.`;

const PAYMENT_TEXT = `TEAM FEE & PAYMENT PLAN

Season Fee: $2,500 per player for the 2026-2027 season.

The fee covers:
- All practice facility costs
- Tournament entry fees (up to 8 tournaments)
- Team uniforms (jersey, pants, hat)
- Insurance coverage during team activities
- Coaching and instruction

Not included:
- Personal equipment (glove, bat, cleats, etc.)
- Travel and lodging for away tournaments
- Additional tournament entry fees beyond 8

Payment Plans:
- Full Payment: $2,500 due at contract signing (save $100 - pay $2,400)
- Two Payments: $1,250 due at signing + $1,250 due by December 1, 2026
- Monthly Plan: $425/month for 6 months beginning at signing

All fees are non-refundable after the first scheduled team practice. Requests for refunds before the first practice will be reviewed on a case-by-case basis.`;

const POSITION_OPTIONS = ['1B', '2B', '3B', 'SS', 'OF', 'P', 'C'];
const BATS_THROWS_OPTIONS = ['R/R', 'L/L', 'R/L', 'L/R'];

const SIZE_OPTIONS = {
  shorts: ['YS', 'YM', 'YL', 'YXL', 'AS', 'AM', 'AL', 'AXL', 'A2XL'],
  pants: ['YS', 'YM', 'YL', 'YXL', 'AS', 'AM', 'AL', 'AXL', 'A2XL'],
  belt: ['Youth', 'Adult S', 'Adult M', 'Adult L', 'Adult XL'],
  shirt: ['YS', 'YM', 'YL', 'YXL', 'AS', 'AM', 'AL', 'AXL', 'A2XL'],
  sweatshirt: ['YS', 'YM', 'YL', 'YXL', 'AS', 'AM', 'AL', 'AXL', 'A2XL'],
  helmet: ['6 1/4', '6 3/8', '6 1/2', '6 5/8', '6 3/4', '6 7/8', '7', '7 1/8', '7 1/4', '7 3/8', '7 1/2'],
  hat: ['YS/M', 'YM/L', 'AS/M', 'AM/L', 'AL/XL'],
};

export default function ContractPage({ userId, userRole, onSigned }) {
  const [loading, setLoading] = useState(true);
  const [existingContract, setExistingContract] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Player Info
  const [playerName, setPlayerName] = useState('');
  const [birthdate, setBirthdate] = useState('');
  const [positions, setPositions] = useState([]);
  const [batsThrows, setBatsThrows] = useState('');
  const [gradYear, setGradYear] = useState('');
  const [highSchool, setHighSchool] = useState('');
  const [gpa, setGpa] = useState('');

  // Family Contact
  const [primaryParentName, setPrimaryParentName] = useState('');
  const [primaryPhone, setPrimaryPhone] = useState('');
  const [primaryEmail, setPrimaryEmail] = useState('');
  const [secondaryParentName, setSecondaryParentName] = useState('');
  const [secondaryPhone, setSecondaryPhone] = useState('');
  const [secondaryEmail, setSecondaryEmail] = useState('');

  // Sizing
  const [shortsSize, setShortsSize] = useState('');
  const [pantsSize, setPantsSize] = useState('');
  const [beltSize, setBeltSize] = useState('');
  const [shirtSize, setShirtSize] = useState('');
  const [sweatshirtSize, setSweatshirtSize] = useState('');
  const [helmetSize, setHelmetSize] = useState('');
  const [hatSize, setHatSize] = useState('');

  // Conduct
  const [conductChecks, setConductChecks] = useState(new Array(CONDUCT_ITEMS.length).fill(false));

  // Medical Consent
  const [consentParentFirst, setConsentParentFirst] = useState('');
  const [consentParentLast, setConsentParentLast] = useState('');
  const [playerFirst, setPlayerFirst] = useState('');
  const [playerLast, setPlayerLast] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [stateName, setStateName] = useState('');
  const [zip, setZip] = useState('');
  const [allergies, setAllergies] = useState('');
  const [specialMedications, setSpecialMedications] = useState('');
  const [insuranceProvider, setInsuranceProvider] = useState('');
  const [insurancePolicy, setInsurancePolicy] = useState('');
  const [preferredHospital, setPreferredHospital] = useState('');

  // Signatures
  const [playerSigFirst, setPlayerSigFirst] = useState('');
  const [playerSigLast, setPlayerSigLast] = useState('');
  const [parentSigFirst, setParentSigFirst] = useState('');
  const [parentSigLast, setParentSigLast] = useState('');

  // Canvas refs
  const playerCanvasRef = useRef(null);
  const parentCanvasRef = useRef(null);
  const [playerDrawing, setPlayerDrawing] = useState(false);
  const [parentDrawing, setParentDrawing] = useState(false);
  const [playerHasSignature, setPlayerHasSignature] = useState(false);
  const [parentHasSignature, setParentHasSignature] = useState(false);

  useEffect(() => {
    fetchContract();
  }, [userId]);

  const fetchContract = async () => {
    try {
      const { data, error } = await supabase
        .from('player_contracts')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      setExistingContract(data);
    } catch (error) {
      console.error('Error fetching contract:', error);
    } finally {
      setLoading(false);
    }
  };

  // Canvas drawing helpers (same as WaiverPage)
  const initCanvas = useCallback((canvas) => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    ctx.scale(2, 2);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  useEffect(() => {
    if (!loading && !existingContract) {
      initCanvas(playerCanvasRef.current);
      initCanvas(parentCanvasRef.current);
    }
  }, [loading, existingContract, initCanvas]);

  const getPos = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const startDraw = (e, canvasRef, setDrawing) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    setDrawing(true);
  };

  const draw = (e, canvasRef, drawing, setHasSig) => {
    e.preventDefault();
    if (!drawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const pos = getPos(e, canvas);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    setHasSig(true);
  };

  const stopDraw = (setDrawing) => { setDrawing(false); };

  const clearCanvas = (canvasRef, setHasSig) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSig(false);
  };

  const canvasToBlob = (canvasRef) => {
    return new Promise((resolve) => {
      canvasRef.current.toBlob(resolve, 'image/png');
    });
  };

  const togglePosition = (pos) => {
    setPositions(prev => prev.includes(pos) ? prev.filter(p => p !== pos) : [...prev, pos]);
  };

  const toggleConduct = (idx) => {
    setConductChecks(prev => { const next = [...prev]; next[idx] = !next[idx]; return next; });
  };

  const handleSubmit = async () => {
    if (!playerName.trim()) return alert('Please enter the player name.');
    if (!conductChecks.every(Boolean)) return alert('Please agree to all Code of Conduct items.');
    if (!playerHasSignature) return alert('Please provide the player signature.');
    if (!parentHasSignature) return alert('Please provide the parent/guardian signature.');
    if (!consentParentFirst.trim() || !consentParentLast.trim()) return alert('Please fill in parent/guardian name in the medical consent section.');
    if (!playerFirst.trim() || !playerLast.trim()) return alert('Please fill in player name in the medical consent section.');
    if (!playerSigFirst.trim() || !playerSigLast.trim()) return alert('Please enter the player\'s printed name for the signature.');
    if (!parentSigFirst.trim() || !parentSigLast.trim()) return alert('Please enter the parent/guardian\'s printed name for the signature.');

    setSubmitting(true);
    try {
      const timestamp = Date.now();

      // Upload player signature
      const playerBlob = await canvasToBlob(playerCanvasRef);
      const playerPath = `${userId}/contract-player-${timestamp}.png`;
      const { error: pErr } = await supabase.storage
        .from('signatures')
        .upload(playerPath, playerBlob, { contentType: 'image/png', upsert: true });
      if (pErr) throw pErr;
      const { data: { publicUrl: playerSigUrl } } = supabase.storage
        .from('signatures')
        .getPublicUrl(playerPath);

      // Upload parent signature
      const parentBlob = await canvasToBlob(parentCanvasRef);
      const parentPath = `${userId}/contract-parent-${timestamp}.png`;
      const { error: gErr } = await supabase.storage
        .from('signatures')
        .upload(parentPath, parentBlob, { contentType: 'image/png', upsert: true });
      if (gErr) throw gErr;
      const { data: { publicUrl: parentSigUrl } } = supabase.storage
        .from('signatures')
        .getPublicUrl(parentPath);

      const { error: insertErr } = await supabase
        .from('player_contracts')
        .insert({
          user_id: userId,
          player_name: playerName.trim(),
          birthdate: birthdate || null,
          positions: positions.length > 0 ? positions : null,
          bats_throws: batsThrows || null,
          grad_year: gradYear || null,
          high_school: highSchool.trim() || null,
          gpa: gpa.trim() || null,
          primary_parent_name: primaryParentName.trim() || null,
          primary_phone: primaryPhone.trim() || null,
          primary_email: primaryEmail.trim() || null,
          secondary_parent_name: secondaryParentName.trim() || null,
          secondary_phone: secondaryPhone.trim() || null,
          secondary_email: secondaryEmail.trim() || null,
          shorts_size: shortsSize || null,
          pants_size: pantsSize || null,
          belt_size: beltSize || null,
          shirt_size: shirtSize || null,
          sweatshirt_size: sweatshirtSize || null,
          helmet_size: helmetSize || null,
          hat_size: hatSize || null,
          conduct_agreed: true,
          consent_parent_first: consentParentFirst.trim() || null,
          consent_parent_last: consentParentLast.trim() || null,
          player_first: playerFirst.trim() || null,
          player_last: playerLast.trim() || null,
          address: address.trim() || null,
          city: city.trim() || null,
          state: stateName.trim() || null,
          zip: zip.trim() || null,
          allergies: allergies.trim() || null,
          special_medications: specialMedications.trim() || null,
          insurance_provider: insuranceProvider.trim() || null,
          insurance_policy: insurancePolicy.trim() || null,
          preferred_hospital: preferredHospital.trim() || null,
          player_signature_url: playerSigUrl,
          parent_signature_url: parentSigUrl,
        });

      if (insertErr) throw insertErr;

      await fetchContract();
      if (onSigned) onSigned();
      alert('Contract signed successfully!');
    } catch (error) {
      console.error('Error submitting contract:', error);
      alert('Error submitting contract: ' + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Loading contract...</p>
      </div>
    );
  }

  // Already signed view
  if (existingContract) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Player Contract</h2>
          <p className="text-gray-600 mt-1">Dudes Baseball 2026-2027 Season</p>
        </div>

        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center space-x-3">
          <CheckCircle className="text-green-600 flex-shrink-0" size={24} />
          <div>
            <p className="font-semibold text-green-800">Contract Signed</p>
            <p className="text-sm text-green-700">
              Signed on {new Date(existingContract.signed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 space-y-6">
          {/* Player Info Summary */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Player Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <p className="text-sm text-gray-600">Player Name</p>
                <p className="text-gray-900 font-medium">{existingContract.player_name}</p>
              </div>
              {existingContract.birthdate && (
                <div>
                  <p className="text-sm text-gray-600">Birthdate</p>
                  <p className="text-gray-900 font-medium">{existingContract.birthdate}</p>
                </div>
              )}
              {existingContract.positions?.length > 0 && (
                <div>
                  <p className="text-sm text-gray-600">Positions</p>
                  <p className="text-gray-900 font-medium">{existingContract.positions.join(', ')}</p>
                </div>
              )}
              {existingContract.bats_throws && (
                <div>
                  <p className="text-sm text-gray-600">Bats/Throws</p>
                  <p className="text-gray-900 font-medium">{existingContract.bats_throws}</p>
                </div>
              )}
              {existingContract.grad_year && (
                <div>
                  <p className="text-sm text-gray-600">Grad Year</p>
                  <p className="text-gray-900 font-medium">{existingContract.grad_year}</p>
                </div>
              )}
              {existingContract.high_school && (
                <div>
                  <p className="text-sm text-gray-600">High School</p>
                  <p className="text-gray-900 font-medium">{existingContract.high_school}</p>
                </div>
              )}
              {existingContract.gpa && (
                <div>
                  <p className="text-sm text-gray-600">GPA</p>
                  <p className="text-gray-900 font-medium">{existingContract.gpa}</p>
                </div>
              )}
            </div>
          </div>

          {/* Family Contact Summary */}
          {existingContract.primary_parent_name && (
            <div className="border-t border-gray-200 pt-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">Family Contact</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Primary Parent/Guardian</p>
                  <p className="text-gray-900 font-medium">{existingContract.primary_parent_name}</p>
                </div>
                {existingContract.primary_phone && (
                  <div>
                    <p className="text-sm text-gray-600">Phone</p>
                    <p className="text-gray-900 font-medium">{existingContract.primary_phone}</p>
                  </div>
                )}
                {existingContract.primary_email && (
                  <div>
                    <p className="text-sm text-gray-600">Email</p>
                    <p className="text-gray-900 font-medium">{existingContract.primary_email}</p>
                  </div>
                )}
              </div>
              {existingContract.secondary_parent_name && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
                  <div>
                    <p className="text-sm text-gray-600">Secondary Parent/Guardian</p>
                    <p className="text-gray-900 font-medium">{existingContract.secondary_parent_name}</p>
                  </div>
                  {existingContract.secondary_phone && (
                    <div>
                      <p className="text-sm text-gray-600">Phone</p>
                      <p className="text-gray-900 font-medium">{existingContract.secondary_phone}</p>
                    </div>
                  )}
                  {existingContract.secondary_email && (
                    <div>
                      <p className="text-sm text-gray-600">Email</p>
                      <p className="text-gray-900 font-medium">{existingContract.secondary_email}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Conduct Agreed */}
          <div className="border-t border-gray-200 pt-4">
            <div className="flex items-center space-x-2">
              <CheckCircle size={18} className="text-green-600" />
              <p className="text-gray-900 font-medium">Code of Conduct Agreed</p>
            </div>
          </div>

          {/* Signatures */}
          <div className="border-t border-gray-200 pt-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Signatures</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <p className="text-sm text-gray-600 mb-1">Player Signature</p>
                <img
                  src={existingContract.player_signature_url}
                  alt="Player Signature"
                  className="border border-gray-200 rounded bg-white max-h-24"
                />
              </div>
              <div>
                <p className="text-sm text-gray-600 mb-1">Parent/Guardian Signature</p>
                <img
                  src={existingContract.parent_signature_url}
                  alt="Parent Signature"
                  className="border border-gray-200 rounded bg-white max-h-24"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Unsigned view — signing form
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-gray-900">Player Contract</h2>
        <p className="text-gray-600 mt-1">Dudes Baseball 2026-2027 Season</p>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-center space-x-3">
        <AlertTriangle className="text-yellow-600 flex-shrink-0" size={24} />
        <p className="text-sm text-yellow-800">Please complete all sections and sign the contract below.</p>
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="p-6 space-y-8">

          {/* Section 1: Player Information */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Player Information</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Player Full Name *</label>
                <input
                  type="text"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder="Enter player's full name"
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Birthdate</label>
                  <input
                    type="date"
                    value={birthdate}
                    onChange={(e) => setBirthdate(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Graduation Year</label>
                  <input
                    type="text"
                    value={gradYear}
                    onChange={(e) => setGradYear(e.target.value)}
                    placeholder="e.g. 2028"
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">GPA</label>
                  <input
                    type="text"
                    value={gpa}
                    onChange={(e) => setGpa(e.target.value)}
                    placeholder="e.g. 3.5"
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">High School</label>
                <input
                  type="text"
                  value={highSchool}
                  onChange={(e) => setHighSchool(e.target.value)}
                  placeholder="Enter high school name"
                  className="w-full md:w-1/2 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Positions</label>
                <div className="flex flex-wrap gap-3">
                  {POSITION_OPTIONS.map(pos => (
                    <label key={pos} className="flex items-center space-x-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={positions.includes(pos)}
                        onChange={() => togglePosition(pos)}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700">{pos}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Bats / Throws</label>
                <div className="flex flex-wrap gap-4">
                  {BATS_THROWS_OPTIONS.map(opt => (
                    <label key={opt} className="flex items-center space-x-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="batsThrows"
                        checked={batsThrows === opt}
                        onChange={() => setBatsThrows(opt)}
                        className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700">{opt}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Family Contact */}
          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Family Contact</h3>
            <div className="space-y-4">
              <p className="text-sm font-medium text-gray-600">Primary Parent / Guardian</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input type="text" value={primaryParentName} onChange={(e) => setPrimaryParentName(e.target.value)} placeholder="Full name" className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input type="tel" value={primaryPhone} onChange={(e) => setPrimaryPhone(e.target.value)} placeholder="Phone number" className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input type="email" value={primaryEmail} onChange={(e) => setPrimaryEmail(e.target.value)} placeholder="Email address" className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>

              <p className="text-sm font-medium text-gray-600 mt-4">Secondary Parent / Guardian</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input type="text" value={secondaryParentName} onChange={(e) => setSecondaryParentName(e.target.value)} placeholder="Full name" className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input type="tel" value={secondaryPhone} onChange={(e) => setSecondaryPhone(e.target.value)} placeholder="Phone number" className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input type="email" value={secondaryEmail} onChange={(e) => setSecondaryEmail(e.target.value)} placeholder="Email address" className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Uniform & Equipment Sizing */}
          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Uniform & Equipment Sizing</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {[
                { label: 'Shorts', value: shortsSize, setter: setShortsSize, options: SIZE_OPTIONS.shorts },
                { label: 'Pants', value: pantsSize, setter: setPantsSize, options: SIZE_OPTIONS.pants },
                { label: 'Belt', value: beltSize, setter: setBeltSize, options: SIZE_OPTIONS.belt },
                { label: 'Shirt / Jersey', value: shirtSize, setter: setShirtSize, options: SIZE_OPTIONS.shirt },
                { label: 'Sweatshirt', value: sweatshirtSize, setter: setSweatshirtSize, options: SIZE_OPTIONS.sweatshirt },
                { label: 'Helmet', value: helmetSize, setter: setHelmetSize, options: SIZE_OPTIONS.helmet },
                { label: 'Hat', value: hatSize, setter: setHatSize, options: SIZE_OPTIONS.hat },
              ].map(({ label, value, setter, options }) => (
                <div key={label}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                  <select
                    value={value}
                    onChange={(e) => setter(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white"
                  >
                    <option value="">Select size</option>
                    {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* Section 4: Code of Conduct */}
          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Code of Conduct</h3>
            <p className="text-sm text-gray-600 mb-4">Please read and agree to each item below. All items must be checked.</p>
            <div className="space-y-3 max-h-96 overflow-y-auto border border-gray-200 rounded-lg p-4 bg-gray-50">
              {CONDUCT_ITEMS.map((item, idx) => (
                <label key={idx} className="flex items-start space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={conductChecks[idx]}
                    onChange={() => toggleConduct(idx)}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 mt-0.5 flex-shrink-0"
                  />
                  <span className="text-sm text-gray-700">{idx + 1}. {item}</span>
                </label>
              ))}
            </div>
            <p className="text-sm mt-2 text-gray-500">
              {conductChecks.filter(Boolean).length} of {CONDUCT_ITEMS.length} items checked
            </p>
          </div>

          {/* Section 5: Violations */}
          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Violations & Disciplinary Action</h3>
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left px-4 py-2 font-semibold text-gray-700 border-b border-gray-200">Offense</th>
                    <th className="text-left px-4 py-2 font-semibold text-gray-700 border-b border-gray-200">Consequence</th>
                  </tr>
                </thead>
                <tbody>
                  {VIOLATION_TABLE.map((row, idx) => (
                    <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-2 text-gray-900 font-medium border-b border-gray-100">{row.offense}</td>
                      <td className="px-4 py-2 text-gray-700 border-b border-gray-100">{row.consequence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 6: Medical Release / Liability / Photo-Media / Communication Consent */}
          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Medical Release, Liability & Consent</h3>
            <div className="max-h-60 overflow-y-auto border border-gray-200 rounded-lg p-4 bg-gray-50">
              <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans">{MEDICAL_RELEASE_TEXT}</pre>
            </div>
          </div>

          {/* Section 7: Consent to Treat Minor */}
          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Consent to Treat Minor</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Parent/Guardian First Name *</label>
                  <input type="text" value={consentParentFirst} onChange={(e) => setConsentParentFirst(e.target.value)} className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Parent/Guardian Last Name *</label>
                  <input type="text" value={consentParentLast} onChange={(e) => setConsentParentLast(e.target.value)} className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Player First Name *</label>
                  <input type="text" value={playerFirst} onChange={(e) => setPlayerFirst(e.target.value)} className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Player Last Name *</label>
                  <input type="text" value={playerLast} onChange={(e) => setPlayerLast(e.target.value)} className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street address" className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                  <input type="text" value={city} onChange={(e) => setCity(e.target.value)} className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                  <input type="text" value={stateName} onChange={(e) => setStateName(e.target.value)} className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">ZIP</label>
                  <input type="text" value={zip} onChange={(e) => setZip(e.target.value)} className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Allergies</label>
                  <input type="text" value={allergies} onChange={(e) => setAllergies(e.target.value)} placeholder="List any allergies or 'None'" className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Special Medications</label>
                  <input type="text" value={specialMedications} onChange={(e) => setSpecialMedications(e.target.value)} placeholder="List any medications or 'None'" className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Insurance Provider</label>
                  <input type="text" value={insuranceProvider} onChange={(e) => setInsuranceProvider(e.target.value)} className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Policy #</label>
                  <input type="text" value={insurancePolicy} onChange={(e) => setInsurancePolicy(e.target.value)} className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Preferred Hospital</label>
                  <input type="text" value={preferredHospital} onChange={(e) => setPreferredHospital(e.target.value)} className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
            </div>
          </div>

          {/* Section 8: Team Fee & Payment Plan */}
          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Team Fee & Payment Plan</h3>
            <div className="max-h-60 overflow-y-auto border border-gray-200 rounded-lg p-4 bg-gray-50">
              <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans">{PAYMENT_TEXT}</pre>
            </div>
          </div>

          {/* Section 9: Signatures */}
          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Signatures</h3>

            {/* Player Signature */}
            <div className="space-y-4 mb-8">
              <p className="text-sm font-semibold text-gray-700">Player Signature</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">First Name *</label>
                  <input type="text" value={playerSigFirst} onChange={(e) => setPlayerSigFirst(e.target.value)} className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Last Name *</label>
                  <input type="text" value={playerSigLast} onChange={(e) => setPlayerSigLast(e.target.value)} className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Signature *</label>
                <div className="border border-gray-300 rounded-lg overflow-hidden bg-white">
                  <canvas
                    ref={playerCanvasRef}
                    className="w-full cursor-crosshair touch-none"
                    style={{ height: '120px' }}
                    onMouseDown={(e) => startDraw(e, playerCanvasRef, setPlayerDrawing)}
                    onMouseMove={(e) => draw(e, playerCanvasRef, playerDrawing, setPlayerHasSignature)}
                    onMouseUp={() => stopDraw(setPlayerDrawing)}
                    onMouseLeave={() => stopDraw(setPlayerDrawing)}
                    onTouchStart={(e) => startDraw(e, playerCanvasRef, setPlayerDrawing)}
                    onTouchMove={(e) => draw(e, playerCanvasRef, playerDrawing, setPlayerHasSignature)}
                    onTouchEnd={() => stopDraw(setPlayerDrawing)}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => clearCanvas(playerCanvasRef, setPlayerHasSignature)}
                  className="mt-2 text-sm text-gray-500 hover:text-gray-700 flex items-center space-x-1"
                >
                  <Eraser size={14} />
                  <span>Clear Signature</span>
                </button>
              </div>
              <p className="text-sm text-gray-500">Date: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </div>

            {/* Parent/Guardian Signature */}
            <div className="space-y-4">
              <p className="text-sm font-semibold text-gray-700">Parent / Guardian Signature</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">First Name *</label>
                  <input type="text" value={parentSigFirst} onChange={(e) => setParentSigFirst(e.target.value)} className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Last Name *</label>
                  <input type="text" value={parentSigLast} onChange={(e) => setParentSigLast(e.target.value)} className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Signature *</label>
                <div className="border border-gray-300 rounded-lg overflow-hidden bg-white">
                  <canvas
                    ref={parentCanvasRef}
                    className="w-full cursor-crosshair touch-none"
                    style={{ height: '120px' }}
                    onMouseDown={(e) => startDraw(e, parentCanvasRef, setParentDrawing)}
                    onMouseMove={(e) => draw(e, parentCanvasRef, parentDrawing, setParentHasSignature)}
                    onMouseUp={() => stopDraw(setParentDrawing)}
                    onMouseLeave={() => stopDraw(setParentDrawing)}
                    onTouchStart={(e) => startDraw(e, parentCanvasRef, setParentDrawing)}
                    onTouchMove={(e) => draw(e, parentCanvasRef, parentDrawing, setParentHasSignature)}
                    onTouchEnd={() => stopDraw(setParentDrawing)}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => clearCanvas(parentCanvasRef, setParentHasSignature)}
                  className="mt-2 text-sm text-gray-500 hover:text-gray-700 flex items-center space-x-1"
                >
                  <Eraser size={14} />
                  <span>Clear Signature</span>
                </button>
              </div>
              <p className="text-sm text-gray-500">Date: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </div>
          </div>

          {/* Submit */}
          <div className="border-t border-gray-200 pt-4">
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Sign Contract'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
