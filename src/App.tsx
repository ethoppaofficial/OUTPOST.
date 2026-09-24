import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { ProtectedRoute } from './components/layout/ProtectedRoute';

// Public pages
import { HomePage } from './pages/public/HomePage';
import { PropertiesPage } from './pages/public/PropertiesPage';
import { PropertyDetailPage } from './pages/public/PropertyDetailPage';
import { LoginPage } from './pages/public/LoginPage';
import { RegisterPage } from './pages/public/RegisterPage';
import { ForgotPasswordPage } from './pages/public/ForgotPasswordPage';
import { UnauthorizedPage } from './pages/public/UnauthorizedPage';

// Student pages
import { StudentDashboard } from './pages/student/StudentDashboard';
import { StudentVerificationPage } from './pages/student/StudentVerificationPage';
import { RoommatesPage } from './pages/student/RoommatesPage';
import { RoommatePreferencesPage } from './pages/student/RoommatePreferencesPage';
import { RoommateRequestsPage } from './pages/student/RoommateRequestsPage';
import { UserSearchPage } from './pages/student/UserSearchPage';
import { GroupsPage } from './pages/student/GroupsPage';
import { NewGroupPage } from './pages/student/NewGroupPage';
import { GroupDetailPage } from './pages/student/GroupDetailPage';
import { ReservationsPage } from './pages/student/ReservationsPage';
import { ReservationDetailPage } from './pages/student/ReservationDetailPage';
import { InvoicePage } from './pages/student/InvoicePage';
import { ChatPage } from './pages/student/ChatPage';

// Landlord pages
import { LandlordDashboard } from './pages/landlord/LandlordDashboard';
import { LandlordPropertiesPage } from './pages/landlord/LandlordPropertiesPage';
import { NewPropertyPage } from './pages/landlord/NewPropertyPage';
import { ManageAvailabilityPage } from './pages/landlord/ManageAvailabilityPage';
import { LandlordReceiptsPage } from './pages/landlord/LandlordReceiptsPage';
import { LandlordVerificationPage } from './pages/landlord/LandlordVerificationPage';

// Admin pages
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { VerificationQueuePage } from './pages/admin/VerificationQueuePage';
import { PropertyApprovalsPage } from './pages/admin/PropertyApprovalsPage';
import { UsersPage } from './pages/admin/UsersPage';
import { DisputesPage } from './pages/admin/DisputesPage';
import { ThemeProvider } from './application/context/ThemeContext';
import { FirebaseProvider } from './application/context/FirebaseContext';
import { ConfigErrorScreen } from './components/ui/BackendStatusBanner';
import { configValidationError } from './infrastructure/config/appConfig';

export default function App() {
  if (configValidationError) {
    return <ConfigErrorScreen />;
  }

  return (
    <FirebaseProvider>
      <ThemeProvider>
        <BrowserRouter>
          <AppShell>
            <Routes>
          {/* Public Routes */}
          <Route path="/" element={<HomePage />} />
          <Route path="/properties" element={<PropertiesPage />} />
          <Route path="/properties/:id" element={<PropertyDetailPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/unauthorized" element={<UnauthorizedPage />} />

          {/* Student Routes */}
          <Route
            path="/student"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <StudentDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/dashboard"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <StudentDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/properties"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <PropertiesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/properties/:id"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <PropertyDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/verification"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <StudentVerificationPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/profile/verification"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <StudentVerificationPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/roommates"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <RoommatesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/roommates/preferences"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <RoommatePreferencesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/roommates/requests"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <RoommateRequestsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/search"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <UserSearchPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/user-search"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <UserSearchPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/groups"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <GroupsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/groups/new"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <NewGroupPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/groups/:groupId"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <GroupDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/groups/:groupId/members"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <GroupDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/groups/:groupId/members/:userId"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <GroupDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/groups/:groupId/settings"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <GroupDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/groups/:groupId/chat"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <GroupDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/reservations"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <ReservationsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/reservations/:reservationId"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <ReservationDetailPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/invoices/:invoiceId"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <InvoicePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/chat"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <ChatPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/student/chat/:conversationId"
            element={
              <ProtectedRoute allowedRoles={['student']}>
                <ChatPage />
              </ProtectedRoute>
            }
          />

          {/* Landlord Routes */}
          <Route
            path="/landlord"
            element={
              <ProtectedRoute allowedRoles={['landlord']}>
                <LandlordDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/landlord/dashboard"
            element={
              <ProtectedRoute allowedRoles={['landlord']}>
                <LandlordDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/landlord/properties"
            element={
              <ProtectedRoute allowedRoles={['landlord']}>
                <LandlordPropertiesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/landlord/properties/new"
            element={
              <ProtectedRoute allowedRoles={['landlord']}>
                <NewPropertyPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/landlord/properties/:propertyId/availability"
            element={
              <ProtectedRoute allowedRoles={['landlord']}>
                <ManageAvailabilityPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/landlord/receipts"
            element={
              <ProtectedRoute allowedRoles={['landlord']}>
                <LandlordReceiptsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/landlord/verification"
            element={
              <ProtectedRoute allowedRoles={['landlord']}>
                <LandlordVerificationPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/landlord/chat"
            element={
              <ProtectedRoute allowedRoles={['landlord']}>
                <ChatPage />
              </ProtectedRoute>
            }
          />

          {/* Admin Routes */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/dashboard"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/verifications"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <VerificationQueuePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/landlord-verifications"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <VerificationQueuePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/properties"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <PropertyApprovalsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/property-verifications"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <PropertyApprovalsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/users"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <UsersPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/disputes"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <DisputesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/chat"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <ChatPage />
              </ProtectedRoute>
            }
          />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  </ThemeProvider>
</FirebaseProvider>
  );
}
