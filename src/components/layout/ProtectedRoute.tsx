/**
 * @file ProtectedRoute.tsx
 * @module components/layout/ProtectedRoute
 * @description Authentication and Role-Based Access Control (RBAC) route wrapper for React Router v7.
 *
 * Security & Access Control Flow:
 * 1. Session Verification: Displays a loading spinner while Supabase authentication initializes.
 * 2. Unauthenticated Guard: Redirects anonymous visitors to `/login`, preserving target path in state.
 * 3. Role Authorization: Compares active `currentUser.role` against `allowedRoles` (`student` | `landlord` | `admin`).
 *    Unauthorized roles are redirected to `/unauthorized`.
 * 4. Maintenance Mode Guard: If `maintenanceMode` is active in `platform_settings`, non-admin users are
 *    presented with a friendly maintenance screen, while platform administrators retain uninterrupted access.
 */

import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../application/context/AuthContext';
import { UserRole } from '../../domain/types';
import { Loader2, Wrench } from 'lucide-react';

interface ProtectedRouteProps {
  /** Permitted roles for this route. If omitted, any authenticated user may enter. */
  allowedRoles?: UserRole[];
  /** Child component or page element to render upon successful authorization */
  children: React.ReactElement;
}

/**
 * Route protection higher-order component checking authentication, role permissions, and maintenance status.
 */
export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ allowedRoles, children }) => {
  const { loading, currentUser, profileStatus, profileError, maintenanceMode, maintenanceLoaded } = useAuth();
  const location = useLocation();

  if (loading || (currentUser?.role !== 'admin' && !maintenanceLoaded)) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center space-y-4">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-sm text-slate-500 font-medium">Verifying authentication session...</p>
      </div>
    );
  }

  if (profileStatus === 'profile_pending') {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center space-y-4 text-center p-6">
        <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Setting up your account profile...</h2>
        <p className="text-sm text-slate-500 max-w-md">Your profile is being initialized in the database. Please wait a moment.</p>
      </div>
    );
  }

  if (profileStatus === 'profile_error') {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center space-y-4 text-center p-6">
        <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
          <Wrench className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Profile initialization error</h2>
        <p className="text-sm text-slate-500 max-w-md">{profileError || 'Unable to retrieve your user profile. Please try logging in again.'}</p>
        <Navigate to="/login" replace state={{ from: location.pathname }} />
      </div>
    );
  }

  if (!currentUser) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (allowedRoles && !allowedRoles.includes(currentUser.role)) {
    return <Navigate to="/unauthorized" replace state={{ from: location.pathname }} />;
  }

  if (maintenanceMode && currentUser.role !== 'admin') {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-3 text-center">
        <Wrench className="h-9 w-9 text-amber-600" />
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">OUTPOST is temporarily unavailable</h1>
        <p className="text-sm text-slate-500">The platform is in maintenance mode. Please try again later.</p>
      </div>
    );
  }

  return children;
};
