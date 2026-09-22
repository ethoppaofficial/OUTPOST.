import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Compass,
  Home,
  Users,
  Building2,
  Receipt,
  MessageSquare,
  Bell,
  ShieldCheck,
  Search,
  User,
  Menu,
  X,
  FileCheck,
  CalendarCheck,
  LogOut,
  Layers,
  MapPin,
  ExternalLink,
  ChevronRight,
  Sparkles,
  CheckCircle2,
  HelpCircle,
  AlertTriangle,
} from 'lucide-react';
import { authService, AuthSession } from '../../application/services/authService';
import { notificationService } from '../../application/services/notificationService';
import { ThemeToggle } from './ThemeToggle';
import { PersonaSwitcher } from './PersonaSwitcher';

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const [session, setSession] = useState<AuthSession>(() => authService.getSession());
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifsDropdownOpen, setNotifsDropdownOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const refreshSession = () => {
    const s = authService.getSession();
    setSession(s);
    setUnreadNotifs(notificationService.getUnreadCount(s.user.id));
  };

  useEffect(() => {
    refreshSession();
    // Subscribe to notifications for current user
    const unsub = notificationService.subscribeToNotifications(session.user.id, () => {
      setUnreadNotifs(notificationService.getUnreadCount(session.user.id));
    });
    return () => unsub();
  }, [session.user.id]);

  // Close mobile menu on location change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const userRole = session.user.role;

  const studentLinks = [
    { label: 'Overview', to: '/student/dashboard', icon: Home },
    { label: 'Browse Housing', to: '/student/properties', icon: Compass },
    { label: 'Find Roommates', to: '/student/roommates', icon: Users },
    { label: 'Roommate Groups', to: '/student/groups', icon: Layers },
    { label: 'Matric Verification', to: '/student/verification', icon: FileCheck },
    { label: 'Student Search', to: '/student/search', icon: Search },
    { label: 'My Reservations', to: '/student/reservations', icon: CalendarCheck },
    { label: 'Chat & Inquiries', to: '/student/chat', icon: MessageSquare },
  ];

  const landlordLinks = [
    { label: 'Overview', to: '/landlord/dashboard', icon: Home },
    { label: 'My Properties', to: '/landlord/properties', icon: Building2 },
    { label: 'List New Property', to: '/landlord/properties/new', icon: Compass },
    { label: 'Review Receipts', to: '/landlord/receipts', icon: Receipt },
    { label: 'Landlord Verification', to: '/landlord/verification', icon: ShieldCheck },
    { label: 'Tenant Inquiries', to: '/landlord/chat', icon: MessageSquare },
  ];

  const adminLinks = [
    { label: 'Admin Console', to: '/admin/dashboard', icon: Home },
    { label: 'User Directory', to: '/admin/users', icon: Users },
    { label: 'Landlord Approvals', to: '/admin/verifications', icon: ShieldCheck },
    { label: 'Property Approvals', to: '/admin/properties', icon: Building2 },
    { label: 'Disputes & Reports', to: '/admin/disputes', icon: AlertTriangle },
    { label: 'Support Chat', to: '/admin/chat', icon: MessageSquare },
  ];

  const activeNavLinks =
    userRole === 'admin'
      ? adminLinks
      : userRole === 'landlord'
      ? landlordLinks
      : studentLinks;

  const notifications = notificationService.getNotifications(session.user.id).slice(0, 5);

  // Render vertical navigation list
  const renderNavContent = () => (
    <div className="flex flex-col h-full">
      {/* Brand Header */}
      <div className="p-4 border-b border-slate-200/80 dark:border-slate-800">
        <Link to="/" className="flex items-center gap-3 focus:outline-none group">
          <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-black tracking-wider text-lg shadow-sm group-hover:bg-emerald-500 transition">
            O
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold tracking-tight text-lg text-slate-950 dark:text-white leading-none">
                OUTPOST
              </span>
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400">
                BUK
              </span>
            </div>
            <span className="text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400 tracking-wider mt-0.5">
              Off-Campus Living
            </span>
          </div>
        </Link>

        {/* Active Role Indicator Card */}
        <div className="mt-3.5 p-2 rounded-xl bg-slate-100/80 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${userRole === 'admin' ? 'bg-amber-500' : userRole === 'landlord' ? 'bg-blue-500' : 'bg-emerald-500'}`} />
            <span className="text-xs font-semibold capitalize text-slate-800 dark:text-slate-200">
              {userRole === 'admin' ? 'Admin Console' : userRole === 'landlord' ? 'Landlord Hub' : 'Student Portal'}
            </span>
          </div>
          <span className="text-[10px] font-mono uppercase font-bold text-slate-500 dark:text-slate-400">
            {userRole}
          </span>
        </div>
      </div>

      {/* Scrollable Navigation Links */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6 scrollbar-thin">
        {/* Workspace Nav Items */}
        <div className="space-y-1">
          <div className="px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            {userRole} Workspace
          </div>
          {activeNavLinks.map((item) => {
            const Icon = item.icon;
            const isActive =
              location.pathname === item.to ||
              (item.to !== '/' &&
                item.to !== '/student/dashboard' &&
                item.to !== '/landlord/dashboard' &&
                item.to !== '/admin/dashboard' &&
                location.pathname.startsWith(item.to + '/'));

            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition group ${
                  isActive
                    ? 'bg-emerald-600 text-white shadow-xs dark:bg-emerald-600'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/80'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200'}`} />
                  <span className="truncate">{item.label}</span>
                </div>
                {isActive && <ChevronRight className="w-3.5 h-3.5 text-white/80" />}
              </Link>
            );
          })}
        </div>

        {/* BUK Off-Campus Case Study Settlements */}
        <div className="space-y-1 pt-2 border-t border-slate-100 dark:border-slate-800/80">
          <div className="px-3 pb-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            <span>BUK Settlements</span>
            <MapPin className="w-3 h-3 text-emerald-500" />
          </div>

          <Link
            to="/properties?university=Bayero+University+Kano+(BUK)"
            className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/80 transition"
          >
            <div className="flex items-center gap-2.5 truncate">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span className="truncate">All BUK Listings</span>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 font-mono">
              New Campus
            </span>
          </Link>

          <Link
            to="/properties?neighbourhood=Dambare"
            className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/80 transition"
          >
            <div className="flex items-center gap-2.5 truncate">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              <span className="truncate">Dambare Settlement</span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">
              ~0.4km
            </span>
          </Link>

          <Link
            to="/properties?neighbourhood=Rimin+Gata"
            className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/80 transition"
          >
            <div className="flex items-center gap-2.5 truncate">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
              <span className="truncate">Rimin Gata Area</span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">
              ~0.9km
            </span>
          </Link>

          <Link
            to="/properties"
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition"
          >
            <Compass className="w-3.5 h-3.5" />
            <span>Public Housing Directory</span>
          </Link>
        </div>

        {/* Verification & Trust Badge */}
        <div className="p-3 rounded-2xl bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200/50 dark:border-emerald-800/40 space-y-1.5">
          <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 font-semibold text-xs">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>Case Study Sandbox</span>
          </div>
          <p className="text-[11px] text-emerald-900/80 dark:text-emerald-300/80 leading-relaxed">
            Data models student hostels around BUK New Campus (Dambare & Rimin Gata) with 7-day payment holds.
          </p>
        </div>
      </div>

      {/* User Card & Footer in Sidebar */}
      <div className="p-3 border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/50">
        <div className="flex items-center gap-3 p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 shadow-2xs">
          <img
            src={session.user.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100'}
            alt={session.displayName}
            className="w-9 h-9 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-700 flex-shrink-0"
          />
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-xs font-semibold text-slate-900 dark:text-white truncate">
              {session.displayName}
            </span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
              {session.user.email}
            </span>
          </div>
        </div>

        <div className="mt-2.5 flex items-center justify-between px-1">
          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
            Appearance
          </div>
          <ThemeToggle />
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans flex">
      {/* 1. Desktop Fixed Vertical Navigation Bar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 z-30 bg-white dark:bg-slate-900 border-r border-slate-200/80 dark:border-slate-800 shadow-xs">
        {renderNavContent()}
      </aside>

      {/* 2. Mobile Slide-out Drawer Overlay & Navigation */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          {/* Backdrop blur */}
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity animate-in fade-in"
            onClick={() => setMobileMenuOpen(false)}
          />

          {/* Drawer Panel */}
          <div className="relative flex-1 flex flex-col max-w-xs w-full bg-white dark:bg-slate-900 shadow-2xl z-10 animate-in slide-in-from-left duration-200">
            <div className="absolute top-3 right-3">
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 rounded-xl text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                aria-label="Close navigation menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {renderNavContent()}
          </div>
        </div>
      )}

      {/* 3. Main Content Wrapper (offset by sidebar width on desktop) */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Top Header Bar */}
        <header className="sticky top-0 z-20 w-full border-b border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md">
          <div className="px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
            {/* Left: Mobile hamburger & location context */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setMobileMenuOpen(true)}
                className="lg:hidden p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                aria-label="Open navigation menu"
              >
                <Menu className="w-5 h-5" />
              </button>

              <div className="hidden sm:flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Bayero University Kano
                </span>
                <span className="text-slate-300 dark:text-slate-600">•</span>
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Off-Campus Accommodations
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/40">
                  Dambare & Rimin Gata
                </span>
              </div>
            </div>

            {/* Right: Persona Switcher, Notifications, Theme & Profile */}
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Persona Switcher */}
              <PersonaSwitcher currentUserId={session.user.id} onPersonaChange={refreshSession} />

              {/* Notification Bell */}
              <div className="relative">
                <button
                  onClick={() => setNotifsDropdownOpen(!notifsDropdownOpen)}
                  className="relative p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                  aria-label="View notifications"
                >
                  <Bell className="w-4 h-4" />
                  {unreadNotifs > 0 && (
                    <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-900" />
                  )}
                </button>

                {/* Notifications Dropdown */}
                {notifsDropdownOpen && (
                  <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 py-2 z-50 animate-in fade-in zoom-in-95 duration-100">
                    <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-900 dark:text-white">Notifications</span>
                      <button
                        onClick={() => {
                          notificationService.markAllAsRead(session.user.id);
                          refreshSession();
                        }}
                        className="text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline"
                      >
                        Mark all read
                      </button>
                    </div>
                    <div className="divide-y divide-slate-100 dark:divide-slate-800/60 max-h-72 overflow-y-auto">
                      {notifications.length === 0 ? (
                        <div className="p-4 text-center text-xs text-slate-400">No new notifications</div>
                      ) : (
                        notifications.map((n) => (
                          <div
                            key={n.id}
                            onClick={() => {
                              notificationService.markAsRead(n.id);
                              refreshSession();
                              if (n.link) navigate(n.link);
                              setNotifsDropdownOpen(false);
                            }}
                            className={`p-3 text-xs cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60 transition ${
                              !n.isRead ? 'bg-emerald-50/40 dark:bg-emerald-950/20' : ''
                            }`}
                          >
                            <div className="font-semibold text-slate-800 dark:text-slate-200 mb-0.5">{n.title}</div>
                            <div className="text-slate-500 dark:text-slate-400 text-[11px] line-clamp-2">{n.message}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Header profile avatar on small screens */}
              <div className="lg:hidden flex items-center">
                <img
                  src={session.user.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100'}
                  alt={session.displayName}
                  className="w-8 h-8 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-700"
                />
              </div>
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          {children}
        </main>
      </div>
    </div>
  );
};
