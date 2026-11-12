/**
 * @file ResetPasswordPage.tsx
 * @module pages/public/ResetPasswordPage
 * @description Dedicated password reset and creation page.
 *
 * Flow:
 * 1. User arrives via Supabase email recovery link (`/reset-password#access_token=...&type=recovery` or query params).
 * 2. Directly provides the "New Password" & "Confirm Password" form so the user can immediately set their new password.
 * 3. On submit, calls `authService.updatePassword(password)` (`supabase.auth.updateUser({ password })`).
 * 4. Displays clear success state with single-click navigation back to account or sign-in.
 */

import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { KeyRound, CheckCircle2, AlertCircle, Eye, EyeOff, Loader2, ArrowRight } from 'lucide-react';
import { authService } from '../../application/services/authService';
import { supabase } from '../../infrastructure/supabase/supabaseClient';
import { useAuth } from '../../application/context/AuthContext';

export const ResetPasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();

  // Password fields
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // States
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Check URL parameters for explicit errors (e.g. otp_expired)
  useEffect(() => {
    try {
      const hash = window.location.hash || '';
      const search = window.location.search || '';

      if (hash.includes('error=') || hash.includes('error_code=') || search.includes('error=') || search.includes('error_code=')) {
        const hashParams = new URLSearchParams(hash.replace(/^#/, ''));
        const searchParams = new URLSearchParams(search.replace(/^\?/, ''));
        const errorDesc = hashParams.get('error_description') || searchParams.get('error_description');
        const humanMessage = errorDesc
          ? errorDesc.replace(/\+/g, ' ')
          : 'Email recovery link is invalid or has expired.';
        setError(humanMessage);
      }
    } catch {
      // Ignore URL parsing errors
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match. Please ensure both fields are identical.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await authService.updatePassword(password);
      if (result.success) {
        setSuccess(true);
      } else {
        setError(result.error || 'Failed to update password. Your recovery link may have expired.');
      }
    } catch (err: any) {
      setError(err?.message || 'Error updating password.');
    } finally {
      setSubmitting(false);
    }
  };

  const getDashboardDestination = () => {
    if (currentUser?.role === 'admin') return '/admin/dashboard';
    if (currentUser?.role === 'landlord') return '/landlord/dashboard';
    if (currentUser?.role === 'student') return '/student/dashboard';
    return '/login';
  };

  return (
    <div className="max-w-md mx-auto my-12 space-y-6">
      <div className="text-center space-y-2">
        <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center mx-auto text-xl font-black shadow-md">
          <KeyRound className="w-6 h-6" />
        </div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
          Create New Password
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Enter and confirm your new secure OUTPOST account password
        </p>
      </div>

      <div className="bg-white dark:bg-slate-900 p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
        {success ? (
          <div className="text-center py-6 space-y-4">
            <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Password Updated Successfully!</h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Your new password has been securely saved in the authentication database.
              </p>
            </div>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => navigate(getDashboardDestination(), { replace: true })}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition shadow-md"
              >
                <span>Continue to Account</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            {error && (
              <div role="alert" className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700 dark:text-slate-300">
                New Password (minimum 6 characters)
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700 dark:text-slate-300">
                Confirm New Password
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white font-semibold text-xs transition shadow-md disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving New Password…</span>
                </>
              ) : (
                <span>Update Password</span>
              )}
            </button>

            <div className="text-center pt-2">
              <Link to="/login" className="text-xs font-semibold text-slate-500 hover:text-slate-900 dark:hover:text-white">
                Back to Sign In
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
