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

import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import {
  Clock,
  FileText,
  Upload,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  Building,
  Loader2,
  RefreshCw,
  Eye,
  Copy,
  Check,
  ShieldAlert,
  Landmark,
  Trash2,
} from 'lucide-react';
import { authService } from '../../application/services/authService';
import { useAuth } from '../../application/context/AuthContext';
import { reservationService } from '../../application/services/reservationService';
import { storageService } from '../../application/services/storageService';
import { ReservationStatusBadge, ReceiptStatusBadge, VerificationTick } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Invoice, PaymentReceipt, Reservation } from '../../domain/types';
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
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { currentUser, loading: authLoading } = useAuth();
  const fallbackSession = authService.getSession();
  const activeUser = currentUser || fallbackSession.user;

  const [reservation, setReservation] = useState<Reservation | undefined>(() =>
    reservationService.getReservationById(reservationId || '')
  );
  const [liveInvoice, setLiveInvoice] = useState<Invoice | undefined>(() =>
    reservation?.invoiceId
      ? reservationService.getInvoiceById(reservation.invoiceId)
      : reservationService.getInvoiceByReservationId(reservationId || '')
  );
  const [receipt, setReceipt] = useState<PaymentReceipt | undefined>(() =>
    reservationService.getReceiptForReservation(reservationId || '')
  );
  const [loadingPage, setLoadingPage] = useState<boolean>(!reservation);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [payerBank, setPayerBank] = useState('GTBank');
  const [reference, setReference] = useState('');
  const [amountPaid, setAmountPaid] = useState<number>(reservation?.amount || 0);
  const [fileName, setFileName] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [viewingReceiptUrl, setViewingReceiptUrl] = useState<string | null>(null);
  const [loadingReceiptPreview, setLoadingReceiptPreview] = useState(false);
  const [copiedField, setCopiedField] = useState<'account' | 'reference' | null>(null);

  const handleCopyText = async (value: string, field: 'account' | 'reference') => {
    if (!value) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else if (typeof document !== 'undefined') {
        const el = document.createElement('textarea');
        el.value = value;
        el.setAttribute('readonly', '');
        el.style.position = 'absolute';
        el.style.left = '-9999px';
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }
      setCopiedField(field);
      setTimeout(() => {
        setCopiedField((prev) => (prev === field ? null : prev));
      }, 2500);
    } catch {
      // Clipboard API unavailable
    }
  };

  const loadDetail = useCallback(async () => {
    if (!reservationId || authLoading) return;
    setLoadingPage(true);
    setLoadError(null);
    try {
      const bundle = await reservationService.loadReservationDetail(reservationId);
      if (bundle) {
        setReservation(bundle.reservation);
        setLiveInvoice(bundle.invoice);
        setReceipt(bundle.receipt);
        setAmountPaid((prev) => (prev > 0 ? prev : bundle.reservation.amount));
      }
    } catch (err: unknown) {
      const normalized = normalizeError(err, 'Could not load reservation details.');
      setLoadError(normalized.userMessage);
    } finally {
      setLoadingPage(false);
    }
  }, [reservationId, authLoading]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  if (loadingPage && !reservation) {
    return (
      <div className="max-w-3xl mx-auto py-12 flex items-center justify-center gap-2 text-xs text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
        <span>Loading reservation details…</span>
      </div>
    );
  }

  if (!reservation) {
    return (
      <div className="text-center py-12 space-y-3">
        <p className="text-sm text-slate-500">{loadError || 'Reservation not found.'}</p>
        <Link to="/student/reservations" className="text-xs text-emerald-600 font-semibold underline">
          Back to my reservations
        </Link>
      </div>
    );
  }

  // Tenant Boundary Check: Student can only view their own reservation
  const isAuthorizedStudent = reservation.studentId === activeUser.id;
  if (!isAuthorizedStudent && activeUser.role !== 'admin') {
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
  const invoice =
    liveInvoice ||
    (reservation.invoiceId
      ? reservationService.getInvoiceById(reservation.invoiceId)
      : reservationService.getInvoiceByReservationId(reservation.id));

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
  const isPayNowMode =
    searchParams.get('mode') === 'pay_now' || reservation.reservationMode === 'pay_now';

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
      const res = await reservationService.submitPaymentReceiptWithStorage({
        reservationId: reservation.id,
        file: receiptFile,
        originalFileName: fileValidation.sanitizedFileName || receiptFile.name,
        amountPaid: Number(amountPaid),
        paymentReference: reference.trim(),
        payerBankName: payerBank,
      });

      if (res.success && res.receipt) {
        setReceipt(res.receipt);
        await loadDetail();
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

  const handleViewReceiptEvidence = async () => {
    if (!receipt?.id) return;
    setLoadingReceiptPreview(true);
    setError(null);
    try {
      const signedUrl = await storageService.getPrivateAssetDownloadUrl('payment-receipt', receipt.id);
      setViewingReceiptUrl(signedUrl);
    } catch (err: unknown) {
      const normalized = normalizeError(err, 'Unable to load private receipt preview.');
      setError(normalized.userMessage);
    } finally {
      setLoadingReceiptPreview(false);
    }
  };

  const handleCancelReservation = async () => {
    setCancelling(true);
    setError(null);
    try {
      const res = await reservationService.cancelReservationPersisted(reservation.id);
      if (res.success) {
        await loadDetail();
        setConfirmCancel(false);
        setSuccess(res.message || 'Reservation cancelled and bed-space released.');
      } else {
        setError(res.message || 'Could not cancel reservation hold.');
      }
    } catch (err: unknown) {
      const normalized = normalizeError(err, 'Could not cancel reservation hold.');
      setError(normalized.userMessage);
    } finally {
      setCancelling(false);
    }
  };

  const handleDeleteReservation = async () => {
    setDeleting(true);
    setError(null);
    try {
      const res = await reservationService.deleteReservationPersisted(reservation.id);
      if (res.success) {
        navigate('/student/reservations');
      } else {
        setError(res.message || 'Could not delete reservation.');
      }
    } catch (err: unknown) {
      const normalized = normalizeError(err, 'Could not delete reservation.');
      setError(normalized.userMessage);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-2">
        <Link
          to="/student/reservations"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to My Reservations</span>
        </Link>

        <button
          type="button"
          onClick={() => void loadDetail()}
          disabled={loadingPage}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingPage ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {loadError && (
        <div role="alert" className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 text-rose-700 text-xs">
          {loadError}
        </div>
      )}

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

        {/* Pay Now / 7-Day Hold Countdown Bar */}
        {isPayNowMode && reservation.status === 'pending_payment' && !isExpired && (
          <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <Landmark className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-xs font-bold text-emerald-900 dark:text-emerald-200">
                  Direct Bank Transfer — Pay Now Mode
                </h4>
                <p className="text-[11px] text-emerald-800 dark:text-emerald-300 mt-0.5">
                  This room is locked exclusively while you transfer{' '}
                  <strong>₦{reservation.amount.toLocaleString()}</strong> to the landlord account below and upload your receipt. Confirmation occurs only after landlord verification.
                </p>
              </div>
            </div>

            {canUploadReceipt && (
              <button
                type="button"
                onClick={() => setUploadModalOpen(true)}
                className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs whitespace-nowrap cursor-pointer"
              >
                I Have Paid — Upload Receipt
              </button>
            )}
          </div>
        )}

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
            {reservation.landlordId ? (
              <Link
                to={`/profiles/landlord/${reservation.landlordId}`}
                className="inline-flex items-center gap-1.5 font-semibold text-slate-900 dark:text-white hover:text-emerald-600 dark:hover:text-emerald-400 hover:underline"
              >
                <span>{reservation.landlordName || 'OUTPOST Host'}</span>
                <VerificationTick type="landlord" isVerified={Boolean(reservation.landlordVerified)} />
              </Link>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900 dark:text-white">
                <span>{reservation.landlordName || 'OUTPOST Host'}</span>
                <VerificationTick type="landlord" isVerified={Boolean(reservation.landlordVerified)} />
              </span>
            )}
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/80 text-xs">
              <div>
                <span className="text-slate-400 text-[11px] block">Beneficiary Bank:</span>
                <span className="font-bold text-slate-800 dark:text-slate-200">{bankDetails.bankName}</span>
              </div>
              <div>
                <span className="text-slate-400 text-[11px] block">Account Number:</span>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                    {bankDetails.accountNumber}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleCopyText(bankDetails.accountNumber, 'account')}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
                  >
                    {copiedField === 'account' ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-600" />
                        <span className="text-emerald-600">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
              <div>
                <span className="text-slate-400 text-[11px] block">Beneficiary Name:</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {bankDetails.accountName}
                </span>
              </div>
              <div>
                <span className="text-slate-400 text-[11px] block">Amount &amp; Reference:</span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-bold text-slate-900 dark:text-white">
                    ₦{reservation.amount.toLocaleString()}
                  </span>
                  <span className="text-slate-400">•</span>
                  <button
                    type="button"
                    onClick={() =>
                      void handleCopyText(invoice?.invoiceNumber || reservation.reservationNumber, 'reference')
                    }
                    className="inline-flex items-center gap-1 font-mono font-semibold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                    title="Copy transfer reference"
                  >
                    <span>{invoice?.invoiceNumber || reservation.reservationNumber}</span>
                    {copiedField === 'reference' ? (
                      <Check className="w-3 h-3" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>
              </div>
              {bankDetails.accountType && (
                <div className="sm:col-span-2 lg:col-span-4 pt-2 border-t border-slate-200/70 dark:border-slate-700/70">
                  <span className="text-slate-400 text-[11px]">Account Type: </span>
                  <span className="font-semibold text-slate-700 dark:text-slate-200 capitalize">
                    {bankDetails.accountType} Account
                  </span>
                </div>
              )}
            </div>

            {bankDetails.paymentInstructions && (
              <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed bg-slate-50/70 dark:bg-slate-800/40 px-3.5 py-2.5 rounded-xl border border-slate-200/60 dark:border-slate-800">
                <strong className="text-slate-800 dark:text-slate-200">Landlord Instructions: </strong>
                {bankDetails.paymentInstructions}
              </p>
            )}

            <div className="p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/70 dark:border-amber-900/50 text-[11px] text-amber-900 dark:text-amber-200 flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                Verify that the beneficiary name (<strong className="font-semibold">{bankDetails.accountName}</strong>) and bank (<strong className="font-semibold">{bankDetails.bankName}</strong>) match in your banking app before transferring{' '}
                <strong>₦{reservation.amount.toLocaleString()}</strong> using reference{' '}
                <strong className="font-mono">{invoice?.invoiceNumber || reservation.reservationNumber}</strong>, then upload your receipt below.
              </span>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/80 text-xs text-amber-800 dark:text-amber-300 space-y-1">
            <p className="font-bold">Landlord Payment Information Unavailable</p>
            <p className="text-[11px]">
              The landlord has not yet configured active direct bank transfer details for this reservation. Do not transfer funds to an unverified account — contact the landlord via OUTPOST chat until payment details are configured.
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

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => void handleViewReceiptEvidence()}
                disabled={loadingReceiptPreview}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
              >
                {loadingReceiptPreview ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5 text-emerald-600" />}
                <span>View Uploaded Receipt</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Cancellation & deletion options (inline iframe-safe confirmation) */}
      {reservation.status !== 'confirmed' && (
        <div className="flex flex-wrap items-center justify-end gap-4">
          {reservation.status === 'pending_payment' && !isExpired && (
            confirmCancel ? (
              <div className="flex flex-wrap items-center justify-end gap-2 p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-xs">
                <span className="text-amber-800 dark:text-amber-200 font-medium">
                  Release this bed-space immediately?
                </span>
                <button
                  type="button"
                  onClick={() => setConfirmCancel(false)}
                  className="px-3 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-semibold cursor-pointer"
                >
                  Keep Hold
                </button>
                <button
                  type="button"
                  disabled={cancelling}
                  onClick={() => void handleCancelReservation()}
                  className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold cursor-pointer disabled:opacity-50"
                >
                  {cancelling ? 'Cancelling…' : 'Confirm Cancel'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setConfirmDelete(false);
                  setConfirmCancel(true);
                }}
                className="text-xs text-amber-600 hover:text-amber-800 dark:text-amber-400 font-medium cursor-pointer"
              >
                Cancel this reservation hold
              </button>
            )
          )}

          {confirmDelete ? (
            <div className="flex flex-wrap items-center justify-end gap-2 p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-xs">
              <span className="text-rose-700 dark:text-rose-300 font-medium">
                {reservation.status === 'pending_payment' || reservation.status === 'receipt_submitted'
                  ? 'Delete this reserved accommodation and release space?'
                  : 'Permanently delete this reservation?'}
              </span>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="px-3 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-semibold cursor-pointer"
              >
                Keep
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void handleDeleteReservation()}
                className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold cursor-pointer disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Confirm Delete'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setConfirmCancel(false);
                setConfirmDelete(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/30 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-100 font-semibold cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Reservation</span>
            </button>
          )}
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

      {/* Signed Private Receipt Viewer Modal */}
      <Modal
        isOpen={Boolean(viewingReceiptUrl)}
        onClose={() => setViewingReceiptUrl(null)}
        title="Uploaded Payment Receipt"
      >
        <div className="space-y-3 text-xs">
          <div className="rounded-2xl overflow-hidden bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 min-h-[240px] max-h-[65vh] flex items-center justify-center p-2">
            {viewingReceiptUrl?.toLowerCase().includes('.pdf') ? (
              <iframe src={viewingReceiptUrl} className="w-full h-96 rounded-xl border-0" title="Uploaded Receipt PDF" />
            ) : (
              <img src={viewingReceiptUrl || ''} alt="Uploaded Payment Receipt" className="max-h-[60vh] object-contain rounded-xl" />
            )}
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setViewingReceiptUrl(null)}
              className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
