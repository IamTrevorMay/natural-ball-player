import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { CheckCircle, AlertTriangle, Eraser } from 'lucide-react';

const WAIVER_TEXT = `NATURAL BALL PLAYER, LLC
LIABILITY WAIVER AND RELEASE OF CLAIMS

PLEASE READ CAREFULLY BEFORE SIGNING

This Liability Waiver and Release of Claims ("Agreement") is entered into by the undersigned participant (or parent/guardian if participant is a minor) and Natural Ball Player, LLC ("NBP"), its owners, officers, employees, coaches, trainers, agents, and affiliates.

1. ASSUMPTION OF RISK

I understand and acknowledge that participation in baseball/softball training, instruction, camps, clinics, and related athletic activities ("Activities") involves inherent risks of physical injury. These risks include, but are not limited to:

   a) Being struck by a pitched, batted, or thrown ball
   b) Injuries from swinging bats, including contact with other persons or objects
   c) Muscle strains, sprains, tears, and other soft tissue injuries
   d) Fractures, dislocations, and joint injuries
   e) Concussions and other head injuries
   f) Heat-related illness including heat exhaustion and heat stroke
   g) Injuries resulting from use of training equipment, batting cages, pitching machines, and other athletic equipment
   h) Injuries resulting from physical conditioning, strength training, and agility exercises
   i) Injuries resulting from contact with other participants, spectators, or facility surfaces
   j) Aggravation of pre-existing conditions or injuries

I VOLUNTARILY ASSUME ALL RISKS associated with participation in the Activities, whether or not described above, and whether arising from the ordinary negligence of NBP or otherwise.

2. WAIVER AND RELEASE

In consideration of being permitted to participate in the Activities, I, on behalf of myself, my heirs, executors, administrators, and assigns, hereby RELEASE, WAIVE, DISCHARGE, AND COVENANT NOT TO SUE Natural Ball Player, LLC, its owners, officers, employees, coaches, trainers, agents, volunteers, and affiliates (collectively "Released Parties") from any and all liability, claims, demands, actions, or causes of action arising out of or related to any loss, damage, or injury, including death, that may be sustained by me or my property while participating in the Activities, whether caused by the ordinary negligence of the Released Parties or otherwise.

3. INDEMNIFICATION

I agree to INDEMNIFY AND HOLD HARMLESS the Released Parties from any loss, liability, damage, or costs, including court costs and attorney's fees, that may be incurred due to my participation in the Activities, whether caused by the ordinary negligence of the Released Parties or otherwise.

4. MEDICAL AUTHORIZATION

I authorize NBP and its personnel to seek and obtain emergency medical treatment for the participant in the event of an injury or medical emergency during the Activities. I understand that I am financially responsible for any medical expenses incurred.

I represent that the participant is physically fit and has no medical condition that would prevent safe participation in the Activities. I agree to notify NBP of any changes in the participant's health status.

5. MEDIA RELEASE

I grant NBP permission to use photographs, video recordings, and other media of the participant taken during the Activities for promotional, educational, and marketing purposes, including but not limited to use on websites, social media, and printed materials, without compensation.

6. FACILITY RULES AND CONDUCT

I agree to abide by all rules, regulations, and instructions of NBP and its staff. I understand that NBP reserves the right to refuse or terminate participation of any individual whose conduct is deemed unsafe or disruptive.

7. PERSONAL PROPERTY

I understand that NBP is not responsible for any lost, stolen, or damaged personal property brought to the facility or training location.

8. GOVERNING LAW

This Agreement shall be governed by and construed in accordance with the laws of the state in which the NBP facility is located. Any disputes arising under this Agreement shall be resolved in the courts of that state.

9. SEVERABILITY

If any provision of this Agreement is found to be unenforceable, the remaining provisions shall remain in full force and effect.

10. ENTIRE AGREEMENT

This Agreement constitutes the entire agreement between the parties regarding the subject matter herein. No verbal or written modifications shall be valid unless signed by both parties.

ACKNOWLEDGMENT

BY SIGNING BELOW, I ACKNOWLEDGE THAT I HAVE READ THIS AGREEMENT IN ITS ENTIRETY, UNDERSTAND ITS TERMS, AND AGREE TO BE BOUND BY ITS PROVISIONS. I UNDERSTAND THAT BY SIGNING THIS AGREEMENT, I AM GIVING UP SUBSTANTIAL LEGAL RIGHTS, INCLUDING THE RIGHT TO SUE FOR DAMAGES IN THE EVENT OF INJURY.

I SIGN THIS AGREEMENT VOLUNTARILY AND WITHOUT INDUCEMENT.`;

