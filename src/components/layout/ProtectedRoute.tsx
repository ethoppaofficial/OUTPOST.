import React from 'react';
import { Navigate } from 'react-router-dom';
import { authService } from '../../application/services/authService';
import { UserRole } from '../../domain/types';

interface ProtectedRouteProps {
  allowedRoles?: UserRole[];
  children: React.ReactElement;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ allowedRoles, children }) => {
  const session = authService.getSession();

  if (!session || !session.user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(session.user.role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return children;
};
