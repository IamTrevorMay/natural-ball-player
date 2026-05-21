import React, { useMemo, useState } from 'react';
import { X, Search } from 'lucide-react';

export default function CopyToPickerModal({ title = 'Copy to...', options = [], multi = true, onPick, onClose, actionLabel = 'Copy', extra }) {
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState('');
  const toggle = (id) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : (multi ? [...s, id] : [id]));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) =>
      (o.label || '').toLowerCase().includes(q) ||
      (o.subtitle || '').toLowerCase().includes(q)
    );
  }, [options, search]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[80vh] flex flex-col">
        <div className="border-b border-gray-200 p-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <div className="p-4 border-b border-gray-100">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
        </div>
        {extra && <div className="p-4 border-b border-gray-100">{extra}</div>}
        <div className="overflow-y-auto flex-1 p-2">
          {filtered.map((opt) => (
            <label key={opt.id} className={`flex items-center space-x-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer ${selected.includes(opt.id) ? 'bg-teal-50' : ''}`}>
              <input type="checkbox" checked={selected.includes(opt.id)} onChange={() => toggle(opt.id)} className="rounded" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">{opt.label}</div>
                {opt.subtitle && <div className="text-xs text-gray-500 truncate">{opt.subtitle}</div>}
              </div>
            </label>
          ))}
          {filtered.length === 0 && <div className="text-center text-gray-400 text-sm py-8">No matches</div>}
        </div>
        <div className="border-t border-gray-200 p-4 flex space-x-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={() => onPick(selected)} disabled={selected.length === 0} className="px-4 py-2 text-sm bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50">
            {actionLabel}{selected.length > 0 ? ` (${selected.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
