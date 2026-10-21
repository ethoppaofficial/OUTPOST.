import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured, invokeEdgeFunction } from '../../infrastructure/supabase/supabaseClient';
import { authService } from '../services/authService';
import { repository } from '../../infrastructure/repositories';
import { appConfig, configValidationError, BackendMode } from '../../infrastructure/config/appConfig';
import { User, UserRole, AccountStatus } from '../../domain/types';

interface AuthContextType {
  firebaseUser: any | null; // Compatibility alias for Supabase user
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
  firestoreDatabaseId: string;
}

const FirebaseContext = createContext<AuthContextType>({
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
  firestoreDatabaseId: '',
});

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
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

      // Check maintenance status
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
        console.warn('[FirebaseContext] Profile sync notice:', err);
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
    <FirebaseContext.Provider
      value={{
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
        firestoreDatabaseId: 'supabase-prod',
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
};

export const useFirebase = () => useContext(FirebaseContext);
export const useAuth = () => useContext(FirebaseContext);
