import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { authService } from '../../application/services/authService';
import { adminService } from '../../application/services/adminService';
import { useFirebase } from '../../application/context/FirebaseContext';

export const AdminLoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser, loading: sessionLoading, signOut } = useFirebase();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!sessionLoading && currentUser?.role === 'admin') navigate('/admin/dashboard', { replace: true });
  }, [currentUser?.role, sessionLoading, navigate]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await authService.loginWithFirebase(email, password);
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

  return (
    <div className="mx-auto my-8 max-w-md space-y-6">
      <div className="text-center space-y-2">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-md dark:bg-emerald-600">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">Administrator sign in</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Restricted access for provisioned OUTPOST administrators.</p>
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
        {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}
        <button type="submit" disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 dark:bg-emerald-600 dark:hover:bg-emerald-500">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          {submitting ? 'Verifying access…' : 'Sign in to Admin Console'}
        </button>
        <p className="text-center text-xs text-slate-500">Administrator accounts are created and granted access by the project owner. There is no administrator self-registration.</p>
      </form>
      <p className="text-center text-sm text-slate-500"><Link to="/login" className="font-semibold text-emerald-600 hover:underline">Return to Student/Landlord sign in</Link></p>
    </div>
  );
};
