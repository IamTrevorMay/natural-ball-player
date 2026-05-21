import React, { useEffect, useRef } from 'react';

export default function CalendarContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onEsc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onEsc);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onEsc); };
  }, [onClose]);

  const width = 200;
  const height = Math.min(items.length * 36 + 16, 300);
  const style = {
    left: Math.min(Math.max(0, x), window.innerWidth - width - 4),
    top: Math.min(Math.max(0, y), window.innerHeight - height - 4),
    minWidth: width,
  };

  return (
    <div ref={ref} style={style} className="fixed z-[60] bg-white shadow-xl rounded-lg border border-gray-200 py-1">
      {items.map((item, idx) => item.divider ? (
        <div key={idx} className="my-1 border-t border-gray-100" />
      ) : (
        <button
          key={idx}
          onClick={(e) => { e.stopPropagation(); if (item.disabled) return; item.onClick(); onClose(); }}
          disabled={item.disabled}
          className={`w-full text-left px-3 py-2 text-sm flex items-center space-x-2 ${item.danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-100'} disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          {item.icon && <span className="flex items-center text-gray-400">{item.icon}</span>}
          <span className="flex-1">{item.label}</span>
        </button>
      ))}
    </div>
  );
}
