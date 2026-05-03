import React, { useState } from 'react';
import {
  Briefcase, Home, Calendar, MessageSquare, DollarSign, Clock, Plane,
  FileText, Users, Map, ArrowLeftRight, Menu, X,
  Upload, CheckSquare, Megaphone, FolderOpen, ChevronDown, ChevronRight
} from 'lucide-react';
import WorkHome from './WorkHome';
import WorkDirectory from './WorkDirectory';
import WorkAdminAnnouncements from './WorkAdminAnnouncements';
import WorkDocs from './WorkDocs';
import WorkAdminDocs from './WorkAdminDocs';
import WorkMyPay from './WorkMyPay';
import WorkAdminPayroll from './WorkAdminPayroll';
import WorkMyHours from './WorkMyHours';
import WorkAdminHours from './WorkAdminHours';

const PAGE_META = {
  'work-home':                  { title: 'Home',                   description: 'Announcements, pinned notes, and quick links for staff.' },
  'work-schedule':              { title: 'Staff Schedule',         description: 'Shifts, meetings, and the Facility view in one place.' },
  'work-messages':              { title: 'Messages',               description: 'Channels and DMs with file/image attachments and real-time updates.' },
  'work-pay':                   { title: 'My Pay',                 description: 'Your paystubs and tax documents.' },
  'work-hours':                 { title: 'My Hours',               description: 'Submit and track the hours you work.' },
  'work-time-off':              { title: 'Time Off',               description: 'Request time off and check the status of your requests.' },
  'work-docs':                  { title: 'Documents',              description: 'Employee handbook, SOPs, and other staff resources.' },
  'work-directory':             { title: 'Staff Directory',        description: 'Browse the staff roster.' },
  'work-roadmap':               { title: 'Roadmap',                description: 'Plan initiatives across the team.' },
  'work-admin-payroll':         { title: 'Payroll',                description: 'Upload paystubs and tax documents for staff.' },
  'work-admin-hours':           { title: 'Hours Review',           description: 'Approve or reject coach hour submissions.' },
  'work-admin-time-off':        { title: 'Time Off Review',        description: 'Approve or reject time off requests.' },
  'work-admin-docs':            { title: 'Manage Documents',       description: 'Upload and organize staff documents.' },
  'work-admin-announcements':   { title: 'Manage Announcements',   description: 'Post and manage announcements for staff.' },
};

function ComingSoon({ viewKey }) {
  const meta = PAGE_META[viewKey] || { title: 'Coming Soon', description: '' };
  return (
    <div className="bg-white rounded-lg shadow p-12 text-center">
      <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-100 text-indigo-600 rounded-full mb-4">
        <Briefcase size={32} />
      </div>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">{meta.title}</h2>
      <p className="text-gray-600 max-w-md mx-auto">{meta.description}</p>
      <p className="text-sm text-gray-400 mt-6">Coming soon</p>
    </div>
  );
}

