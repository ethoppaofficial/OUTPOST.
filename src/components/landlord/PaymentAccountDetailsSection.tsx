/**
 * @file PaymentAccountDetailsSection.tsx
 * @module components/landlord/PaymentAccountDetailsSection
 * @description Dashboard section enabling landlords to configure, view (masked with reveal control),
 * and update their receiving Nigerian bank account details for direct student transfers.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Landmark,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  Edit3,
  ShieldCheck,
  Loader2,
  X,
} from 'lucide-react';
import { paymentAccountService } from '../../application/services/paymentAccountService';
import {
  NIGERIAN_BANKS,
  maskAccountNumber,
  validateLandlordPaymentDetails,
} from '../../application/utils/validation';
import { BankAccountType, LandlordPaymentAccount } from '../../domain/types';

interface PaymentAccountDetailsSectionProps {
  landlordId?: string;
}

const OTHER_BANK_VALUE = '__OTHER__';

export const PaymentAccountDetailsSection: React.FC<PaymentAccountDetailsSectionProps> = ({
  landlordId,
}) => {
  const [savedAccount, setSavedAccount] = useState<LandlordPaymentAccount | null>(() =>
    landlordId ? paymentAccountService.getCachedPaymentAccount(landlordId) || null : null
  );
  const [loading, setLoading] = useState<boolean>(Boolean(landlordId && landlordId !== 'anonymous'));
  const [saving, setSaving] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [revealNumber, setRevealNumber] = useState<boolean>(false);

  const [accountHolderName, setAccountHolderName] = useState('');
  const [selectedBank, setSelectedBank] = useState<string>('');
  const [customBankName, setCustomBankName] = useState<string>('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountType, setAccountType] = useState<BankAccountType | ''>('');
  const [paymentInstructions, setPaymentInstructions] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<string | null>(null);

  const populateFormFromAccount = useCallback((acct: LandlordPaymentAccount | null) => {
    if (!acct) {
      setAccountHolderName('');
      setSelectedBank('');
      setCustomBankName('');
      setAccountNumber('');
      setAccountType('');
      setPaymentInstructions('');
      return;
    }

    setAccountHolderName(acct.accountHolderName || '');
    const isKnownBank = (NIGERIAN_BANKS as readonly string[]).includes(acct.bankName);
    if (isKnownBank) {
      setSelectedBank(acct.bankName);
      setCustomBankName('');
    } else if (acct.bankName) {
      setSelectedBank(OTHER_BANK_VALUE);
      setCustomBankName(acct.bankName);
    } else {
      setSelectedBank('');
      setCustomBankName('');
    }
    setAccountNumber(acct.accountNumber || '');
    setAccountType(acct.accountType || '');
    setPaymentInstructions(acct.paymentInstructions || '');
  }, []);

  const loadAccount = useCallback(async () => {
    if (!landlordId || landlordId === 'anonymous') {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const acct = await paymentAccountService.loadMyPaymentAccount(landlordId);
      setSavedAccount(acct);
      populateFormFromAccount(acct);
      setIsEditing(!acct);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Unable to load saved payment account details.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [landlordId, populateFormFromAccount]);

  useEffect(() => {
    void loadAccount();
  }, [loadAccount]);

  const effectiveBankName =
    selectedBank === OTHER_BANK_VALUE ? customBankName : selectedBank;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!landlordId || landlordId === 'anonymous') return;

    setError(null);
    setSuccess(null);

    const validation = validateLandlordPaymentDetails({
      accountHolderName,
      bankName: effectiveBankName,
      accountNumber,
      accountType,
      paymentInstructions,
    });

    if (!validation.isValid) {
      setFieldErrors(validation.fieldErrors as Record<string, string>);
      setError(validation.error || 'Please review the highlighted bank account fields.');
      return;
    }

    setFieldErrors({});
    setSaving(true);
    try {
      const res = await paymentAccountService.saveMyPaymentAccount(landlordId, {
        accountHolderName: validation.normalized.accountHolderName,
        bankName: validation.normalized.bankName,
        accountNumber: validation.normalized.accountNumber,
        accountType: validation.normalized.accountType || '',
        paymentInstructions: validation.normalized.paymentInstructions || '',
      });

      if (!res.success || !res.account) {
        setError(res.error || 'Could not save payment account details.');
        return;
      }

      setSavedAccount(res.account);
      populateFormFromAccount(res.account);
      setIsEditing(false);
      setRevealNumber(false);
      setSuccess(
        savedAccount
          ? 'Payment account details updated. New reservations will use these receiving details.'
          : 'Payment account details saved. Students reserving your listings can now view transfer instructions.'
      );
      setTimeout(() => setSuccess(null), 6000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save payment account details.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setError(null);
    setFieldErrors({});
    populateFormFromAccount(savedAccount);
    setIsEditing(false);
  };

  const formatAccountType = (type?: BankAccountType | null) => {
    if (!type) return null;
    if (type === 'savings') return 'Savings Account';
    if (type === 'current') return 'Current Account';
    if (type === 'corporate') return 'Corporate / Business Account';
    return type;
  };

  return (
    <section
      aria-labelledby="landlord-payment-account-heading"
      className="p-6 sm:p-7 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-5"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 shrink-0">
            <Landmark className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2
                id="landlord-payment-account-heading"
                className="text-base font-bold text-slate-900 dark:text-white"
              >
                Payment Account Details
              </h2>
              {loading ? (
                <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-500">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Checking</span>
                </span>
              ) : savedAccount ? (
                <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-900">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Saved &amp; Active</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200/70 dark:border-amber-900">
                  <AlertCircle className="w-3 h-3" />
                  <span>Not Configured</span>
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Provide the Nigerian bank account where students should transfer accommodation fees directly.
            </p>
          </div>
        </div>

        {savedAccount && !isEditing && !loading && (
          <button
            type="button"
            onClick={() => {
              setSuccess(null);
              setError(null);
              setFieldErrors({});
              setIsEditing(true);
            }}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition shrink-0"
          >
            <Edit3 className="w-3.5 h-3.5 text-emerald-600" />
            <span>Update Account Details</span>
          </button>
        )}
      </div>

      {success && (
        <div
          role="status"
          className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && !savedAccount ? (
        <div className="py-6 flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
          <span>Loading your saved bank account details…</span>
        </div>
      ) : savedAccount && !isEditing ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/70 dark:border-slate-800 text-xs">
            <div>
              <span className="text-slate-400 text-[11px] block">Account Holder Name</span>
              <span className="font-bold text-slate-900 dark:text-white mt-0.5 block">
                {savedAccount.accountHolderName}
              </span>
            </div>

            <div>
              <span className="text-slate-400 text-[11px] block">Bank Name</span>
              <span className="font-bold text-slate-900 dark:text-white mt-0.5 block">
                {savedAccount.bankName}
              </span>
            </div>

            <div>
              <span className="text-slate-400 text-[11px] block">Account Number</span>
              <div className="flex items-center gap-2 mt-0.5">
                <span
                  data-testid="masked-account-number"
                  className="font-mono font-bold text-sm text-emerald-700 dark:text-emerald-400 tracking-wide"
                >
                  {revealNumber
                    ? savedAccount.accountNumber
                    : maskAccountNumber(savedAccount.accountNumber)}
                </span>
                <button
                  type="button"
                  onClick={() => setRevealNumber((prev) => !prev)}
                  aria-label={revealNumber ? 'Hide account number' : 'Reveal account number'}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  {revealNumber ? (
                    <>
                      <EyeOff className="w-3 h-3" />
                      <span>Hide</span>
                    </>
                  ) : (
                    <>
                      <Eye className="w-3 h-3" />
                      <span>Reveal</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <div>
              <span className="text-slate-400 text-[11px] block">Account Type</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5 block">
                {formatAccountType(savedAccount.accountType) || 'Not specified'}
              </span>
            </div>
          </div>

          {savedAccount.paymentInstructions && (
            <div className="p-3.5 rounded-2xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 text-xs space-y-1">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block">
                Student Transfer Instructions
              </span>
              <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                {savedAccount.paymentInstructions}
              </p>
            </div>
          )}

          <p className="text-[11px] text-slate-400">
            Last updated {new Date(savedAccount.updatedAt).toLocaleDateString()} • Invoices issued before future edits retain their original beneficiary snapshot.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4 text-xs" noValidate>
          {!savedAccount && (
            <div className="p-3.5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-900/50 text-amber-800 dark:text-amber-300 text-xs">
              Students holding reservations for your rooms will see a notice that bank details are unavailable until you save your active payout account below.
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="landlord-account-holder"
                className="font-semibold text-slate-700 dark:text-slate-300 block"
              >
                Account Holder Name <span className="text-rose-500">*</span>
              </label>
              <input
                id="landlord-account-holder"
                type="text"
                required
                disabled={saving}
                maxLength={120}
                value={accountHolderName}
                onChange={(e) => setAccountHolderName(e.target.value)}
                placeholder="e.g. Alhaji Danladi Properties Ltd"
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
              />
              {fieldErrors.accountHolderName && (
                <p className="text-[11px] text-rose-600 dark:text-rose-400">
                  {fieldErrors.accountHolderName}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="landlord-bank-select"
                className="font-semibold text-slate-700 dark:text-slate-300 block"
              >
                Bank Name <span className="text-rose-500">*</span>
              </label>
              <select
                id="landlord-bank-select"
                disabled={saving}
                value={selectedBank}
                onChange={(e) => setSelectedBank(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
              >
                <option value="">Select Nigerian Bank...</option>
                {NIGERIAN_BANKS.map((bank) => (
                  <option key={bank} value={bank}>
                    {bank}
                  </option>
                ))}
                <option value={OTHER_BANK_VALUE}>Other Bank (Specify name)</option>
              </select>

              {selectedBank === OTHER_BANK_VALUE && (
                <input
                  id="landlord-custom-bank"
                  type="text"
                  required
                  disabled={saving}
                  maxLength={100}
                  value={customBankName}
                  onChange={(e) => setCustomBankName(e.target.value)}
                  placeholder="Enter exact bank or microfinance institution name"
                  className="w-full mt-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              )}

              {fieldErrors.bankName && (
                <p className="text-[11px] text-rose-600 dark:text-rose-400">
                  {fieldErrors.bankName}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="landlord-account-number"
                className="font-semibold text-slate-700 dark:text-slate-300 block"
              >
                Account Number <span className="text-rose-500">*</span>
              </label>
              <input
                id="landlord-account-number"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                required
                disabled={saving}
                maxLength={16}
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                placeholder="e.g. 0123456789"
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-mono"
              />
              <p className="text-[11px] text-slate-400">
                10-digit NUBAN standard (or 10–12 digits where your bank uses an extended account format).
              </p>
              {fieldErrors.accountNumber && (
                <p className="text-[11px] text-rose-600 dark:text-rose-400">
                  {fieldErrors.accountNumber}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="landlord-account-type"
                className="font-semibold text-slate-700 dark:text-slate-300 block"
              >
                Account Type <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <select
                id="landlord-account-type"
                disabled={saving}
                value={accountType}
                onChange={(e) => setAccountType(e.target.value as BankAccountType | '')}
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
              >
                <option value="">Not specified</option>
                <option value="savings">Savings Account</option>
                <option value="current">Current Account</option>
                <option value="corporate">Corporate / Business Account</option>
              </select>
              {fieldErrors.accountType && (
                <p className="text-[11px] text-rose-600 dark:text-rose-400">
                  {fieldErrors.accountType}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor="landlord-payment-instructions"
                className="font-semibold text-slate-700 dark:text-slate-300"
              >
                Payment Instructions for Students{' '}
                <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <span className="text-[11px] text-slate-400">
                {paymentInstructions.length}/500
              </span>
            </div>
            <textarea
              id="landlord-payment-instructions"
              rows={2}
              disabled={saving}
              maxLength={500}
              value={paymentInstructions}
              onChange={(e) => setPaymentInstructions(e.target.value)}
              placeholder="e.g. Include your OUTPOST reservation reference or invoice number in the bank transfer narration."
              className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
            />
            {fieldErrors.paymentInstructions && (
              <p className="text-[11px] text-rose-600 dark:text-rose-400">
                {fieldErrors.paymentInstructions}
              </p>
            )}
          </div>

          <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800">
            <p className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>
                Only receiving account details are stored. Never share a PIN, password, OTP, card number, or CVV.
              </span>
            </p>

            <div className="flex items-center justify-end gap-2 shrink-0">
              {savedAccount && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleCancelEdit}
                  className="inline-flex items-center gap-1 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold cursor-pointer disabled:opacity-50"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Cancel</span>
                </button>
              )}

              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow-xs cursor-pointer disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving Account…</span>
                  </>
                ) : (
                  <span>{savedAccount ? 'Save Updated Details' : 'Save Payment Account'}</span>
                )}
              </button>
            </div>
          </div>
        </form>
      )}
    </section>
  );
};
