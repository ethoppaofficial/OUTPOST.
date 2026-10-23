/**
 * @file AuthContext.tsx
 * @module application/context/AuthContext
 * @description Central React Authentication Context and session state provider for OUTPOST.
 *
 * Authoritative Backend:
 * - Authentication state is driven exclusively by Supabase Auth:
 *   - `supabase.auth.onAuthStateChange()` listens for session changes.
 *   - User profile data is fetched from the Supabase `profiles` PostgreSQL table.
 *   - Account suspension (`account_status === 'suspended'`) and maintenance mode (`platform_settings`)
 *     are actively evaluated during authentication lifecycle.
 */

import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../../infrastructure/supabase/supabaseClient';
import { authService } from '../services/authService';
import { repository } from '../../infrastructure/repositories';
import { configValidationError, BackendMode } from '../../infrastructure/config/appConfig';
import { User, UserRole, AccountStatus } from '../../domain/types';

export interface AuthContextType {
  authUser: any | null;
  /** @deprecated Use authUser instead */
  firebaseUser?: any | null;
  currentUser: User | null;
  loading: boolean;
  connected: boolean;
  maintenanceMode: boolean;
  maintenanceLoaded: boolean;
  backendMode: BackendMode;
  isConfigValid: boolean;
  validationError?: string;
  signInWithGoogle: (preferredRole?: UserRole) => Promise<{ success: boolean; user?: User; error?: string; role?: UserRole }>;
  signInWithEmail: (email: string, password?: string) => Promise<{ success: boolean; user?: User; error?: string }>;
  signOut: () => Promise<void>;
  databaseId: string;
  /** @deprecated Legacy compatibility field */
  firestoreDatabaseId?: string;
}

export const AuthContext = createContext<AuthContextType>({
  authUser: null,
  firebaseUser: null,
  currentUser: null,
  loading: true,
  connected: false,
  maintenanceMode: false,
  maintenanceLoaded: true,
  backendMode: 'supabase',
  isConfigValid: true,
  signInWithGoogle: async () => ({ success: false }),
  signInWithEmail: async () => ({ success: false }),
  signOut: async () => {},
  databaseId: 'supabase-prod',
  firestoreDatabaseId: 'supabase-prod',
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [supabaseUser, setSupabaseUser] = useState<any | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [connected, setConnected] = useState<boolean>(false);
  const [maintenanceMode, setMaintenanceMode] = useState<boolean>(false);
  const [maintenanceLoaded, setMaintenanceLoaded] = useState<boolean>(true);

  useEffect(() => {
    // 1. Verify Supabase connectivity
    setConnected(isSupabaseConfigured);

    // 2. Initialize repository
    repository.init().catch((err) => {
      console.warn('[App Init] Supabase repository initialization notice:', err?.message || 'offline');
    });

    // 3. Listen to Supabase Auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      const user = session?.user ?? null;
      setSupabaseUser(user);

      if (!user) {
        repository.clearActiveSession();
        setCurrentUser(null);
        setMaintenanceMode(false);
        setMaintenanceLoaded(true);
        setLoading(false);
        return;
      }

      setLoading(true);

      // Check maintenance status from Supabase platform_settings
      try {
        const { data: settings } = await supabase.from('platform_settings').select('*').limit(1).maybeSingle();
        if (settings && (settings as any).maintenance_mode === true) {
          setMaintenanceMode(true);
        } else {
          setMaintenanceMode(false);
        }
      } catch {
        setMaintenanceMode(false);
      } finally {
        setMaintenanceLoaded(true);
      }

      // Fetch user profile from Supabase profiles table
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();

        const storedRole = profile?.role as UserRole | undefined;
        const role: UserRole = storedRole === 'admin'
          ? 'admin'
          : storedRole === 'landlord'
          ? 'landlord'
          : 'student';

        const existingUser = repository.getUserById(user.id);
        const resolvedUser: User = {
          ...(existingUser || {
            id: user.id,
            email: user.email || '',
            accountStatus: (profile?.account_status as AccountStatus) || (user.email_confirmed_at ? 'active' : 'email_unverified'),
            emailVerified: Boolean(user.email_confirmed_at),
            createdAt: user.created_at || new Date().toISOString(),
          }),
          id: user.id,
          email: user.email || existingUser?.email || '',
          role,
          emailVerified: Boolean(user.email_confirmed_at),
          fullName: profile?.full_name || user.user_metadata?.full_name || user.email?.split('@')[0] || '',
          avatarUrl: profile?.avatar_url || user.user_metadata?.avatar_url || '',
          accountStatus: (profile?.account_status as AccountStatus) || 'active',
        };

        repository.setActiveUserId(user.id);
        setCurrentUser(resolvedUser);
      } catch (err) {
        console.warn('[AuthContext] Profile sync notice:', err);
      } finally {
        setLoading(false);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signInWithGoogle = async (preferredRole: UserRole = 'student') => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          queryParams: {
            preferred_role: preferredRole,
          },
        },
      });

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Authentication failed.' };
    }
  };

  const signInWithEmail = async (email: string, password?: string) => {
    setLoading(true);
    const res = await authService.loginWithSupabase(email, password);
    if (res.success && res.user) {
      setCurrentUser(res.user);
    }
    setLoading(false);
    return res;
  };

  const signOut = async () => {
    try {
      if (currentUser?.role === 'admin') {
        repository.logAudit({
          actorId: currentUser.id,
          action: 'ADMIN_LOGOUT',
          resource: 'auth',
          details: { timestamp: new Date().toISOString() },
        });
      }
      await authService.logout();
      setCurrentUser(null);
      setSupabaseUser(null);
    } catch (err) {
      console.error('Sign out error:', err);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        authUser: supabaseUser,
        firebaseUser: supabaseUser,
        currentUser,
        loading,
        connected,
        maintenanceMode,
        maintenanceLoaded,
        backendMode: 'supabase',
        isConfigValid: isSupabaseConfigured,
        validationError: configValidationError,
        signInWithGoogle,
        signInWithEmail,
        signOut,
        databaseId: 'supabase-prod',
        firestoreDatabaseId: 'supabase-prod',
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

/**
 * @deprecated Use useAuth() instead.
 * Provided for smooth backward compatibility during Supabase-only cutover.
 */
export const useFirebase = useAuth;

/**
 * @deprecated Use AuthProvider instead.
 */
export const FirebaseProvider = AuthProvider;
