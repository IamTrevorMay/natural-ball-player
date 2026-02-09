import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { Calendar, List, MapPin, Clock, Users, CheckCircle, XCircle, HelpCircle, X, ChevronLeft, ChevronRight, Filter } from 'lucide-react';

export default function Schedule({ userId, userRole }) {
  const [view, setView] = useState('list'); // 'list' or 'calendar'
  const [events, setEvents] = useState([]);
  const [filteredEvents, setFilteredEvents] = useState([]);
  const [filter, setFilter] = useState('all'); // 'all', 'games', 'practices'
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date());

  useEffect(() => {
    fetchEvents();
  }, [userId]);

  useEffect(() => {
    applyFilters();
  }, [events, filter]);

  const fetchEvents = async () => {
    // Get user's teams first
    const { data: userTeams } = await supabase
      .from('team_members')
      .select('team_id')
      .eq('user_id', userId);

    if (!userTeams || userTeams.length === 0) {
      setLoading(false);
      return;
    }

    const teamIds = userTeams.map(t => t.team_id);

    // Fetch events for user's teams
    const { data, error } = await supabase
      .from('schedule_events')
      .select(`
        *,
        teams(name),
        event_rsvps(user_id, status)
      `)
      .in('team_id', teamIds)
      .order('event_date', { ascending: true });

    if (!error && data) {
      // Enrich events with RSVP data
      const enrichedEvents = data.map(event => ({
        ...event,
        userRsvp: event.event_rsvps?.find(r => r.user_id === userId),
        rsvpCounts: event.event_rsvps?.reduce((acc, rsvp) => {
          acc[rsvp.status] = (acc[rsvp.status] || 0) + 1;
          return acc;
        }, {})
      }));
      
      setEvents(enrichedEvents);
    }
    setLoading(false);
  };

  const applyFilters = () => {
    let filtered = [...events];
    
    if (filter === 'games') {
      filtered = filtered.filter(e => e.event_type === 'game');
    } else if (filter === 'practices') {
      filtered = filtered.filter(e => e.event_type === 'practice');
    }
    
    setFilteredEvents(filtered);
  };

  const handleRsvp = async (eventId, status) => {
    const { error } = await supabase
      .from('event_rsvps')
      .upsert({
        event_id: eventId,
        user_id: userId,
        status: status
      }, {
        onConflict: 'event_id,user_id'
      });

    if (!error) {
      fetchEvents();
      if (selectedEvent && selectedEvent.id === eventId) {
        const updatedEvent = events.find(e => e.id === eventId);
        setSelectedEvent(updatedEvent);
      }
    }
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const upcomingEvents = filteredEvents.filter(e => new Date(e.event_date) >= today);
  const pastEvents = filteredEvents.filter(e => new Date(e.event_date) < today);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-600">Loading schedule...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Schedule</h2>
          <p className="text-gray-600 mt-1">Your games and practices</p>
        </div>
        <div className="flex items-center space-x-2">
          {/* Filter */}
          <div className="flex items-center space-x-2 bg-white rounded-lg shadow px-3 py-2">
            <Filter size={16} className="text-gray-500" />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="text-sm border-none focus:outline-none focus:ring-0 bg-transparent"
            >
              <option value="all">All Events</option>
              <option value="games">Games Only</option>
              <option value="practices">Practices Only</option>
            </select>
          </div>
          
          {/* View Toggle */}
          <div className="bg-white rounded-lg shadow flex">
            <button
              onClick={() => setView('list')}
              className={`px-4 py-2 rounded-l-lg font-medium transition flex items-center space-x-2 ${
                view === 'list'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              <List size={18} />
              <span>List</span>
            </button>
            <button
              onClick={() => setView('calendar')}
              className={`px-4 py-2 rounded-r-lg font-medium transition flex items-center space-x-2 ${
                view === 'calendar'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Calendar size={18} />
              <span>Calendar</span>
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      {view === 'list' ? (
        <ListView
          upcomingEvents={upcomingEvents}
          pastEvents={pastEvents}
          onEventClick={setSelectedEvent}
          onRsvp={handleRsvp}
          userId={userId}
        />
      ) : (
        <CalendarView
          events={filteredEvents}
          currentMonth={currentMonth}
          setCurrentMonth={setCurrentMonth}
          onEventClick={setSelectedEvent}
        />
      )}

      {/* Event Detail Modal */}
      {selectedEvent && (
        <EventDetailModal
          event={selectedEvent}
          userId={userId}
          onClose={() => setSelectedEvent(null)}
          onRsvp={handleRsvp}
        />
      )}
    </div>
  );
}

function ListView({ upcomingEvents, pastEvents, onEventClick, onRsvp, userId }) {
  return (
    <div className="space-y-6">
      {/* Upcoming Events */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Upcoming Events ({upcomingEvents.length})
        </h3>
        {upcomingEvents.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <Calendar size={48} className="mx-auto mb-4 text-gray-300" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Upcoming Events</h3>
            <p className="text-gray-600">Check back later for new games and practices</p>
          </div>
        ) : (
          <div className="space-y-3">
            {upcomingEvents.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                onClick={() => onEventClick(event)}
                onRsvp={onRsvp}
                userId={userId}
              />
            ))}
          </div>
        )}
      </div>

      {/* Past Events */}
      {pastEvents.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Past Events ({pastEvents.length})
          </h3>
          <div className="space-y-3 opacity-60">
            {pastEvents.slice(0, 5).map((event) => (
              <EventCard
                key={event.id}
                event={event}
                onClick={() => onEventClick(event)}
                isPast={true}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EventCard({ event, onClick, onRsvp, userId, isPast }) {
  const eventDate = new Date(event.event_date);
  const isOptional = event.is_optional;
  const userRsvp = event.userRsvp?.status;

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-lg shadow hover:shadow-md transition cursor-pointer p-4"
    >
      <div className="flex items-start justify-between">
        <div className="flex space-x-4 flex-1">
          {/* Date Box */}
          <div className="bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-lg p-3 text-center min-w-[70px]">
            <div className="text-2xl font-bold">{eventDate.getDate()}</div>
            <div className="text-xs uppercase">
              {eventDate.toLocaleDateString('en-US', { month: 'short' })}
            </div>
          </div>

          {/* Event Details */}
          <div className="flex-1">
            <div className="flex items-center space-x-3 mb-2">
              <h4 className="text-lg font-semibold text-gray-900">
                {event.opponent}
              </h4>
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                event.event_type === 'game'
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-green-100 text-green-700'
              }`}>
                {event.event_type}
              </span>
              {event.home_away && (
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  event.home_away === 'home'
                    ? 'bg-green-50 text-green-700 border border-green-200'
                    : 'bg-orange-50 text-orange-700 border border-orange-200'
                }`}>
                  {event.home_away}
                </span>
              )}
              {isOptional && (
                <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs font-medium">
                  RSVP
                </span>
              )}
            </div>

            <div className="space-y-1 text-sm text-gray-600">
              <div className="flex items-center space-x-2">
                <Clock size={14} />
                <span>{event.event_time}</span>
              </div>
              <div className="flex items-center space-x-2">
                <MapPin size={14} />
                <span>{event.location}</span>
              </div>
              <div className="flex items-center space-x-2">
                <Users size={14} />
                <span>{event.teams?.name}</span>
              </div>
            </div>

            {/* RSVP Status/Counts */}
            {isOptional && !isPast && (
              <div className="mt-3 flex items-center space-x-2">
                {userRsvp && (
                  <div className={`text-xs font-medium px-2 py-1 rounded ${
                    userRsvp === 'attending'
                      ? 'bg-green-100 text-green-700'
                      : userRsvp === 'not_attending'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-gray-100 text-gray-700'
                  }`}>
                    You: {userRsvp === 'attending' ? '✓ Going' : userRsvp === 'not_attending' ? '✗ Not Going' : '? Maybe'}
                  </div>
                )}
                {event.rsvpCounts && (
                  <div className="text-xs text-gray-500">
                    {event.rsvpCounts.attending || 0} attending • {event.rsvpCounts.not_attending || 0} not attending
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* RSVP Buttons (for optional events) */}
        {isOptional && !isPast && (
          <div className="flex flex-col space-y-1 ml-4" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => onRsvp(event.id, 'attending')}
              className={`p-2 rounded-lg transition ${
                userRsvp === 'attending'
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-green-50 hover:text-green-600'
              }`}
              title="Attending"
            >
              <CheckCircle size={18} />
            </button>
            <button
              onClick={() => onRsvp(event.id, 'maybe')}
              className={`p-2 rounded-lg transition ${
                userRsvp === 'maybe'
                  ? 'bg-yellow-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-yellow-50 hover:text-yellow-600'
              }`}
              title="Maybe"
            >
              <HelpCircle size={18} />
            </button>
            <button
              onClick={() => onRsvp(event.id, 'not_attending')}
              className={`p-2 rounded-lg transition ${
                userRsvp === 'not_attending'
                  ? 'bg-red-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-600'
              }`}
              title="Not Attending"
            >
              <XCircle size={18} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CalendarView({ events, currentMonth, setCurrentMonth, onEventClick }) {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  // Get first day of month and number of days
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay();

  // Generate calendar grid
  const calendarDays = [];
  
  // Empty cells before first day
  for (let i = 0; i < startingDayOfWeek; i++) {
    calendarDays.push(null);
  }
  
  // Days of month
  for (let day = 1; day <= daysInMonth; day++) {
    calendarDays.push(day);
  }

  const previousMonth = () => {
    setCurrentMonth(new Date(year, month - 1));
  };

  const nextMonth = () => {
    setCurrentMonth(new Date(year, month + 1));
  };

  const getEventsForDay = (day) => {
    if (!day) return [];
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return events.filter(e => e.event_date === dateStr);
  };

  const isToday = (day) => {
    if (!day) return false;
    const today = new Date();
    return (
      day === today.getDate() &&
      month === today.getMonth() &&
      year === today.getFullYear()
    );
  };

  return (
    <div className="bg-white rounded-lg shadow">
      {/* Calendar Header */}
      <div className="p-6 border-b border-gray-200 flex items-center justify-between">
        <button
          onClick={previousMonth}
          className="p-2 hover:bg-gray-100 rounded-lg transition"
        >
          <ChevronLeft size={20} />
        </button>
        <h3 className="text-xl font-bold text-gray-900">
          {currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </h3>
        <button
          onClick={nextMonth}
          className="p-2 hover:bg-gray-100 rounded-lg transition"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Calendar Grid */}
      <div className="p-6">
        {/* Day headers */}
        <div className="grid grid-cols-7 gap-2 mb-2">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="text-center text-sm font-semibold text-gray-600 py-2">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar days */}
        <div className="grid grid-cols-7 gap-2">
          {calendarDays.map((day, index) => {
            const dayEvents = getEventsForDay(day);
            return (
              <div
                key={index}
                className={`min-h-[100px] border rounded-lg p-2 ${
                  day ? 'bg-white hover:bg-gray-50' : 'bg-gray-50'
                } ${isToday(day) ? 'border-blue-500 border-2' : 'border-gray-200'}`}
              >
                {day && (
                  <>
                    <div className={`text-sm font-semibold mb-1 ${
                      isToday(day) ? 'text-blue-600' : 'text-gray-900'
                    }`}>
                      {day}
                    </div>
                    <div className="space-y-1">
                      {dayEvents.map(event => (
                        <button
                          key={event.id}
                          onClick={() => onEventClick(event)}
                          className={`w-full text-left px-2 py-1 rounded text-xs font-medium truncate ${
                            event.event_type === 'game'
                              ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                              : 'bg-green-100 text-green-700 hover:bg-green-200'
                          }`}
                        >
                          {event.event_time} {event.opponent}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EventDetailModal({ event, userId, onClose, onRsvp }) {
  const eventDate = new Date(event.event_date);
  const isOptional = event.is_optional;
  const userRsvp = event.userRsvp?.status;
  const isPast = eventDate < new Date();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold text-gray-900">{event.opponent}</h3>
            <p className="text-sm text-gray-600 mt-1">{event.teams?.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={24} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Event Type & Home/Away */}
          <div className="flex items-center space-x-2">
            <span className={`px-4 py-2 rounded-full text-sm font-medium ${
              event.event_type === 'game'
                ? 'bg-blue-100 text-blue-700'
                : 'bg-green-100 text-green-700'
            }`}>
              {event.event_type}
            </span>
            {event.home_away && (
              <span className={`px-4 py-2 rounded-full text-sm font-medium ${
                event.home_away === 'home'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-orange-100 text-orange-700'
              }`}>
                {event.home_away} game
              </span>
            )}
            {isOptional && (
              <span className="px-4 py-2 bg-yellow-100 text-yellow-700 rounded-full text-sm font-medium">
                Optional - RSVP Required
              </span>
            )}
          </div>

          {/* Date & Time */}
          <div className="bg-gray-50 rounded-lg p-4 space-y-3">
            <div className="flex items-center space-x-3">
              <Calendar size={20} className="text-blue-600" />
              <div>
                <div className="text-sm text-gray-600">Date</div>
                <div className="font-semibold text-gray-900">
                  {eventDate.toLocaleDateString('en-US', { 
                    weekday: 'long', 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  })}
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <Clock size={20} className="text-blue-600" />
              <div>
                <div className="text-sm text-gray-600">Time</div>
                <div className="font-semibold text-gray-900">{event.event_time}</div>
              </div>
            </div>
          </div>

          {/* Location */}
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-start space-x-3">
              <MapPin size={20} className="text-blue-600 mt-1" />
              <div className="flex-1">
                <div className="text-sm text-gray-600">Location</div>
                <div className="font-semibold text-gray-900">{event.location}</div>
                {event.address && (
                  <a
                    href={`https://maps.google.com/?q=${encodeURIComponent(event.address)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:text-blue-800 mt-1 inline-block"
                  >
                    {event.address} →
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* Notes */}
          {event.notes && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="text-sm font-medium text-blue-900 mb-1">Notes</div>
              <p className="text-sm text-blue-800 whitespace-pre-wrap">{event.notes}</p>
            </div>
          )}

          {/* RSVP Section */}
          {isOptional && !isPast && (
            <div className="border-t border-gray-200 pt-6">
              <h4 className="font-semibold text-gray-900 mb-4">Your Response</h4>
              <div className="grid grid-cols-3 gap-3">
                <button
                  onClick={() => onRsvp(event.id, 'attending')}
                  className={`p-4 rounded-lg font-medium transition flex flex-col items-center space-y-2 ${
                    userRsvp === 'attending'
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-green-50'
                  }`}
                >
                  <CheckCircle size={24} />
                  <span>Attending</span>
                  {event.rsvpCounts?.attending && (
                    <span className="text-xs opacity-75">
                      {event.rsvpCounts.attending} going
                    </span>
                  )}
                </button>
                <button
                  onClick={() => onRsvp(event.id, 'maybe')}
                  className={`p-4 rounded-lg font-medium transition flex flex-col items-center space-y-2 ${
                    userRsvp === 'maybe'
                      ? 'bg-yellow-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-yellow-50'
                  }`}
                >
                  <HelpCircle size={24} />
                  <span>Maybe</span>
                  {event.rsvpCounts?.maybe && (
                    <span className="text-xs opacity-75">
                      {event.rsvpCounts.maybe} maybe
                    </span>
                  )}
                </button>
                <button
                  onClick={() => onRsvp(event.id, 'not_attending')}
                  className={`p-4 rounded-lg font-medium transition flex flex-col items-center space-y-2 ${
                    userRsvp === 'not_attending'
                      ? 'bg-red-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-red-50'
                  }`}
                >
                  <XCircle size={24} />
                  <span>Not Going</span>
                  {event.rsvpCounts?.not_attending && (
                    <span className="text-xs opacity-75">
                      {event.rsvpCounts.not_attending} not going
                    </span>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
