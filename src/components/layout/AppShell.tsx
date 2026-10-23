/**
 * @file AppShell.tsx
 * @module components/layout/AppShell
 * @description Master responsive application frame providing persona-specific navigation, headers, and quick actions.
 *
 * Architecture Role:
 * - Shell Frame: Wraps all pages with responsive top navbar, collateral sidebar, mobile drawer, and footer.
 * - Dynamic Persona Navigation: Tailors navigation menu items based on active `currentUser.role`:
 *   - Students: Accommodation Search, Verification, Roommates, Groups, Reservations, Invoices, Chat.
 *   - Landlords: Dashboard, Properties, New Listing, Availability, Payment Receipts, Verification.
 *   - Admins: Verification Queue, Property Approvals, User Directory, Disputes, Audit Logs, Settings.
 * - Reactive Badges: Polls and listens to `notificationService` and `chatService` for live unread counters.
 */

import React, { useState, useEffect, useRef } from 'react';
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
  ChevronRight,
  ChevronDown,
  Sparkles,
  CheckCircle2,
  HelpCircle,
  AlertTriangle,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
} from 'lucide-react';
import { notificationService } from '../../application/services/notificationService';
import { chatService } from '../../application/services/chatService';
import { ThemeToggle } from './ThemeToggle';
import { useAuth } from '../../application/context/AuthContext';

export interface NavItem {
  id: string;
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  badgeKey?: 'notifications' | 'messages';
  exact?: boolean;
}

