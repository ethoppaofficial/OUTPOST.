import React from 'react';
import { BarChart3, Loader2 } from 'lucide-react';
import {
  adminService,
  AdminMetrics,
  ADMIN_METRICS_METADATA,
} from '../../application/services/adminService';
import { useAdminData } from '../../application/hooks/useAdminData';
import { AdminStatusBar } from '../../components/admin/AdminStatusBar';

export const AdminReportsPage: React.FC = () => {
  const {
    data: metrics,
    loading,
    refreshing,
    error,
    isLive,
    lastUpdatedAt,
    refresh,
  } = useAdminData<AdminMetrics>(() => adminService.getAdminMetrics());

  const activeMetrics = !error ? metrics : null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white">Platform reports</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Authoritative metrics queried directly from PostgreSQL metadata tables via{' '}
          <span className="font-mono text-xs">getAdminMetrics()</span>. No seed data or silent zero fallbacks.
        </p>
      </header>

      <AdminStatusBar
        isLive={isLive}
        loading={loading}
        refreshing={refreshing}
        error={error}
        lastUpdatedAt={lastUpdatedAt}
        onRefresh={() => void refresh()}
      />

      {loading && !activeMetrics ? (
        <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
          <span>Calculating live PostgreSQL report counts…</span>
        </div>
      ) : activeMetrics ? (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-2 border-b border-slate-100 p-4 font-bold text-slate-900 dark:border-slate-800 dark:text-white">
            <BarChart3 className="h-4 w-4 text-emerald-600" /> Live platform summary
          </div>
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800/70">
              <tr>
                <th className="p-3">Measure</th>
                {/* <th className="p-3">Authoritative Source Table</th> */}
                {/* <th className="p-3">Filter / Definition</th> */}
                <th className="p-3 text-right">Live Count</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {ADMIN_METRICS_METADATA.map((def) => (
                <tr key={def.key}>
                  <td className="p-3 font-medium text-slate-900 dark:text-white">{def.label}</td>
                  {/* <td className="p-3 font-mono text-xs text-slate-600 dark:text-slate-300">{def.sourceTable}</td> */}
                  {/* <td className="p-3 text-xs text-slate-500 dark:text-slate-400">{def.filterDescription}</td> */}
                  <td className="p-3 text-right font-bold text-slate-900 dark:text-white">
                    {activeMetrics[def.key].toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        <strong className="font-semibold text-slate-800 dark:text-slate-200">Uploaded Evidence Scope: </strong>
        Identity and financial file counts track authorized metadata rows in{' '}
        <span className="font-mono">student_verification_documents</span>,{' '}
        <span className="font-mono">landlord_verification_submissions</span>, and{' '}
        <span className="font-mono">payment_receipts</span>. Property listing photos and chat attachments are
        excluded, and unlinked Storage objects without metadata records are never counted as verified evidence.
      </div>
    </div>
  );
};
