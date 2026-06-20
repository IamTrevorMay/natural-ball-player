import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { CheckCircle, AlertTriangle, Eraser } from 'lucide-react';
import SignedSignatureImage from './SignedSignatureImage';
import { formatUserError } from './errorMessage';

// Issue #189: acknowledgment of the Facility Fine policy document. Every user
// (player/coach/admin) must sign before they can dismiss the prompt. Mirrors
// ContractPage / WaiverPage flow but with a single signature, no extra fields.
//
// The actual fine document is uploaded via Settings → Documents with a title
// starting "Facility Fine". This page locates it, renders it inline, and writes
// a row to facility_fine_signatures once signed.

export default function FacilityFinePage({ userId, onSigned }) {
  const [loading, setLoading] = useState(true);
  const [doc, setDoc] = useState(null); // { id, title, signedUrl }
  const [existing, setExisting] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [printedName, setPrintedName] = useState('');

  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);

  const fetchDoc = async () => {
    const { data: rows } = await supabase
      .from('staff_documents')
      .select('id, title, file_path, created_at')
      .ilike('title', 'Facility Fine%')
      .order('created_at', { ascending: false })
      .limit(1);
    const row = rows && rows[0];
    if (!row) return null;
    const { data: signed } = await supabase.storage
      .from('staff-documents')
      .createSignedUrl(row.file_path, 60 * 60);
    return signed?.signedUrl ? { id: row.id, title: row.title, signedUrl: signed.signedUrl } : null;
  };

  const fetchSignature = async (documentId) => {
    if (!documentId) return null;
    const { data } = await supabase
      .from('facility_fine_signatures')
      .select('*')
      .eq('user_id', userId)
      .eq('document_id', documentId)
      .maybeSingle();
    return data;
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      const d = await fetchDoc();
      setDoc(d);
      if (d) {
        const sig = await fetchSignature(d.id);
        setExisting(sig);
      }
      setLoading(false);
    })();
  }, [userId]);

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
    if (!loading && !existing && doc) initCanvas(canvasRef.current);
  }, [loading, existing, doc, initCanvas]);

  const getPos = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const startDraw = (e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    setDrawing(true);
  };

  const draw = (e) => {
    e.preventDefault();
    if (!drawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const pos = getPos(e, canvas);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    setHasSignature(true);
  };

  const stopDraw = () => setDrawing(false);

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  };

  const canvasToBlob = () => new Promise((resolve) => canvasRef.current.toBlob(resolve, 'image/png'));

  const handleSubmit = async () => {
    if (!printedName.trim()) return alert('Please type your printed name.');
    if (!hasSignature) return alert('Please draw your signature.');
    setSubmitting(true);
    try {
      const blob = await canvasToBlob();
      const path = `${userId}/facility-fine-${Date.now()}.png`;
      const { error: upErr } = await supabase.storage
        .from('signatures')
        .upload(path, blob, { contentType: 'image/png', upsert: true });
      if (upErr) throw upErr;

      const { error: insErr } = await supabase
        .from('facility_fine_signatures')
        .insert({
          user_id: userId,
          document_id: doc.id,
          signature_url: path,
          signature_text: printedName.trim(),
        });
      if (insErr) throw insErr;

      const sig = await fetchSignature(doc.id);
      setExisting(sig);
      if (onSigned) onSigned();
    } catch (error) {
      console.error('Facility Fine sign error:', error);
      alert('Could not save signature: ' + formatUserError(error));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading facility fine policy...</div>;
  }

  if (!doc) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 flex items-start gap-3">
          <AlertTriangle className="text-amber-600 flex-shrink-0" size={22} />
          <div>
            <h2 className="text-lg font-semibold text-amber-900">No facility fine document uploaded yet</h2>
            <p className="text-sm text-amber-800 mt-1">
              An admin needs to upload a PDF to Settings → Documents with a title starting "Facility Fine". Once uploaded, players will be prompted to sign here.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{doc.title}</h1>
        <p className="text-sm text-gray-500 mt-1">Read the document below, then add your signature to acknowledge.</p>
      </div>

      <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
        <iframe
          src={doc.signedUrl}
          title={doc.title}
          className="w-full"
          style={{ height: '70vh' }}
        />
      </div>

      {existing ? (
        <div className="bg-green-50 border border-green-200 rounded-lg p-5 flex items-start gap-3">
          <CheckCircle className="text-green-600 flex-shrink-0" size={22} />
          <div className="flex-1">
            <div className="text-green-900 font-semibold">Signed</div>
            <div className="text-sm text-green-800">
              {existing.signature_text ? `${existing.signature_text} · ` : ''}
              {new Date(existing.signed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </div>
            {existing.signature_url && (
              <div className="mt-3 max-w-xs">
                <SignedSignatureImage signatureValue={existing.signature_url} />
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Printed name *</label>
            <input
              type="text"
              value={printedName}
              onChange={(e) => setPrintedName(e.target.value)}
              placeholder="Type your full name"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Signature *</label>
            <div className="border border-gray-300 rounded-lg bg-white">
              <canvas
                ref={canvasRef}
                style={{ width: '100%', height: 180, touchAction: 'none' }}
                onMouseDown={startDraw}
                onMouseMove={draw}
                onMouseUp={stopDraw}
                onMouseLeave={stopDraw}
                onTouchStart={startDraw}
                onTouchMove={draw}
                onTouchEnd={stopDraw}
              />
            </div>
            <button
              type="button"
              onClick={clearCanvas}
              className="mt-2 text-sm text-gray-600 hover:text-gray-900 inline-flex items-center gap-1"
            >
              <Eraser size={14} />
              <span>Clear</span>
            </button>
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Sign and Submit'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
