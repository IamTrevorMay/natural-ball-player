import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { Pin, Megaphone } from 'lucide-react';

export default function WorkHome({ userId, userRole }) {
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchAnnouncements = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('staff_announcements')
      .select('id, title, body, pinned, created_at, updated_at, author_id, author:author_id(full_name, avatar_url)')
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching announcements:', error);
    } else {
      setAnnouncements(data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAnnouncements();

    const channel = supabase.channel('staff-announcements')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'staff_announcements' }, () => fetchAnnouncements())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchAnnouncements]);

  const formatDate = (iso) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  if (loading) {
    return <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">Loading...</div>;
  }

  if (announcements.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-12 text-center">
        <Megaphone className="mx-auto text-gray-300 mb-4" size={48} />
        <h3 className="text-lg font-semibold text-gray-900 mb-1">No announcements yet</h3>
        <p className="text-gray-500">
          {userRole === 'admin'
            ? 'Head to Manage Announcements to post the first one.'
            : 'Check back soon — admins will post updates here.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {announcements.map(a => (
        <div
          key={a.id}
          className={`bg-white rounded-lg shadow p-6 ${a.pinned ? 'border-l-4 border-indigo-500' : ''}`}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-3 mb-3">
              {a.author?.avatar_url ? (
                <img src={a.author.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover" />
              ) : (
                <div className="w-9 h-9 bg-indigo-600 rounded-full flex items-center justify-center text-white text-sm font-bold">
                  {a.author?.full_name?.charAt(0) || '?'}
                </div>
              )}
              <div>
                <p className="text-sm font-medium text-gray-900">{a.author?.full_name || 'Unknown'}</p>
                <p className="text-xs text-gray-500">{formatDate(a.created_at)}</p>
              </div>
            </div>
            {a.pinned && (
              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-medium">
                <Pin size={12} />
                <span>Pinned</span>
              </span>
            )}
          </div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">{a.title}</h3>
          <p className="text-gray-700 whitespace-pre-wrap">{a.body}</p>
        </div>
      ))}
    </div>
  );
}
