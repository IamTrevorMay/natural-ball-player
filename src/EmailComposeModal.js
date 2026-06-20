import React, { useState, useRef } from 'react';
import { X, Send, CheckCircle, AlertTriangle, Paperclip } from 'lucide-react';
import { supabaseUrl, supabaseAnonKey } from './supabaseClient';
import { supabase } from './supabaseClient';
import { useModalTracking, trackAction } from './usage';

const MAX_TOTAL_SIZE = 10 * 1024 * 1024; // 10 MB

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]); // strip data:... prefix
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function EmailComposeModal({ recipientName, recipientEmail, playerId, prospectId, onClose, onSent }) {
  useModalTracking('EmailComposeModal');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState([]); // [{ file, name, size }]
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const fileInputRef = useRef(null);

  const totalAttachmentSize = attachments.reduce((sum, a) => sum + a.size, 0);

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const currentSize = totalAttachmentSize;
    const added = [];
    let runningSize = currentSize;

    for (const file of files) {
      if (runningSize + file.size > MAX_TOTAL_SIZE) break;
      added.push({ file, name: file.name, size: file.size });
      runningSize += file.size;
    }

    if (added.length < files.length) {
      setResult({ type: 'error', message: 'Some files were skipped — 10 MB total attachment limit.' });
    }

    setAttachments(prev => [...prev, ...added]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (index) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    if (!subject.trim() || !body.trim()) return;
    trackAction('send_email');
    setSending(true);
    setResult(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setResult({ type: 'error', message: 'Not authenticated. Please log in again.' });
        setSending(false);
        return;
      }

      // Encode attachments as base64
      const encodedAttachments = await Promise.all(
        attachments.map(async (a) => ({
          filename: a.name,
          content: await readFileAsBase64(a.file),
        }))
      );

      const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': supabaseAnonKey,
        },
        body: JSON.stringify({
          recipientEmail,
          recipientName,
          subject: subject.trim(),
          body: body.trim(),
          playerId: playerId || null,
          prospectId: prospectId || null,
          attachments: encodedAttachments.length ? encodedAttachments : undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setResult({ type: 'error', message: data.error || 'Failed to send email' });
      } else {
        setResult({ type: 'success', message: 'Email sent successfully!' });
        if (onSent) onSent();
      }
    } catch (err) {
      setResult({ type: 'error', message: err.message || 'Network error' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] flex flex-col">
        <div className="border-b border-gray-200 p-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">Compose Email</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>

        <div className="p-4 space-y-4 flex-1 overflow-y-auto">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
            <input
              type="text"
              value={`${recipientName} <${recipientEmail}>`}
              readOnly
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50 text-gray-600"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Email subject..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={sending || result?.type === 'success'}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Body</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your message..."
              rows={8}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              disabled={sending || result?.type === 'success'}
            />
          </div>

          <div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileSelect}
              disabled={sending || result?.type === 'success'}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending || result?.type === 'success' || totalAttachmentSize >= MAX_TOTAL_SIZE}
              className="inline-flex items-center space-x-1.5 text-sm text-blue-600 hover:text-blue-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Paperclip size={15} />
              <span>Attach files</span>
            </button>
            {totalAttachmentSize > 0 && (
              <span className="ml-2 text-xs text-gray-400">{formatSize(totalAttachmentSize)} / 10 MB</span>
            )}

            {attachments.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {attachments.map((a, i) => (
                  <span key={i} className="inline-flex items-center bg-gray-100 text-gray-700 text-xs px-2.5 py-1.5 rounded-full space-x-1.5">
                    <Paperclip size={12} className="text-gray-400" />
                    <span className="max-w-[140px] truncate">{a.name}</span>
                    <span className="text-gray-400">({formatSize(a.size)})</span>
                    {result?.type !== 'success' && (
                      <button onClick={() => removeAttachment(i)} className="text-gray-400 hover:text-red-500 ml-0.5">
                        <X size={13} />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>

          {result && (
            <div className={`flex items-center space-x-2 p-3 rounded-lg text-sm ${
              result.type === 'success'
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
              {result.type === 'success' ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
              <span>{result.message}</span>
            </div>
          )}
        </div>

        <div className="border-t border-gray-200 p-4 flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-50 transition"
          >
            {result?.type === 'success' ? 'Close' : 'Cancel'}
          </button>
          {result?.type !== 'success' && (
            <button
              onClick={handleSend}
              disabled={sending || !subject.trim() || !body.trim()}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 transition disabled:opacity-50 flex items-center space-x-2"
            >
              <Send size={16} />
              <span>{sending ? 'Sending...' : 'Send Email'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
