import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bell,
  Check,
  CheckCheck,
  Megaphone,
  RefreshCw,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import { useAuth } from '../../application/context/AuthContext';
import { authService } from '../../application/services/authService';
import { notificationService } from '../../application/services/notificationService';
import { AppNotification } from '../../domain/types';

type FilterTab = 'all' | 'unread' | 'broadcast';

export const NotificationsPage: React.FC = () => {
  const { currentUser } = useAuth();
  const session = authService.getSession();
  const userId = currentUser?.id || session.user.id;

  const [notifications, setNotifications] = useState<AppNotification[]>(() =>
    userId && userId !== 'anonymous' ? notificationService.getNotifications(userId) : []
  );
  const [filter, setFilter] = useState<FilterTab>('all');
  const [refreshing, setRefreshing] = useState(false);

  const syncLocal = useCallback(() => {
    if (!userId || userId === 'anonymous') return;
    setNotifications(notificationService.getNotifications(userId));
  }, [userId]);

  const handleRefresh = useCallback(async () => {
    if (!userId || userId === 'anonymous') return;
    setRefreshing(true);
    try {
      const live = await notificationService.refreshNotifications(userId);
      setNotifications(live);
    } finally {
      setRefreshing(false);
    }
  }, [userId]);

  useEffect(() => {
    void handleRefresh();
  }, [handleRefresh]);

  useEffect(() => {
    if (!userId || userId === 'anonymous') return;
    const unsubOne = notificationService.subscribeToNotifications(userId, syncLocal);
    const unsubList = notificationService.subscribeToListUpdates(syncLocal);
    return () => {
      unsubOne();
      unsubList();
    };
  }, [userId, syncLocal]);

  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const filtered = notifications.filter((n) => {
    if (filter === 'unread') return !n.isRead;
    if (filter === 'broadcast') return n.type === 'broadcast';
    return true;
  });

  const audienceLabel = (audience?: string) => {
    if (audience === 'all_users') return 'All Users';
    if (audience === 'all_landlords') return 'All Landlords';
    if (audience === 'all_students') return 'All Students';
    if (audience === 'individual') return 'Direct Admin Message';
    return 'Platform Broadcast';
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <Bell className="w-6 h-6 text-emerald-600" />
            <span>Notifications &amp; Broadcasts</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Platform announcements, individual notices from administration, and account alerts.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => {
                notificationService.markAllAsRead(userId);
                syncLocal();
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span>Mark all read ({unreadCount})</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
        {(
          [
            { id: 'all', label: `All (${notifications.length})` },
            { id: 'unread', label: `Unread (${unreadCount})` },
            { id: 'broadcast', label: `Admin Broadcasts (${notifications.filter((n) => n.type === 'broadcast').length})` },
          ] as Array<{ id: FilterTab; label: string }>
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilter(tab.id)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer ${
              filter === tab.id
                ? 'bg-slate-900 text-white dark:bg-emerald-600'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="p-12 text-center rounded-3xl bg-white dark:bg-slate-900 border border-dashed border-slate-200 dark:border-slate-800 space-y-2">
          <Bell className="w-8 h-8 text-slate-400 mx-auto" />
          <p className="text-sm font-bold text-slate-900 dark:text-white">No notifications here</p>
          <p className="text-xs text-slate-500">
            Broadcast messages, reservation alerts, and account updates will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((n) => {
            const isBroadcast = n.type === 'broadcast';
            return (
              <div
                key={n.id}
                className={`p-5 rounded-2xl border transition space-y-2.5 ${
                  !n.isRead
                    ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/60'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    {isBroadcast ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 text-[10px] font-bold uppercase tracking-wider">
                        <Megaphone className="w-3 h-3" />
                        {audienceLabel(n.metadata?.audience)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-bold uppercase tracking-wider">
                        {n.type}
                      </span>
                    )}
                    {!n.isRead && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-600 text-white text-[10px] font-bold uppercase">
                        New
                      </span>
                    )}
                    <span className="text-[11px] text-slate-400">
                      {new Date(n.createdAt).toLocaleString()}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {!n.isRead && (
                      <button
                        type="button"
                        onClick={() => {
                          notificationService.markAsRead(n.id);
                          syncLocal();
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 cursor-pointer"
                      >
                        <Check className="w-3 h-3 text-emerald-600" />
                        <span>Mark read</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        notificationService.deleteNotification(n.id);
                        syncLocal();
                      }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer"
                      title="Delete notification"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <h3 className="text-sm font-bold text-slate-900 dark:text-white">{n.title}</h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                  {n.message}
                </p>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-slate-400">
                  <span>
                    {n.metadata?.sender_name ? `Sent by ${n.metadata.sender_name}` : 'OUTPOST Platform'}
                  </span>
                  {n.link && n.link !== '/notifications' && (
                    <Link
                      to={n.link}
                      onClick={() => notificationService.markAsRead(n.id)}
                      className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400 hover:underline"
                    >
                      <span>Open details</span>
                      <ExternalLink className="w-3 h-3" />
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
