import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { CheckCircle, AlertTriangle, Eraser } from 'lucide-react';
import SignedSignatureImage from './SignedSignatureImage';
import { formatUserError } from './errorMessage';

const COMMITMENT_ITEMS = [
  'I commit to participate in the Naturals Select program for the 2026-2027 season.',
  'I understand that a roster spot is being reserved for me upon signing this Letter of Intent.',
  'I will attend all mandatory team activities including practices, games, and tournaments as scheduled.',
  'I agree to uphold the values and standards of the Naturals Select organization.',
  'I understand this Letter of Intent is non-binding but represents a good-faith commitment to the program.',
  'I acknowledge that final enrollment is subject to completion of the Player Contract and all required documents.',
];

const POSITION_OPTIONS = ['1B', '2B', '3B', 'SS', 'OF', 'P', 'C'];

export default function LetterOfIntentPage({ userId, userRole, onSigned }) {
  const [loading, setLoading] = useState(true);
  const [existing, setExisting] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const [playerName, setPlayerName] = useState('');
  const [birthdate, setBirthdate] = useState('');
  const [positions, setPositions] = useState([]);
  const [gradYear, setGradYear] = useState('');
  const [highSchool, setHighSchool] = useState('');
  const [parentName, setParentName] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [parentEmail, setParentEmail] = useState('');
  const [commitmentChecks, setCommitmentChecks] = useState(new Array(COMMITMENT_ITEMS.length).fill(false));

  const [playerSigFirst, setPlayerSigFirst] = useState('');
  const [playerSigLast, setPlayerSigLast] = useState('');
  const [parentSigFirst, setParentSigFirst] = useState('');
  const [parentSigLast, setParentSigLast] = useState('');

  const playerCanvasRef = useRef(null);
  const parentCanvasRef = useRef(null);
  const [playerDrawing, setPlayerDrawing] = useState(false);
  const [parentDrawing, setParentDrawing] = useState(false);
  const [playerHasSignature, setPlayerHasSignature] = useState(false);
  const [parentHasSignature, setParentHasSignature] = useState(false);

  useEffect(() => { fetchLOI(); }, [userId]);

  const fetchLOI = async () => {
    try {
      const { data, error } = await supabase
        .from('player_letters_of_intent')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      setExisting(data);
    } catch (error) {
      console.error('Error fetching LOI:', error);
    } finally {
      setLoading(false);
    }
  };

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
    if (!loading && !existing) {
      initCanvas(playerCanvasRef.current);
      initCanvas(parentCanvasRef.current);
    }
  }, [loading, existing, initCanvas]);

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

  const canvasToBlob = (canvasRef) => new Promise((resolve) => {
    canvasRef.current.toBlob(resolve, 'image/png');
  });

  const togglePosition = (pos) => {
    setPositions(prev => prev.includes(pos) ? prev.filter(p => p !== pos) : [...prev, pos]);
  };

  const handleSubmit = async () => {
    if (!playerName.trim()) return alert('Please enter the player name.');
    if (!commitmentChecks.every(Boolean)) return alert('Please agree to all commitment items.');
    if (!playerHasSignature) return alert('Please provide the player signature.');
    if (!parentHasSignature) return alert('Please provide the parent/guardian signature.');
    if (!playerSigFirst.trim() || !playerSigLast.trim()) return alert('Please enter the player\'s printed name.');
    if (!parentSigFirst.trim() || !parentSigLast.trim()) return alert('Please enter the parent/guardian\'s printed name.');

    setSubmitting(true);
    try {
      const timestamp = Date.now();

      const playerBlob = await canvasToBlob(playerCanvasRef);
      const playerPath = `${userId}/loi-player-${timestamp}.png`;
      const { error: pErr } = await supabase.storage
        .from('signatures')
        .upload(playerPath, playerBlob, { contentType: 'image/png', upsert: true });
      if (pErr) throw pErr;

      const parentBlob = await canvasToBlob(parentCanvasRef);
      const parentPath = `${userId}/loi-parent-${timestamp}.png`;
      const { error: gErr } = await supabase.storage
        .from('signatures')
        .upload(parentPath, parentBlob, { contentType: 'image/png', upsert: true });
      if (gErr) throw gErr;

      const { error: insertErr } = await supabase
        .from('player_letters_of_intent')
        .insert({
          user_id: userId,
          player_name: playerName.trim(),
          birthdate: birthdate || null,
          positions: positions.length > 0 ? positions : null,
          grad_year: gradYear || null,
          high_school: highSchool.trim() || null,
          parent_name: parentName.trim() || null,
          parent_phone: parentPhone.trim() || null,
          parent_email: parentEmail.trim() || null,
          commitment_agreed: true,
          player_sig_first: playerSigFirst.trim(),
          player_sig_last: playerSigLast.trim(),
          parent_sig_first: parentSigFirst.trim(),
          parent_sig_last: parentSigLast.trim(),
          player_signature_url: playerPath,
          parent_signature_url: parentPath,
        });

      if (insertErr) throw insertErr;

      await fetchLOI();
      if (onSigned) onSigned();
      alert('Letter of Intent signed successfully!');
    } catch (error) {
      console.error('Error submitting LOI:', error);
      alert('Error submitting Letter of Intent: ' + formatUserError(error));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  if (existing) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Letter of Intent</h2>
          <p className="text-gray-600 mt-1">Naturals Select 2026-2027 Season</p>
        </div>

        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center space-x-3">
          <CheckCircle className="text-green-600 flex-shrink-0" size={24} />
          <div>
            <p className="font-semibold text-green-800">Letter of Intent Signed</p>
            <p className="text-sm text-green-700">
              Signed on {new Date(existing.signed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 space-y-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Player Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <p className="text-sm text-gray-600">Player Name</p>
                <p className="text-gray-900 font-medium">{existing.player_name}</p>
              </div>
              {existing.birthdate && (
                <div>
                  <p className="text-sm text-gray-600">Birthdate</p>
                  <p className="text-gray-900 font-medium">{existing.birthdate}</p>
                </div>
              )}
              {existing.positions?.length > 0 && (
                <div>
                  <p className="text-sm text-gray-600">Positions</p>
                  <p className="text-gray-900 font-medium">{existing.positions.join(', ')}</p>
                </div>
              )}
              {existing.grad_year && (
                <div>
                  <p className="text-sm text-gray-600">Grad Year</p>
                  <p className="text-gray-900 font-medium">{existing.grad_year}</p>
                </div>
              )}
              {existing.high_school && (
                <div>
                  <p className="text-sm text-gray-600">High School</p>
                  <p className="text-gray-900 font-medium">{existing.high_school}</p>
                </div>
              )}
            </div>
          </div>

          {existing.parent_name && (
            <div className="border-t border-gray-200 pt-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">Parent/Guardian</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Name</p>
                  <p className="text-gray-900 font-medium">{existing.parent_name}</p>
                </div>
                {existing.parent_phone && (
                  <div>
                    <p className="text-sm text-gray-600">Phone</p>
                    <p className="text-gray-900 font-medium">{existing.parent_phone}</p>
                  </div>
                )}
                {existing.parent_email && (
                  <div>
                    <p className="text-sm text-gray-600">Email</p>
                    <p className="text-gray-900 font-medium">{existing.parent_email}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="border-t border-gray-200 pt-4">
            <div className="flex items-center space-x-2">
              <CheckCircle size={18} className="text-green-600" />
              <p className="text-gray-900 font-medium">Commitment Items Agreed</p>
            </div>
          </div>

          <div className="border-t border-gray-200 pt-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Signatures</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <p className="text-sm text-gray-600 mb-1">Player Signature</p>
                <SignedSignatureImage
                  signatureValue={existing.player_signature_url}
                  alt="Player Signature"
                  className="border border-gray-200 rounded bg-white max-h-24"
                />
              </div>
              <div>
                <p className="text-sm text-gray-600 mb-1">Parent/Guardian Signature</p>
                <SignedSignatureImage
                  signatureValue={existing.parent_signature_url}
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

  // Signing form
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-gray-900">Letter of Intent</h2>
        <p className="text-gray-600 mt-1">Naturals Select 2026-2027 Season</p>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-center space-x-3">
        <AlertTriangle className="text-yellow-600 flex-shrink-0" size={24} />
        <p className="text-sm text-yellow-800">Please complete all sections and sign the Letter of Intent below.</p>
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="p-6 space-y-8">
          {/* Player Info */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Player Information</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Player Full Name *</label>
                <input type="text" value={playerName} onChange={(e) => setPlayerName(e.target.value)} placeholder="Enter player's full name" className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Birthdate</label>
                  <input type="date" value={birthdate} onChange={(e) => setBirthdate(e.target.value)} className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Graduation Year</label>
                  <input type="text" value={gradYear} onChange={(e) => setGradYear(e.target.value)} placeholder="e.g. 2028" className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">High School</label>
                  <input type="text" value={highSchool} onChange={(e) => setHighSchool(e.target.value)} placeholder="Enter high school name" className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Positions</label>
                <div className="flex flex-wrap gap-3">
                  {POSITION_OPTIONS.map(pos => (
                    <label key={pos} className="flex items-center space-x-1.5 cursor-pointer">
                      <input type="checkbox" checked={positions.includes(pos)} onChange={() => togglePosition(pos)} className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500" />
                      <span className="text-sm text-gray-700">{pos}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Parent/Guardian */}
          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Parent / Guardian Contact</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input type="text" value={parentName} onChange={(e) => setParentName(e.target.value)} placeholder="Full name" className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input type="tel" value={parentPhone} onChange={(e) => setParentPhone(e.target.value)} placeholder="Phone number" className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input type="email" value={parentEmail} onChange={(e) => setParentEmail(e.target.value)} placeholder="Email address" className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
          </div>

          {/* Commitment Items */}
          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Commitment Agreement</h3>
            <p className="text-sm text-gray-600 mb-4">Please read and agree to each item below.</p>
            <div className="space-y-3 border border-gray-200 rounded-lg p-4 bg-gray-50">
              {COMMITMENT_ITEMS.map((item, idx) => (
                <label key={idx} className="flex items-start space-x-3 cursor-pointer">
                  <input type="checkbox" checked={commitmentChecks[idx]} onChange={() => setCommitmentChecks(prev => { const next = [...prev]; next[idx] = !next[idx]; return next; })} className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 mt-0.5 flex-shrink-0" />
                  <span className="text-sm text-gray-700">{idx + 1}. {item}</span>
                </label>
              ))}
            </div>
            <p className="text-sm mt-2 text-gray-500">{commitmentChecks.filter(Boolean).length} of {COMMITMENT_ITEMS.length} items checked</p>
          </div>

          {/* Signatures */}
          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Signatures</h3>

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
                  <canvas ref={playerCanvasRef} className="w-full cursor-crosshair touch-none" style={{ height: '120px' }}
                    onMouseDown={(e) => startDraw(e, playerCanvasRef, setPlayerDrawing)}
                    onMouseMove={(e) => draw(e, playerCanvasRef, playerDrawing, setPlayerHasSignature)}
                    onMouseUp={() => stopDraw(setPlayerDrawing)}
                    onMouseLeave={() => stopDraw(setPlayerDrawing)}
                    onTouchStart={(e) => startDraw(e, playerCanvasRef, setPlayerDrawing)}
                    onTouchMove={(e) => draw(e, playerCanvasRef, playerDrawing, setPlayerHasSignature)}
                    onTouchEnd={() => stopDraw(setPlayerDrawing)}
                  />
                </div>
                <button type="button" onClick={() => clearCanvas(playerCanvasRef, setPlayerHasSignature)} className="mt-2 text-sm text-gray-500 hover:text-gray-700 flex items-center space-x-1">
                  <Eraser size={14} /><span>Clear Signature</span>
                </button>
              </div>
              <p className="text-sm text-gray-500">Date: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </div>

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
                  <canvas ref={parentCanvasRef} className="w-full cursor-crosshair touch-none" style={{ height: '120px' }}
                    onMouseDown={(e) => startDraw(e, parentCanvasRef, setParentDrawing)}
                    onMouseMove={(e) => draw(e, parentCanvasRef, parentDrawing, setParentHasSignature)}
                    onMouseUp={() => stopDraw(setParentDrawing)}
                    onMouseLeave={() => stopDraw(setParentDrawing)}
                    onTouchStart={(e) => startDraw(e, parentCanvasRef, setParentDrawing)}
                    onTouchMove={(e) => draw(e, parentCanvasRef, parentDrawing, setParentHasSignature)}
                    onTouchEnd={() => stopDraw(setParentDrawing)}
                  />
                </div>
                <button type="button" onClick={() => clearCanvas(parentCanvasRef, setParentHasSignature)} className="mt-2 text-sm text-gray-500 hover:text-gray-700 flex items-center space-x-1">
                  <Eraser size={14} /><span>Clear Signature</span>
                </button>
              </div>
              <p className="text-sm text-gray-500">Date: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </div>
          </div>

          {/* Submit */}
          <div className="border-t border-gray-200 pt-4">
            <button onClick={handleSubmit} disabled={submitting} className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50">
              {submitting ? 'Submitting...' : 'Sign Letter of Intent'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
