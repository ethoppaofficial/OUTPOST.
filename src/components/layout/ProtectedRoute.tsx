import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useFirebase } from '../../application/context/FirebaseContext';
import { UserRole } from '../../domain/types';
import { Loader2, Wrench } from 'lucide-react';

interface ProtectedRouteProps {
  allowedRoles?: UserRole[];
  children: React.ReactElement;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ allowedRoles, children }) => {
  const { loading, currentUser, maintenanceMode, maintenanceLoaded } = useFirebase();
  const location = useLocation();

  if (loading || (currentUser?.role !== 'admin' && !maintenanceLoaded)) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center space-y-4">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-sm text-slate-500 font-medium">Verifying authentication session...</p>
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
