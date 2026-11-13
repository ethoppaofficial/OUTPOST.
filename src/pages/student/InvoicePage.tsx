/**
 * @file InvoicePage.tsx
 * @module pages/student/InvoicePage
 * @description Official student accommodation fee invoice and bank payment slip.
 *
 * Capabilities:
 * - Official Invoice Presentation: Details student registration number, academic session, accommodation unit fee, and due date.
 * - Landlord Verified Bank Credentials: Displays landlord account number, bank name, and account holder for direct transfer.
 * - Print-Optimized Layout: Formatted with print media queries (`no-print` classes) for physical receipting or PDF export.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Printer, ArrowLeft, Building2, Loader2, RefreshCw, Copy, Check, AlertTriangle } from 'lucide-react';
import { reservationService } from '../../application/services/reservationService';
import { Invoice } from '../../domain/types';

export const InvoicePage: React.FC = () => {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const [invoice, setInvoice] = useState<Invoice | undefined>(() =>
    reservationService.getInvoiceById(invoiceId || '')
  );
  const [loading, setLoading] = useState<boolean>(!invoice);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copiedAccount, setCopiedAccount] = useState<boolean>(false);

  const loadInvoice = useCallback(async () => {
    if (!invoiceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const live = await reservationService.loadInvoiceById(invoiceId);
      if (live) setInvoice(live);
    } catch (err: any) {
      setLoadError(err?.message || 'Could not load invoice document.');
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    void loadInvoice();
  }, [loadInvoice]);

  if (loading && !invoice) {
    return (
      <div className="py-12 flex items-center justify-center gap-2 text-xs text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
        <span>Loading official invoice…</span>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="text-center py-12 space-y-3">
        <p className="text-sm text-slate-500">{loadError || 'Invoice document not found.'}</p>
        <Link to="/student/reservations" className="text-xs text-emerald-600 font-semibold underline">
          Back to Reservations
        </Link>
      </div>
    );
  }

  const items = invoice.items || [
    { description: `${invoice.unitName || 'Room'} Reservation (Academic Session)`, amount: invoice.amount },
  ];
  const totalAmount = invoice.totalAmount ?? invoice.amount;

  const handlePrint = () => {
    window.print();
  };

  const hasVerifiedBankDetails = Boolean(
    invoice.bankDetails?.bankName && invoice.bankDetails?.accountNumber
  );

  const handleCopyAccountNumber = async () => {
    const acct = invoice.bankDetails?.accountNumber;
    if (!acct) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(acct);
      }
      setCopiedAccount(true);
      setTimeout(() => setCopiedAccount(false), 2500);
    } catch {
      // Clipboard unavailable
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Top Action Bar */}
      <div className="flex items-center justify-between no-print">
        <Link
          to={`/student/reservations/${invoice.reservationId}`}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Reservation</span>
        </Link>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadInvoice()}
            disabled={loading}
            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            onClick={handlePrint}
            className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs"
          >
            <Printer className="w-4 h-4" />
            <span>Print / Save PDF</span>
          </button>
        </div>
      </div>

      {/* Printable Invoice Paper Sheet */}
      <div className="bg-white text-slate-900 p-8 sm:p-12 rounded-3xl border border-slate-200 shadow-xl space-y-8 print:border-none print:shadow-none print:p-0">
        {/* Invoice Header */}
        <div className="flex justify-between items-start border-b border-slate-100 pb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 rounded-lg bg-slate-950 text-white flex items-center justify-center font-black text-sm">
                O
              </div>
              <span className="font-extrabold tracking-tight text-lg text-slate-950">OUTPOST</span>
            </div>
            <p className="text-[11px] text-slate-500">Off-Campus Student Accommodation Platform (BUK Case Study)</p>
            <p className="text-[11px] text-slate-500">Dambare & Rimin Gata, Kano State, Nigeria</p>
          </div>

          <div className="text-right space-y-1">
            <span className="text-xs font-bold uppercase tracking-widest text-emerald-600">Official Invoice</span>
            <div className="text-base font-black font-mono">{invoice.invoiceNumber}</div>
            <div className="text-xs text-slate-500">
              Date: {new Date(invoice.createdAt).toLocaleDateString()}
            </div>
            <div className="text-xs font-medium text-amber-600">
              Due Date: {new Date(invoice.dueDate).toLocaleDateString()}
            </div>
          </div>
        </div>

        {/* Bill To & Property Details */}
        <div className="grid grid-cols-2 gap-6 text-xs">
          <div>
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
              Billed To (Student):
            </span>
            <div className="font-bold text-sm text-slate-900">{invoice.studentName}</div>
            <div className="text-slate-600 font-mono">Reg: {invoice.registrationNumber}</div>
            <div className="text-slate-600">{invoice.university}</div>
          </div>

          <div className="text-right sm:text-left">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
              Accommodation Provider:
            </span>
            <div className="font-bold text-sm text-slate-900">{invoice.landlordName}</div>
            <div className="text-slate-600">Verified Landlord Partner</div>
            <div className="text-slate-600">Property: {invoice.propertyTitle}</div>
          </div>
        </div>

        {/* Itemized Line Items */}
        <div className="space-y-3">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b-2 border-slate-200 text-slate-400 text-[11px] font-semibold uppercase">
                <th className="py-2">Description</th>
                <th className="py-2 text-right">Amount (₦ NGN)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item, idx) => (
                <tr key={idx}>
                  <td className="py-3 font-medium text-slate-800">{item.description}</td>
                  <td className="py-3 text-right font-mono font-semibold text-slate-900">
                    ₦{item.amount.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="pt-4 border-t border-slate-200 flex justify-end">
            <div className="w-64 space-y-2 text-xs">
              <div className="flex justify-between text-slate-500">
                <span>Subtotal:</span>
                <span className="font-mono">₦{totalAmount.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Platform Commission:</span>
                <span className="text-emerald-600 font-medium">₦0.00 (Free)</span>
              </div>
              <div className="flex justify-between text-base font-black text-slate-900 pt-2 border-t border-slate-200">
                <span>Total Payable:</span>
                <span className="text-emerald-600 font-mono">
                  ₦{totalAmount.toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Direct Landlord Bank Payment Details */}
        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5 text-xs">
          <div className="flex items-center gap-2 text-slate-900 font-bold">
            <Building2 className="w-4 h-4 text-emerald-600" />
            <span>Landlord Direct Bank Transfer Instructions</span>
          </div>

          {hasVerifiedBankDetails ? (
            <>
              <p className="text-[11px] text-slate-600">
                Please verify the beneficiary details in your banking app before transferring{' '}
                <strong>₦{totalAmount.toLocaleString()}</strong> directly to the landlord account below:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-xs pt-1">
                <div>
                  <span className="text-slate-400 text-[10px] block font-sans">Bank:</span>
                  <span className="font-bold text-slate-900">{invoice.bankDetails.bankName}</span>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px] block font-sans">Account Number:</span>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-emerald-700">{invoice.bankDetails.accountNumber}</span>
                    <button
                      type="button"
                      onClick={() => void handleCopyAccountNumber()}
                      className="no-print inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-slate-200 font-sans text-[10px] font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
                    >
                      {copiedAccount ? (
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
                  <span className="text-slate-400 text-[10px] block font-sans">Payment Ref:</span>
                  <span className="font-bold text-slate-900">{invoice.invoiceNumber}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-[11px] text-slate-600 pt-1">
                {invoice.bankDetails.accountName && (
                  <p>
                    Account Name: <strong className="text-slate-900">{invoice.bankDetails.accountName}</strong>
                  </p>
                )}
                {invoice.bankDetails.accountType && (
                  <p className="capitalize">
                    Account Type: <strong className="text-slate-900">{invoice.bankDetails.accountType}</strong>
                  </p>
                )}
              </div>
              {invoice.bankDetails.paymentInstructions && (
                <p className="text-[11px] text-slate-600 pt-1 border-t border-slate-200/70">
                  <strong>Instructions:</strong> {invoice.bankDetails.paymentInstructions}
                </p>
              )}
            </>
          ) : (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[11px] flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>
                <strong>Payment Account Not Yet Configured:</strong> The landlord has not yet added active direct bank transfer details. Please message the landlord on OUTPOST before initiating any transfer.
              </span>
            </div>
          )}
        </div>

        {/* Footer notes */}
        <div className="text-[10px] text-slate-400 text-center space-y-1 pt-4 border-t border-slate-100">
          <p>Thank you for choosing verified student housing with OUTPOST.</p>
          <p>This is a computer-generated tax invoice and requires no physical signature.</p>
        </div>
      </div>
    </div>
  );
};
