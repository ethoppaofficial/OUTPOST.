import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User as FirebaseUser,
  onIdTokenChanged,
  signInWithPopup,
  signOut as fbSignOut,
} from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { auth, db, functions, googleAuthProvider, testConnection } from '../../infrastructure/firebase/firebaseConfig';
import { authService } from '../services/authService';
import { repository } from '../../infrastructure/repositories';
import { appConfig, configValidationError, BackendMode } from '../../infrastructure/config/appConfig';
import { User, UserRole } from '../../domain/types';

interface FirebaseContextType {
  firebaseUser: FirebaseUser | null;
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

const FirebaseContext = createContext<FirebaseContextType>({
  firebaseUser: null,
  currentUser: null,
  loading: true,
  connected: false,
  maintenanceMode: false,
  maintenanceLoaded: true,
  backendMode: 'firebase',
  isConfigValid: true,
  signInWithGoogle: async () => ({ success: false }),
  signInWithEmail: async () => ({ success: false }),
  signOut: async () => {},
  firestoreDatabaseId: '',
});

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [connected, setConnected] = useState<boolean>(false);
  const [maintenanceMode, setMaintenanceMode] = useState<boolean>(false);
  const [maintenanceLoaded, setMaintenanceLoaded] = useState<boolean>(true);

  useEffect(() => {
    // 1. Verify Firestore connectivity
    testConnection().then((isOk) => {
      setConnected(isOk);
    });

    // 2. Initialize repository
    repository.init().catch(() => {});

    // 3. Listen to Firebase Auth and the account's persisted Firestore profile.
    let unsubscribeProfile: (() => void) | undefined;
    let unsubscribePublicSettings: (() => void) | undefined;
    const unsubscribeAuth = onIdTokenChanged(auth, async (user) => {
      unsubscribeProfile?.();
      unsubscribeProfile = undefined;
      unsubscribePublicSettings?.();
      unsubscribePublicSettings = undefined;
      setFirebaseUser(user);

      if (!user) {
        setCurrentUser(null);
        setMaintenanceMode(false);
        setMaintenanceLoaded(true);
        setLoading(false);
        return;
      }

      setMaintenanceLoaded(false);
      unsubscribePublicSettings = onSnapshot(
        doc(db, 'publicSettings', 'default'),
        (snap) => {
          setMaintenanceMode(snap.exists() && snap.data().maintenanceMode === true);
          setMaintenanceLoaded(true);
        },
        (error) => {
          console.warn('Public platform status listener notice:', error);
          setMaintenanceMode(false);
          setMaintenanceLoaded(true);
        },
      );

      setLoading(true);
      let hasAdminClaim = false;
      try {
        const token = await user.getIdTokenResult();
        hasAdminClaim = token.claims.admin === true;
      } catch (error) {
        console.warn('Could not verify Firebase role claims:', error);
      }
      if (auth.currentUser?.uid !== user.uid) return;
      const userDocRef = doc(db, 'users', user.uid);
      unsubscribeProfile = onSnapshot(
        userDocRef,
        (snap) => {
          const profileData = snap.exists() ? snap.data() : {};
          const existingUser = repository.getUserById(user.uid);
          const storedRole = profileData.role as UserRole | undefined;
          const role: UserRole = hasAdminClaim
            ? 'admin'
            : storedRole === 'student' || storedRole === 'landlord'
            ? storedRole
            : 'student';
          const localUser: User = {
            ...(existingUser || {
              id: user.uid,
              email: user.email || '',
              accountStatus: user.emailVerified ? 'active' : 'email_unverified',
              emailVerified: user.emailVerified,
              createdAt: new Date().toISOString(),
            }),
            id: user.uid,
            email: user.email || existingUser?.email || '',
            role,
            emailVerified: user.emailVerified,
            ...(profileData.accountStatus ? { accountStatus: profileData.accountStatus as User['accountStatus'] } : {}),
            ...(profileData.fullName ? { fullName: profileData.fullName as string } : user.displayName ? { fullName: user.displayName } : {}),
            ...(user.photoURL ? { avatarUrl: user.photoURL } : {}),
          };
          repository.setActiveUserId(user.uid);
          setCurrentUser(localUser);
          setLoading(false);
        },
        (err) => {
          console.warn('Firebase user profile listener notice:', err);
          const existingUser = repository.getUserById(user.uid);
          setCurrentUser({
            ...(existingUser || {}),
            id: user.uid,
            email: user.email || '',
            role: hasAdminClaim ? 'admin' : 'student',
            accountStatus: user.emailVerified ? 'active' : 'email_unverified',
            emailVerified: user.emailVerified,
            createdAt: existingUser?.createdAt || new Date().toISOString(),
            ...(user.displayName ? { fullName: user.displayName } : {}),
          });
          setLoading(false);
        }
      );
    });

    return () => {
      unsubscribeAuth();
      unsubscribeProfile?.();
      unsubscribePublicSettings?.();
    };
  }, []);

