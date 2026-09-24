import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { LogIn, ShieldCheck, UserCheck, AlertCircle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { authService } from '../../application/services/authService';
import { UserRole } from '../../domain/types';
import { useFirebase } from '../../application/context/FirebaseContext';

export const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roleTab, setRoleTab] = useState<UserRole>('student');
  const [error, setError] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const navigate = useNavigate();
  const { signInWithGoogle, connected, firebaseUser } = useFirebase();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const result = authService.login(email);
    if (result.success && result.user) {
      if (result.user.role === 'student') navigate('/student/dashboard');
      else if (result.user.role === 'landlord') navigate('/landlord/dashboard');
      else if (result.user.role === 'admin') navigate('/admin/dashboard');
    } else {
      setError(result.error || 'Login failed.');
    }
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      const res = await signInWithGoogle(roleTab);
      if (res.success) {
        if (roleTab === 'student') navigate('/student/dashboard');
        else if (roleTab === 'landlord') navigate('/landlord/dashboard');
        else if (roleTab === 'admin') navigate('/admin/dashboard');
      } else if (res.error) {
        setError(res.error);
      }
    } catch (err: any) {
      setError(err?.message || 'Google sign-in error occurred.');
    } finally {
      setGoogleLoading(false);
    }
  };

  const quickFill = (demoEmail: string, demoRole: UserRole) => {
    setEmail(demoEmail);
    setPassword('DemoSecret123!');
    setRoleTab(demoRole);
    setError(null);
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

      {/* Role Tabs */}
      <div className="flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 text-xs font-semibold">
        {(['student', 'landlord', 'admin'] as UserRole[]).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => {
              setRoleTab(r);
              if (r === 'student') setEmail('aliyu.abubakar@buk.edu.ng');
              else if (r === 'landlord') setEmail('garba.dambare@outpost.ng');
              else if (r === 'admin') setEmail('admin@outpost.ng');
            }}
            className={`flex-1 py-2 rounded-lg capitalize transition ${
              roleTab === r
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      {/* Login Card */}
      <div className="bg-white dark:bg-slate-900 p-6 sm:p-8 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xl space-y-5">
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
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white font-semibold text-xs transition shadow-md flex items-center justify-center gap-2"
          >
            <LogIn className="w-4 h-4" />
            <span>Sign In to Portal</span>
          </button>
        </form>

        <div className="relative flex py-1 items-center">
          <div className="flex-grow border-t border-slate-200 dark:border-slate-800"></div>
          <span className="flex-shrink mx-3 text-[11px] font-medium text-slate-400">or sign in with</span>
          <div className="flex-grow border-t border-slate-200 dark:border-slate-800"></div>
        </div>

        {/* Firebase Google Auth Button */}
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
          <span>{googleLoading ? 'Connecting to Google...' : `Continue with Google (${roleTab})`}</span>
        </button>

        {/* Firebase Status Badge */}
        <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
            <span className="font-medium text-slate-700 dark:text-slate-300">Firebase Firestore</span>
          </div>
          <span className="text-[10px] text-slate-400">gen-lang-client-0233398434 (europe-west2)</span>
        </div>

        {/* Development Quick Fill Helpers */}
        <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider text-center">
            Demo 1-Click Credentials
          </p>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <button
              type="button"
              onClick={() => quickFill('aliyu.abubakar@buk.edu.ng', 'student')}
              className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 text-left border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
            >
              <span className="font-semibold block">Aliyu (Verified)</span>
              <span className="text-[10px] text-slate-400">BUK Student</span>
            </button>
            <button
              type="button"
              onClick={() => quickFill('ibrahim.musa@buk.edu.ng', 'student')}
              className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 text-left border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
            >
              <span className="font-semibold block">Ibrahim (Pending)</span>
              <span className="text-[10px] text-slate-400">BUK Student</span>
            </button>
            <button
              type="button"
              onClick={() => quickFill('garba.dambare@outpost.ng', 'landlord')}
              className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 text-left border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
            >
              <span className="font-semibold block">Alhaji Garba</span>
              <span className="text-[10px] text-slate-400">Verified Landlord</span>
            </button>
            <button
              type="button"
              onClick={() => quickFill('admin@outpost.ng', 'admin')}
              className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 text-left border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
            >
              <span className="font-semibold block">Dr. Vance (Admin)</span>
              <span className="text-[10px] text-slate-400">Console Officer</span>
            </button>
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