export default function WorkPortalShell({ userId, userRole, userName, userAvatar, onLogout, onSwitchPortal }) {
  const [currentView, setCurrentView] = useState('work-home');
  const [mobileOpen, setMobileOpen] = useState(false);

  const meta = PAGE_META[currentView] || { title: 'Work Portal' };

  const renderContent = () => {
    switch (currentView) {
      case 'work-home':
        return <WorkHome userId={userId} userRole={userRole} />;
      case 'work-directory':
        return <WorkDirectory />;
      case 'work-docs':
        return <WorkDocs />;
      case 'work-pay':
        return <WorkMyPay userId={userId} />;
      case 'work-hours':
        return <WorkMyHours userId={userId} />;
      case 'work-admin-announcements':
        return <WorkAdminAnnouncements userId={userId} />;
      case 'work-admin-docs':
        return <WorkAdminDocs userId={userId} />;
      case 'work-admin-payroll':
        return <WorkAdminPayroll userId={userId} />;
      case 'work-admin-hours':
        return <WorkAdminHours userId={userId} />;
      default:
        return <ComingSoon viewKey={currentView} />;
    }
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <WorkSidebar
        userRole={userRole}
        userName={userName}
        userAvatar={userAvatar}
        currentView={currentView}
        setCurrentView={(v) => { setCurrentView(v); setMobileOpen(false); }}
        onLogout={onLogout}
        onSwitchPortal={onSwitchPortal}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
      />

      <div className="flex-1 md:ml-64">
        <div className="sticky top-0 z-30 bg-white border-b px-4 md:px-8 py-3 flex items-center">
          <button
            onClick={() => setMobileOpen(true)}
            className="md:hidden p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition mr-2"
            aria-label="Open menu"
          >
            <Menu size={22} />
          </button>
          <h2 className="text-lg font-semibold text-gray-900">{meta.title}</h2>
        </div>

        <div className="p-4 md:p-8">
          <div className="max-w-7xl mx-auto">
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkSidebar({ userRole, userName, userAvatar, currentView, setCurrentView, onLogout, onSwitchPortal, mobileOpen, setMobileOpen }) {
  const isAdmin = userRole === 'admin';
  const [adminExpanded, setAdminExpanded] = useState(true);

  const NavItem = ({ id, icon: Icon, label }) => (
    <button
      onClick={() => setCurrentView(id)}
      className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition ${
        currentView === id ? 'bg-indigo-600' : 'hover:bg-gray-800'
      }`}
    >
      <Icon size={20} />
      <span className="flex-1 text-left">{label}</span>
    </button>
  );

  const SubNavItem = ({ id, icon: Icon, label }) => (
    <button
      onClick={() => setCurrentView(id)}
      className={`w-full flex items-center space-x-3 px-4 py-2 rounded-lg transition text-sm ${
        currentView === id ? 'bg-indigo-600' : 'hover:bg-gray-800'
      }`}
    >
      <Icon size={16} />
      <span className="flex-1 text-left">{label}</span>
    </button>
  );

  return (
    <div className={`w-64 bg-gray-900 text-white h-screen fixed left-0 top-0 p-6 flex flex-col z-50 transition-transform ${
      mobileOpen ? 'translate-x-0' : '-translate-x-full'
    } md:translate-x-0`}>
      <div className="mb-8 flex items-start justify-between">
        <div className="min-w-0">
          <div className="flex items-center space-x-2">
            <Briefcase size={22} className="text-indigo-400 flex-shrink-0" />
            <h1 className="text-xl font-bold text-indigo-400 truncate">NBP Work Portal</h1>
          </div>
          <div className="flex items-center space-x-3 mt-3">
            {userAvatar ? (
              <img src={userAvatar} alt="Avatar" className="w-9 h-9 rounded-full object-cover" />
            ) : (
              <div className="w-9 h-9 bg-indigo-600 rounded-full flex items-center justify-center text-white text-sm font-bold">
                {userName?.charAt(0) || '?'}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-200 truncate">{userName || 'User'}</p>
              <p className="text-xs text-gray-400">{userRole?.toUpperCase()}</p>
            </div>
          </div>
        </div>
        <button
          onClick={() => setMobileOpen(false)}
          className="md:hidden p-1 text-gray-400 hover:text-white"
          aria-label="Close menu"
        >
          <X size={20} />
        </button>
      </div>

      <nav className="space-y-2 flex-1 overflow-y-auto -mx-2 px-2">
        <NavItem id="work-home"      icon={Home}          label="Home" />
        <NavItem id="work-schedule"  icon={Calendar}      label="Schedule" />
        <NavItem id="work-messages"  icon={MessageSquare} label="Messages" />
        <NavItem id="work-pay"       icon={DollarSign}    label="My Pay" />
        <NavItem id="work-hours"     icon={Clock}         label="My Hours" />
        <NavItem id="work-time-off"  icon={Plane}         label="Time Off" />
        <NavItem id="work-docs"      icon={FileText}      label="Documents" />
        <NavItem id="work-directory" icon={Users}         label="Directory" />
        <NavItem id="work-roadmap"   icon={Map}           label="Roadmap" />

        {isAdmin && (
          <div className="pt-2">
            <button
              onClick={() => setAdminExpanded(!adminExpanded)}
              className="w-full flex items-center space-x-3 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-gray-400 hover:text-white transition"
            >
              <span className="flex-1 text-left">Admin</span>
              {adminExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            {adminExpanded && (
              <div className="space-y-1 mt-1">
                <SubNavItem id="work-admin-payroll"        icon={Upload}      label="Payroll" />
                <SubNavItem id="work-admin-hours"          icon={CheckSquare} label="Hours Review" />
                <SubNavItem id="work-admin-time-off"       icon={CheckSquare} label="Time Off Review" />
                <SubNavItem id="work-admin-docs"           icon={FolderOpen}  label="Manage Documents" />
                <SubNavItem id="work-admin-announcements"  icon={Megaphone}   label="Manage Announcements" />
              </div>
            )}
          </div>
        )}
      </nav>

      <div className="mt-auto pt-4 space-y-2">
        <button
          onClick={onSwitchPortal}
          className="w-full flex items-center justify-center space-x-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition text-sm"
        >
          <ArrowLeftRight size={16} />
          <span>Switch to Main Portal</span>
        </button>
        <button
          onClick={onLogout}
          className="w-full bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}
