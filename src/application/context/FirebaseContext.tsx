import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User as FirebaseUser,
  onAuthStateChanged,
  signInWithPopup,
  signOut as fbSignOut,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db, googleAuthProvider, testConnection } from '../../infrastructure/firebase/firebaseConfig';
import { authService } from '../services/authService';
import { repository } from '../../infrastructure/repositories';
import { appConfig, configValidationError, BackendMode } from '../../infrastructure/config/appConfig';
import { User, UserRole } from '../../domain/types';

interface FirebaseContextType {
  firebaseUser: FirebaseUser | null;
  currentUser: User | null;
  loading: boolean;
  connected: boolean;
  backendMode: BackendMode;
  isConfigValid: boolean;
  validationError?: string;
  signInWithGoogle: (preferredRole?: 'student' | 'landlord') => Promise<{ success: boolean; user?: User; error?: string }>;
  signInWithEmail: (email: string, password?: string) => Promise<{ success: boolean; user?: User; error?: string }>;
  signOut: () => Promise<void>;
  firestoreDatabaseId: string;
}

const FirebaseContext = createContext<FirebaseContextType>({
  firebaseUser: null,
  currentUser: null,
  loading: true,
  connected: false,
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

  useEffect(() => {
    // 1. Verify Firestore connectivity
    testConnection().then((isOk) => {
      setConnected(isOk);
    });

    // 2. Initialize repository
    repository.init().catch(() => {});

    // 3. Listen to Auth State
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        try {
          const syncedUser = await authService.syncUserFromFirestore(user);

          if (syncedUser.accountStatus === 'suspended') {
            await fbSignOut(auth);
            repository.clearActiveUserId();
            setCurrentUser(null);
            setLoading(false);
            return;
          }

          // Ensure initial profile record exists for new users without auto-verifying credentials
          if (syncedUser.role === 'student' && !repository.getStudentProfile(user.uid)) {
            repository.saveStudentProfile({
              userId: user.uid,
              fullName: user.displayName || syncedUser.fullName || 'OUTPOST Student',
              phone: '',
              registrationNumber: `BUK/PENDING/${user.uid.slice(0, 6).toUpperCase()}`,
              institutionName: 'Bayero University Kano (BUK)',
              university: 'Bayero University Kano (BUK)',
              campus: 'New Campus (Gwarzo Road)',
              studyLevel: 'Undergraduate (Year 1)',
              programme: 'General Studies',
              gender: 'Other',
              preferredLocation: 'Dambare',
              bio: 'BUK student member on OUTPOST.',
              isProfileVerified: false,
            });
          } else if (syncedUser.role === 'landlord' && !repository.getLandlordProfile(user.uid)) {
            repository.saveLandlordProfile({
              userId: user.uid,
              legalName: user.displayName || syncedUser.fullName || 'Landlord Partner',
              phone: '',
              contactAddress: 'Gwarzo Road Corridor, Kano State',
              idType: 'National ID (NIN)',
              idReference: 'PENDING-SUBMISSION',
              verificationStatus: 'not_started',
              submittedAt: new Date().toISOString(),
            });
          }

          repository.setActiveUserId(user.uid);
          setCurrentUser(syncedUser);
        } catch (err) {
          console.warn('Session synchronization notice:', err);
        }
      } else {
        repository.clearActiveUserId();
        setCurrentUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async (preferredRole: 'student' | 'landlord' = 'student') => {
    try {
      const result = await signInWithPopup(auth, googleAuthProvider);
      const user = result.user;

      const userDocRef = doc(db, 'users', user.uid);
      const snap = await getDoc(userDocRef);

      // Public sign-in may only initialize student or landlord; existing server role is preserved
      let role: UserRole = preferredRole === 'landlord' ? 'landlord' : 'student';
      if (snap.exists() && snap.data()?.role) {
        role = snap.data().role as UserRole;
      }

      if (!snap.exists()) {
        await setDoc(userDocRef, {
          id: user.uid,
          email: user.email || '',
          fullName: user.displayName || 'OUTPOST User',
          role,
          accountStatus: 'active',
          avatarUrl: user.photoURL || '',
          isActive: true,
          emailVerified: user.emailVerified,
          createdAt: new Date().toISOString(),
        });
      }

      const syncedUser = await authService.syncUserFromFirestore(user);
      if (syncedUser.accountStatus === 'suspended') {
        await fbSignOut(auth);
        repository.clearActiveUserId();
        return { success: false, error: 'Your account has been suspended by an administrator.' };
      }

      repository.setActiveUserId(user.uid);
      setCurrentUser(syncedUser);
      return { success: true, user: syncedUser };
    } catch (error: any) {
      console.error('Google sign-in error:', error);
      return { success: false, error: error?.message || 'Google authentication failed.' };
    }
  };

  const signInWithEmail = async (email: string, password?: string) => {
    return authService.loginWithFirebase(email, password);
  };

  const signOut = async () => {
    try {
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
