/**
 * @file AdminAuditLogsPage.tsx
 * @module pages/admin/AdminAuditLogsPage
 * @description Administrative viewer for inspecting the immutable `audit_logs` security ledger.
 *
 * Security & Auditability:
 * - Append-only Ledger: Displays administrative actions, target entities, timestamps, and details.
 * - Search & Filter: Allows administrators to filter by actor, action type, or target record ID.
 * - Direct writes/deletions on this ledger are permanently blocked at the PostgreSQL engine level.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Search, ShieldCheck } from 'lucide-react';
import { adminService } from '../../application/services/adminService';
import { AuditLog } from '../../domain/types';

export const AdminAuditLogsPage: React.FC = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    adminService.getAuditLogs().then((data) => { if (active) setLogs(data); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Audit logs could not be loaded.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return logs;
    return logs.filter((log) => [log.action, log.actorName, log.actorId, log.targetEntity, log.targetId, log.details].some((value) => String(value || '').toLowerCase().includes(term)));
  }, [logs, search]);
  return <div className="space-y-6"><header><div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-purple-600" /><h1 className="text-2xl font-black text-slate-900 dark:text-white">Audit logs</h1></div><p className="mt-1 text-sm text-slate-500">Administrative actions are written by trusted Cloud Functions and are read-only here.</p></header>{error && <div role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30">{error}</div>}<label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900"><Search className="h-4 w-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} maxLength={120} placeholder="Search action, administrator, target, or reason" className="w-full bg-transparent text-sm outline-none" /></label>{loading ? <p className="text-sm text-slate-500">Loading logs…</p> : filtered.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-700">No matching audit records.</div> : <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"><table className="w-full min-w-[800px] text-left text-xs"><thead className="bg-slate-50 uppercase text-slate-500 dark:bg-slate-800/70"><tr><th className="p-3">Timestamp</th><th className="p-3">Administrator</th><th className="p-3">Action</th><th className="p-3">Affected record</th><th className="p-3">Reason / details</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{filtered.map((log) => <tr key={log.id} className="align-top"><td className="whitespace-nowrap p-3 text-slate-500">{log.timestamp ? new Date(log.timestamp).toLocaleString() : '—'}</td><td className="p-3">{log.actorName || log.actorId}<span className="mt-1 block text-[10px] text-slate-400">{log.actorId}</span></td><td className="p-3 font-semibold">{String(log.action).replaceAll('_', ' ')}</td><td className="p-3">{log.targetEntity}<span className="mt-1 block font-mono text-[10px] text-slate-400">{log.targetId}</span></td><td className="max-w-sm whitespace-normal p-3 text-slate-600 dark:text-slate-300">{log.details || '—'}</td></tr>)}</tbody></table></div>}</div>;
};
