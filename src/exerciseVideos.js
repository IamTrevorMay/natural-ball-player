import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

// Fetched once per page session and cached at module scope, so opening the
// workout/program editor (or both, or the same one repeatedly) never
// re-fetches the ~1,275-row library more than once. Resets only on a full
// page reload.
let cachedVideos = null;
let inFlightPromise = null;

async function fetchExerciseVideos() {
  const { data, error } = await supabase.from('exercise_videos').select('name, name_key, video_url');
  if (error) {
    // A failed lookup must never block a coach from saving a workout — the
    // name input just falls back to a plain text field with no suggestions.
    console.error('exerciseVideos: fetch failed:', error);
    return [];
  }
  return data || [];
}

export function useExerciseVideos() {
  const [videos, setVideos] = useState(cachedVideos || []);
  const [loading, setLoading] = useState(cachedVideos === null);

  useEffect(() => {
    if (cachedVideos !== null) {
      setVideos(cachedVideos);
      setLoading(false);
      return;
    }
    if (!inFlightPromise) inFlightPromise = fetchExerciseVideos();

    let cancelled = false;
    inFlightPromise.then((rows) => {
      cachedVideos = rows;
      inFlightPromise = null;
      if (!cancelled) {
        setVideos(rows);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  const byKey = {};
  videos.forEach((v) => { byKey[v.name_key] = v; });

  return { videos, byKey, loading };
}
