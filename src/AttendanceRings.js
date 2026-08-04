import React from 'react';

function Ring({ label, attended, total, color, size = 52 }) {
  const strokeWidth = 5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  const hasData = total > 0;
  const pct = hasData ? Math.round((attended / total) * 100) : null;
  const dashOffset = hasData ? circumference * (1 - attended / total) : circumference;

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="#E5E7EB"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <span
        className="absolute text-xs font-bold text-gray-800"
        style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        {pct !== null ? `${pct}%` : '--'}
      </span>
      <p className="text-[10px] font-medium text-gray-600 mt-1 leading-tight text-center">{label}</p>
      <p className="text-[10px] text-gray-400 leading-tight">
        {hasData ? `${attended}/${total}` : '0/0'}
      </p>
    </div>
  );
}

// Sessions counts attended + upcoming reserved individual training (hitting,
// throwing, lessons, bullpens, slot bookings — NOT lifts/practices/games), so
// unlike the other three it has no fixed "total scheduled" to form a ratio
// against. Shown as a flat count rather than a percentage ring (#271).
function SessionsCount({ attended, upcoming, size = 52 }) {
  const total = attended + upcoming;
  return (
    <div className="flex flex-col items-center">
      <div
        className="rounded-full bg-purple-100 border-2 border-purple-500 flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        <span className="text-sm font-bold text-purple-700">{total}</span>
      </div>
      <p className="text-[10px] font-medium text-gray-600 mt-1 leading-tight text-center">Sessions</p>
      <p className="text-[10px] text-gray-400 leading-tight">
        {attended} attended{upcoming > 0 ? `, ${upcoming} upcoming` : ''}
      </p>
    </div>
  );
}

export default function AttendanceRings({ practices, games, lifts, sessions, onToggleLog, canEdit }) {
  return (
    <div
      className={`flex items-start space-x-3 ${canEdit ? 'cursor-pointer' : ''}`}
      onClick={canEdit ? onToggleLog : undefined}
      title={canEdit ? 'View Attendance' : undefined}
    >
      <div className="relative">
        <Ring label="Practices" attended={practices.attended} total={practices.total} color="#10B981" />
      </div>
      <div className="relative">
        <Ring label="Games" attended={games.attended} total={games.total} color="#3B82F6" />
      </div>
      <div className="relative">
        <Ring label="Lifts" attended={lifts.attended} total={lifts.total} color="#F59E0B" />
      </div>
      <div className="relative">
        <SessionsCount attended={sessions.attended} upcoming={sessions.upcoming} />
      </div>
    </div>
  );
}
