import React from 'react';
import { Navigate } from 'react-router-dom';
import { authService } from '../../application/services/authService';
import { useFirebase } from '../../application/context/FirebaseContext';
import { UserRole } from '../../domain/types';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  allowedRoles?: UserRole[];
  children: React.ReactElement;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ allowedRoles, children }) => {
  const { loading, firebaseUser } = useFirebase();
  const session = authService.getSession();

  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center space-y-4">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-sm text-slate-500 font-medium">Verifying authentication session...</p>
      </div>
    );
  }

  if (!session || !session.user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(session.user.role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return children;
};
