/**
 * @file AdminDashboard.tsx
 * @module pages/admin/AdminDashboard
 * @description Master operational overview dashboard for OUTPOST platform administrators.
 *
 * Authoritative Metrics:
 * - Uses `adminService.getDashboardData()` -> `adminService.getAdminMetrics()` backed by live PostgreSQL counts.
 * - Separates identity/payment evidence counts strictly by metadata table (`student_verification_documents`,
 *   `landlord_verification_submissions`, `payment_receipts`).
 * - Never masks errors with fake zeros or local/demo data.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Clock3,
  FileCheck2,
  FileText,
  FolderCheck,
  Receipt,
  ShieldCheck,
  UserCheck,
  Users,
} from 'lucide-react';
import {
  adminService,
  AdminDashboardData,
  AdminMetrics,
} from '../../application/services/adminService';
import { useAdminData } from '../../application/hooks/useAdminData';
import { AdminStatusBar } from '../../components/admin/AdminStatusBar';

const primaryCards: Array<{ key: keyof AdminMetrics; label: string; subtitle: string; icon: any }> = [
  { key: 'totalUsers', label: 'Registered users', icon: Users },
  { key: 'totalNonAdminUsers', label: 'Non-admin users', icon: Users },
  { key: 'totalStudents', label: 'Registered students', icon: Users },
  { key: 'totalLandlords', label: 'Registered landlords', icon: Building2 },
  { key: 'totalAdministrators', label: 'Administrators', icon: ShieldCheck },
  { key: 'totalUploadedStudentDocuments', label: 'Student files uploaded', icon: FileText },
  { key: 'totalLandlordVerificationSubmissions', label: 'Landlord files uploaded', icon: FolderCheck },
  { key: 'totalPaymentReceipts', label: 'Payment receipts uploaded', icon: Receipt },
  { key: 'pendingStudentVerifications', label: 'Student checks pending', icon: FileCheck2 },
  { key: 'pendingLandlordVerifications', label: 'Landlord checks pending', icon: UserCheck },
  { key: 'approvedLandlordVerifications', label: 'Approved landlords', icon: ShieldCheck },
  { key: 'rejectedLandlordVerifications', label: 'Rejected landlords', icon: AlertTriangle },
  { key: 'totalProperties', label: 'Total submitted properties', icon: Building2 },
  { key: 'approvedProperties', label: 'Approved properties', icon: FileCheck2 },
  { key: 'pendingPropertyVerifications', label: 'Property reviews pending', icon: Clock3 },
  { key: 'activeProperties', label: 'Active properties', icon: Building2 },
  { key: 'activeReservations', label: 'Active reservations', icon: Receipt },
  { key: 'pendingReceiptVerifications', label: 'Receipts pending review', icon: Clock3 },
  { key: 'expiredReservations', label: 'Expired reservations', icon: AlertTriangle },
];

export const AdminDashboard: React.FC = () => {
  const {
    data,
    loading,
    refreshing,
    error,
    isLive,
    lastUpdatedAt,
    refresh,
  } = useAdminData<AdminDashboardData>(
    () => adminService.getDashboardData(),
    [],
    {
      realtimeTables: [
        'profiles',
        'student_verification_documents',
        'landlord_verification_submissions',
        'properties',
        'reservations',
        'payment_receipts',
      ],
    }
  );

  // Only render metrics when not currently errored and data is actually available
  const metrics = !error ? data?.metrics : undefined;
  const needsAction = metrics
    ? metrics.pendingLandlordVerifications +
      metrics.pendingStudentVerifications +
      metrics.pendingPropertyVerifications +
      metrics.pendingReceiptVerifications
    : 0;

  return (
    <div className="space-y-7">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-purple-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
            <ShieldCheck className="h-3.5 w-3.5" /> Administrator workspace
          </span>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">
            Platform operations
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Live database metrics across OUTPOST student housing around Dambare &amp; Rimin Gata.
          </p>
        </div>
        <Link
          to="/admin/verifications"
          className="inline-flex items-center gap-2 self-start rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-purple-500"
        >
          Open review queue <ArrowRight className="h-4 w-4" />
        </Link>
      </header>

      <AdminStatusBar
        isLive={isLive}
        loading={loading}
        refreshing={refreshing}
        error={error}
        lastUpdatedAt={lastUpdatedAt}
        onRefresh={() => void refresh()}
      />

      {loading && !data && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Loading metrics">
          {Array.from({ length: 8 }).map((_, idx) => (
            <div
              key={idx}
              className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-800/50"
            />
          ))}
        </div>
      )}

      {metrics && (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Platform metrics">
            {primaryCards.map(({ key, label, subtitle, icon: Icon }) => (
              <div
                key={key}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
                  <Icon className="h-4 w-4 shrink-0 text-emerald-600" />
                </div>
                <div className="mt-2 text-2xl font-black text-slate-900 dark:text-white">
                  {metrics[key].toLocaleString()}
                </div>
                <p className="mt-1 font-mono text-[10px] text-slate-400">{subtitle}</p>
              </div>
            ))}
          </section>

          <section className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                <AlertTriangle className="h-4 w-4 text-amber-500" /> Action required
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {needsAction
                  ? `${needsAction} item${needsAction === 1 ? '' : 's'} are awaiting review.`
                  : 'No pending verification or receipt queues.'}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link to="/admin/verifications" className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold dark:bg-slate-800">
                  Verifications ({metrics.pendingStudentVerifications + metrics.pendingLandlordVerifications})
                </Link>
                <Link to="/admin/properties" className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold dark:bg-slate-800">
                  Properties ({metrics.pendingPropertyVerifications})
                </Link>
                <Link to="/admin/reservations" className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold dark:bg-slate-800">
                  Receipts ({metrics.pendingReceiptVerifications})
                </Link>
                <Link to="/admin/reports" className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold dark:bg-slate-800">
                  Reports &amp; definitions
                </Link>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-slate-900 dark:text-white">Recent audited activity</h2>
                <Link to="/admin/audit-logs" className="text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400">
                  View logs
                </Link>
              </div>
              {!data?.recentActivity.length ? (
                <p className="mt-4 text-sm text-slate-500">No recorded activity yet in audit_logs.</p>
              ) : (
                <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
                  {data.recentActivity.slice(0, 5).map((item) => (
                    <li key={item.id} className="py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                            {item.action.replaceAll('_', ' ')}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {item.actorName} · {item.targetEntity} {item.targetId}
                          </p>
                        </div>
                        <span className="shrink-0 text-[11px] text-slate-400">
                          {item.timestamp ? new Date(item.timestamp).toLocaleString() : '—'}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
};
