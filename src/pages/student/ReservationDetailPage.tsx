/**
 * @file ReservationDetailPage.tsx
 * @module pages/student/ReservationDetailPage
 * @description Detailed view of a student accommodation reservation hold.
 *
 * Security Rationale & Financial Invariants:
 * - Direct Landlord Bank Details: OUTPOST never takes custody of user funds (an explicit MVP exclusion).
 *   Payment instructions and account details are retrieved strictly from the authoritative `Invoice`
 *   record linked to the reservation. Hardcoded fallback bank accounts are strictly prohibited.
 * - Authentic Evidence Required: Fake receipt URLs or unauthenticated third-party storage fallbacks are forbidden.
 *   A physical file must be uploaded to tenant-isolated Supabase storage before registering the receipt.
 * - Eligibility Boundaries: Receipts can only be submitted while the reservation status is `pending_payment`
 *   or `receipt_submitted` within the 7-day hold window. Expired or cancelled holds reject uploads.
 */

import React, { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  Clock,
  FileText,
  Upload,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowLeft,
  Building,
  CreditCard,
  Loader2,
} from 'lucide-react';
import { authService } from '../../application/services/authService';
import { reservationService } from '../../application/services/reservationService';
import { storageService } from '../../application/services/storageService';
import { ReservationStatusBadge, ReceiptStatusBadge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import {
  validateUploadFile,
  PAYMENT_RECEIPT_UPLOAD_RULES,
} from '../../application/utils/uploadValidation';
import {
  validateAmount,
  validateTextLength,
} from '../../application/utils/validation';
import { normalizeError } from '../../application/utils/errorUtils';

export const ReservationDetailPage: React.FC = () => {
  const { reservationId } = useParams<{ reservationId: string }>();
  const navigate = useNavigate();
  const session = authService.getSession();

  const [reservation, setReservation] = useState(() =>
    reservationService.getReservationById(reservationId || '')
  );

  const [receipt, setReceipt] = useState(() =>
    reservationService.getReceiptForReservation(reservationId || '')
  );

  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [payerBank, setPayerBank] = useState('GTBank');
  const [reference, setReference] = useState('');
  const [amountPaid, setAmountPaid] = useState<number>(reservation?.amount || 0);
  const [fileName, setFileName] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!reservation) {
    return (
      <div className="text-center py-12 space-y-3">
        <p className="text-sm text-slate-500">Reservation not found.</p>
        <Link to="/student/reservations" className="text-xs text-emerald-600 font-semibold underline">
          Back to my reservations
        </Link>
      </div>
    );
  }

  // Tenant Boundary Check: Student can only view their own reservation
  const isAuthorizedStudent = reservation.studentId === session.user.id;
  if (!isAuthorizedStudent && session.user.role !== 'admin') {
    return (
      <div className="text-center py-12 space-y-3">
        <p className="text-sm text-rose-500 font-semibold">Unauthorized: You do not have permission to view this reservation.</p>
        <Link to="/student/reservations" className="text-xs text-emerald-600 font-semibold underline">
          Back to my reservations
        </Link>
      </div>
    );
  }

  // Authoritative invoice & direct landlord payment details
  const invoice = reservation.invoiceId
    ? reservationService.getInvoiceById(reservation.invoiceId)
    : reservationService.getInvoiceByReservationId(reservation.id);

  const bankDetails = invoice?.bankDetails;
  const hasVerifiedBankDetails = Boolean(
    bankDetails?.accountNumber && bankDetails?.bankName
  );

  const expiresDate = new Date(reservation.holdExpiresAt);
  const now = new Date();
  const isExpired = now.getTime() > expiresDate.getTime() || reservation.status === 'expired';
  const diffHours = Math.max(0, Math.round((expiresDate.getTime() - now.getTime()) / (1000 * 60 * 60)));
  const diffDays = Math.floor(diffHours / 24);
  const remainingHours = diffHours % 24;

  const canUploadReceipt =
    !isExpired &&
    (reservation.status === 'pending_payment' || reservation.status === 'receipt_submitted');

  const handleUploadReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // 1. Validate eligibility
    if (!canUploadReceipt) {
      setError('This reservation is not eligible for receipt submission (it may be confirmed, expired, or cancelled).');
      return;
    }

    // 2. Validate transaction reference
    const refValidation = validateTextLength(reference, 4, 60, 'Transaction reference / Session ID');
    if (!refValidation.isValid) {
      setError(refValidation.error!);
      return;
    }

    // 3. Validate payment amount
    const amountValidation = validateAmount(amountPaid, 'Amount paid');
    if (!amountValidation.isValid) {
      setError(amountValidation.error!);
      return;
    }

    // 4. Validate physical file upload (strictly reject missing or fake fallback URLs)
    const fileValidation = validateUploadFile(receiptFile, PAYMENT_RECEIPT_UPLOAD_RULES);
    if (!fileValidation.isValid || !receiptFile) {
      setError(fileValidation.error || 'Please select an authentic payment receipt file (JPEG, PNG, or PDF).');
      return;
    }

    setUploading(true);

    try {
      // Direct upload through tenant-isolated storage service
      const uploadRes = await storageService.uploadPaymentReceipt(
        reservation.id,
        receiptFile,
        fileValidation.sanitizedFileName || receiptFile.name,
        reservation.landlordId,
        session.user.id
      );

      if (!uploadRes || !uploadRes.url) {
        throw new Error('Failed to obtain authenticated storage location for the receipt.');
      }

      const res = await reservationService.uploadPaymentReceipt({
        reservationId: reservation.id,
        invoiceId: reservation.invoiceId || invoice?.id || `inv-${reservation.id}`,
        studentId: session.user.id,
        landlordId: reservation.landlordId,
        fileUrl: uploadRes.url,
        fileName: uploadRes.fileName,
        fileSize: uploadRes.fileSize,
        paymentReference: reference.trim(),
        payerBankName: payerBank,
        amountPaid: Number(amountPaid),
      });

      if (res.success && res.receipt) {
        setReceipt(res.receipt);
        setReservation(reservationService.getReservationById(reservation.id));
        setUploadModalOpen(false);
        setReceiptFile(null);
        setFileName('');
        setSuccess('Payment receipt submitted successfully! The landlord has been notified to verify your bank transfer.');
        setTimeout(() => setSuccess(null), 6000);
      } else {
        setError(res.error || 'Failed to register submitted payment receipt.');
      }
    } catch (err: unknown) {
      const normalized = normalizeError(err, 'Failed to upload receipt to storage.');
      setError(normalized.userMessage);
    } finally {
      setUploading(false);
    }
  };

  const handleCancelReservation = () => {
    if (window.confirm('Are you sure you want to cancel this reservation hold? Your bed-space will be immediately released.')) {
      reservationService.cancelReservation(reservation.id);
      setReservation(reservationService.getReservationById(reservation.id));
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Link
        to="/student/reservations"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>Back to My Reservations</span>
      </Link>

      {/* Header */}
      <div className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="font-mono text-xs font-bold text-slate-400">
              Hold Ref: {reservation.reservationNumber}
            </span>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white mt-0.5">
              {reservation.propertyTitle || reservation.propertyName}
            </h1>
          </div>

          <ReservationStatusBadge status={reservation.status} />
        </div>

        {/* 7-Day Hold Countdown Bar */}
        {reservation.status === 'pending_payment' && !isExpired && (
          <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200/70 dark:border-amber-900/60 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              <div>
                <h4 className="text-xs font-bold text-amber-900 dark:text-amber-200">
                  7-Day Exclusive Hold Active
                </h4>
                <p className="text-[11px] text-amber-700 dark:text-amber-300">
                  This room is reserved exclusively for you until {expiresDate.toLocaleDateString()} ({expiresDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}).
                </p>
              </div>
            </div>

            <div className="text-right">
              <span className="text-sm font-black text-amber-700 dark:text-amber-300">
                {diffDays}d {remainingHours}h remaining
              </span>
            </div>
          </div>
        )}

        {isExpired && (
          <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 text-rose-800 dark:text-rose-300 text-xs flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 flex-shrink-0" />
            <div>
              <p className="font-bold">Reservation Hold Expired</p>
              <p className="text-[11px]">The 7-day payment window for this hold elapsed without verified payment.</p>
            </div>
          </div>
        )}

        {/* Property & Invoice Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
          <div>
            <span className="text-slate-400 text-[11px] block">Reserved Unit</span>
            <span className="font-semibold text-slate-900 dark:text-white">{reservation.roomName || reservation.unitName}</span>
          </div>
          <div>
            <span className="text-slate-400 text-[11px] block">Session Cost</span>
            <span className="font-bold text-emerald-600 dark:text-emerald-400">
              ₦{reservation.amount.toLocaleString()}
            </span>
          </div>
          <div>
            <span className="text-slate-400 text-[11px] block">Landlord</span>
            <span className="font-semibold text-slate-900 dark:text-white">{reservation.landlordName || 'Verified Host'}</span>
          </div>
          <div>
            <span className="text-slate-400 text-[11px] block">Official Invoice</span>
            {reservation.invoiceId ? (
              <Link
                to={`/student/invoices/${reservation.invoiceId}`}
                className="text-emerald-600 hover:underline font-semibold flex items-center gap-1"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>View Invoice</span>
              </Link>
            ) : (
              <span className="text-slate-400">Pending creation</span>
            )}
          </div>
        </div>
      </div>

      {success && (
        <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 text-emerald-700 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/* Authoritative Landlord Direct Bank Details */}
      <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <Building className="w-5 h-5 text-emerald-600" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            Landlord Verified Direct Bank Transfer Details
          </h2>
        </div>

        {hasVerifiedBankDetails && bankDetails ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/80 text-xs">
              <div>
                <span className="text-slate-400 text-[11px] block">Beneficiary Bank:</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">{bankDetails.bankName}</span>
              </div>
              <div>
                <span className="text-slate-400 text-[11px] block">Account Number:</span>
                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                  {bankDetails.accountNumber}
                </span>
              </div>
              <div>
                <span className="text-slate-400 text-[11px] block">Beneficiary Name:</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {bankDetails.accountName}
                </span>
              </div>
            </div>

            {bankDetails.paymentInstructions && (
              <p className="text-[11px] text-slate-500 leading-relaxed italic">
                {bankDetails.paymentInstructions}
              </p>
            )}

            <p className="text-[11px] text-slate-500 leading-relaxed">
              Please transfer exact amount <strong>₦{reservation.amount.toLocaleString()}</strong> using reference code{' '}
              <strong className="font-mono text-emerald-600">{reservation.reservationNumber}</strong>. Once payment completes on your mobile banking app, upload your receipt below.
            </p>
          </div>
        ) : (
          <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/80 text-xs text-amber-800 dark:text-amber-300 space-y-1">
            <p className="font-bold">Landlord Payment Information Unavailable</p>
            <p className="text-[11px]">
              Direct bank details have not yet been synchronized for this listing. Please communicate with the landlord via chat before making an external bank transfer.
            </p>
          </div>
        )}

        {/* Receipt Status & Action */}
        <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Receipt Status:</span>
            <ReceiptStatusBadge status={receipt?.status || 'not_submitted'} />
          </div>

          {canUploadReceipt && (
            <button
              onClick={() => setUploadModalOpen(true)}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 cursor-pointer transition"
            >
              <Upload className="w-4 h-4" />
              <span>{receipt ? 'Upload Updated Receipt' : 'Upload Payment Receipt'}</span>
            </button>
          )}
        </div>

        {/* Existing Receipt Preview if uploaded */}
        {receipt && (
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-400">Payment Reference:</span>
              <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{receipt.paymentReference}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Bank & Amount:</span>
              <span>{receipt.payerBankName} • ₦{receipt.amountPaid.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Submitted At:</span>
              <span>{new Date(receipt.uploadedAt).toLocaleString()}</span>
            </div>

            {receipt.rejectionReason && (
              <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 text-rose-700 text-[11px]">
                <strong>Landlord Rejection Note: </strong>
                {receipt.rejectionReason}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Cancellation option */}
      {reservation.status === 'pending_payment' && !isExpired && (
        <div className="text-right">
          <button
            onClick={handleCancelReservation}
            className="text-xs text-rose-500 hover:text-rose-700 font-medium cursor-pointer"
          >
            Cancel this reservation hold
          </button>
        </div>
      )}

      {/* Upload Receipt Modal */}
      <Modal
        isOpen={uploadModalOpen}
        onClose={() => {
          if (!uploading) setUploadModalOpen(false);
        }}
        title="Upload Bank Transfer Receipt"
      >
        <form onSubmit={handleUploadReceipt} className="space-y-4 text-xs">
          <div className="space-y-1.5">
            <label className="font-semibold text-slate-700 dark:text-slate-300">Originating Bank</label>
            <select
              value={payerBank}
              disabled={uploading}
              onChange={(e) => setPayerBank(e.target.value)}
              className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
            >
              <option value="GTBank">Guaranty Trust Bank (GTBank)</option>
              <option value="Access Bank">Access Bank</option>
              <option value="Zenith Bank">Zenith Bank</option>
              <option value="First Bank">First Bank of Nigeria</option>
              <option value="UBA">United Bank for Africa (UBA)</option>
              <option value="Stanbic IBTC">Stanbic IBTC Bank</option>
              <option value="Fidelity Bank">Fidelity Bank</option>
              <option value="Kuda">Kuda Microfinance Bank</option>
              <option value="OPay">OPay Digital Services</option>
              <option value="Moniepoint">Moniepoint Microfinance Bank</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="font-semibold text-slate-700 dark:text-slate-300">
              Transaction Reference / Session ID
            </label>
            <input
              type="text"
              required
              disabled={uploading}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. 090267238192837192"
              className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <label className="font-semibold text-slate-700 dark:text-slate-300">Amount Paid (₦ NGN)</label>
            <input
              type="number"
              required
              min={1}
              disabled={uploading}
              value={amountPaid}
              onChange={(e) => setAmountPaid(Number(e.target.value))}
              className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
            />
          </div>

          <div className="space-y-1.5">
            <label className="font-semibold text-slate-700 dark:text-slate-300">
              Receipt Screenshot / PDF Proof
            </label>
            <input
              type="file"
              required
              disabled={uploading}
              accept=".png,.jpg,.jpeg,.pdf"
              onChange={(e) => {
                setError(null);
                if (e.target.files && e.target.files[0]) {
                  const selected = e.target.files[0];
                  const check = validateUploadFile(selected, PAYMENT_RECEIPT_UPLOAD_RULES);
                  if (!check.isValid) {
                    setError(check.error!);
                    setReceiptFile(null);
                    setFileName('');
                    return;
                  }
                  setReceiptFile(selected);
                  setFileName(check.sanitizedFileName || selected.name);
                }
              }}
              className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
            />
            {fileName && <span className="text-[11px] text-emerald-600 block">Attached: {fileName}</span>}
          </div>

          {error && (
            <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              disabled={uploading}
              onClick={() => setUploadModalOpen(false)}
              className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={uploading || !receiptFile}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Uploading Proof...</span>
                </>
              ) : (
                <span>Submit for Verification</span>
              )}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
