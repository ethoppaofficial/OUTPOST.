import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Megaphone,
  Users,
  Building2,
  GraduationCap,
  UserCheck,
  Send,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Search,
  Clock,
  RefreshCw,
  Check,
  X,
} from 'lucide-react';
import {
  adminService,
  AdminBroadcastRecord,
  AdminUser,
  BroadcastAudience,
} from '../../application/services/adminService';
import { Badge } from '../../components/ui/Badge';

const AUDIENCE_OPTIONS: Array<{
  id: BroadcastAudience;
  label: string;
  description: string;
  icon: any;
}> = [
  {
    id: 'all_users',
    label: 'Every User',
    description: 'Notify all active students, landlords & admins',
    icon: Users,
  },
  {
    id: 'all_landlords',
    label: 'Every Landlord',
    description: 'Notify all active landlord accounts',
    icon: Building2,
  },
  {
    id: 'all_students',
    label: 'Every Student',
    description: 'Notify all active student accounts',
    icon: GraduationCap,
  },
  {
    id: 'specific_users',
    label: 'Specific Users',
    description: 'Pick one or multiple individual users to notify',
    icon: UserCheck,
  },
];

export const AdminBroadcastsPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const initialUserId = searchParams.get('userId') || '';

  const [targetAudience, setTargetAudience] = useState<BroadcastAudience>(
    initialUserId ? 'specific_users' : 'all_users'
  );
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>(
    initialUserId ? [initialUserId] : []
  );
  const [userSearch, setUserSearch] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [history, setHistory] = useState<AdminBroadcastRecord[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoadingData(true);
    setError(null);
    try {
      const [userList, broadcastRows] = await Promise.all([
        adminService.getUsers(),
        adminService.getBroadcastHistory(),
      ]);
      setUsers(userList);
      setHistory(broadcastRows);
    } catch (err: any) {
      setError(err?.message || 'Could not load users or broadcast history.');
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (initialUserId) {
      setTargetAudience('specific_users');
      setSelectedUserIds((prev) => (prev.includes(initialUserId) ? prev : [...prev, initialUserId]));
    }
  }, [initialUserId]);

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    return users
      .filter((u) => {
        if (!q) return true;
        return (
          (u.fullName || u.name || '').toLowerCase().includes(q) ||
          (u.email || '').toLowerCase().includes(q) ||
          u.role.toLowerCase().includes(q) ||
          u.id.toLowerCase().includes(q)
        );
      })
      .slice(0, 80);
  }, [users, userSearch]);

  const selectedUsers = useMemo(
    () => users.filter((u) => selectedUserIds.includes(u.id)),
    [users, selectedUserIds]
  );

  const isSpecificTarget = targetAudience === 'specific_users' || targetAudience === 'individual';

  const estimatedRecipientCount = useMemo(() => {
    if (isSpecificTarget) return selectedUserIds.length;
    if (targetAudience === 'all_landlords') {
      return users.filter((u) => u.role === 'landlord' && (u.status || u.accountStatus) !== 'suspended').length;
    }
    if (targetAudience === 'all_students') {
      return users.filter((u) => u.role === 'student' && (u.status || u.accountStatus) !== 'suspended').length;
    }
    return users.filter((u) => (u.status || u.accountStatus) !== 'suspended').length;
  }, [isSpecificTarget, targetAudience, selectedUserIds.length, users]);

  const toggleUserSelection = (userId: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (isSpecificTarget && selectedUserIds.length === 0) {
      setError('Please select at least one specific user recipient.');
      return;
    }

    setSending(true);
    try {
      const res = await adminService.sendBroadcast({
        targetAudience,
        title,
        message,
        targetUserId: isSpecificTarget ? selectedUserIds[0] : undefined,
        targetUserIds: isSpecificTarget ? selectedUserIds : undefined,
      });

      setSuccess(
        `Broadcast saved and delivered to ${res.recipientCount} ${
          res.recipientCount === 1 ? 'recipient' : 'recipients'
        }.`
      );
      setTitle('');
      setMessage('');
      if (res.broadcast) {
        setHistory((prev) => [res.broadcast!, ...prev.filter((item) => item.id !== res.broadcast!.id)]);
      }
      const refreshedHistory = await adminService.getBroadcastHistory().catch(() => null);
      if (refreshedHistory && refreshedHistory.length > 0) {
        setHistory(refreshedHistory);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to send broadcast notification.');
    } finally {
      setSending(false);
    }
  };

  const formatAudienceBadge = (audience: BroadcastAudience) => {
    if (audience === 'all_users') return 'Every User';
    if (audience === 'all_landlords') return 'Every Landlord';
    if (audience === 'all_students') return 'Every Student';
    if (audience === 'specific_users') return 'Specific Users';
    return 'Specific User';
  };

  const getAudienceBadgeVariant = (audience: BroadcastAudience) => {
    if (audience === 'all_users') return 'success';
    if (audience === 'all_landlords') return 'warning';
    if (audience === 'all_students') return 'info';
    return 'default';
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-purple-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
            <Megaphone className="h-3.5 w-3.5" /> Platform Communications
          </span>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">
            Broadcast Messages &amp; User Notifications
          </h1>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Send urgent announcements or direct notices to every user, every landlord, every student, or specific users. Every broadcast is archived below.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadData()}
          disabled={loadingData}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loadingData ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div role="status" className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-medium text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/* Composer Form */}
      <form
        onSubmit={handleSubmit}
        className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs space-y-5 dark:border-slate-800 dark:bg-slate-900"
      >
        <div>
          <label className="text-xs font-bold text-slate-700 dark:text-slate-200 block mb-2.5">
            1. Select Target Audience
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {AUDIENCE_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const active =
                targetAudience === opt.id ||
                (opt.id === 'specific_users' && targetAudience === 'individual');
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setTargetAudience(opt.id)}
                  className={`text-left p-4 rounded-2xl border transition cursor-pointer ${
                    active
                      ? 'border-purple-500 bg-purple-50/70 dark:bg-purple-950/30 dark:border-purple-600 ring-1 ring-purple-500/30'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900 dark:text-white">{opt.label}</span>
                    <Icon className={`w-4 h-4 ${active ? 'text-purple-600 dark:text-purple-400' : 'text-slate-400'}`} />
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{opt.description}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Multi-user Specific Recipient Box */}
        {isSpecificTarget && (
          <div className="rounded-2xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden shadow-xs">
            {/* Box Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 bg-slate-100/80 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                <label className="text-xs font-bold text-slate-800 dark:text-slate-100">
                  User Directory Box ({filteredUsers.length} {filteredUsers.length === 1 ? 'user' : 'users'} · {selectedUserIds.length} selected)
                </label>
              </div>
              <div className="flex items-center gap-3">
                {filteredUsers.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedUserIds((prev) =>
                        Array.from(new Set([...prev, ...filteredUsers.map((u) => u.id)]))
                      )
                    }
                    className="text-[11px] font-semibold text-purple-600 dark:text-purple-400 hover:underline cursor-pointer"
                  >
                    Select matching ({filteredUsers.length})
                  </button>
                )}
                {selectedUserIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedUserIds([])}
                    className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                  >
                    Clear selection
                  </button>
                )}
              </div>
            </div>

            {/* Selected chips & Search bar inside Box */}
            <div className="p-3 space-y-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60">
              {selectedUsers.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedUsers.map((u) => (
                    <span
                      key={u.id}
                      className="inline-flex items-center gap-1 rounded-lg bg-purple-100 dark:bg-purple-900/50 px-2 py-1 text-[11px] font-semibold text-purple-800 dark:text-purple-200"
                    >
                      <span>{u.fullName || u.name || u.email}</span>
                      <span className="opacity-70">({u.role})</span>
                      <button
                        type="button"
                        onClick={() => toggleUserSelection(u.id)}
                        className="ml-0.5 hover:text-rose-600 cursor-pointer"
                        aria-label={`Remove ${u.fullName || u.email}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Filter users inside box by name, email, role, or ID..."
                  className="w-full pl-8 pr-3 py-2 rounded-xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
                />
              </div>
            </div>

            {/* Inner Scrollable List Box */}
            <div className="p-3 bg-slate-50/40 dark:bg-slate-950/30">
              <ul
                aria-label="Broadcast recipient users list"
                className="h-60 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 space-y-1.5 list-none"
              >
                {filteredUsers.length === 0 ? (
                  <li className="p-4 text-center text-xs text-slate-400">No matching users found.</li>
                ) : (
                  filteredUsers.map((u) => {
                    const checked = selectedUserIds.includes(u.id);
                    return (
                      <li key={u.id}>
                        <button
                          type="button"
                          onClick={() => toggleUserSelection(u.id)}
                          className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border text-left text-xs transition cursor-pointer ${
                            checked
                              ? 'border-purple-400 dark:border-purple-600 bg-purple-50/80 dark:bg-purple-950/40'
                              : 'border-slate-200/80 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900 dark:text-white truncate">
                              {u.fullName || u.name || 'User'}{' '}
                              <span className="text-[10px] font-bold uppercase text-slate-400">({u.role})</span>
                            </p>
                            <p className="text-[11px] text-slate-500 truncate">{u.email}</p>
                          </div>
                          <span
                            className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                              checked
                                ? 'bg-purple-600 border-purple-600 text-white'
                                : 'border-slate-300 dark:border-slate-600'
                            }`}
                          >
                            {checked && <Check className="w-3.5 h-3.5" />}
                          </span>
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
          </div>
        )}

        <div className="grid gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-200">
              2. Notification Subject / Title *
            </label>
            <input
              type="text"
              required
              minLength={2}
              maxLength={140}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Scheduled Hostel Inspection Notice / Important Rent Transfer Reminder"
              className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-200">
              3. Message Body *
            </label>
            <textarea
              required
              minLength={2}
              maxLength={2000}
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Write the message to deliver to the selected users' notification inbox..."
              className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
            />
            <div className="flex justify-between text-[11px] text-slate-400">
              <span>Delivered immediately to each user&apos;s OUTPOST Notification Bell &amp; Inbox and logged in broadcast history.</span>
              <span>{message.length} / 2000</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Target audience:{' '}
            <strong className="text-slate-900 dark:text-white">
              {formatAudienceBadge(targetAudience)}
            </strong>{' '}
            · Estimated recipients:{' '}
            <strong className="text-slate-900 dark:text-white">
              {loadingData ? '…' : estimatedRecipientCount}
            </strong>
          </div>

          <button
            type="submit"
            disabled={sending}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-xs disabled:opacity-50 cursor-pointer"
          >
            {sending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Sending Notifications…</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                <span>Send Broadcast Notification</span>
              </>
            )}
          </button>
        </div>
      </form>

      {/* Sent Broadcast History */}
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs space-y-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Clock className="w-4 h-4 text-purple-600" />
            <span>Sent Broadcast History</span>
          </h2>
          <span className="text-[11px] text-slate-400">{history.length} saved</span>
        </div>

        {loadingData ? (
          <div className="py-8 flex items-center justify-center gap-2 text-xs text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin text-purple-600" />
            <span>Loading broadcast log…</span>
          </div>
        ) : history.length === 0 ? (
          <p className="text-xs text-slate-500 py-6 text-center">
            No broadcast messages have been sent yet.
          </p>
        ) : (
          <div className="space-y-3">
            {history.map((item) => {
              const targetSummary =
                item.targetUserNames && item.targetUserNames.length > 0
                  ? item.targetUserNames.join(', ')
                  : item.targetUserName;
              return (
                <div
                  key={item.id}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4 space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={getAudienceBadgeVariant(item.targetAudience)}>
                        Audience: {formatAudienceBadge(item.targetAudience)}
                      </Badge>
                      {targetSummary && (
                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                          → {targetSummary}
                        </span>
                      )}
                      <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                        {item.recipientCount} {item.recipientCount === 1 ? 'recipient' : 'recipients'}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-400">
                      {item.createdAt ? new Date(item.createdAt).toLocaleString() : '—'}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">{item.title}</h3>
                  <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{item.message}</p>
                  <p className="text-[11px] text-slate-400">Sent by {item.senderName}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
