import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';

const MAX_SUGGESTIONS = 8;
const MIN_CHARS = 2;
// Single source of truth for the dropdown's cap — applied via inline style,
// not a Tailwind max-h-* class, so there's no second copy of this number
// that could drift out of sync with it.
const DROPDOWN_MAX_H = 224;

// Exact match first, then starts-with, then contains — alphabetical within
// each group. `videos` is already the full library; this just ranks it
// against the current query, it doesn't fetch anything.
function rankSuggestions(videos, query) {
  const q = query.trim().toLowerCase();
  if (q.length < MIN_CHARS) return [];

  const exact = [];
  const startsWith = [];
  const contains = [];
  for (const v of videos) {
    const key = v.name_key || '';
    if (key === q) exact.push(v);
    else if (key.startsWith(q)) startsWith.push(v);
    else if (key.includes(q)) contains.push(v);
  }
  const byName = (a, b) => a.name.localeCompare(b.name);
  exact.sort(byName);
  startsWith.sort(byName);
  contains.sort(byName);
  return [...exact, ...startsWith, ...contains].slice(0, MAX_SUGGESTIONS);
}

/*
 * Controlled exercise-name input with a suggest-as-you-type dropdown against
 * the exercise_videos library. Used by both CreateTrainingProgramModal and
 * CreateWorkoutTemplateModal in CoachTools.js — one component, two call
 * sites, rather than the dropdown copy-pasted into each.
 *
 * The dropdown renders through a portal into document.body, positioned via
 * getBoundingClientRect(), because these inputs live in a <td> inside a
 * scrolling table inside a scrolling modal — an inline absolutely-positioned
 * dropdown would get clipped by the modal's overflow-y-auto on any row that
 * isn't near the top.
 */
export default function ExerciseNameInput({ value, onChange, onPick, hasLink, videos, loading }) {
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [coords, setCoords] = useState(null);
  const inputRef = useRef(null);

  const suggestions = useMemo(() => rankSuggestions(videos || [], value || ''), [videos, value]);

  // "No library match" means no EXACT name_key match for what's currently
  // typed — not "no suggestions," since contains-matches can still be
  // showing while the typed text itself isn't a real exercise name yet.
  const hasExactMatch = useMemo(() => {
    const key = (value || '').trim().toLowerCase();
    if (!key) return true;
    return (videos || []).some((v) => v.name_key === key);
  }, [videos, value]);

  const trimmedValue = (value || '').trim();
  // Gated on !loading too, so a not-yet-fetched library never flashes a
  // false "no video yet" for an exercise that actually has one.
  const showHint = !loading && trimmedValue.length > 0 && !hasExactMatch && !hasLink;

  useEffect(() => {
    if (!open) return undefined;
    const updateCoords = () => {
      if (!inputRef.current) return;
      const rect = inputRef.current.getBoundingClientRect();
      // The portal is position: fixed, so anything past the viewport edge
      // can never be scrolled into view — flip up when there isn't room
      // below and there's more room above, and always cap height to
      // whichever space is actually available so it never overflows either
      // edge (matters on short viewports where neither side fully fits).
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      if (spaceBelow < DROPDOWN_MAX_H && spaceAbove > spaceBelow) {
        setCoords({
          direction: 'up',
          bottom: window.innerHeight - rect.top,
          left: rect.left,
          width: rect.width,
          maxHeight: Math.max(0, Math.min(DROPDOWN_MAX_H, spaceAbove)),
        });
      } else {
        setCoords({
          direction: 'down',
          top: rect.bottom,
          left: rect.left,
          width: rect.width,
          maxHeight: Math.max(0, Math.min(DROPDOWN_MAX_H, spaceBelow)),
        });
      }
    };
    updateCoords();
    // capture: true so this also fires for scroll on the modal's inner
    // overflow-y-auto container, not just the window itself.
    window.addEventListener('scroll', updateCoords, true);
    window.addEventListener('resize', updateCoords);
    return () => {
      window.removeEventListener('scroll', updateCoords, true);
      window.removeEventListener('resize', updateCoords);
    };
  }, [open]);

  // `open` is driven only by explicit user actions (type / focus / pick /
  // Escape / blur) rather than reactively from `suggestions`. Picking sets
  // `value` to the picked name, which still matches itself in `suggestions`
  // — a reactive "open whenever suggestions is non-empty" effect would
  // immediately reopen the list right after picking.
  const handleChange = (e) => {
    const newValue = e.target.value;
    onChange(newValue);
    setOpen(rankSuggestions(videos || [], newValue).length > 0);
    setHighlightIndex(0);
  };

  // onPick is authoritative for the picked value (both call sites' onPick
  // route to a patch that includes `name`) — onChange is for typing only.
  const pick = (video) => {
    onPick({ name: video.name, video_url: video.video_url });
    setOpen(false);
  };

  const onKeyDown = (e) => {
    // Never hijack keys when the list isn't open — these editors are tables
    // coaches tab through fast.
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(suggestions[highlightIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <input
        ref={inputRef}
        type="text"
        autoComplete="off"
        value={value}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
        onBlur={() => setOpen(false)}
        className="flex-1 min-w-0 px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
      />
      {showHint && (
        <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">no video yet</span>
      )}
      {open && suggestions.length > 0 && coords && createPortal(
        <ul
          style={{
            position: 'fixed',
            left: coords.left,
            width: coords.width,
            maxHeight: coords.maxHeight,
            zIndex: 9999,
            ...(coords.direction === 'up' ? { bottom: coords.bottom } : { top: coords.top }),
          }}
          className="bg-white border border-gray-300 rounded shadow-lg overflow-y-auto text-sm"
        >
          {suggestions.map((v, i) => (
            <li
              key={v.name_key}
              // Prevents the input's onBlur from closing the list before the
              // click registers.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(v)}
              onMouseEnter={() => setHighlightIndex(i)}
              className={`px-2 py-1.5 cursor-pointer ${i === highlightIndex ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}`}
            >
              {v.name}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  );
}
