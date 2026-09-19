import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Compass,
  Users,
  CalendarCheck,
  ShieldCheck,
  AlertTriangle,
  Clock,
  ArrowRight,
  MessageSquare,
  FileCheck,
  Search,
} from 'lucide-react';
import { authService } from '../../application/services/authService';
import { reservationService } from '../../application/services/reservationService';
import { roommateService } from '../../application/services/roommateService';
import { verificationService } from '../../application/services/verificationService';
import { VerificationBadge, ReservationStatusBadge } from '../../components/ui/Badge';

export const StudentDashboard: React.FC = () => {
  const session = authService.getSession();
  const student = authService.getCurrentStudentProfile();
  const reservations = reservationService.getStudentReservations(session.user.id);
  const activeReservations = reservations.filter((r) => r.status === 'pending_payment' || r.status === 'receipt_submitted');
  const roommateRequests = roommateService.getReceivedRequests(session.user.id).filter((r) => r.status === 'pending');
  const documents = verificationService.getStudentDocuments(session.user.id);

  const isVerified = student?.isProfileVerified;
  const isPendingReview = documents.some((d) => d.status === 'pending');
  const isRejected = documents.some((d) => d.status === 'rejected');

  return (
    <div className="space-y-8">
      {/* Welcome Banner */}
      <div className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              Hello, {student?.fullName || session.displayName}
            </h1>
            <VerificationBadge type="student" status={!!isVerified} />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {student?.registrationNumber} • {student?.programme} • {student?.university} ({student?.campus})
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/student/properties"
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5"
          >
            <Compass className="w-4 h-4" />
            <span>Search Accommodations</span>
          </Link>
        </div>
      </div>

      {/* Verification Status Card if not verified */}
      {!isVerified && (
        <div className="p-5 rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-amber-900 dark:text-amber-200">
                {isPendingReview
                  ? 'Verification Documents Under Review'
                  : isRejected
                  ? 'Document Review Rejected'
                  : 'Student ID Verification Required'}
              </h4>
              <p className="text-xs text-amber-700 dark:text-amber-300/80 max-w-xl mt-0.5">
                {isPendingReview
                  ? 'Your institutional document is currently being reviewed by an admin. You can browse and reserve holds while verification completes.'
                  : isRejected
                  ? 'An uploaded document was declined. Please view the feedback reason and submit a clear photo of your Student ID or Admission letter.'
                  : 'To unlock trusted student status, roommate matching badges, and landlord approvals, please upload your Student ID Card or School Fees Receipt.'}
              </p>
            </div>
          </div>

          <Link
            to="/student/profile/verification"
            className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold whitespace-nowrap text-center"
          >
            {isPendingReview ? 'View Status' : 'Upload Verification ID'}
          </Link>
        </div>
      )}

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link
          to="/student/reservations"
          className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs hover:border-slate-300 transition space-y-2 block"
        >
          <div className="flex justify-between items-center text-slate-400">
            <span className="text-xs font-medium">Active Holds</span>
            <CalendarCheck className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">
            {activeReservations.length}
          </div>
          <div className="text-[11px] text-slate-400">7-day hold locking in progress</div>
        </Link>

        <Link
          to="/student/roommates"
          className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs hover:border-slate-300 transition space-y-2 block"
        >
          <div className="flex justify-between items-center text-slate-400">
            <span className="text-xs font-medium">Roommate Matching</span>
            <Users className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">
            Compatibility
          </div>
          <div className="text-[11px] text-slate-400">Explore peers near your campus</div>
        </Link>

        <Link
          to="/student/roommate-requests"
          className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs hover:border-slate-300 transition space-y-2 block"
        >
          <div className="flex justify-between items-center text-slate-400">
            <span className="text-xs font-medium">Roommate Requests</span>
            <Users className="w-4 h-4 text-purple-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">
            {roommateRequests.length}
          </div>
          <div className="text-[11px] text-slate-400">Pending student invitations</div>
        </Link>

        <Link
          to="/student/chat"
          className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs hover:border-slate-300 transition space-y-2 block"
        >
          <div className="flex justify-between items-center text-slate-400">
            <span className="text-xs font-medium">Messages</span>
            <MessageSquare className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 dark:text-white">
            Direct & Group
          </div>
          <div className="text-[11px] text-slate-400">Landlords and roommates</div>
        </Link>
      </div>

      {/* Active Reservations Section */}
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            My Accommodation Holds & Reservations
          </h2>
          <Link
            to="/student/reservations"
            className="text-xs font-semibold text-emerald-600 hover:underline flex items-center gap-1"
          >
            <span>All Reservations</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {reservations.length === 0 ? (
          <div className="p-8 rounded-2xl bg-white dark:bg-slate-900 border border-dashed border-slate-200 dark:border-slate-800 text-center space-y-2">
            <CalendarCheck className="w-8 h-8 text-slate-400 mx-auto" />
            <p className="text-xs text-slate-500">You haven't placed any accommodation holds yet.</p>
            <Link
              to="/student/properties"
              className="inline-block px-4 py-1.5 rounded-xl bg-slate-900 dark:bg-emerald-600 text-white text-xs font-medium"
            >
              Browse Student Hostels
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {reservations.slice(0, 2).map((res) => (
              <div
                key={res.id}
                className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 space-y-3 shadow-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-slate-400 font-medium">
                    {res.reservationNumber}
                  </span>
                  <ReservationStatusBadge status={res.status} />
                </div>

                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">{res.propertyTitle}</h3>
                  <p className="text-xs text-slate-500">{res.roomName} • ₦{res.amount.toLocaleString()} / session</p>
                </div>

                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
                  <span className="text-[11px] text-slate-400">
                    Expires: {new Date(res.holdExpiresAt).toLocaleDateString()}
                  </span>
                  <Link
                    to={`/student/reservations/${res.id}`}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition"
                  >
                    View Invoice & Receipt
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick Navigation Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Link
          to="/student/user-search"
          className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 hover:border-slate-300 transition flex items-center gap-3"
        >
          <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
            <Search className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900 dark:text-white">Student Registration Lookup</h4>
            <p className="text-[11px] text-slate-400">Verify a student by matric number safely</p>
          </div>
        </Link>

        <Link
          to="/student/groups"
          className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 hover:border-slate-300 transition flex items-center gap-3"
        >
          <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900 dark:text-white">Accommodation Groups</h4>
            <p className="text-[11px] text-slate-400">Form a group to rent multi-room flats</p>
          </div>
        </Link>

        <Link
          to="/student/roommate-preferences"
          className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 hover:border-slate-300 transition flex items-center gap-3"
        >
          <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
            <FileCheck className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-900 dark:text-white">My Roommate Preferences</h4>
            <p className="text-[11px] text-slate-400">Update habits, budget & sleep routine</p>
          </div>
        </Link>
      </div>
    </div>
  );
};
