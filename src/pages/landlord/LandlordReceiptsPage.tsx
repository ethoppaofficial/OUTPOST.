import React, { useState } from 'react';
import { CheckCircle2, XCircle, Clock, FileText, ExternalLink, ShieldCheck, AlertCircle } from 'lucide-react';
import { authService } from '../../application/services/authService';
import { reservationService } from '../../application/services/reservationService';
import { PaymentReceipt } from '../../domain/types';
import { ReceiptStatusBadge, Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';

export const LandlordReceiptsPage: React.FC = () => {
  const session = authService.getSession();
  const [receipts, setReceipts] = useState<PaymentReceipt[]>(() =>
    reservationService.getLandlordReceipts(session.user.id)
  );

  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('Payment reference not reflecting in bank statement');
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const handleApprove = (receiptId: string) => {
    const res = reservationService.reviewPaymentReceipt(receiptId, 'approved');
    if (res.success) {
      setReceipts(reservationService.getLandlordReceipts(session.user.id));
      setActionSuccess('Receipt confirmed! Student reservation status is now CONFIRMED.');
      setTimeout(() => setActionSuccess(null), 4000);
    }
  };

  const handleRejectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReceiptId) return;

    const res = reservationService.reviewPaymentReceipt(selectedReceiptId, 'rejected', rejectionReason);
    if (res.success) {
      setReceipts(reservationService.getLandlordReceipts(session.user.id));
      setRejectModalOpen(false);
      setActionSuccess('Receipt rejected with student notification.');
      setTimeout(() => setActionSuccess(null), 4000);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
          Student Payment Receipts & Verification
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Review external bank transfers submitted by students holding rooms in your accommodations.
        </p>
      </div>

      {actionSuccess && (
        <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 text-emerald-700 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {receipts.length === 0 ? (
        <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-slate-200 dark:border-slate-800 text-xs text-slate-400">
          No student payment receipts submitted yet.
        </div>
      ) : (
        <div className="space-y-4">
          {receipts.map((rec) => {
            const isPending = rec.status === 'pending_review';
            return (
              <div
                key={rec.id}
                className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-slate-900 dark:text-white">
                        {rec.studentName}
                      </h3>
                      <span className="font-mono text-xs text-slate-400">
                        ({rec.registrationNumber})
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Property: <span className="font-semibold text-slate-700 dark:text-slate-300">{rec.propertyTitle}</span> ({rec.roomName})
                    </p>
                  </div>

                  <ReceiptStatusBadge status={rec.status} />
                </div>

                {/* Transfer details grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800 text-xs">
                  <div>
                    <span className="text-slate-400 text-[11px] block">Payer Bank:</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{rec.payerBankName}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[11px] block">Amount Paid:</span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">
                      ₦{rec.amountPaid.toLocaleString()}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[11px] block">Reference / Session ID:</span>
                    <span className="font-mono font-semibold text-slate-800 dark:text-slate-200 truncate block">
                      {rec.paymentReference}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[11px] block">Submitted At:</span>
                    <span className="text-slate-600 dark:text-slate-400">
                      {new Date(rec.uploadedAt).toLocaleDateString()} ({new Date(rec.uploadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
                    </span>
                  </div>
                </div>

                {rec.rejectionReason && (
                  <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 text-rose-700 text-xs">
                    <strong>Rejection Reason:</strong> {rec.rejectionReason}
                  </div>
                )}

                {/* Actions */}
                <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
                  {isPending && (
                    <>
                      <button
                        onClick={() => {
                          setSelectedReceiptId(rec.id);
                          setRejectModalOpen(true);
                        }}
                        className="px-4 py-2 rounded-xl border border-rose-200 dark:border-rose-900 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-medium"
                      >
                        Reject Receipt
                      </button>

                      <button
                        onClick={() => handleApprove(rec.id)}
                        className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Confirm Receipt & Lock Reservation</span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Reject Receipt Modal */}
      <Modal isOpen={rejectModalOpen} onClose={() => setRejectModalOpen(false)} title="Decline Payment Receipt">
        <form onSubmit={handleRejectSubmit} className="space-y-4 text-xs">
          <p className="text-slate-600 dark:text-slate-300">
            Please state the exact reason for declining this receipt. The student will be notified immediately to re-upload.
          </p>

          <div className="space-y-1.5">
            <label className="font-semibold text-slate-700 dark:text-slate-300">Reason</label>
            <select
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
            >
              <option value="Payment reference not reflecting in bank statement">
                Payment reference not reflecting in bank statement
              </option>
              <option value="Amount paid does not match invoice total">
                Amount paid does not match invoice total
              </option>
              <option value="Unreadable / blurry receipt screenshot">
                Unreadable / blurry receipt screenshot
              </option>
              <option value="Transfer reversed or failed at destination bank">
                Transfer reversed or failed at destination bank
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
