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

  const userRole = session.user.role;

  const studentLinks = [
    { label: 'Overview', to: '/student/dashboard', icon: <Home className="w-4 h-4" /> },
    { label: 'Find Housing', to: '/student/properties', icon: <Compass className="w-4 h-4" /> },
    { label: 'Find Roommates', to: '/student/roommates', icon: <Users className="w-4 h-4" /> },
    { label: 'Student Search', to: '/student/user-search', icon: <Search className="w-4 h-4" /> },
    { label: 'Groups', to: '/student/groups', icon: <Layers className="w-4 h-4" /> },
    { label: 'My Reservations', to: '/student/reservations', icon: <CalendarCheck className="w-4 h-4" /> },
    { label: 'Direct & Group Chat', to: '/student/chat', icon: <MessageSquare className="w-4 h-4" /> },
    { label: 'Student ID Verification', to: '/student/profile/verification', icon: <FileCheck className="w-4 h-4" /> },
  ];

  const landlordLinks = [
    { label: 'Overview', to: '/landlord/dashboard', icon: <Home className="w-4 h-4" /> },
    { label: 'My Properties', to: '/landlord/properties', icon: <Building2 className="w-4 h-4" /> },
    { label: 'Post New Property', to: '/landlord/properties/new', icon: <Compass className="w-4 h-4" /> },
    { label: 'Review Receipts', to: '/landlord/receipts', icon: <Receipt className="w-4 h-4" /> },
    { label: 'Landlord Verification', to: '/landlord/verification', icon: <ShieldCheck className="w-4 h-4" /> },
    { label: 'Inquiries & Chat', to: '/landlord/chat', icon: <MessageSquare className="w-4 h-4" /> },
  ];

  const adminLinks = [
    { label: 'Platform Console', to: '/admin/dashboard', icon: <Home className="w-4 h-4" /> },
    { label: 'Manage Users', to: '/admin/users', icon: <Users className="w-4 h-4" /> },
    { label: 'Verify Landlords', to: '/admin/landlord-verifications', icon: <ShieldCheck className="w-4 h-4" /> },
    { label: 'Verify Properties', to: '/admin/property-verifications', icon: <Building2 className="w-4 h-4" /> },
    { label: 'Reservations & Audits', to: '/admin/reservations', icon: <CalendarCheck className="w-4 h-4" /> },
    { label: 'Support Chat', to: '/admin/chat', icon: <MessageSquare className="w-4 h-4" /> },
  ];

  const activeNavLinks =
    userRole === 'admin'
      ? adminLinks
      : userRole === 'landlord'
      ? landlordLinks
      : studentLinks;

  const notifications = notificationService.getNotifications(session.user.id).slice(0, 5);

  return (
    <div className="min-vh-100 min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans">
      {/* Top Header */}
      <header className="sticky top-0 z-40 w-full border-b border-slate-200/80 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
          {/* Logo & Brand Wordmark */}
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-2.5 focus:outline-none">
              <div className="w-9 h-9 rounded-xl bg-slate-900 dark:bg-emerald-600 flex items-center justify-center text-white font-black tracking-wider text-base shadow-xs">
                O
              </div>
              <div className="flex flex-col">
                <span className="font-extrabold tracking-tight text-lg text-slate-950 dark:text-white leading-none">
                  OUTPOST
                </span>
                <span className="text-[10px] uppercase font-semibold text-emerald-600 dark:text-emerald-400 tracking-wider">
                  Verified Student Living
                </span>
              </div>
            </Link>

            {/* Public or Role quick switch tab */}
            <nav className="hidden lg:flex items-center gap-1">
              <Link
                to="/properties"
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  location.pathname === '/properties'
                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Public Listings
              </Link>
            </nav>
          </div>

          {/* Right Header Utilities: Persona Switcher, Notifications, Theme Toggle, User Profile */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Quick Persona Switcher for demo testing */}
            <PersonaSwitcher currentUserId={session.user.id} onPersonaChange={refreshSession} />

            {/* Notification Bell with counter */}
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

            {/* Theme Toggle */}
            <ThemeToggle />

            {/* Profile Avatar / Name */}
            <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-slate-200 dark:border-slate-800">
              <img
                src={session.user.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100'}
                alt={session.displayName}
                className="w-8 h-8 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-700"
              />
              <div className="flex flex-col text-left">
                <span className="text-xs font-semibold text-slate-900 dark:text-white line-clamp-1 max-w-[120px]">
                  {session.displayName}
                </span>
                <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                  {userRole}
                </span>
              </div>
            </div>

            {/* Mobile Hamburger */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Secondary Role Navigation Bar on Desktop */}
        <div className="hidden lg:block border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/60 dark:bg-slate-900/40 px-4 sm:px-6 lg:px-8">
          <div className="max-w-7xl mx-auto flex items-center gap-1 overflow-x-auto py-1.5 scrollbar-none">
            {activeNavLinks.map((item) => {
              const isActive = location.pathname === item.to || (item.to !== '/' && location.pathname.startsWith(item.to + '/'));
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition whitespace-nowrap ${
                    isActive
                      ? 'bg-slate-900 text-white dark:bg-emerald-600 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 pt-3 pb-6 space-y-1 shadow-lg animate-in slide-in-from-top duration-150">
            <div className="px-2 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
              {userRole} Portal
            </div>
            {activeNavLinks.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition ${
                  location.pathname === item.to
                    ? 'bg-slate-900 text-white dark:bg-emerald-600 dark:text-white'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </Link>
            ))}
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
              <Link
                to="/properties"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Compass className="w-4 h-4" />
                <span>Public Accommodation Directory</span>
              </Link>
              <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/60">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Appearance Mode</span>
                <ThemeToggle />
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Main Viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {children}
      </main>

      {/* Footer with SEO links and platform verification note */}
      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 py-8 px-4 sm:px-6 lg:px-8 text-xs text-slate-500 dark:text-slate-400 mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-slate-900 dark:bg-emerald-600 text-white flex items-center justify-center font-bold text-[10px]">
              O
            </div>
            <span className="font-semibold text-slate-800 dark:text-slate-200">OUTPOST Student Housing</span>
            <span>•</span>
            <span>Multi-Institution Verified Student Accommodation & Roommate Matching</span>
          </div>

          <div className="flex items-center gap-6">
            <Link to="/properties" className="hover:text-slate-900 dark:hover:text-white transition">All Properties</Link>
            <Link to="/login" className="hover:text-slate-900 dark:hover:text-white transition">Sign In</Link>
            <Link to="/register" className="hover:text-slate-900 dark:hover:text-white transition">Register Account</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};
