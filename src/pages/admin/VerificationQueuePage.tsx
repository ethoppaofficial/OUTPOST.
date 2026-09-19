import React, { useState } from 'react';
import { ShieldCheck, CheckCircle2, XCircle, Clock, FileText, ExternalLink, AlertCircle } from 'lucide-react';
import { verificationService } from '../../application/services/verificationService';
import { authService } from '../../application/services/authService';
import { StudentVerificationSubmission, LandlordVerificationSubmission } from '../../domain/types';
import { VerificationBadge, Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';

export const VerificationQueuePage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'students' | 'landlords'>('students');
  const [studentQueue, setStudentQueue] = useState<StudentVerificationSubmission[]>(() =>
    verificationService.getPendingStudentVerifications()
  );
  const [landlordQueue, setLandlordQueue] = useState<LandlordVerificationSubmission[]>(() =>
    verificationService.getPendingLandlordVerifications()
  );

  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<{ type: 'student' | 'landlord'; id: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('Submitted document scan is unreadable or obscured.');
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const refreshQueues = () => {
    setStudentQueue(verificationService.getPendingStudentVerifications());
    setLandlordQueue(verificationService.getPendingLandlordVerifications());
  };

  const handleApproveStudent = (subId: string) => {
    const res = verificationService.reviewStudentVerification(subId, 'approved', 'admin-super-1');
    if (res.success) {
      refreshQueues();
      setActionSuccess('Student verification approved! Student badge assigned.');
      setTimeout(() => setActionSuccess(null), 3000);
    }
  };

  const handleApproveLandlord = (subId: string) => {
    const res = verificationService.reviewLandlordVerification(subId, 'approved', 'admin-super-1');
    if (res.success) {
      refreshQueues();
      setActionSuccess('Landlord credentials verified! Gold shield badge awarded.');
      setTimeout(() => setActionSuccess(null), 3000);
    }
  };

  const handleRejectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectTarget) return;

    if (rejectTarget.type === 'student') {
      verificationService.reviewStudentVerification(rejectTarget.id, 'rejected', 'admin-super-1', rejectReason);
    } else {
      verificationService.reviewLandlordVerification(rejectTarget.id, 'rejected', 'admin-super-1', rejectReason);
    }

    refreshQueues();
    setRejectModalOpen(false);
    setActionSuccess(`Verification rejected with feedback note.`);
    setTimeout(() => setActionSuccess(null), 3000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
          Credential Verification Queue
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Review institutional student ID cards, matriculation records, NIN credentials, and hostel title deeds.
        </p>
      </div>

      {actionSuccess && (
        <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 text-emerald-700 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex rounded-2xl bg-slate-100 dark:bg-slate-800 p-1 text-xs font-semibold">
        <button
          onClick={() => setActiveTab('students')}
          className={`flex-1 py-2.5 rounded-xl transition ${
            activeTab === 'students'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-500'
          }`}
        >
          Student ID Submissions ({studentQueue.length})
        </button>
        <button
          onClick={() => setActiveTab('landlords')}
          className={`flex-1 py-2.5 rounded-xl transition ${
            activeTab === 'landlords'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-500'
          }`}
        >
          Landlord KYC Submissions ({landlordQueue.length})
        </button>
      </div>

      {/* Student List */}
      {activeTab === 'students' && (
        <div className="space-y-4">
          {studentQueue.length === 0 ? (
            <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-slate-200 dark:border-slate-800 text-xs text-slate-400">
              No pending student verifications in the queue.
            </div>
          ) : (
            studentQueue.map((sub) => (
              <div
                key={sub.id}
                className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                      {sub.fullName}
                    </h3>
                    <div className="text-xs text-slate-500 font-mono">
                      Matric: {sub.registrationNumber} • {sub.university} ({sub.campus})
                    </div>
                  </div>

                  <span className="px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 text-xs font-semibold">
                    Pending Review
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800 text-xs">
                  <div>
                    <span className="text-slate-400 text-[11px] block">Programme:</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{sub.programme}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[11px] block">Study Level:</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{sub.studyLevel}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[11px] block">Institutional Email:</span>
                    <span className="font-mono text-slate-800 dark:text-slate-200 truncate block">{sub.studentEmail}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[11px] block">Submitted At:</span>
                    <span className="text-slate-600 dark:text-slate-400">{new Date(sub.submittedAt).toLocaleDateString()}</span>
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-between border-t border-slate-100 dark:border-slate-800">
                  <span className="text-xs text-slate-400">
                    Uploaded Doc: <span className="font-mono text-slate-600 dark:text-slate-300">student_id_card.png</span>
                  </span>

                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setRejectTarget({ type: 'student', id: sub.id });
                        setRejectModalOpen(true);
                      }}
                      className="px-4 py-2 rounded-xl border border-rose-200 dark:border-rose-900 text-rose-600 hover:bg-rose-50 text-xs font-medium"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => handleApproveStudent(sub.id)}
                      className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs flex items-center gap-1"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Approve & Grant Student Badge</span>
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Landlord List */}
      {activeTab === 'landlords' && (
        <div className="space-y-4">
          {landlordQueue.length === 0 ? (
            <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-slate-200 dark:border-slate-800 text-xs text-slate-400">
              No pending landlord verifications in the queue.
            </div>
          ) : (
            landlordQueue.map((sub) => (
              <div
                key={sub.id}
                className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                      {sub.legalName}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {sub.businessName ? `${sub.businessName} • ` : ''}ID: {sub.idType} ({sub.idNumber})
                    </p>
                  </div>

                  <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold">
                    Pending KYC
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800 text-xs">
                  <div>
                    <span className="text-slate-400 text-[11px] block">Proof of Ownership / Authority:</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{sub.ownershipDocType}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[11px] block">Submitted At:</span>
                    <span className="text-slate-600 dark:text-slate-400">{new Date(sub.submittedAt).toLocaleDateString()}</span>
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
                  <button
                    onClick={() => {
                      setRejectTarget({ type: 'landlord', id: sub.id });
                      setRejectModalOpen(true);
                    }}
                    className="px-4 py-2 rounded-xl border border-rose-200 dark:border-rose-900 text-rose-600 hover:bg-rose-50 text-xs font-medium"
                  >
                    Reject KYC
                  </button>
                  <button
                    onClick={() => handleApproveLandlord(sub.id)}
                    className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-xs flex items-center gap-1"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Approve Landlord Verification</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Rejection Modal */}
      <Modal isOpen={rejectModalOpen} onClose={() => setRejectModalOpen(false)} title="Reject Verification Application">
        <form onSubmit={handleRejectSubmit} className="space-y-4 text-xs">
          <p className="text-slate-600 dark:text-slate-300">
            Specify why this credential verification is being declined. The applicant will be able to review this and re-submit.
          </p>

          <div className="space-y-1.5">
            <label className="font-semibold text-slate-700 dark:text-slate-300">Rejection Reason</label>
            <select
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
            >
              <option value="Submitted document scan is unreadable or obscured.">
                Submitted document scan is unreadable or obscured.
              </option>
              <option value="Matriculation / registration number does not match institutional records.">
                Matriculation / registration number does not match institutional records.
              </option>
              <option value="ID card validity expired or lacks required university seal.">
                ID card validity expired or lacks required university seal.
              </option>
              <option value="Proof of property ownership address does not match hostel listing.">
                Proof of property ownership address does not match hostel listing.
              </option>
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setRejectModalOpen(false)}
              className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold"
            >
              Confirm Rejection
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
