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

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../../infrastructure/supabase/supabaseClient';
import { authService } from '../services/authService';
import { repository } from '../../infrastructure/repositories';
import { configValidationError, BackendMode } from '../../infrastructure/config/appConfig';
import { User, UserRole, AccountStatus, LandlordProfile } from '../../domain/types';

export type ProfileInitializationStatus =
  | 'loading'
  | 'authenticated'
  | 'profile_pending'
  | 'profile_error'
  | 'unauthenticated';

export interface AuthContextType {
  authUser: any | null;
  currentUser: User | null;
  landlordProfile: LandlordProfile | null;
  loading: boolean;
  profileStatus: ProfileInitializationStatus;
  profileError?: string;
  connected: boolean;
  maintenanceMode: boolean;
  maintenanceLoaded: boolean;
  backendMode: BackendMode;
  isConfigValid: boolean;
  validationError?: string;
  refreshAuthProfile: () => Promise<void>;
  signInWithGoogle: (preferredRole?: UserRole) => Promise<{ success: boolean; user?: User; error?: string; role?: UserRole }>;
  signInWithEmail: (email: string, password?: string) => Promise<{ success: boolean; user?: User; error?: string }>;
  signOut: () => Promise<void>;
  databaseId: string;
}

export const AuthContext = createContext<AuthContextType>({
  authUser: null,
  currentUser: null,
  landlordProfile: null,
  loading: true,
  profileStatus: 'loading',
  connected: false,
  maintenanceMode: false,
  maintenanceLoaded: true,
  backendMode: 'supabase',
  isConfigValid: true,
  refreshAuthProfile: async () => {},
  signInWithGoogle: async () => ({ success: false }),
  signInWithEmail: async () => ({ success: false }),
  signOut: async () => {},
  databaseId: 'supabase-prod',
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [supabaseUser, setSupabaseUser] = useState<any | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [landlordProfile, setLandlordProfile] = useState<LandlordProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [profileStatus, setProfileStatus] = useState<ProfileInitializationStatus>('loading');
  const [profileError, setProfileError] = useState<string | undefined>(undefined);
  const [connected, setConnected] = useState<boolean>(false);
  const [maintenanceMode, setMaintenanceMode] = useState<boolean>(false);
  const [maintenanceLoaded, setMaintenanceLoaded] = useState<boolean>(true);
  const mountedRef = useRef(true);
  const syncSeqRef = useRef(0);

  const syncSession = useCallback(async (session: any | null) => {
    const seq = ++syncSeqRef.current;
    const isStale = () => !mountedRef.current || seq !== syncSeqRef.current;
    const user = session?.user ?? null;

    if (isStale()) return;
    setSupabaseUser(user);

    if (!user) {
      // Never restore stale local/in-memory accounts in browser runtime when Supabase has no active session.
      repository.clearActiveSession();
      setCurrentUser(null);
      setLandlordProfile(null);
      setProfileStatus('unauthenticated');
      setProfileError(undefined);
      setMaintenanceMode(false);
      setMaintenanceLoaded(true);
      setLoading(false);
      return;
    }

    setLoading(true);

    // Check maintenance status from Supabase platform_settings
    try {
      const { data: settings } = await supabase.from('platform_settings').select('*').limit(1).maybeSingle();
      if (!isStale()) {
        setMaintenanceMode(Boolean(settings && (settings as any).maintenance_mode === true));
      }
    } catch {
      if (!isStale()) setMaintenanceMode(false);
    } finally {
      if (!isStale()) setMaintenanceLoaded(true);
    }

    // Fetch authoritative user profile from Supabase profiles table with bounded retries
    try {
      let profile: any = null;
      let lastError: any = null;

      for (let attempt = 0; attempt < 3; attempt++) {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .maybeSingle();

        if (isStale()) return;
        if (data) {
          profile = data;
          break;
        }
        if (error) {
          lastError = error;
        }
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
        }
      }

      if (isStale()) return;

      if (profile) {
        const storedRole = profile.role as UserRole | undefined;
        let validRole: UserRole | null = null;
        if (storedRole === 'admin') validRole = 'admin';
        else if (storedRole === 'landlord') validRole = 'landlord';
        else if (storedRole === 'student') validRole = 'student';

        if (!validRole) {
          console.error('[AuthContext] Unrecognized role in database profile:', storedRole);
          setProfileStatus('profile_error');
          setProfileError('Account profile contains an invalid role specification.');
          setCurrentUser(null);
          setLandlordProfile(null);
          return;
        }

        const resolvedStatus = (profile.account_status as AccountStatus) || 'active';

        if (resolvedStatus === 'suspended') {
          repository.clearActiveSession();
          setProfileStatus('profile_error');
          setProfileError('Your account has been suspended by an administrator.');
          setCurrentUser(null);
          setLandlordProfile(null);
          return;
        }

        // Administrator privileges strictly require role === 'admin' AND account_status === 'active'.
        if (validRole === 'admin' && resolvedStatus !== 'active') {
          repository.clearActiveSession();
          setProfileStatus('profile_error');
          setProfileError('Administrator access requires an active account status in public.profiles.');
          setCurrentUser(null);
          setLandlordProfile(null);
          return;
        }

        let resolvedLandlordProfile: LandlordProfile | null = null;
        if (validRole === 'landlord') {
          const { data: lp } = await supabase
            .from('landlord_profiles')
            .select('*')
            .eq('user_id', user.id)
            .maybeSingle();

          if (isStale()) return;

          if (lp) {
            resolvedLandlordProfile = {
              userId: lp.user_id,
              legalName: profile.full_name || lp.company_name || 'Landlord',
              businessName: lp.company_name || undefined,
              phone: profile.phone || '',
              contactAddress: lp.business_address || '',
              idType: 'National ID (NIN)',
              idReference: lp.tax_id || '',
              verificationStatus: (lp.verification_status as any) || 'not_started',
              rejectionReason: lp.rejection_reason || undefined,
              verifiedAt: lp.verified_at || undefined,
            };
          }
        }

        const existingUser = repository.getUserById(user.id);
        const resolvedUser: User = {
          ...(existingUser || {
            id: user.id,
            email: user.email || profile.email || '',
            accountStatus: resolvedStatus,
            emailVerified: Boolean(user.email_confirmed_at),
            createdAt: profile.created_at || user.created_at || new Date().toISOString(),
          }),
          id: user.id,
          email: user.email || profile.email || existingUser?.email || '',
          role: validRole,
          accountStatus: resolvedStatus,
          emailVerified: Boolean(user.email_confirmed_at),
          fullName: profile.full_name || user.user_metadata?.full_name || '',
          avatarUrl: profile.avatar_url || user.user_metadata?.avatar_url || '',
          phone: profile.phone || existingUser?.phone,
          landlordProfile: resolvedLandlordProfile || undefined,
        };

        repository.createUser(resolvedUser);
        repository.setActiveUserId(user.id);
        setCurrentUser(resolvedUser);
        setLandlordProfile(resolvedLandlordProfile);
        setProfileStatus('authenticated');
        setProfileError(undefined);
        return;
      }

      // Only allow in-memory repository user in non-browser Node unit tests (never in browser runtime)
      if (typeof window === 'undefined') {
        const localUser = repository.getUserById(user.id);
        if (localUser) {
          setCurrentUser(localUser);
          setLandlordProfile(null);
          setProfileStatus('authenticated');
          setProfileError(undefined);
          return;
        }
      }

      // If database query failed with network/PostgREST error
      if (lastError) {
        console.error('[AuthContext] Error retrieving profile from database:', lastError);
        setProfileStatus('profile_error');
        setProfileError('Database communication error during profile verification.');
        setCurrentUser(null);
        setLandlordProfile(null);
        return;
      }

      // If profile does not exist, mark pending. NEVER silently convert to student!
      setProfileStatus('profile_pending');
      setProfileError('Your account profile is currently being provisioned. Please stand by.');
      setCurrentUser(null);
      setLandlordProfile(null);
    } catch (err: any) {
      if (isStale()) return;
      console.warn('[AuthContext] Profile sync notice:', err);
      setProfileStatus('profile_error');
      setProfileError(err?.message || 'Authentication profile error.');
      setCurrentUser(null);
      setLandlordProfile(null);
    } finally {
      if (!isStale()) {
        setLoading(false);
      }
    }
  }, []);

  const refreshAuthProfile = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    await syncSession(data?.session ?? null);
  }, [syncSession]);

  useEffect(() => {
    mountedRef.current = true;
    // 1. Verify Supabase connectivity
    setConnected(isSupabaseConfigured);

    // 2. Initialize repository
    repository.init().catch((err) => {
      console.warn('[App Init] Supabase repository initialization notice:', err?.message || 'offline');
    });

    // 3. Read current session immediately on mount so UI does not stay stuck or flash signed-out links
    supabase.auth
      .getSession()
      .then(({ data }) => syncSession(data?.session ?? null))
      .catch((err) => {
        console.warn('[AuthContext] Initial getSession notice:', err?.message || err);
        if (mountedRef.current) {
          setProfileStatus('unauthenticated');
          setLoading(false);
        }
      });

    // 4. Listen to Supabase Auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      void syncSession(session);
    });

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
    };
  }, [syncSession]);

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
      await refreshAuthProfile();
    } else {
      setLoading(false);
    }
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
      setLandlordProfile(null);
      setSupabaseUser(null);
      setProfileStatus('unauthenticated');
      setProfileError(undefined);
      setLoading(false);
    } catch (err) {
      console.error('Sign out error:', err);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        authUser: supabaseUser,
        currentUser,
        landlordProfile,
        loading,
        profileStatus,
        profileError,
        connected,
        maintenanceMode,
        maintenanceLoaded,
        backendMode: 'supabase',
        isConfigValid: isSupabaseConfigured,
        validationError: configValidationError,
        refreshAuthProfile,
        signInWithGoogle,
        signInWithEmail,
        signOut,
        databaseId: 'supabase-prod',
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

