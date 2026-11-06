/**
 * @file ResetPasswordPage.tsx
 * @module pages/public/ResetPasswordPage
 * @description Resilient password reset page supporting both automated magic links and 6-digit OTP codes.
 *
 * Resilience Strategy:
 * - Link Mode: Automatically detects recovery session from URL hash / PKCE token.
 * - OTP Code Mode: Bypasses email link scanners / antivirus pre-fetchers that cause `otp_expired`
 *   by allowing the user to enter their email, 6-digit code from the email, and new password.
 */

import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { KeyRound, Lock, CheckCircle2, AlertCircle, Eye, EyeOff, Loader2, ArrowRight, ShieldCheck, Mail, Hash } from 'lucide-react';
import { authService } from '../../application/services/authService';
import { supabase } from '../../infrastructure/supabase/supabaseClient';
import { useAuth } from '../../application/context/AuthContext';

export const ResetPasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { currentUser } = useAuth();

  const [mode, setMode] = useState<'link' | 'otp'>(() => {
    return searchParams.get('mode') === 'code' ? 'otp' : 'link';
  });

  // OTP mode fields
  const [email, setEmail] = useState(() => searchParams.get('email') || '');
  const [otpToken, setOtpToken] = useState('');

  // Password fields
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // States
  const [loadingSession, setLoadingSession] = useState(true);
  const [hasValidSession, setHasValidSession] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function checkRecoverySession() {
      try {
        const hash = window.location.hash;

        // If URL hash indicates an error from Supabase (e.g. otp_expired caused by email scanners)
        if (hash.includes('error=') || hash.includes('error_code=')) {
          const hashParams = new URLSearchParams(hash.replace(/^#/, ''));
          const errorCode = hashParams.get('error_code');
          const errorDesc = hashParams.get('error_description');
          let humanMessage = errorDesc ? errorDesc.replace(/\+/g, ' ') : 'Email recovery link is invalid or has expired.';
          if (errorCode === 'otp_expired') {
            humanMessage = 'The one-time magic link was already opened or expired (often caused by email antivirus scanners). You can enter your 6-digit code from the email below.';
          }
          if (isMounted) {
            setError(humanMessage);
            setHasValidSession(false);
            setLoadingSession(false);
            // Automatically switch to OTP code mode so user is never stuck
            setMode('otp');
          }
          return;
        }

        // Check if Supabase client already has an active recovery session
        const { data: { session } } = await supabase.auth.getSession();
        if (session && isMounted) {
          setHasValidSession(true);
          setLoadingSession(false);
          return;
        }

        // Check if URL contains valid hash parameters (#access_token=...&type=recovery)
        if (hash.includes('access_token') || hash.includes('type=recovery')) {
          if (isMounted) {
            setHasValidSession(true);
            setLoadingSession(false);
          }
          return;
        }

        // Listen for PASSWORD_RECOVERY or SIGNED_IN event from Supabase
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
          if (isMounted) {
            if (event === 'PASSWORD_RECOVERY' || (session && event === 'SIGNED_IN')) {
              setHasValidSession(true);
            }
            setLoadingSession(false);
          }
        });

        // Bounded fallback timeout
        setTimeout(() => {
          if (isMounted && loadingSession) {
            supabase.auth.getSession().then(({ data }) => {
              if (isMounted) {
                setHasValidSession(Boolean(data.session));
                setLoadingSession(false);
              }
            });
          }
        }, 1200);

        return () => {
          subscription.unsubscribe();
        };
      } catch {
        if (isMounted) {
          setHasValidSession(false);
          setLoadingSession(false);
        }
      }
    }

    checkRecoverySession();
    return () => {
      isMounted = false;
    };
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
      if (mode === 'otp') {
        if (!email.trim() || !otpToken.trim()) {
          setError('Please provide your account email and the 6-digit code from your email.');
          setSubmitting(false);
          return;
        }

        const result = await authService.resetPasswordWithOtp(email, otpToken, password);
        if (result.success) {
          setSuccess(true);
        } else {
          setError(result.error || 'Invalid or expired 6-digit code. Please verify the code in your email.');
        }
      } else {
        const result = await authService.updatePassword(password);
        if (result.success) {
          setSuccess(true);
        } else {
          setError(result.error || 'Failed to update password. Try using the 6-digit code option.');
        }
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
        {loadingSession && mode === 'link' ? (
          <div className="py-10 text-center space-y-3">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mx-auto" />
            <p className="text-xs text-slate-500">Verifying secure recovery session…</p>
          </div>
        ) : success ? (
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
          <div className="space-y-4">
            {/* Mode Selector Tabs */}
            <div className="flex rounded-xl bg-slate-100 p-1 text-xs font-semibold dark:bg-slate-800">
              <button
                type="button"
                onClick={() => { setMode('link'); setError(null); }}
                className={`flex-1 rounded-lg py-2 transition ${
                  mode === 'link'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Direct Link
              </button>
              <button
                type="button"
                onClick={() => { setMode('otp'); setError(null); }}
                className={`flex-1 rounded-lg py-2 transition ${
                  mode === 'otp'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                6-Digit Code
              </button>
            </div>

            {error && (
              <div role="alert" className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {mode === 'link' && !hasValidSession ? (
              <div className="text-center py-4 space-y-3">
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  No active session was detected from this link. If your email scanner opened it, switch to the <strong>6-Digit Code</strong> tab above or request a new reset link.
                </p>
                <button
                  type="button"
                  onClick={() => setMode('otp')}
                  className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition shadow-md"
                >
                  Enter 6-Digit Code Instead
                </button>
                <div className="pt-2">
                  <Link to="/forgot-password" className="text-xs font-semibold text-slate-500 hover:underline">
                    Request New Reset Link
                  </Link>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4 text-xs">
                {mode === 'otp' && (
                  <>
                    <div className="space-y-1.5">
                      <label className="font-semibold text-slate-700 dark:text-slate-300">
                        Account Email Address
                      </label>
                      <div className="relative">
                        <input
                          type="email"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="ethoppaofficial@gmail.com"
                          className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 pl-9"
                        />
                        <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="font-semibold text-slate-700 dark:text-slate-300">
                        6-Digit Reset Code (from email)
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          required
                          maxLength={12}
                          value={otpToken}
                          onChange={(e) => setOtpToken(e.target.value)}
                          placeholder="e.g. 123456"
                          className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-mono tracking-widest text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 pl-9"
                        />
                        <Hash className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      </div>
                    </div>
                  </>
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
        )}
      </div>
    </div>
  );
};
