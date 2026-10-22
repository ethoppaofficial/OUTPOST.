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

import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { Printer, ArrowLeft, Building2, CheckCircle2, ShieldCheck } from 'lucide-react';
import { reservationService } from '../../application/services/reservationService';
import { authService } from '../../application/services/authService';

export const InvoicePage: React.FC = () => {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const invoice = reservationService.getInvoiceById(invoiceId || '');

  if (!invoice) {
    return (
      <div className="text-center py-12 space-y-3">
        <p className="text-sm text-slate-500">Invoice document not found.</p>
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

        <button
          onClick={handlePrint}
          className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs"
        >
          <Printer className="w-4 h-4" />
          <span>Print / Save PDF</span>
        </button>
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

        {/* Bank Wire Payment Details */}
        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
          <div className="flex items-center gap-2 text-slate-900 font-bold">
            <Building2 className="w-4 h-4 text-emerald-600" />
            <span>Bank Transfer Instructions</span>
          </div>
          <p className="text-[11px] text-slate-600">
            Please make transfer to the following verified escrow account:
          </p>
          <div className="grid grid-cols-3 gap-2 font-mono text-xs pt-1">
            <div>
              <span className="text-slate-400 text-[10px] block">Bank:</span>
              <span className="font-bold">GTBank</span>
            </div>
            <div>
              <span className="text-slate-400 text-[10px] block">Account No:</span>
              <span className="font-bold text-emerald-600">0249182391</span>
            </div>
            <div>
              <span className="text-slate-400 text-[10px] block">Payment Ref:</span>
              <span className="font-bold">{invoice.invoiceNumber}</span>
            </div>
          </div>
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
