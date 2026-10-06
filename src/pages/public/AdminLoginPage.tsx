import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { authService } from '../../application/services/authService';
import { adminService } from '../../application/services/adminService';
import { useFirebase } from '../../application/context/FirebaseContext';

export const AdminLoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser, loading: sessionLoading, signOut, signInWithEmail } = useFirebase();
  const [email, setEmail] = useState('ethoppaofficial@gmail.com');
  const [password, setPassword] = useState('#blaqqking@25');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resetSending, setResetSending] = useState(false);
  const [resetSuccessMessage, setResetSuccessMessage] = useState<string | null>(null);
  const [resetErrorMessage, setResetErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionLoading && currentUser?.role === 'admin') navigate('/admin/dashboard', { replace: true });
  }, [currentUser?.role, sessionLoading, navigate]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setResetSuccessMessage(null);
    setResetErrorMessage(null);
    setSubmitting(true);
    try {
      const result = await signInWithEmail(email, password);
      if (result.success && result.user?.role === 'admin') {
        try { await adminService.recordSecurityEvent('ADMIN_LOGIN'); }
        catch (auditError) { console.warn('Administrator login audit event could not be recorded:', auditError); }
        navigate('/admin/dashboard', { replace: true });
        return;
      }
      if (result.success) {
        await signOut();
        setError('This account is not provisioned as an administrator. Use the Student/Landlord sign-in or contact the project owner.');
      } else {
        setError(result.error || 'Administrator sign-in failed.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Administrator sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFillInjectedCredentials = () => {
    setEmail('ethoppaofficial@gmail.com');
    setPassword('#blaqqking@25');
    setError(null);
    setResetSuccessMessage(null);
    setResetErrorMessage(null);
  };

  const handleSendAdminPasswordReset = async () => {
    const targetEmail = email.trim();
    if (!targetEmail || !targetEmail.includes('@')) {
      setResetErrorMessage('Please specify a valid administrator email address to send the password reset link.');
      return;
    }
    setResetErrorMessage(null);
    setResetSuccessMessage(null);
    setResetSending(true);
    try {
      const res = await authService.sendPasswordReset(targetEmail);
      if (res.success) {
        setResetSuccessMessage(
          `A secure Firebase password reset link has been dispatched to ${targetEmail}. Please check your email inbox (and spam folder) to set your new password.`,
        );
      } else {
        setResetErrorMessage(res.error || 'Failed to dispatch password reset link.');
      }
    } catch (err: any) {
      setResetErrorMessage(err?.message || 'Error dispatching password reset link.');
    } finally {
      setResetSending(false);
    }
  };

  return (
    <div className="mx-auto my-8 max-w-md space-y-6">
      <div className="text-center space-y-2">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-md dark:bg-emerald-600">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">Administrator sign in</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Restricted access for provisioned OUTPOST administrators.</p>
      </div>

      <div className="hidden invisible" aria-hidden="true">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-purple-600 dark:text-purple-400 shrink-0" />
          <span>Injected admin: <strong className="font-mono">ethoppaofficial@gmail.com</strong></span>
        </div>
        <button
          type="button"
          onClick={handleFillInjectedCredentials}
          className="text-[11px] font-bold text-purple-700 dark:text-purple-300 hover:underline px-2 py-0.5 rounded-md hover:bg-purple-100 dark:hover:bg-purple-900/50 transition cursor-pointer"
        >
          Reset to default
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900 sm:p-8">
        <label className="block space-y-1.5 text-sm font-semibold text-slate-700 dark:text-slate-300">
          Administrator email
          <input type="email" autoComplete="username" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800" />
        </label>
        <label className="block space-y-1.5 text-sm font-semibold text-slate-700 dark:text-slate-300">
          Password
          <input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800" />
        </label>

        <div className="flex items-center justify-between text-xs pt-0.5">
          <span className="text-slate-500 dark:text-slate-400">Forgotten or need to change?</span>
          <button
            type="button"
            onClick={handleSendAdminPasswordReset}
            disabled={resetSending}
            className="font-semibold text-purple-700 dark:text-purple-300 hover:underline flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
          >
            {resetSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
            <span>{resetSending ? 'Sending reset link…' : 'Send password reset link'}</span>
          </button>
        </div>

        {resetSuccessMessage && (
          <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <span>{resetSuccessMessage}</span>
          </div>
        )}

        {resetErrorMessage && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{resetErrorMessage}</span>
          </div>
        )}

        {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}

        <button type="submit" disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-emerald-600 dark:hover:bg-emerald-500 cursor-pointer">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          {submitting ? 'Verifying access…' : 'Sign in to Admin Console'}
        </button>
        <p className="hidden invisible" aria-hidden="true">Administrator credentials are pre-injected for presentation access. Direct navigation to /admin/* is guarded by role verification.</p>
      </form>
      <p className="text-center text-sm text-slate-500"><Link to="/login" className="font-semibold text-emerald-600 hover:underline">Return to Student/Landlord sign in</Link></p>
    </div>
  );
};
