import React from 'react';

export default function RecurrenceDecisionModal({ title = 'This is a recurring event', message, actionLabel = 'Delete', onPick, onClose, allowOne = true, allowFuture = true }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      {/* #350: capped height, with the caller-supplied title and message
          clamped (full text on hover) so they cannot grow the header past the
          cap and clip what is under it. This modal is shown mid-delete — an
          unreachable Cancel there is the dangerous case, because the only
          escape left is reloading the page. */}
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-6 pt-6 pb-2 flex-shrink-0">
          <h3 className="text-lg font-bold text-gray-900 mb-2 line-clamp-2 break-words" title={title}>{title}</h3>
          {message && <p className="text-sm text-gray-600 line-clamp-3 break-words" title={message}>{message}</p>}
        </div>
        <div className="px-6 py-4 space-y-2 overflow-y-auto flex-1 min-h-0">
          {allowOne && (
            <button onClick={() => onPick('one')} className="w-full text-left px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition">
              <div className="font-medium text-gray-900">{actionLabel} this event only</div>
              <div className="text-xs text-gray-500">Other occurrences will remain</div>
            </button>
          )}
          {allowFuture && (
            <button onClick={() => onPick('future')} className="w-full text-left px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition">
              <div className="font-medium text-gray-900">{actionLabel} this and future events</div>
              <div className="text-xs text-gray-500">Past occurrences will remain</div>
            </button>
          )}
          <button onClick={() => onPick('all')} className="w-full text-left px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition">
            <div className="font-medium text-gray-900">{actionLabel} all events in series</div>
            <div className="text-xs text-gray-500">All occurrences (past and future)</div>
          </button>
        </div>
        <div className="border-t border-gray-200 px-6 py-3 flex justify-end flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
        </div>
      </div>
    </div>
  );
}
