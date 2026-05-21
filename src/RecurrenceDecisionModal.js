import React from 'react';

export default function RecurrenceDecisionModal({ title = 'This is a recurring event', message, actionLabel = 'Delete', onPick, onClose, allowOne = true }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-2">{title}</h3>
        {message && <p className="text-sm text-gray-600 mb-4">{message}</p>}
        <div className="space-y-2">
          {allowOne && (
            <button onClick={() => onPick('one')} className="w-full text-left px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition">
              <div className="font-medium text-gray-900">{actionLabel} this event only</div>
              <div className="text-xs text-gray-500">Other occurrences will remain</div>
            </button>
          )}
          <button onClick={() => onPick('future')} className="w-full text-left px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition">
            <div className="font-medium text-gray-900">{actionLabel} this and future events</div>
            <div className="text-xs text-gray-500">Past occurrences will remain</div>
          </button>
          <button onClick={() => onPick('all')} className="w-full text-left px-4 py-3 border border-gray-200 rounded-lg hover:bg-gray-50 transition">
            <div className="font-medium text-gray-900">{actionLabel} all events in series</div>
            <div className="text-xs text-gray-500">All occurrences (past and future)</div>
          </button>
        </div>
        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
        </div>
      </div>
    </div>
  );
}
