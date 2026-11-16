/**
 * @file LoginPage.tsx
 * @module pages/public/LoginPage
 * @description Authentication page for students, landlords, and staff logging into OUTPOST.
 *
 * Authentication & Redirect Flow:
 * - Supports email/password authentication via Supabase Auth.
 * - Inspects authenticated profile role and automatically routes to the appropriate portal:
 *   - `student` -> `/student/dashboard`
 *   - `landlord` -> `/landlord/dashboard`
 *   - `admin` -> `/admin/dashboard`
 * - Displays error messaging for invalid credentials, unverified accounts, or network timeouts.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { LogIn, AlertCircle, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { authService } from '../../application/services/authService';
import { useAuth } from '../../application/context/AuthContext';
import { initialAuthCallback, supabase } from '../../infrastructure/supabase/supabaseClient';
import { repository } from '../../infrastructure/repositories';

// Deduplicate single-use token_hash verification calls across React StrictMode double-mounts.
const tokenVerificationInFlight = new Map<string, Promise<{ error: any }>>();

const verifyConfirmationTokenOnce = (tokenHash: string, type: 'signup' | 'email') => {
  const existing = tokenVerificationInFlight.get(tokenHash);
  if (existing) return existing;
  const pending = supabase.auth
    .verifyOtp({
      token_hash: tokenHash,
      type,
    })
    .then((res) => ({ error: res.error }));
  tokenVerificationInFlight.set(tokenHash, pending);
  return pending;
};

export const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationMessage, setConfirmationMessage] = useState<string | null>(null);
  const [resendStatus, setResendStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [resending, setResending] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [handlingConfirmation, setHandlingConfirmation] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const {
    signInWithGoogle,
    connected,
    authUser,
    currentUser,
    loading,
    signInWithEmail,
    profileStatus,
    profileError,
    signOut,
  } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const confirmationSignOutPendingRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const searchParams = new URLSearchParams(location.search || window.location.search || '');
    const hashStr = window.location.hash || '';
    const hashParams = new URLSearchParams(hashStr.replace(/^#/, ''));
    const captured = initialAuthCallback && !initialAuthCallback.consumed ? initialAuthCallback : null;

    const flowType = (
      hashParams.get('type') ||
      searchParams.get('type') ||
      captured?.flowType ||
      ''
    ).toLowerCase();
    const tokenHash =
      hashParams.get('token_hash') || searchParams.get('token_hash') || captured?.tokenHash || '';
    const authCode = searchParams.get('code') || captured?.code || '';

    const authErrorCode =
      hashParams.get('error_code') ||
      searchParams.get('error_code') ||
      hashParams.get('error') ||
      searchParams.get('error') ||
      captured?.errorCode ||
      captured?.error;
    const authErrorDesc =
      hashParams.get('error_description') ||
      searchParams.get('error_description') ||
      captured?.errorDescription;
    const hasAuthError = Boolean(
      authErrorCode ||
        authErrorDesc ||
        hashStr.includes('otp_expired') ||
        location.search.includes('otp_expired') ||
        captured?.hasAuthError
    );

    const isConfirmationArrival =
      searchParams.get('confirmed') === '1' ||
      captured?.confirmedParam === '1' ||
      flowType === 'signup' ||
      flowType === 'email' ||
      flowType === 'email_change' ||
      Boolean(tokenHash) ||
      hasAuthError;

    if (!isConfirmationArrival) return;

    if (initialAuthCallback) {
      initialAuthCallback.consumed = true;
    }
    try {
      window.sessionStorage.removeItem('outpost_signup_confirmation_pending');
    } catch {
      // Ignore storage restrictions
    }

    if (hasAuthError) {
      confirmationSignOutPendingRef.current = false;
      setHandlingConfirmation(false);
      setConfirmationMessage(null);
      const rawDesc = authErrorDesc ? authErrorDesc.replace(/\+/g, ' ') : '';
      setError(
        rawDesc
          ? `${rawDesc}. Enter your email below to resend a confirmation link, or sign in with your password if your account is already confirmed.`
          : 'Your email confirmation link is invalid or has expired. Enter your email below and resend confirmation, or sign in if already confirmed.'
      );
      if (window.location.search || window.location.hash) {
        window.history.replaceState({}, '', '/login');
      }
      return;
    }

    confirmationSignOutPendingRef.current = true;
    setHandlingConfirmation(true);
    setError(null);

    let cancelled = false;
    (async () => {
      try {
        if (tokenHash && (flowType === 'signup' || flowType === 'email' || !flowType)) {
          const { error: otpErr } = await verifyConfirmationTokenOnce(
            tokenHash,
            flowType === 'email' ? 'email' : 'signup'
          );
          if (otpErr && !cancelled) {
            // Check whether session already succeeded (e.g. GoTrue pre-verified link)
            const { data: sessionData } = await supabase.auth.getSession();
            if (!sessionData?.session) {
              confirmationSignOutPendingRef.current = false;
              setConfirmationMessage(null);
              setError(
                otpErr.message ||
                  'Could not confirm email from link. Enter your email below to resend confirmation or sign in if already confirmed.'
              );
              return;
            }
          }
        } else {
          // Wait for Supabase client to settle any URL token or PKCE ?code= confirmation callback first
          await supabase.auth.getSession();
          if (authCode) {
            await new Promise((resolve) => setTimeout(resolve, 120));
            await supabase.auth.getSession();
          }
        }
        if (!cancelled) {
          setConfirmationMessage(
            'Your email address has been confirmed! Sign in below using the email and password you provided during registration.'
          );
        }
        if (!cancelled && confirmationSignOutPendingRef.current) {
          await supabase.auth.signOut({ scope: 'local' });
          repository.clearActiveSession();
          confirmationSignOutPendingRef.current = false;
        }
      } catch {
        // Non-fatal cleanup
      } finally {
        if (!cancelled) {
          setHandlingConfirmation(false);
          if (window.location.search || window.location.hash) {
            window.history.replaceState({}, '', '/login');
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [location.search]);

  useEffect(() => {
    if (confirmationSignOutPendingRef.current && authUser) {
      confirmationSignOutPendingRef.current = false;
      void supabase.auth.signOut({ scope: 'local' }).then(() => {
        repository.clearActiveSession();
      });
    }
  }, [authUser]);

  useEffect(() => {
    if (
      loading ||
      submitting ||
      handlingConfirmation ||
      confirmationSignOutPendingRef.current ||
      error ||
      confirmationMessage
    ) {
      return;
    }

    if (profileStatus === 'authenticated' && currentUser) {
      const stateFrom = (location.state as { from?: string } | null)?.from;
      const defaultPortal =
        currentUser.role === 'admin'
          ? '/admin/dashboard'
          : currentUser.role === 'landlord'
          ? '/landlord/dashboard'
          : '/student/dashboard';
      navigate(stateFrom && !stateFrom.startsWith('/login') ? stateFrom : defaultPortal, {
        replace: true,
      });
    }
  }, [
    loading,
    submitting,
    handlingConfirmation,
    error,
    confirmationMessage,
    profileStatus,
    currentUser,
    location.state,
    navigate,
  ]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    confirmationSignOutPendingRef.current = false;
    setHandlingConfirmation(false);
    setError(null);
    setResendStatus(null);
    setSubmitting(true);

    try {
      const result = await signInWithEmail(email, password);
      if (result.success && result.user) {
        const stateFrom = (location.state as { from?: string } | null)?.from;
        if (result.user.role === 'student') {
          navigate(stateFrom?.startsWith('/student') ? stateFrom : '/student/dashboard', { replace: true });
        } else if (result.user.role === 'landlord') {
          navigate(stateFrom?.startsWith('/landlord') ? stateFrom : '/landlord/dashboard', { replace: true });
        } else if (result.user.role === 'admin') {
          navigate(stateFrom?.startsWith('/admin') ? stateFrom : '/admin/dashboard', { replace: true });
        }
      } else {
        setError(result.error || 'Login failed.');
      }
    } catch (err: any) {
      setError(err?.message || 'Login error occurred.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      const res = await signInWithGoogle('student');
      if (res.success) {
        if (res.role === 'landlord') navigate('/landlord/dashboard');
        else if (res.role === 'admin') navigate('/admin/dashboard');
        else navigate('/student/dashboard');
      } else if (res.error) {
        setError(res.error);
      }
    } catch (err: any) {
      setError(err?.message || 'Google sign-in error occurred.');
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto my-6 sm:my-10 space-y-6">
      <div className="text-center space-y-2">
        <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center mx-auto text-xl font-black shadow-md">
          O
        </div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
          Sign In to OUTPOST
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Access your student portal, landlord listings, or admin console
        </p>
      </div>

      {/* Login Card */}
      <div className="bg-white dark:bg-slate-900 p-6 sm:p-8 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xl space-y-5">
        {confirmationMessage && (
          <div
            role="status"
            className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200 flex items-start gap-2.5"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
            <span>{confirmationMessage}</span>
          </div>
        )}
        {profileStatus === 'profile_error' && authUser && (
          <div role="alert" className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300 flex items-start justify-between gap-2">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{profileError || 'Unable to load your OUTPOST account profile.'}</span>
            </div>
            <button
              type="button"
              onClick={() => void signOut()}
              className="shrink-0 font-semibold underline hover:no-underline"
            >
              Sign out
            </button>
          </div>
        )}
        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Active Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. yourname@university.edu.ng"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between items-center text-xs">
              <label className="font-semibold text-slate-700 dark:text-slate-300">Password</label>
              <Link to="/forgot-password" className="text-[11px] text-emerald-600 hover:underline">
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-3.5 py-2.5 pr-11 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300 space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
              {(error.toLowerCase().includes('not been confirmed') ||
                error.toLowerCase().includes('email not confirmed') ||
                error.toLowerCase().includes('expired') ||
                error.toLowerCase().includes('confirmation link')) && (
                <div className="pl-6 space-y-2.5 pt-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      disabled={resending}
                      onClick={async () => {
                        setResending(true);
                        setResendStatus(null);
                        const res = await authService.resendVerificationEmail(email);
                        setResendStatus(
                          res.success
                            ? {
                                ok: true,
                                text: 'A new confirmation link/code has been sent. Check your inbox or spam folder.',
                              }
                            : {
                                ok: false,
                                text: res.error || 'Could not resend confirmation email.',
                              }
                        );
                        setResending(false);
                      }}
                      className="font-semibold text-emerald-700 dark:text-emerald-300 underline hover:no-underline disabled:opacity-50 cursor-pointer"
                    >
                      {resending ? 'Sending confirmation link…' : 'Resend confirmation email'}
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value)}
                      placeholder="Or enter 6-digit code from email"
                      className="flex-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-800 text-[11px] text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                    <button
                      type="button"
                      disabled={verifyingOtp || otpCode.trim().length < 6}
                      onClick={async () => {
                        setVerifyingOtp(true);
                        setResendStatus(null);
                        const res = await authService.verifySignupOtp(email, otpCode);
                        if (res.success) {
                          setError(null);
                          setOtpCode('');
                          setConfirmationMessage(
                            'Your email address has been confirmed! Sign in below using your password.'
                          );
                        } else {
                          setResendStatus({
                            ok: false,
                            text: res.error || 'Invalid or expired confirmation code.',
                          });
                        }
                        setVerifyingOtp(false);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold disabled:opacity-50 cursor-pointer"
                    >
                      {verifyingOtp ? 'Verifying…' : 'Verify Code'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {resendStatus && (
            <div
              role={resendStatus.ok ? 'status' : 'alert'}
              className={`p-3 rounded-xl border text-xs ${
                resendStatus.ok
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                  : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300'
              }`}
            >
              {resendStatus.text}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white font-semibold text-xs transition shadow-md flex items-center justify-center gap-2"
          >
            <LogIn className="w-4 h-4" />
            <span>{submitting ? 'Signing in…' : 'Sign in'}</span>
          </button>
        </form>

        <div className="relative flex py-1 items-center">
          <div className="flex-grow border-t border-slate-200 dark:border-slate-800"></div>
          <span className="flex-shrink mx-3 text-[11px] font-medium text-slate-400">or continue with</span>
          <div className="flex-grow border-t border-slate-200 dark:border-slate-800"></div>
        </div>

        {/* Google Auth Button (Supabase Auth) */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={googleLoading}
          className="w-full py-2.5 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-200 font-semibold text-xs transition shadow-xs flex items-center justify-center gap-2.5 disabled:opacity-60"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          <span>{googleLoading ? 'Connecting to Google…' : 'Continue with Google'}</span>
        </button>

        {/* Supabase Status Badge (hidden per clean UI guidelines) */}
        <div className="hidden" aria-hidden="true">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
            <span className="font-medium text-slate-700 dark:text-slate-300">Supabase Database</span>
          </div>
        </div>

        <div className="text-center text-xs text-slate-500 pt-2">
          Don't have an account?{' '}
          <Link to="/register" className="font-semibold text-emerald-600 hover:underline">
            Register as Student or Landlord
          </Link>
        </div>
      </div>
    </div>
  );
};
