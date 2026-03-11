import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';
import { Plus, X } from 'lucide-react';

const DEFAULT_STATUS = ['Active', 'Remote', 'On-Site', 'Inactive', 'Archived'];
const DEFAULT_SUB_STATUS = ['No Sub-Status', 'Development', 'Trial'];

const STATUS_COLORS = {
  'Active': 'bg-green-500 text-white',
  'Remote': 'bg-orange-500 text-white',
  'On-Site': 'bg-blue-500 text-white',
  'Inactive': 'bg-gray-500 text-white',
  'Archived': 'bg-red-500 text-white',
};

// Cache for custom options so we don't refetch on every render
let optionsCache = {};
let cacheTimestamp = 0;
const CACHE_TTL = 30000; // 30s

async function fetchCustomOptions(category) {
  const now = Date.now();
  if (optionsCache[category] && now - cacheTimestamp < CACHE_TTL) {
    return optionsCache[category];
  }
  const { data } = await supabase
    .from('custom_status_options')
    .select('value')
    .eq('category', category)
    .order('value');
  const values = (data || []).map(d => d.value);
  optionsCache[category] = values;
  cacheTimestamp = now;
  return values;
}

function invalidateCache() {
  optionsCache = {};
  cacheTimestamp = 0;
}

export function useStatusOptions(category) {
  const [customOptions, setCustomOptions] = useState([]);
  const defaults = category.includes('sub_status') ? DEFAULT_SUB_STATUS : DEFAULT_STATUS;

  useEffect(() => {
    fetchCustomOptions(category).then(setCustomOptions);
  }, [category]);

  const allOptions = [...defaults, ...customOptions.filter(c => !defaults.includes(c))];

  const addOption = async (value) => {
    const trimmed = value.trim();
    if (!trimmed || allOptions.includes(trimmed)) return false;
    const { error } = await supabase
      .from('custom_status_options')
      .insert({ category, value: trimmed });
    if (!error) {
      invalidateCache();
      setCustomOptions(prev => [...prev, trimmed].sort());
      return true;
    }
    return false;
  };

  return { options: allOptions, addOption };
}

export function StatusBadgeSelect({ value, options, colors, onChange, onAddOption, placeholder, isAdmin }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [newValue, setNewValue] = useState('');
  const dropdownRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
        setIsAdding(false);
        setNewValue('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (isAdding && inputRef.current) inputRef.current.focus();
  }, [isAdding]);

  const colorMap = colors || STATUS_COLORS;
  const color = value && colorMap[value] ? colorMap[value] : '';

  const handleSelect = (val) => {
    onChange(val);
    setIsOpen(false);
  };

  const handleAddNew = async () => {
    if (!newValue.trim()) return;
    const success = await onAddOption(newValue);
    if (success) {
      onChange(newValue.trim());
      setNewValue('');
      setIsAdding(false);
      setIsOpen(false);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`px-2 py-1 rounded text-xs font-medium cursor-pointer inline-flex items-center space-x-1 ${color || 'bg-gray-100 text-gray-600'}`}
      >
        <span>{value || placeholder || '—'}</span>
        <svg width="10" height="10" viewBox="0 0 16 16" className={`${color ? 'fill-white' : 'fill-gray-500'}`}>
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute z-20 mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg py-1 max-h-56 overflow-y-auto">
          <button
            onClick={() => handleSelect('')}
            className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-50"
          >
            {placeholder || '—'}
          </button>
          {options.map(opt => (
            <button
              key={opt}
              onClick={() => handleSelect(opt)}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 ${value === opt ? 'font-semibold text-blue-600 bg-blue-50' : 'text-gray-700'}`}
            >
              {opt}
            </button>
          ))}

          {isAdmin && (
            <div className="border-t border-gray-100 mt-1 pt-1">
              {!isAdding ? (
                <button
                  onClick={() => setIsAdding(true)}
                  className="w-full text-left px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50 flex items-center space-x-1"
                >
                  <Plus size={12} />
                  <span>New Status</span>
                </button>
              ) : (
                <div className="px-2 py-1.5">
                  <div className="flex items-center space-x-1">
                    <input
                      ref={inputRef}
                      type="text"
                      value={newValue}
                      onChange={(e) => setNewValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddNew();
                        if (e.key === 'Escape') { setIsAdding(false); setNewValue(''); }
                      }}
                      placeholder="Type name..."
                      className="flex-1 min-w-0 px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <button
                      onClick={handleAddNew}
                      disabled={!newValue.trim()}
                      className="p-1 text-blue-600 hover:text-blue-800 disabled:text-gray-300"
                    >
                      <Plus size={14} />
                    </button>
                    <button
                      onClick={() => { setIsAdding(false); setNewValue(''); }}
                      className="p-1 text-gray-400 hover:text-gray-600"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
