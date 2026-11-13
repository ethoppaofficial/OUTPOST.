/**
 * @file ReservationsPage.tsx
 * @module pages/student/ReservationsPage
 * @description Student workspace page displaying active, confirmed, and expired accommodation reservations.
 *
 * Capabilities:
 * - Hold Timer Tracking: Monitors remaining hours/days on 7-day payment holds.
 * - Invoice Access: Links directly to official student accommodation fee invoices (`/student/invoices/:id`).
 * - Receipt Status: Tracks whether bank transfer receipts have been submitted, approved, or rejected.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck, FileText, ArrowRight, RefreshCw, Loader2 } from 'lucide-react';
import { authService } from '../../application/services/authService';
import { reservationService } from '../../application/services/reservationService';
import { ReservationStatusBadge } from '../../components/ui/Badge';
import { useAuth } from '../../application/context/AuthContext';
import { Reservation } from '../../domain/types';

export const ReservationsPage: React.FC = () => {
  const { currentUser, loading: authLoading } = useAuth();
  const session = authService.getSession();
  const studentId = currentUser?.id || session.user.id;

  const [reservations, setReservations] = useState<Reservation[]>(() =>
    studentId && studentId !== 'anonymous' ? reservationService.getStudentReservations(studentId) : []
  );
  const [loadingList, setLoadingList] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadReservations = useCallback(async () => {
    if (authLoading) return;
    if (!studentId || studentId === 'anonymous') {
      setLoadingList(false);
      return;
    }
    setLoadingList(true);
    setLoadError(null);
    try {
      const live = await reservationService.loadStudentReservations(studentId);
      setReservations(live);
    } catch (err: any) {
      setLoadError(err?.message || 'Could not load reservations.');
    } finally {
      setLoadingList(false);
    }
  }, [authLoading, studentId]);

  useEffect(() => {
    void loadReservations();
  }, [loadReservations]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            My Accommodation Reservations & Holds
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Track active 7-day holds, review issued invoices, and monitor landlord payment receipt confirmations.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadReservations()}
          disabled={loadingList}
          className="inline-flex items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingList ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {loadError && (
        <div role="alert" className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 text-rose-700 text-xs">
          {loadError}
        </div>
      )}

      {loadingList && reservations.length === 0 ? (
        <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 flex items-center justify-center gap-2 text-xs text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
          <span>Loading your reservations…</span>
        </div>
      ) : reservations.length === 0 ? (
        <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-slate-200 dark:border-slate-800 space-y-3">
          <CalendarCheck className="w-8 h-8 text-slate-400 mx-auto" />
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">No Active Reservations</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            When you select an accommodation room, an exclusive 7-day hold is placed to protect your space while you transfer funds.
          </p>
          <Link
            to="/student/properties"
            className="inline-block px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
          >
            Browse Verified Hostels
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {reservations.map((res) => {
            const isHoldActive = res.status === 'pending_payment';
            const expiresDate = new Date(res.holdExpiresAt);
            const isExpired = res.status === 'expired' || (isHoldActive && expiresDate < new Date());

            return (
              <div
                key={res.id}
                className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-slate-700 dark:text-slate-300">
                      {res.reservationNumber}
                    </span>
                    <ReservationStatusBadge status={res.status} />
                  </div>

                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    {res.propertyTitle}
                  </h3>

                  <p className="text-xs text-slate-500">
                    {res.roomName} • ₦{res.amount.toLocaleString()} / session • Landlord: {res.landlordName}
                  </p>

                  <div className="flex items-center gap-4 text-[11px] text-slate-400 pt-1">
                    <span>Reserved: {new Date(res.createdAt).toLocaleDateString()}</span>
                    <span>•</span>
                    <span className={isExpired ? 'text-rose-500 font-bold' : 'text-amber-600 font-medium'}>
                      Hold Deadline: {expiresDate.toLocaleDateString()} ({expiresDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
                    </span>
                  </div>
                </div>

                <div className="flex sm:flex-col items-center sm:items-end gap-2">
                  <Link
                    to={`/student/reservations/${res.id}`}
                    className="w-full sm:w-auto px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white text-xs font-semibold transition shadow-xs text-center flex items-center justify-center gap-1.5"
                  >
                    <span>Manage & Upload Receipt</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>

                  <Link
                    to={`/student/invoices/${res.invoiceId}`}
                    className="w-full sm:w-auto px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 text-center flex items-center justify-center gap-1"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>View Invoice</span>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
