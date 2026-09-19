import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Building2, Users, AlertTriangle, CheckCircle2, Clock, ArrowRight } from 'lucide-react';
import { adminService } from '../../application/services/adminService';
import { verificationService } from '../../application/services/verificationService';
import { propertyService } from '../../application/services/propertyService';

export const AdminDashboard: React.FC = () => {
  const metrics = adminService.getAdminMetrics();
  const pendingStudents = verificationService.getPendingStudentVerifications();
  const pendingLandlords = verificationService.getPendingLandlordVerifications();
  const pendingProperties = propertyService.getAllProperties().filter((p) => p.verificationStatus === 'pending');

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-md bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 font-mono text-[10px] font-bold uppercase tracking-wider">
              Super Admin Console
            </span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-1">
            Platform Verification & Moderation Hub
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Enforce trust, authenticate Nigerian student IDs, inspect hostel listings, and supervise 7-day reservation holds.
          </p>
        </div>

        <Link
          to="/admin/verifications"
          className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 self-start sm:self-auto"
        >
          <ShieldCheck className="w-4 h-4" />
          <span>Open Verification Queue</span>
        </Link>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-1">
          <div className="flex justify-between items-center text-slate-400">
            <span className="text-xs font-medium">Total Registered</span>
            <Users className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">
            {metrics.totalStudents + metrics.totalLandlords}
          </div>
          <div className="text-[11px] text-slate-400">
            {metrics.totalStudents} students • {metrics.totalLandlords} landlords
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-1">
          <div className="flex justify-between items-center text-slate-400">
            <span className="text-xs font-medium">Pending Verifications</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-black text-amber-600 dark:text-amber-400">
            {metrics.pendingVerifications}
          </div>
          <div className="text-[11px] text-slate-400">Student & Landlord KYC</div>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-1">
          <div className="flex justify-between items-center text-slate-400">
            <span className="text-xs font-medium">Hostel Listings</span>
            <Building2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">
            {metrics.totalProperties}
          </div>
          <div className="text-[11px] text-slate-400">
            {pendingProperties.length} pending moderation
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-1">
          <div className="flex justify-between items-center text-slate-400">
            <span className="text-xs font-medium">Active Bookings & Holds</span>
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
            {metrics.activeReservations}
          </div>
          <div className="text-[11px] text-slate-400">7-day hold cycle</div>
        </div>
      </div>

      {/* Review Pipelines Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Student Verification Queue */}
        <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Student ID Queue</h3>
              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-bold">
                {pendingStudents.length} Pending
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Institutional portal cross-referencing and student card validation.
            </p>
          </div>

          <Link
            to="/admin/verifications"
            className="w-full py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-800 dark:text-slate-200 text-xs font-semibold text-center block"
          >
            Review Students
          </Link>
        </div>

        {/* Landlord Verification Queue */}
        <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Landlord KYC Queue</h3>
              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-bold">
                {pendingLandlords.length} Pending
              </span>
            </div>
            <p className="text-xs text-slate-500">
              NIN slip, utility bills, and property ownership deeds review.
            </p>
          </div>

          <Link
            to="/admin/verifications"
            className="w-full py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-800 dark:text-slate-200 text-xs font-semibold text-center block"
          >
            Review Landlords
          </Link>
        </div>

        {/* Property Listing Moderation */}
        <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col justify-between space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Hostel Moderation</h3>
              <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 text-[11px] font-bold">
                {pendingProperties.length} Pending
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Campus proximity, pricing accuracy, and photo validation.
            </p>
          </div>

          <Link
            to="/admin/properties"
            className="w-full py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-800 dark:text-slate-200 text-xs font-semibold text-center block"
          >
            Inspect Accommodations
          </Link>
        </div>
      </div>
    </div>
  );
};
