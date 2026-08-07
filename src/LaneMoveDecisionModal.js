import React from 'react';

// #289: drop-time choice shown when a bar of a multi-lane facility event is
// dropped onto a different lane. "Move the whole event" is the #280 behaviour
// (shift every lane by the same offset) and stays the default-feeling first,
// focused option — single-lane is strictly opt-in, because silently moving
// one lane is exactly the data-loss bug #280 fixed. Styled to match
// RecurrenceDecisionModal (the drop-decision pattern Cordell already knows
// from #279), but its own component: that modal's one/future/all wording is
// about recurrence, not lanes.
//
// allowWhole=false means the whole block wouldn't fit at the target (e.g. a
// 7-lane event shoved past the edge of the 11-lane grid) — the whole-event
// option is omitted rather than offered-and-refused.
//
// startTimeLabel is set only when the drop also changed the time. Moving one
// lane to a different time would mean splitting the row into two events
// (bookings, recurrence and all) — out of scope for v1 — so the single-lane
// option states plainly that the time stays put.
export default function LaneMoveDecisionModal({ eventTitle, sourceLane, targetLane, allowWhole, startTimeLabel, onPick, onClose }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-2">Move which lanes?</h3>
        <p className="text-sm text-gray-600 mb-2">
          {eventTitle ? `"${eventTitle}"` : 'This event'} covers more than one lane. You grabbed {sourceLane} and dropped on {targetLane}.
        </p>
        {!allowWhole && (
          <p className="text-xs text-amber-600 mb-2">
            The whole event wouldn't fit there — only the grabbed lane can move to {targetLane}.
          </p>
        )}
        <div className="space-y-2 mt-4">
          {allowWhole && (
            <button autoFocus onClick={() => onPick('whole')} className="w-full text-left px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition">
              <div className="font-medium text-gray-900">Move the whole event</div>
              <div className="text-xs text-gray-500">
                Every lane shifts by the same amount{startTimeLabel ? ', and the start time changes too' : ''}
              </div>
            </button>
          )}
          <button autoFocus={!allowWhole} onClick={() => onPick('one')} className="w-full text-left px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition">
            <div className="font-medium text-gray-900">Move just this lane</div>
            <div className="text-xs text-gray-500">
              {startTimeLabel
                ? `Lanes only — the start time stays at ${startTimeLabel}.${allowWhole ? ' To change the time, move the whole event.' : ''}`
                : 'The other lanes stay where they are'}
            </div>
          </button>
        </div>
        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
        </div>
      </div>
    </div>
  );
}
