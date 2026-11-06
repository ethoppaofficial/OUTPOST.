/**
 * @file AdminDashboard.tsx
 * @module pages/admin/AdminDashboard
 * @description Master operational overview dashboard for OUTPOST platform administrators.
 *
 * Metrics & Governance:
 * - Aggregates counts across students, landlords, active properties, and active holds.
 * - Displays pending action queues: student verification documents, landlord legal deeds, and property approvals.
 * - Summarizes expired reservation counts and recent audit log events.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Building2, CheckCircle2, Clock3, FileCheck2, Info, Receipt, ShieldCheck, Users } from 'lucide-react';
import { adminService, AdminDashboardData, getAdminAuthWarning } from '../../application/services/adminService';

const cards = [
  { key: 'totalStudents', label: 'Total students', icon: Users },
  { key: 'totalLandlords', label: 'Total landlords', icon: Building2 },
  { key: 'pendingLandlordVerifications', label: 'Landlord checks pending', icon: ShieldCheck },
  { key: 'pendingStudentVerifications', label: 'Student checks pending', icon: FileCheck2 },
  { key: 'pendingPropertyVerifications', label: 'Property reviews pending', icon: Clock3 },
  { key: 'activeProperties', label: 'Active properties', icon: Building2 },
  { key: 'activeReservations', label: 'Active reservations', icon: Receipt },
  { key: 'pendingReceiptVerifications', label: 'Receipts pending review', icon: Clock3 },
  { key: 'expiredReservations', label: 'Expired reservations', icon: AlertTriangle },
] as const;

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Could not load live administrator data. Check your access and Supabase configuration.';
}

export const AdminDashboard: React.FC = () => {
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    adminService.getDashboardData().then((result) => {
      if (active) setData(result);
    }).catch((cause) => {
      if (active) setError(errorText(cause));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const authWarning = getAdminAuthWarning();
  const metrics = data?.metrics;
  const needsAction = metrics ? metrics.pendingLandlordVerifications + metrics.pendingStudentVerifications + metrics.pendingPropertyVerifications + metrics.pendingReceiptVerifications : 0;
  return (
    <div className="space-y-7">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-purple-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"><ShieldCheck className="h-3.5 w-3.5" /> Administrator workspace</span>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">Platform operations</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Live overview of OUTPOST student housing around BUK New Site.</p>
        </div>
        <Link to="/admin/verifications" className="inline-flex items-center gap-2 self-start rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-purple-500">Open review queue <ArrowRight className="h-4 w-4" /></Link>
      </header>

      {authWarning && (
        <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
          <div className="flex items-start gap-2.5">
            <Info className="h-4 w-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="font-semibold text-sm">Remote Database Synchronization Notice</p>
              <p className="mt-1 text-amber-700 dark:text-amber-300/90 leading-relaxed">
                Supabase Row-Level Security restricts live PostgreSQL table reads to provisioned administrators. If you registered directly or don't see remote student/landlord counts yet, ensure your account (<span className="font-mono font-bold">ethoppaofficial@gmail.com</span>) has an active admin role by running this in your Supabase SQL Editor:
              </p>
              <code className="mt-2 block select-all rounded-lg bg-amber-100/90 p-2.5 font-mono text-xs text-amber-950 dark:bg-amber-900/60 dark:text-amber-200">
                UPDATE public.profiles SET role = 'admin', account_status = 'active' WHERE email = 'ethoppaofficial@gmail.com';
              </code>
            </div>
          </div>
        </div>
      )}

      {error && <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">{error}</div>}
      {loading && <p className="text-sm text-slate-500">Loading live platform data…</p>}
      {metrics && <>
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Platform metrics">
          {cards.map(({ key, label, icon: Icon }) => (
            <div key={key} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between"><span className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span><Icon className="h-4 w-4 text-emerald-600" /></div>
              <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">{metrics[key].toLocaleString()}</div>
            </div>
          ))}
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white"><AlertTriangle className="h-4 w-4 text-amber-500" /> Action required</h2>
            <p className="mt-1 text-sm text-slate-500">{needsAction ? `${needsAction} item${needsAction === 1 ? '' : 's'} are awaiting review.` : 'No pending verification or receipt queues.'}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link to="/admin/verifications" className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold dark:bg-slate-800">Verifications</Link>
              <Link to="/admin/properties" className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold dark:bg-slate-800">Properties</Link>
              <Link to="/admin/reservations" className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold dark:bg-slate-800">Reservations</Link>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between"><h2 className="font-bold text-slate-900 dark:text-white">Recent audited activity</h2><Link to="/admin/audit-logs" className="text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400">View logs</Link></div>
            {!data?.recentActivity.length ? <p className="mt-4 text-sm text-slate-500">No recorded activity yet.</p> : <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">{data.recentActivity.slice(0, 5).map((item) => <li key={item.id} className="py-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{item.action.replaceAll('_', ' ')}</p><p className="mt-0.5 text-xs text-slate-500">{item.actorName} · {item.targetEntity} {item.targetId}</p></div><span className="shrink-0 text-[11px] text-slate-400">{item.timestamp ? new Date(item.timestamp).toLocaleString() : '—'}</span></div></li>)}</ul>}
          </div>
        </section>
      </>}
    </div>
  );
};
