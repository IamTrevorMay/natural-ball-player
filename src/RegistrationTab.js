// #447: Records → Registration on the player profile. One fixed card per
// tournament platform (Perfect Game, Top Tier). Each card holds a link to the
// athlete's profile on that site and/or an uploaded proof file, so a coach
// can show a tournament director the registration in seconds. Athletes
// manage their own cards; admin and coach can manage anyone's (RLS on
// player_registrations + the registrations bucket). The staff-wide roster
// of who is missing proof is Coach Tools → Registrations.

import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { ExternalLink, FileText, Download, Trash2, Edit2, CheckCircle2, AlertCircle } from 'lucide-react';
import { formatUserError } from './errorMessage';
import { safeFileName, normalizeUrl } from './externalStatsSources';
import { REGISTRATION_SITES, REGISTRATIONS_BUCKET, hasRegistrationProof } from './registrationSites';

const emptyDraft = (row) => ({ profile_url: row?.profile_url || '', notes: row?.notes || '', file: null });

const when = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export default function RegistrationTab({ userId, loggedInUserId, userRole }) {
  const [rows, setRows] = useState({});
  const [loading, setLoading] = useState(true);
  const [editingSite, setEditingSite] = useState(null);
  const [draft, setDraft] = useState(emptyDraft());
  const [saving, setSaving] = useState(false);

  const isStaff = userRole === 'admin' || userRole === 'coach';
  const isOwn = loggedInUserId === userId;
  const canManage = isStaff || isOwn;

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('player_registrations')
      .select('*')
      .eq('player_id', userId);
    if (error) console.error('Error loading registrations:', error);
    const bySite = {};
    (data || []).forEach((r) => { bySite[r.site] = r; });
    setRows(bySite);
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const startEdit = (site) => { setEditingSite(site); setDraft(emptyDraft(rows[site])); };
  const cancel = () => { setEditingSite(null); setDraft(emptyDraft()); };

  const save = async (site) => {
    const url = normalizeUrl(draft.profile_url);
    if (url === null) { alert('That link does not look like a web address. Please paste the full URL.'); return; }
    const existing = rows[site] || null;
    const keepsFile = existing?.file_url && !draft.file;
    if (!url && !draft.file && !keepsFile) { alert('Add a link to the profile or attach the registration (or both).'); return; }

    setSaving(true);
    let file_url = existing?.file_url || null;
    let file_name = existing?.file_name || null;
    if (draft.file) {
      const safeName = safeFileName(draft.file.name);
      const path = `${userId}/${site}-${Date.now()}-${safeName}`;
      const { error: upErr } = await supabase.storage.from(REGISTRATIONS_BUCKET).upload(path, draft.file, { upsert: false });
      if (upErr) { setSaving(false); alert('Upload failed: ' + formatUserError(upErr)); return; }
      if (existing?.file_url) await supabase.storage.from(REGISTRATIONS_BUCKET).remove([existing.file_url]);
      file_url = path;
      file_name = safeName;
    }

    const payload = {
      profile_url: url || null,
      notes: draft.notes.trim() || null,
      file_url,
      file_name,
      updated_by: loggedInUserId,
      updated_at: new Date().toISOString(),
    };
    const { error } = existing
      ? await supabase.from('player_registrations').update(payload).eq('id', existing.id)
      : await supabase.from('player_registrations').insert({ ...payload, player_id: userId, site });
    setSaving(false);
    if (error) { alert('Save failed: ' + formatUserError(error)); return; }
    cancel();
    load();
  };

  const remove = async (row) => {
    if (!window.confirm('Remove this registration' + (row.file_url ? ' and its file' : '') + '?')) return;
    if (row.file_url) await supabase.storage.from(REGISTRATIONS_BUCKET).remove([row.file_url]);
    const { error } = await supabase.from('player_registrations').delete().eq('id', row.id);
    if (error) { alert('Remove failed: ' + formatUserError(error)); return; }
    load();
  };

  const openFile = async (row) => {
    const { data, error } = await supabase.storage.from(REGISTRATIONS_BUCKET).createSignedUrl(row.file_url, 600);
    if (error || !data) { alert('Could not open that file.'); return; }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const renderForm = (site) => {
    const existing = rows[site.value];
    return (
      <div className="border-t border-blue-200 bg-blue-50 p-4 space-y-3">
        <p className="text-xs text-gray-600">{site.hint}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-700 mb-1">{site.label} profile link</label>
            <input
              type="url"
              value={draft.profile_url}
              onChange={(e) => setDraft({ ...draft, profile_url: e.target.value })}
              placeholder="https://..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Registration proof <span className="text-gray-400">(screenshot or PDF, up to 15 MB)</span>
            </label>
            <input
              type="file"
              accept=".pdf,image/png,image/jpeg,image/webp,image/heic"
              onChange={(e) => setDraft({ ...draft, file: e.target.files?.[0] || null })}
              className="block w-full text-sm text-gray-700 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-white file:text-blue-700 file:font-medium file:border file:border-gray-300"
            />
            {existing?.file_name && !draft.file && (
              <p className="text-xs text-gray-500 mt-1">Keeping current file: {existing.file_name}. Choose a new one to replace it.</p>
            )}
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-700 mb-1">Notes <span className="text-gray-400">(optional)</span></label>
            <input
              type="text"
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              placeholder="e.g. player ID, name used on the site, team registered under"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <div className="flex justify-end space-x-2">
          <button onClick={cancel} className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition text-sm">Cancel</button>
          <button onClick={() => save(site.value)} disabled={saving} className="px-3 py-1.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 text-sm">
            {saving ? 'Saving...' : existing ? 'Save changes' : 'Save registration'}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Tournament Registration</h3>
        <p className="text-sm text-gray-600 mt-0.5">
          {isOwn
            ? 'Every Naturals tournament runs through Perfect Game or Top Tier. Link your profile on each site and attach proof of registration so directors and opposing teams can always find you.'
            : "This athlete's Perfect Game and Top Tier registrations. A missing card means there is no proof on file yet."}
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : (
        <div className="space-y-3">
          {REGISTRATION_SITES.map((site) => {
            const row = rows[site.value];
            const registered = hasRegistrationProof(row);
            return (
              <div key={site.value} className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="flex items-start justify-between gap-3 px-4 py-4">
                  <div className="flex items-start space-x-3 min-w-0">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${registered ? 'bg-green-100' : 'bg-gray-100'}`}>
                      {registered
                        ? <CheckCircle2 size={20} className="text-green-600" />
                        : <AlertCircle size={20} className="text-gray-400" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-semibold text-gray-900">{site.label}</h4>
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${registered ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                          {registered ? 'Registered' : 'Not on file'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {registered
                          ? `Updated ${when(row.updated_at)}`
                          : site.home
                            ? <>No proof yet. <a href={site.home} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Open {site.label}</a> to register.</>
                            : 'No proof yet.'}
                      </p>
                      {row?.notes && <p className="text-sm text-gray-600 mt-1">{row.notes}</p>}
                      {registered && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {row.profile_url && (
                            <a
                              href={row.profile_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50 min-h-[32px]"
                            >
                              <ExternalLink size={13} /><span>Open {site.label} profile</span>
                            </a>
                          )}
                          {row.file_url && (
                            <button
                              onClick={() => openFile(row)}
                              className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50 min-h-[32px]"
                              title={row.file_name || 'Download'}
                            >
                              <Download size={13} /><span className="truncate max-w-[200px]">{row.file_name || 'Registration file'}</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  {canManage && editingSite !== site.value && (
                    <div className="flex items-center space-x-1 flex-shrink-0">
                      {registered ? (
                        <>
                          <button onClick={() => startEdit(site.value)} className="p-1.5 text-gray-400 hover:text-blue-600 transition" title="Edit"><Edit2 size={15} /></button>
                          <button onClick={() => remove(row)} className="p-1.5 text-gray-400 hover:text-red-600 transition" title="Remove"><Trash2 size={15} /></button>
                        </>
                      ) : (
                        <button
                          onClick={() => startEdit(site.value)}
                          className="bg-blue-600 text-white px-3 py-2 rounded-lg font-medium hover:bg-blue-700 transition flex items-center space-x-1 text-sm min-h-[40px] touch-manipulation"
                        >
                          <FileText size={16} /><span>Add registration</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {editingSite === site.value && renderForm(site)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
