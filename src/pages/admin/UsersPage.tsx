/**
 * @file UsersPage.tsx
 * @module pages/admin/UsersPage
 * @description Administrative user directory for inspecting profiles and enforcing account suspensions.
 *
 * Governance Features:
 * - User Directory: Lists all registered students, landlords, and administrators.
 * - Profile Linkage: Displays university registration numbers for students and business names for landlords.
 * - Account Suspension: Enables administrators to suspend abusive or fraudulent accounts (`account_status = 'suspended'`).
 *   - Suspended accounts are immediately locked out of Edge Functions and database mutations.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Ban, Search, ShieldCheck, UserCheck } from 'lucide-react';
import { adminService, AdminUser } from '../../application/services/adminService';
import { UserRole } from '../../domain/types';
import { Badge, VerificationBadge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';

export const UsersPage: React.FC = () => {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [target, setTarget] = useState<AdminUser | null>(null);
  const [reason, setReason] = useState('');
  const refresh = async () => setUsers(await adminService.getUsers());
  useEffect(() => {
    let active = true;
    adminService.getUsers().then((data) => { if (active) setUsers(data); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'User records could not be loaded.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const filtered = useMemo(() => users.filter((user) => {
    const query = search.trim().toLowerCase();
    const profileNumber = user.studentProfile?.registrationNumber || '';
    const business = user.landlordProfile?.businessName || '';
    const roleMatches = roleFilter === 'all' || user.role === roleFilter;
    const textMatches = !query || [user.name, user.fullName, user.email, user.id, profileNumber, business].some((value) => String(value || '').toLowerCase().includes(query));
    return roleMatches && textMatches;
  }), [users, search, roleFilter]);
  const changeStatus = async (user: AdminUser, status: 'active' | 'suspended', note?: string) => {
    setBusyId(user.id); setError(null); setSuccess(null);
    try {
      await adminService.setUserStatus(user.id, status, note);
      await refresh();
      setSuccess(`${user.email} account ${status === 'suspended' ? 'suspended' : 'reactivated'}; the action was audited.`);
      setTarget(null); setReason('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The account status could not be changed.');
    } finally { setBusyId(null); }
  };
  return <div className="space-y-6"><header><h1 className="text-2xl font-black text-slate-900 dark:text-white">User management</h1><p className="mt-1 text-sm text-slate-500">Live Supabase user profiles. Identity documents are not displayed in this directory.</p></header>
    {error && <div role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30">{error}</div>}{success && <div role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/30">{success}</div>}
    <div className="flex flex-col gap-3 sm:flex-row"><label className="flex flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900"><Search className="h-4 w-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} maxLength={120} placeholder="Search name, email, UID, matriculation, or business" className="w-full bg-transparent text-sm outline-none" /></label><select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as 'all' | UserRole)} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-800 dark:bg-slate-900"><option value="all">All roles</option><option value="student">Students</option><option value="landlord">Landlords</option><option value="admin">Administrators</option></select></div>
    {loading ? <p className="text-sm text-slate-500">Loading users…</p> : filtered.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-700">No matching platform users.</div> : <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-slate-50 uppercase text-slate-500 dark:bg-slate-800/70"><tr><th className="p-3">Account</th><th className="p-3">Role</th><th className="p-3">Account status</th><th className="p-3">Verification</th><th className="p-3 text-right">Admin action</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{filtered.map((user) => { const suspended = user.status === 'suspended' || user.accountStatus === 'suspended'; return <tr key={user.id} className="align-top"><td className="p-3"><p className="font-bold text-slate-900 dark:text-white">{user.name || user.fullName || 'User'}</p><p className="mt-1 text-slate-500">{user.email}</p><p className="mt-1 break-all font-mono text-[10px] text-slate-400">{user.id}</p></td><td className="p-3"><Badge variant={user.role === 'admin' ? 'danger' : user.role === 'landlord' ? 'warning' : 'info'}>{user.role}</Badge></td><td className="p-3">{user.status || user.accountStatus || 'active'}</td><td className="space-y-1 p-3">{user.role === 'student' && <VerificationBadge type="student" status={Boolean(user.studentProfile?.isProfileVerified)} />}{user.role === 'landlord' && <VerificationBadge type="landlord" status={user.landlordProfile?.verificationStatus || 'pending'} />}{user.role === 'admin' && <Badge variant="danger">Administrator</Badge>}</td><td className="p-3 text-right">{user.role !== 'admin' && <button type="button" disabled={busyId === user.id} onClick={() => { if (suspended) void changeStatus(user, 'active'); else { setTarget(user); setReason(''); } }} className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 font-semibold disabled:opacity-50 ${suspended ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300'}`}>{suspended ? <UserCheck className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}{busyId === user.id ? 'Saving…' : suspended ? 'Reactivate' : 'Suspend'}</button>}</td></tr>; })}</tbody></table></div>}
    <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"><ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />Suspensions update Supabase Auth and the account record through a privileged server function. Administrators cannot be suspended here.</div>
    <Modal isOpen={!!target} onClose={() => { setTarget(null); setReason(''); }} title="Suspend account"><form onSubmit={(event) => { event.preventDefault(); if (target) void changeStatus(target, 'suspended', reason); }} className="space-y-4 text-sm"><p>Suspending <strong>{target?.email}</strong> disables the Supabase Auth account and records the reason.</p><label className="block font-semibold">Reason<textarea required minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} rows={4} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800" /></label><div className="flex justify-end gap-2"><button type="button" onClick={() => setTarget(null)} className="rounded-lg px-3 py-2 text-xs">Cancel</button><button disabled={!!busyId} className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white">{busyId ? 'Saving…' : 'Suspend account'}</button></div></form></Modal>
  </div>;
};
