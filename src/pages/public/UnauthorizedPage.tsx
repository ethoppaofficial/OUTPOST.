import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert, ArrowLeft, LayoutDashboard } from 'lucide-react';
import { authService } from '../../application/services/authService';

export const UnauthorizedPage: React.FC = () => {
  const user = authService.getAuthenticatedUser();
  const dashboardPath =
    user?.role === 'admin'
      ? '/admin'
      : user?.role === 'landlord'
      ? '/landlord'
      : user?.role === 'student'
      ? '/student'
      : null;

  return (
    <div className="max-w-md mx-auto my-16 text-center space-y-4 p-8 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-md">
      <div className="w-14 h-14 rounded-2xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 flex items-center justify-center mx-auto">
        <ShieldAlert className="w-7 h-7" />
      </div>
      <h1 className="text-xl font-bold text-slate-900 dark:text-white">Restricted Portal Access</h1>
      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
        Your current account role does not have permission to access this route. Access is strictly enforced by your verified account role.
      </p>
      <div className="pt-2 flex flex-wrap items-center justify-center gap-2">
        {dashboardPath && (
          <Link
            to={dashboardPath}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition"
          >
            <LayoutDashboard className="w-4 h-4" />
            <span>Go to My Dashboard</span>
          </Link>
        )}
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 dark:bg-slate-800 text-white text-xs font-semibold transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Return to Homepage</span>
        </Link>
      </div>
    </div>
  );
};
