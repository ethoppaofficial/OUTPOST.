import React, { useState } from 'react';
import { ShieldCheck, KeyRound, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { useAuth } from '../../application/context/AuthContext';
import { authService } from '../../application/services/authService';

export const AdminAccountPage: React.FC = () => {
  const { currentUser, authUser } = useAuth();
  const [sendingReset, setSendingReset] = useState(false);
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  const adminEmail = authUser?.email || currentUser?.email || '';

  const handleSendResetEmail = async () => {
    if (!adminEmail) {
      setResetError('No administrator email address associated with the active session.');
      return;
    }
    setResetSuccess(null);
    setResetError(null);
    setSendingReset(true);
    try {
      const res = await authService.sendPasswordReset(adminEmail);
      if (res.success) {
        setResetSuccess(
          `A secure password reset link has been dispatched to ${adminEmail}. Follow the link in your email to set a new password.`,
        );
      } else {
        setResetError(res.error || 'Failed to dispatch password reset email.');
      }
    } catch (err: any) {
      setResetError(err?.message || 'Error requesting password reset.');
    } finally {
      setSendingReset(false);
    }
  };

  return (
    <section className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white">Administrator account</h1>
        <p className="mt-1 text-sm text-slate-500">Account identity, credentials, and password management.</p>
      </header>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900 space-y-6">
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-purple-100 p-3 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div>
            <p className="font-bold text-slate-900 dark:text-white">Administrator</p>
            <p className="text-xs text-slate-500">Designated platform operator: {adminEmail}</p>
          </div>
        </div>

        <dl className="grid gap-4 text-sm sm:grid-cols-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div>
            <dt className="text-xs text-slate-500">Name</dt>
            <dd className="mt-1 font-semibold text-slate-900 dark:text-white">{currentUser?.fullName || 'Administrator'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Email Address</dt>
            <dd className="mt-1 font-semibold font-mono text-xs text-slate-900 dark:text-white">{adminEmail}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Email verified</dt>
            <dd className="mt-1 font-semibold text-slate-900 dark:text-white">{firebaseUser?.emailVerified ? 'Yes' : 'Yes (Designated)'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Role Status</dt>
            <dd className="mt-1 font-semibold text-emerald-600 dark:text-emerald-400">Active Administrator</dd>
          </div>
        </dl>
      </div>

      {/* Password Management & Reset Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900 space-y-4">
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-amber-100 p-3 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            <KeyRound className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-bold text-slate-900 dark:text-white">Security & Password Management</h2>
            <p className="text-xs text-slate-500">Enforce or change administrator password via Firebase Authentication</p>
          </div>
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          Need to change or recover the administrator password? Requesting a reset link will dispatch an official, time-limited Firebase password change link directly to <strong>{adminEmail}</strong>.
        </p>

        {resetSuccess && (
          <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <span>{resetSuccess}</span>
          </div>
        )}

        {resetError && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{resetError}</span>
          </div>
        )}

        <button
          type="button"
          onClick={handleSendResetEmail}
          disabled={sendingReset}
          className="inline-flex items-center gap-2 rounded-xl bg-purple-700 hover:bg-purple-800 px-4 py-2.5 text-xs font-semibold text-white transition disabled:opacity-60 cursor-pointer shadow-xs"
        >
          {sendingReset ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          <span>{sendingReset ? 'Sending recovery link…' : `Send password reset email to ${adminEmail}`}</span>
        </button>
      </div>
    </section>
  );
};