  const signInWithGoogle = async (preferredRole: UserRole = 'student') => {
    try {
      const result = await signInWithPopup(auth, googleAuthProvider);
      const user = result.user;
      const token = await user.getIdTokenResult(true);

      const userDocRef = doc(db, 'users', user.uid);
      const snap = await getDoc(userDocRef);

      const storedRole = snap.exists() ? snap.data().role : undefined;
      const role: UserRole = token.claims.admin === true
        || user.email === 'ethoppaofficial@gmail.com'
        || user.email === 'admin@outpost.ng'
        ? 'admin'
        : storedRole === 'student' || storedRole === 'landlord'
        ? storedRole
        : preferredRole === 'landlord'
        ? 'landlord'
        : 'student';

      if (!snap.exists()) {
        await setDoc(userDocRef, {
          id: user.uid,
          email: user.email || '',
          ...(user.displayName ? { fullName: user.displayName } : {}),
          role,
          accountStatus: user.emailVerified ? 'active' : 'email_unverified',
          avatarUrl: user.photoURL || '',
          isActive: true,
          emailVerified: user.emailVerified,
          createdAt: new Date().toISOString(),
        });
      }

      const authenticatedUser: User = {
        id: user.uid,
        email: user.email || '',
        role,
        accountStatus: snap.exists() && snap.data()?.accountStatus ? snap.data().accountStatus : (user.emailVerified ? 'active' : 'email_unverified'),
        emailVerified: user.emailVerified,
        createdAt: snap.exists() && snap.data()?.createdAt ? snap.data().createdAt : new Date().toISOString(),
        ...(user.displayName ? { fullName: user.displayName } : {}),
        ...(user.photoURL ? { avatarUrl: user.photoURL } : {}),
      };

      repository.setActiveUserId(user.uid);
      return { success: true, role, user: authenticatedUser };
    } catch (error: any) {
      console.error('Google sign-in error:', error);
      return { success: false, error: error?.message || 'Authentication failed.' };
    }
  };

  const signInWithEmail = async (email: string, password?: string) => {
    const res = await authService.loginWithFirebase(email, password);
    if (res.success && res.user) {
      setCurrentUser(res.user);
      setLoading(false);
    }
    return res;
  };

  const signOut = async () => {
    try {
      if (currentUser?.role === 'admin') {
        try {
          await httpsCallable(functions, 'adminRecordSecurityEvent')({ event: 'ADMIN_LOGOUT' });
        } catch (auditError) {
          console.warn('Administrator logout audit event could not be recorded:', auditError);
        }
      }
      await fbSignOut(auth);
      await authService.logout();
      setCurrentUser(null);
    } catch (err) {
      console.error('Sign out error:', err);
    }
  };

  return (
    <FirebaseContext.Provider
      value={{
        firebaseUser,
        currentUser,
        loading,
        connected,
        maintenanceMode,
        maintenanceLoaded,
        backendMode: appConfig.backendMode,
        isConfigValid: !configValidationError,
        validationError: configValidationError,
        signInWithGoogle,
        signInWithEmail,
        signOut,
        firestoreDatabaseId: appConfig.firebase.firestoreDatabaseId,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
};

export const useFirebase = () => useContext(FirebaseContext);