export default function WaiverPage({ userId, userRole, onSigned }) {
  const [loading, setLoading] = useState(true);
  const [existingWaiver, setExistingWaiver] = useState(null);
  const [isMinor, setIsMinor] = useState(false);
  const [participantName, setParticipantName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [guardianName, setGuardianName] = useState('');
  const [guardianRelationship, setGuardianRelationship] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Canvas refs
  const participantCanvasRef = useRef(null);
  const guardianCanvasRef = useRef(null);
  const [participantDrawing, setParticipantDrawing] = useState(false);
  const [guardianDrawing, setGuardianDrawing] = useState(false);
  const [participantHasSignature, setParticipantHasSignature] = useState(false);
  const [guardianHasSignature, setGuardianHasSignature] = useState(false);

  useEffect(() => {
    fetchWaiver();
  }, [userId]);

  const fetchWaiver = async () => {
    try {
      const { data, error } = await supabase
        .from('waiver_signatures')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;
      setExistingWaiver(data);
    } catch (error) {
      console.error('Error fetching waiver:', error);
    } finally {
      setLoading(false);
    }
  };

  // Canvas drawing helpers
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
    if (!loading && !existingWaiver) {
      initCanvas(participantCanvasRef.current);
      if (isMinor) initCanvas(guardianCanvasRef.current);
    }
  }, [loading, existingWaiver, isMinor, initCanvas]);

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

  const stopDraw = (setDrawing) => {
    setDrawing(false);
  };

  const clearCanvas = (canvasRef, setHasSig) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSig(false);
  };

  const canvasToBlob = (canvasRef) => {
    return new Promise((resolve) => {
      const canvas = canvasRef.current;
      canvas.toBlob(resolve, 'image/png');
    });
  };

  const handleSubmit = async () => {
    if (!participantName.trim()) return alert('Please enter the participant name.');
    if (!agreed) return alert('Please confirm you have read and agree to the waiver.');
    if (!participantHasSignature) return alert('Please provide a signature.');
    if (isMinor && !guardianName.trim()) return alert('Please enter the guardian name.');
    if (isMinor && !guardianRelationship) return alert('Please select the guardian relationship.');
    if (isMinor && !guardianHasSignature) return alert('Please provide the guardian signature.');

    setSubmitting(true);
    try {
      const timestamp = Date.now();

      // Upload participant signature
      const participantBlob = await canvasToBlob(participantCanvasRef);
      const participantPath = `${userId}/participant-${timestamp}.png`;
      const { error: pUploadErr } = await supabase.storage
        .from('signatures')
        .upload(participantPath, participantBlob, { contentType: 'image/png', upsert: true });
      if (pUploadErr) throw pUploadErr;
      const { data: { publicUrl: participantUrl } } = supabase.storage
        .from('signatures')
        .getPublicUrl(participantPath);

      let guardianUrl = null;
      if (isMinor) {
        const guardianBlob = await canvasToBlob(guardianCanvasRef);
        const guardianPath = `${userId}/guardian-${timestamp}.png`;
        const { error: gUploadErr } = await supabase.storage
          .from('signatures')
          .upload(guardianPath, guardianBlob, { contentType: 'image/png', upsert: true });
        if (gUploadErr) throw gUploadErr;
        const { data: { publicUrl: gUrl } } = supabase.storage
          .from('signatures')
          .getPublicUrl(guardianPath);
        guardianUrl = gUrl;
      }

      const { error: insertErr } = await supabase
        .from('waiver_signatures')
        .insert({
          user_id: userId,
          participant_name: participantName.trim(),
          participant_signature_url: participantUrl,
          is_minor: isMinor,
          guardian_name: isMinor ? guardianName.trim() : null,
          guardian_signature_url: guardianUrl,
          guardian_relationship: isMinor ? guardianRelationship : null,
          emergency_phone: isMinor ? emergencyPhone.trim() || null : null,
        });

      if (insertErr) throw insertErr;

      await fetchWaiver();
      if (onSigned) onSigned();
      alert('Waiver signed successfully!');
    } catch (error) {
      console.error('Error submitting waiver:', error);
      alert('Error submitting waiver: ' + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Loading waiver...</p>
      </div>
    );
  }

  // Already signed view
  if (existingWaiver) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Liability Waiver</h2>
          <p className="text-gray-600 mt-1">Your signed waiver agreement</p>
        </div>

        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center space-x-3">
          <CheckCircle className="text-green-600 flex-shrink-0" size={24} />
          <div>
            <p className="font-semibold text-green-800">Waiver Signed</p>
            <p className="text-sm text-green-700">
              Signed on {new Date(existingWaiver.signed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow">
          <div className="p-6">
            <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg p-4 bg-gray-50 mb-6">
              <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans">{WAIVER_TEXT}</pre>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-600">Participant Name</p>
                <p className="text-gray-900 font-medium">{existingWaiver.participant_name}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600 mb-1">Participant Signature</p>
                <img
                  src={existingWaiver.participant_signature_url}
                  alt="Participant Signature"
                  className="border border-gray-200 rounded bg-white max-h-24"
                />
              </div>

              {existingWaiver.is_minor && (
                <>
                  <div className="border-t border-gray-200 pt-4 mt-4">
                    <p className="text-sm font-semibold text-gray-700 mb-3">Parent / Guardian Information</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                      <div>
                        <p className="text-sm text-gray-600">Guardian Name</p>
                        <p className="text-gray-900 font-medium">{existingWaiver.guardian_name}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-600">Relationship</p>
                        <p className="text-gray-900 font-medium">{existingWaiver.guardian_relationship}</p>
                      </div>
                      {existingWaiver.emergency_phone && (
                        <div>
                          <p className="text-sm text-gray-600">Emergency Phone</p>
                          <p className="text-gray-900 font-medium">{existingWaiver.emergency_phone}</p>
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="text-sm text-gray-600 mb-1">Guardian Signature</p>
                      <img
                        src={existingWaiver.guardian_signature_url}
                        alt="Guardian Signature"
                        className="border border-gray-200 rounded bg-white max-h-24"
                      />
                    </div>
                  </div>
                </>
              )}
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
        <h2 className="text-3xl font-bold text-gray-900">Liability Waiver</h2>
        <p className="text-gray-600 mt-1">Please read and sign the waiver below</p>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-center space-x-3">
        <AlertTriangle className="text-yellow-600 flex-shrink-0" size={24} />
        <p className="text-sm text-yellow-800">You must read and sign this waiver before participating in any activities.</p>
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="p-6 space-y-6">
          {/* Waiver Text */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Waiver Agreement</h3>
            <div className="max-h-80 overflow-y-auto border border-gray-200 rounded-lg p-4 bg-gray-50">
              <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans">{WAIVER_TEXT}</pre>
            </div>
          </div>

          {/* Minor Toggle */}
          <div className="flex items-center space-x-3 py-3 border-t border-gray-200">
            <label className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={isMinor}
                onChange={(e) => setIsMinor(e.target.checked)}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <span className="ml-2 text-sm font-medium text-gray-700">
                The participant is under 18 years of age
              </span>
            </label>
          </div>

          {/* Participant Section */}
          <div className="border-t border-gray-200 pt-4">
            <h4 className="text-md font-semibold text-gray-800 mb-4">Participant Information</h4>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                <input
                  type="text"
                  value={participantName}
                  onChange={(e) => setParticipantName(e.target.value)}
                  placeholder="Enter participant's full legal name"
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Signature *</label>
                <div className="border border-gray-300 rounded-lg overflow-hidden bg-white">
                  <canvas
                    ref={participantCanvasRef}
                    className="w-full cursor-crosshair touch-none"
                    style={{ height: '120px' }}
                    onMouseDown={(e) => startDraw(e, participantCanvasRef, setParticipantDrawing)}
                    onMouseMove={(e) => draw(e, participantCanvasRef, participantDrawing, setParticipantHasSignature)}
                    onMouseUp={() => stopDraw(setParticipantDrawing)}
                    onMouseLeave={() => stopDraw(setParticipantDrawing)}
                    onTouchStart={(e) => startDraw(e, participantCanvasRef, setParticipantDrawing)}
                    onTouchMove={(e) => draw(e, participantCanvasRef, participantDrawing, setParticipantHasSignature)}
                    onTouchEnd={() => stopDraw(setParticipantDrawing)}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => clearCanvas(participantCanvasRef, setParticipantHasSignature)}
                  className="mt-2 text-sm text-gray-500 hover:text-gray-700 flex items-center space-x-1"
                >
                  <Eraser size={14} />
                  <span>Clear Signature</span>
                </button>
              </div>

              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">
                  I have read, understand, and agree to the terms of this liability waiver *
                </span>
              </label>
            </div>
          </div>

          {/* Guardian Section (if minor) */}
          {isMinor && (
            <div className="border-t border-gray-200 pt-4">
              <h4 className="text-md font-semibold text-gray-800 mb-4">Parent / Guardian Information</h4>
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Guardian Full Name *</label>
                    <input
                      type="text"
                      value={guardianName}
                      onChange={(e) => setGuardianName(e.target.value)}
                      placeholder="Enter guardian's full legal name"
                      className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Relationship *</label>
                    <select
                      value={guardianRelationship}
                      onChange={(e) => setGuardianRelationship(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none bg-white"
                    >
                      <option value="">Select relationship</option>
                      <option value="Parent">Parent</option>
                      <option value="Guardian">Guardian</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Emergency Phone</label>
                  <input
                    type="tel"
                    value={emergencyPhone}
                    onChange={(e) => setEmergencyPhone(e.target.value)}
                    placeholder="Emergency contact number"
                    className="w-full md:w-1/2 border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Guardian Signature *</label>
                  <div className="border border-gray-300 rounded-lg overflow-hidden bg-white">
                    <canvas
                      ref={guardianCanvasRef}
                      className="w-full cursor-crosshair touch-none"
                      style={{ height: '120px' }}
                      onMouseDown={(e) => startDraw(e, guardianCanvasRef, setGuardianDrawing)}
                      onMouseMove={(e) => draw(e, guardianCanvasRef, guardianDrawing, setGuardianHasSignature)}
                      onMouseUp={() => stopDraw(setGuardianDrawing)}
                      onMouseLeave={() => stopDraw(setGuardianDrawing)}
                      onTouchStart={(e) => startDraw(e, guardianCanvasRef, setGuardianDrawing)}
                      onTouchMove={(e) => draw(e, guardianCanvasRef, guardianDrawing, setGuardianHasSignature)}
                      onTouchEnd={() => stopDraw(setGuardianDrawing)}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => clearCanvas(guardianCanvasRef, setGuardianHasSignature)}
                    className="mt-2 text-sm text-gray-500 hover:text-gray-700 flex items-center space-x-1"
                  >
                    <Eraser size={14} />
                    <span>Clear Signature</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Submit */}
          <div className="border-t border-gray-200 pt-4">
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Sign Waiver'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