export interface NavGroup {
  id: string;
  title: string;
  items: NavItem[];
}

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const { currentUser, signOut } = useAuth();
  const session = currentUser
    ? {
        user: currentUser,
        displayName: currentUser.fullName || currentUser.name || currentUser.email,
      }
    : null;
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifsDropdownOpen, setNotifsDropdownOpen] = useState(false);

  // Expanded and collapsed desktop sidebar modes with persisted preference
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('outpost_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  // Track expanded groups in sidebar
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    housing: true,
    roommates: true,
    workspace: true,
  });

  const location = useLocation();
  const navigate = useNavigate();
  const prevTriggerRef = useRef<HTMLElement | null>(null);

  const refreshSession = () => {
    if (!currentUser?.id) {
      setUnreadNotifs(0);
      setUnreadMessages(0);
      return;
    }
    setUnreadNotifs(notificationService.getUnreadCount(currentUser.id));
    setUnreadMessages(chatService.getUnreadMessageCount(currentUser.id));
  };

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  const toggleSidebarCollapse = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('outpost_sidebar_collapsed', String(next));
      } catch {
        // Ignore local storage errors
      }
      return next;
    });
  };

  // Notification badges follow the authenticated user account.
  useEffect(() => {
    refreshSession();
  }, [currentUser?.id]);

  // Listen to persona/session changes & notification subscriptions
  useEffect(() => {
    if (!session?.user?.id) return;
    const currentUserId = session.user.id;

    const unsubNotifs = notificationService.subscribeToNotifications(currentUserId, () => {
      setUnreadNotifs(notificationService.getUnreadCount(currentUserId));
    });

    const unsubConvos = chatService.subscribeToConversations(() => {
      setUnreadMessages(chatService.getUnreadMessageCount(currentUserId));
    });

    return () => {
      unsubNotifs();
      unsubConvos();
    };
  }, [session?.user?.id]);

  // Mobile menu scroll lock and keyboard escape handling
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          setMobileMenuOpen(false);
          prevTriggerRef.current?.focus();
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => {
        document.body.style.overflow = '';
        window.removeEventListener('keydown', handleKeyDown);
      };
    } else {
      document.body.style.overflow = '';
    }
  }, [mobileMenuOpen]);

  // Close mobile drawer on route transition
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    await signOut();
    navigate('/');
  };

  const userRole = session?.user?.role || 'student';
  const profilePath =
    userRole === 'admin'
      ? '/admin/account'
      : userRole === 'landlord'
      ? '/landlord/verification'
      : '/student/profile';

  // Typed navigation groups by role
  const studentNavGroups: NavGroup[] = [
    {
      id: 'housing',
      title: 'Housing Discovery',
      items: [
        { id: 'dash', label: 'Overview', to: '/student/dashboard', icon: Home, exact: true },
        { id: 'browse', label: 'Browse Accommodations', to: '/student/properties', icon: Compass },
        { id: 'res', label: 'My Reservations', to: '/student/reservations', icon: CalendarCheck },
      ],
    },
    {
      id: 'roommates',
      title: 'Peer Matching & Cohorts',
      items: [
        { id: 'matches', label: 'Roommate Matches', to: '/student/roommates', icon: Users },
        { id: 'groups', label: 'Roommate Squads', to: '/student/groups', icon: Layers },
        { id: 'search', label: 'Verify Student Matric', to: '/student/search', icon: Search },
      ],
    },
    {
      id: 'account',
      title: 'Account & Communication',
      items: [
        {
          id: 'chat',
          label: 'Chat & Inquiries',
          to: '/student/chat',
          icon: MessageSquare,
          badgeKey: 'messages',
        },
        {
          id: 'verif',
          label: 'Matric Verification',
          to: '/student/verification',
          icon: FileCheck,
        },
      ],
    },
  ];

  const landlordNavGroups: NavGroup[] = [
    {
      id: 'workspace',
      title: 'Property Management',
      items: [
        { id: 'dash', label: 'Overview', to: '/landlord/dashboard', icon: Home, exact: true },
        { id: 'props', label: 'My Listings', to: '/landlord/properties', icon: Building2 },
        { id: 'new-prop', label: 'Post New Property', to: '/landlord/properties/new', icon: Compass },
        { id: 'receipts', label: 'Review Receipts', to: '/landlord/receipts', icon: Receipt },
      ],
    },
    {
      id: 'account',
      title: 'Trust & Messaging',
      items: [
        { id: 'chat', label: 'Tenant Inquiries', to: '/landlord/chat', icon: MessageSquare, badgeKey: 'messages' },
        { id: 'verif', label: 'Landlord Verification', to: '/landlord/verification', icon: ShieldCheck },
      ],
    },
  ];

  const adminNavGroups: NavGroup[] = [
    {
      id: 'workspace',
      title: 'Governance & Audits',
      items: [
        { id: 'dash', label: 'Admin Console', to: '/admin/dashboard', icon: Home, exact: true },
        { id: 'users', label: 'User Directory', to: '/admin/users', icon: Users },
        { id: 'landlords', label: 'Landlord Approvals', to: '/admin/verifications', icon: ShieldCheck },
        { id: 'props', label: 'Property Approvals', to: '/admin/properties', icon: Building2 },
        { id: 'reservations', label: 'Reservations & Receipts', to: '/admin/reservations', icon: Receipt },
        { id: 'reports', label: 'Reports', to: '/admin/reports', icon: Layers },
        { id: 'audit', label: 'Audit Logs', to: '/admin/audit-logs', icon: FileCheck },
        { id: 'settings', label: 'Platform Settings', to: '/admin/settings', icon: Settings },
        { id: 'account', label: 'Admin Account', to: '/admin/account', icon: User },
        { id: 'chat', label: 'Support & Inquiries', to: '/admin/chat', icon: MessageSquare, badgeKey: 'messages' },
      ],
    },
  ];

  const activeNavGroups =
    userRole === 'admin'
      ? adminNavGroups
      : userRole === 'landlord'
      ? landlordNavGroups
      : studentNavGroups;

  const notifications = session?.user?.id
    ? notificationService.getNotifications(session.user.id).slice(0, 5)
    : [];

  // Helper for active route calculation
  const isRouteActive = (item: NavItem) => {
    if (item.exact) {
      return location.pathname === item.to;
    }
    return (
      location.pathname === item.to ||
      (item.to !== '/' && location.pathname.startsWith(item.to + '/'))
    );
  };

  // Render navigation contents
  const renderNavContent = (isMobile = false) => {
    const collapsed = !isMobile && isCollapsed;

    return (
      <div className="flex flex-col h-full select-none">
        {/* Brand Header */}
        <div
          className={`p-3.5 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between ${
            collapsed ? 'flex-col gap-2' : ''
          }`}
        >
          <Link
            to="/"
            className="flex items-center gap-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500 rounded-xl group"
            title="OUTPOST BUK Accommodation"
          >
            <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-black tracking-wider text-base shadow-sm group-hover:bg-emerald-500 transition flex-shrink-0">
              O
            </div>
            {!collapsed && (
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="font-extrabold tracking-tight text-base text-slate-950 dark:text-white leading-none">
                    OUTPOST
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400">
                    BUK
                  </span>
                </div>
                <span className="text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400 tracking-wider mt-0.5">
                  Kano Off-Campus
                </span>
              </div>
            )}
          </Link>

          {!isMobile && (
            <button
              onClick={toggleSidebarCollapse}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? (
                <PanelLeftOpen className="w-4 h-4" />
              ) : (
                <PanelLeftClose className="w-4 h-4" />
              )}
            </button>
          )}
        </div>

        {/* Active Role Indicator */}
        {!collapsed && session && (
          <div className="mx-3 mt-3 p-2 rounded-xl bg-slate-100/80 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 truncate">
              <div
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  userRole === 'admin'
                    ? 'bg-amber-500'
                    : userRole === 'landlord'
                    ? 'bg-blue-500'
                    : 'bg-emerald-500'
                }`}
              />
              <span className="font-semibold capitalize text-slate-800 dark:text-slate-200 truncate">
                {userRole === 'admin'
                  ? 'Admin Console'
                  : userRole === 'landlord'
                  ? 'Landlord Hub'
                  : 'Student Portal'}
              </span>
            </div>
            <span className="text-[10px] font-mono uppercase font-bold text-slate-500 dark:text-slate-400">
              {userRole}
            </span>
          </div>
        )}

        {/* Scrollable Navigation Groups */}
        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4 scrollbar-thin">
          {activeNavGroups.map((group) => {
            const isGroupExpanded = expandedGroups[group.id] !== false;

            return (
              <div key={group.id} className="space-y-1">
                {!collapsed ? (
                  <button
                    onClick={() => toggleGroup(group.id)}
                    className="w-full flex items-center justify-between px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition"
                  >
                    <span>{group.title}</span>
                    <ChevronDown
                      className={`w-3 h-3 transition-transform ${
                        isGroupExpanded ? 'rotate-0' : '-rotate-90'
                      }`}
                    />
                  </button>
                ) : (
                  <div className="w-full border-t border-slate-100 dark:border-slate-800 my-1" />
                )}

                {(isGroupExpanded || collapsed) &&
                  group.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = isRouteActive(item);
                    const badgeValue =
                      item.badgeKey === 'messages'
                        ? unreadMessages
                        : item.badgeKey === 'notifications'
                        ? unreadNotifs
                        : 0;

                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        title={collapsed ? item.label : undefined}
                        className={`flex items-center ${
                          collapsed ? 'justify-center p-2.5' : 'justify-between px-3 py-2'
                        } rounded-xl text-xs font-semibold transition group relative ${
                          isActive
                            ? 'bg-emerald-600 text-white shadow-xs dark:bg-emerald-600'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/80'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Icon
                            className={`w-4 h-4 flex-shrink-0 ${
                              isActive
                                ? 'text-white'
                                : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200'
                            }`}
                          />
                          {!collapsed && <span className="truncate">{item.label}</span>}
                        </div>

                        {!collapsed && badgeValue > 0 && (
                          <span
                            className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold font-mono ${
                              isActive
                                ? 'bg-white text-emerald-700'
                                : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                            }`}
                          >
                            {badgeValue}
                          </span>
                        )}

                        {collapsed && badgeValue > 0 && (
                          <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-900" />
                        )}
                      </Link>
                    );
                  })}
              </div>
            );
          })}
        </div>

        {/* User Card & Logout in Sidebar */}
        {session && (
          <div className="p-2.5 border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/50">
            {!collapsed ? (
              <div className="flex items-center gap-2.5 p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 shadow-2xs">
                <Link
                  to={profilePath}
                  title="View Account Profile"
                  className="flex items-center gap-2.5 min-w-0 flex-1 group"
                >
                  <img
                    src={
                      session.user.avatarUrl ||
                      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100'
                    }
                    alt={session.displayName}
                    className="w-8 h-8 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-700 flex-shrink-0 group-hover:ring-2 group-hover:ring-emerald-500 transition cursor-pointer"
                  />
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-xs font-semibold text-slate-900 dark:text-white truncate group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition">
                      {session.displayName}
                    </span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                      {session.user.email}
                    </span>
                  </div>
                </Link>
                <button
                  onClick={handleLogout}
                  className="p-1 text-slate-400 hover:text-rose-600 transition cursor-pointer"
                  title="Sign Out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Link to={profilePath} title="View Account Profile">
                  <img
                    src={
                      session.user.avatarUrl ||
                      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100'
                    }
                    alt={session.displayName}
                    title={session.displayName}
                    className="w-8 h-8 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-700 hover:ring-2 hover:ring-emerald-500 transition cursor-pointer"
                  />
                </Link>
                <button
                  onClick={handleLogout}
                  className="p-1.5 text-slate-400 hover:text-rose-600 transition cursor-pointer"
                  title="Sign Out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const publicPaths = ['/', '/properties', '/map', '/login', '/admin/login', '/register', '/forgot-password', '/unauthorized'];
  const isPublicRoute =
    publicPaths.includes(location.pathname) || location.pathname.startsWith('/properties/');
  const dashboardPath =
    session?.user.role === 'admin'
      ? '/admin/dashboard'
      : session?.user.role === 'landlord'
      ? '/landlord/dashboard'
      : '/student/dashboard';

  if (isPublicRoute) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans flex flex-col">
        <header className="sticky top-0 z-30 border-b border-slate-200/80 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <Link to="/" className="flex items-center gap-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500" aria-label="OUTPOST home">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-base font-black text-white">O</span>
              <span>
                <span className="block text-base font-extrabold tracking-tight">OUTPOST</span>
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Off-campus housing</span>
              </span>
            </Link>

            <nav className="hidden items-center gap-6 sm:flex" aria-label="Main navigation">
              <Link to="/" className="text-sm font-medium text-slate-600 hover:text-emerald-700 dark:text-slate-300 dark:hover:text-emerald-400">Home</Link>
              <Link to="/properties" className="text-sm font-medium text-slate-600 hover:text-emerald-700 dark:text-slate-300 dark:hover:text-emerald-400">Browse housing</Link>
              <Link to="/map" className="text-sm font-medium text-slate-600 hover:text-emerald-700 dark:text-slate-300 dark:hover:text-emerald-400">Map</Link>
            </nav>

            <div className="flex items-center gap-2 sm:gap-3">
              <ThemeToggle />
              {session ? (
                <Link to={dashboardPath} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500">Go to dashboard</Link>
              ) : (
                <>
                  <Link to="/login" className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">Sign in</Link>
                  <Link to="/register" className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500">Create account</Link>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans flex">
      {/* 1. Desktop Fixed Vertical Navigation Bar */}
      <aside
        className={`hidden lg:flex lg:flex-col ${
          isCollapsed ? 'lg:w-20' : 'lg:w-64'
        } lg:fixed lg:inset-y-0 z-30 bg-white dark:bg-slate-900 border-r border-slate-200/80 dark:border-slate-800 shadow-xs transition-all duration-200`}
      >
        {renderNavContent(false)}
      </aside>

      {/* 2. Mobile Slide-out Drawer Overlay & Navigation */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
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
            {renderNavContent(true)}
          </div>
        </div>
      )}

      {/* 3. Main Content Wrapper */}
      <div
        className={`flex-1 ${
          isCollapsed ? 'lg:pl-20' : 'lg:pl-64'
        } flex flex-col min-w-0 transition-all duration-200`}
      >
        {/* Top Header Bar */}
        <header className="sticky top-0 z-20 w-full border-b border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md">
          <div className="px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
            {/* Left: Mobile hamburger & location context */}
            <div className="flex items-center gap-3">
              <button
                onClick={(e) => {
                  prevTriggerRef.current = e.currentTarget;
                  setMobileMenuOpen(true);
                }}
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
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              {/* Chat Messages Quick Link */}
              {session?.user && (
                <Link
                  to={
                    userRole === 'admin'
                      ? '/admin/chat'
                      : userRole === 'landlord'
                      ? '/landlord/chat'
                      : '/student/chat'
                  }
                  className="relative p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                  title="Messages & Inquiries"
                >
                  <MessageSquare className="w-4 h-4" />
                  {unreadMessages > 0 && (
                    <span className="absolute top-1 right-1 px-1 min-w-[14px] h-[14px] rounded-full bg-emerald-500 text-white text-[9px] font-bold flex items-center justify-center ring-2 ring-white dark:ring-slate-900">
                      {unreadMessages}
                    </span>
                  )}
                </Link>
              )}

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
                      <span className="text-xs font-semibold text-slate-900 dark:text-white">
                        Notifications
                      </span>
                      {session?.user?.id && (
                        <button
                          onClick={() => {
                            notificationService.markAllAsRead(session.user.id);
                            refreshSession();
                          }}
                          className="text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline"
                        >
                          Mark all read
                        </button>
                      )}
                    </div>
                    <div className="divide-y divide-slate-100 dark:divide-slate-800/60 max-h-72 overflow-y-auto">
                      {notifications.length === 0 ? (
                        <div className="p-4 text-center text-xs text-slate-400">
                          No new notifications
                        </div>
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
                            <div className="font-semibold text-slate-800 dark:text-slate-200 mb-0.5">
                              {n.title}
                            </div>
                            <div className="text-slate-500 dark:text-slate-400 text-[11px] line-clamp-2">
                              {n.message}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Theme Toggle */}
              <ThemeToggle />
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
