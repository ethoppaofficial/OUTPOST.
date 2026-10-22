/**
 * @file LandlordDashboard.tsx
 * @description Central dashboard for accredited property landlords and hostel managers.
 * 
 * Provides:
 * - Real-time portfolio summary: total listed properties, cumulative capacity, and vacant bedspaces.
 * - Pending payment receipt alerts requiring urgent landlord bank transaction verification.
 * - Identity verification status (Approved, Pending, or Action Required).
 * - Direct navigation to add new listings, adjust bedspace availability, and review payments.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { Building2, Receipt, ShieldCheck, Clock, Plus, Users, ArrowRight } from 'lucide-react';
import { authService } from '../../application/services/authService';
import { propertyService } from '../../application/services/propertyService';
import { reservationService } from '../../application/services/reservationService';
import { verificationService } from '../../application/services/verificationService';
import { VerificationBadge, Badge } from '../../components/ui/Badge';
import { useFirebase } from '../../application/context/FirebaseContext';

/**
 * LandlordDashboard Component
 * 
 * Renders portfolio statistics, pending offline payment verification queues,
 * and quick-action buttons for managing student accommodation listings.
 */
export const LandlordDashboard: React.FC = () => {
  const { currentUser } = useFirebase();
  const session = authService.getSession();
  const profile = authService.getCurrentLandlordProfile();
  const properties = propertyService.getLandlordProperties(session.user.id);
  const receipts = reservationService.getLandlordReceipts(session.user.id);
  const pendingReceipts = receipts.filter((r) => r.status === 'pending_review');

  const totalSpaces = properties.reduce((acc, p) => acc + p.totalCapacity, 0);
  const availableSpaces = properties.reduce((acc, p) => acc + p.availableSpaces, 0);

  const isVerified = profile?.verificationStatus === 'approved';

  const rawFullName =
    profile?.legalName ||
    currentUser?.fullName ||
    session?.user?.fullName ||
    session?.displayName ||
    currentUser?.email ||
    '';

  const getFirstName = (name: string): string => {
    if (!name) return 'Host';
    const trimmed = name.trim();
    if (trimmed.includes('@')) {
      const local = trimmed.split('@')[0];
      const clean = local.replace(/[._-]/g, ' ').trim();
      const first = clean.split(/\s+/)[0];
      return first ? first.charAt(0).toUpperCase() + first.slice(1) : 'Host';
    }
    const firstWord = trimmed.split(/\s+/)[0];
    return firstWord || 'Host';
  };

  const firstName = getFirstName(rawFullName || profile?.businessName || 'Host');

  return (
    <div className="space-y-8">
      {/* Welcome Banner */}
      <div className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              Hello, {firstName}
            </h1>
            <VerificationBadge type="landlord" status={profile?.verificationStatus || 'pending'} />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {profile?.businessName ? `${profile.businessName} • ` : ''}
            Accredited Property Host
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/landlord/properties/new"
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>List New Property</span>
          </Link>
        </div>
      </div>

      {/* Verification Notice */}
      {!isVerified && (
        <div className="p-5 rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-amber-900 dark:text-amber-200">
                Landlord Ownership Verification Pending
              </h4>
              <p className="text-xs text-amber-700 dark:text-amber-300/80 max-w-xl mt-0.5">
                Your government identity credentials are under platform review. Approved landlords receive the gold verified shield badge and direct student trust.
              </p>
            </div>
          </div>

          <Link
            to="/landlord/verification"
            className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold whitespace-nowrap text-center"
          >
            Manage Verification Docs
          </Link>
        </div>
      )}

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-2">
          <div className="flex justify-between items-center text-slate-400">
            <span className="text-xs font-medium">Listed Hostels</span>
            <Building2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">
            {properties.length}
          </div>
          <div className="text-[11px] text-slate-400">Accommodations managed</div>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-2">
          <div className="flex justify-between items-center text-slate-400">
            <span className="text-xs font-medium">Available Spaces</span>
            <Users className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">
            {availableSpaces} <span className="text-xs font-normal text-slate-400">/ {totalSpaces}</span>
          </div>
          <div className="text-[11px] text-slate-400">Open bed spaces for students</div>
        </div>

        <Link
          to="/landlord/receipts"
          className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs hover:border-slate-300 transition space-y-2 block"
        >
          <div className="flex justify-between items-center text-slate-400">
            <span className="text-xs font-medium">Receipts to Review</span>
            <Receipt className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-black text-amber-600 dark:text-amber-400">
            {pendingReceipts.length}
          </div>
          <div className="text-[11px] text-slate-400">Pending bank transfer signoffs</div>
        </Link>

        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-2">
          <div className="flex justify-between items-center text-slate-400">
            <span className="text-xs font-medium">Verification Status</span>
            <ShieldCheck className="w-4 h-4 text-purple-500" />
          </div>
          <div className="text-base font-bold text-slate-900 dark:text-white capitalize">
            {profile?.verificationStatus || 'Pending'}
          </div>
          <div className="text-[11px] text-slate-400">Platform credential review</div>
        </div>
      </div>

      {/* Pending Receipts Review Alert */}
      {pendingReceipts.length > 0 && (
        <div className="p-5 rounded-2xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-900/40 space-y-3">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2 text-sm font-bold text-emerald-900 dark:text-emerald-200">
              <Receipt className="w-4 h-4 text-emerald-600" />
              <span>{pendingReceipts.length} Student Payment Receipt(s) Awaiting Confirmation</span>
            </div>
            <Link
              to="/landlord/receipts"
              className="text-xs font-semibold text-emerald-600 hover:underline flex items-center gap-1"
            >
              <span>Review All</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            Confirming student transfer receipts immediately updates their reservation to confirmed status.
          </p>
        </div>
      )}

      {/* Managed Accommodations Table */}
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">My Properties</h2>
          <Link
            to="/landlord/properties"
            className="text-xs font-semibold text-emerald-600 hover:underline"
          >
            Manage All Properties
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {properties.map((prop) => (
            <div
              key={prop.id}
              className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col justify-between space-y-3"
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-emerald-600">{prop.propertyType}</span>
                  <VerificationBadge type="property" status={prop.verificationStatus} />
                </div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">{prop.title}</h3>
                <p className="text-xs text-slate-500">{prop.neighbourhood} • {prop.campus}</p>
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center text-xs">
                <div>
                  <span className="text-slate-400">Available Spaces:</span>{' '}
                  <span className="font-bold text-emerald-600">{prop.availableSpaces} of {prop.totalCapacity}</span>
                </div>

                <Link
                  to={`/landlord/properties/${prop.id}/availability`}
                  className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 text-xs font-medium"
                >
                  Manage Spaces
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
