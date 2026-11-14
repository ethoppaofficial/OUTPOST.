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
    id: 'individual',
    label: 'Individual User',
    description: 'Send a direct notification to one specific user',
    icon: UserCheck,
  },
];

export const AdminBroadcastsPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const initialUserId = searchParams.get('userId') || '';

  const [targetAudience, setTargetAudience] = useState<BroadcastAudience>(
    initialUserId ? 'individual' : 'all_users'
  );
  const [targetUserId, setTargetUserId] = useState(initialUserId);
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
      setTargetAudience('individual');
      setTargetUserId(initialUserId);
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
      .slice(0, 60);
  }, [users, userSearch]);

  const selectedIndividual = useMemo(
    () => users.find((u) => u.id === targetUserId),
    [users, targetUserId]
  );

  const estimatedRecipientCount = useMemo(() => {
    if (targetAudience === 'individual') return targetUserId ? 1 : 0;
    if (targetAudience === 'all_landlords') {
      return users.filter((u) => u.role === 'landlord' && (u.status || u.accountStatus) !== 'suspended').length;
    }
    if (targetAudience === 'all_students') {
      return users.filter((u) => u.role === 'student' && (u.status || u.accountStatus) !== 'suspended').length;
    }
    return users.filter((u) => (u.status || u.accountStatus) !== 'suspended').length;
  }, [targetAudience, targetUserId, users]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (targetAudience === 'individual' && !targetUserId) {
      setError('Please select a specific user recipient.');
      return;
    }

    setSending(true);
    try {
      const res = await adminService.sendBroadcast({
        targetAudience,
        title,
        message,
        targetUserId: targetAudience === 'individual' ? targetUserId : undefined,
      });

      setSuccess(
        `Broadcast notification delivered to ${res.recipientCount} ${
          res.recipientCount === 1 ? 'recipient' : 'recipients'
        }.`
      );
      setTitle('');
      setMessage('');
      const refreshedHistory = await adminService.getBroadcastHistory().catch(() => history);
      setHistory(refreshedHistory);
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
    return 'Individual User';
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
            Send urgent announcements or direct notices to every user, every landlord, every student, or an individual user.
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
              const active = targetAudience === opt.id;
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

        {/* Individual User Picker */}
        {targetAudience === 'individual' && (
          <div className="space-y-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Choose Recipient User
              </label>
              {selectedIndividual && (
                <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                  Selected: {selectedIndividual.fullName || selectedIndividual.name} ({selectedIndividual.role})
                </span>
              )}
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search user by name, email, role, or ID..."
                className="w-full pl-8 pr-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
              />
            </div>

            <select
              value={targetUserId}
              onChange={(e) => setTargetUserId(e.target.value)}
              required
              className="w-full p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
            >
              <option value="">-- Select recipient account --</option>
              {filteredUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {(u.fullName || u.name || 'User')} ({u.role}) — {u.email}
                </option>
              ))}
            </select>
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
              <span>Delivered immediately to each user&apos;s OUTPOST Notification Bell &amp; Inbox.</span>
              <span>{message.length} / 2000</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Estimated recipients:{' '}
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
          <span className="text-[11px] text-slate-400">{history.length} recent</span>
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
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {history.map((item) => (
              <div key={item.id} className="py-4 space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={item.targetAudience === 'individual' ? 'info' : 'warning'}>
                      {formatAudienceBadge(item.targetAudience)}
                    </Badge>
                    {item.targetUserName && (
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        → {item.targetUserName}
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
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
