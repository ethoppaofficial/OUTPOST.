import React, { useEffect, useState } from 'react';
import { BarChart3, Loader2 } from 'lucide-react';
import { adminService, AdminDashboardData } from '../../application/services/adminService';

export const AdminReportsPage: React.FC = () => {
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    adminService.getDashboardData().then((result) => { if (active) setData(result); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Reports could not be loaded.'); });
    return () => { active = false; };
  }, []);
  const metrics = data?.metrics;
  const reportRows = metrics ? [
    ['Users', 'Students', metrics.totalStudents],
    ['Users', 'Landlords', metrics.totalLandlords],
    ['Verification', 'Student submissions pending', metrics.pendingStudentVerifications],
    ['Verification', 'Landlord submissions pending', metrics.pendingLandlordVerifications],
    ['Properties', 'Pending property review', metrics.pendingPropertyVerifications],
    ['Properties', 'Active properties', metrics.activeProperties],
    ['Reservations', 'Active reservations', metrics.activeReservations],
    ['Payments', 'Receipts pending review', metrics.pendingReceiptVerifications],
    ['Reservations', 'Expired reservations', metrics.expiredReservations],
  ] : [];
  return <div className="space-y-6"><header><h1 className="text-2xl font-black text-slate-900 dark:text-white">Platform reports</h1><p className="mt-1 text-sm text-slate-500">Operational summaries generated from live platform records; this view does not fabricate missing data.</p></header>{error && <div role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/30">{error}</div>}{!data && !error ? <Loader2 className="h-5 w-5 animate-spin text-emerald-600" /> : data && <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"><div className="flex items-center gap-2 border-b border-slate-100 p-4 font-bold dark:border-slate-800"><BarChart3 className="h-4 w-4 text-emerald-600" /> Current platform summary</div><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800/70"><tr><th className="p-3">Report</th><th className="p-3">Measure</th><th className="p-3 text-right">Count</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{reportRows.map(([group, label, value]) => <tr key={label}><td className="p-3 text-slate-500">{group}</td><td className="p-3 font-medium">{label}</td><td className="p-3 text-right font-bold">{Number(value).toLocaleString()}</td></tr>)}</tbody></table></div>}</div>;
};
