import React, { useState, useRef, useEffect } from 'react';
import { Bell, MessageSquare, Clock, Plane, ArrowLeftRight, Briefcase, Home } from 'lucide-react';

function fmtSlotTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hour = parseInt(h);
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`;
}
function fmtDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function NotificationBell({ currentPortal, mainCounts, workCounts, onJump }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const total =
    (mainCounts?.unreadMessages || 0)
    + (mainCounts?.pendingSlots?.length || 0)
    + (workCounts?.unreadMessages || 0)
    + (workCounts?.pendingHours?.length || 0)
    + (workCounts?.pendingTimeOff?.length || 0);

  const jump = (portal, view) => {
    setOpen(false);
    onJump?.(portal, view);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition"
      >
        <Bell size={22} />
        {total > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full h-5 min-w-[20px] flex items-center justify-center px-1">
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-96 bg-white rounded-lg shadow-xl border border-gray-200 z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
            <h4 className="font-semibold text-gray-900 text-sm">Notifications</h4>
            <span className="text-xs text-gray-500">{total} new</span>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {total === 0 && (
              <div className="px-4 py-6 text-center text-sm text-gray-500">No new notifications</div>
            )}

            {/* Main portal notifications */}
            {(mainCounts?.pendingSlots || []).map(req => (
              <button
                key={`main-slot-${req.id}`}
                onClick={() => jump('main', 'coach-tools')}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 transition"
              >
                <div className="flex items-start space-x-3">
                  <div className="mt-0.5"><Clock size={16} className="text-yellow-500" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900">
                      <span className="font-medium">{req.users?.full_name || 'A player'}</span> requested a training session
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {req.slot?.slot_date && fmtDate(req.slot.slot_date)}
                      {req.slot?.start_time && ` at ${fmtSlotTime(req.slot.start_time)}`}
                    </p>
                  </div>
                  {currentPortal !== 'main' && <PortalTag kind="main" />}
                </div>
              </button>
            ))}

            {(mainCounts?.unreadMessages > 0) && (
              <button
                onClick={() => jump('main', 'messages')}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 transition"
              >
                <div className="flex items-start space-x-3">
                  <div className="mt-0.5"><MessageSquare size={16} className="text-blue-500" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900">
                      <span className="font-medium">{mainCounts.unreadMessages} unread message{mainCounts.unreadMessages !== 1 ? 's' : ''}</span>
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">in your conversations</p>
                  </div>
                  {currentPortal !== 'main' && <PortalTag kind="main" />}
                </div>
              </button>
            )}

            {/* Work portal notifications */}
            {(workCounts?.unreadMessages > 0) && (
              <button
                onClick={() => jump('work', 'work-messages')}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 transition"
              >
                <div className="flex items-start space-x-3">
                  <div className="mt-0.5"><MessageSquare size={16} className="text-indigo-500" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900">
                      <span className="font-medium">{workCounts.unreadMessages} unread Work message{workCounts.unreadMessages !== 1 ? 's' : ''}</span>
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">in channels and DMs</p>
                  </div>
                  {currentPortal !== 'work' && <PortalTag kind="work" />}
                </div>
              </button>
            )}

            {(workCounts?.pendingHours || []).slice(0, 5).map(h => (
              <button
                key={`work-hr-${h.id}`}
                onClick={() => jump('work', 'work-admin-hours')}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 transition"
              >
                <div className="flex items-start space-x-3">
                  <div className="mt-0.5"><Clock size={16} className="text-yellow-500" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900">
                      <span className="font-medium">{h.submitter?.full_name || 'A coach'}</span> submitted {Number(h.hours_decimal).toFixed(2)} hrs
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">on {fmtDate(h.work_date)}</p>
                  </div>
                  {currentPortal !== 'work' && <PortalTag kind="work" />}
                </div>
              </button>
            ))}

            {(workCounts?.pendingTimeOff || []).slice(0, 5).map(t => (
              <button
                key={`work-to-${t.id}`}
                onClick={() => jump('work', 'work-admin-time-off')}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 border-b border-gray-100 transition"
              >
                <div className="flex items-start space-x-3">
                  <div className="mt-0.5"><Plane size={16} className="text-yellow-500" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900">
                      <span className="font-medium">{t.submitter?.full_name || 'A coach'}</span> requested {t.type.toUpperCase()}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">{fmtDate(t.start_date)}{t.end_date !== t.start_date && ` – ${fmtDate(t.end_date)}`}</p>
                  </div>
                  {currentPortal !== 'work' && <PortalTag kind="work" />}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PortalTag({ kind }) {
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex items-center space-x-1 flex-shrink-0 ${
      kind === 'work' ? 'bg-indigo-100 text-indigo-700' : 'bg-blue-100 text-blue-700'
    }`}>
      {kind === 'work' ? <Briefcase size={10} /> : <Home size={10} />}
      <ArrowLeftRight size={9} />
    </span>
  );
}
