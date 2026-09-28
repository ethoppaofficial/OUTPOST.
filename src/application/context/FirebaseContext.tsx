import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User as FirebaseUser,
  onAuthStateChanged,
  signInWithPopup,
  signOut as fbSignOut,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db, googleAuthProvider, testConnection } from '../../infrastructure/firebase/firebaseConfig';
import { handleFirestoreError, OperationType } from '../../infrastructure/firebase/errorHandler';
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
  signInWithGoogle: (preferredRole?: UserRole) => Promise<{ success: boolean; error?: string }>;
  signInWithEmail: (email: string, password?: string) => Promise<{ success: boolean; error?: string }>;
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
        let role: UserRole = 'student';
        if (
          user.email === 'admin@outpost.ng' ||
          user.email === 'ethoppaofficial@gmail.com' ||
          user.email === 'mrrex0312@gmail.com'
        ) {
          role = 'admin';
        }

        // Sync user document in Firestore
        try {
          const userDocRef = doc(db, 'users', user.uid);
          const snap = await getDoc(userDocRef);

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
          } else {
            const data = snap.data();
            if (data?.role) {
              role = data.role as UserRole;
            }
          }
        } catch (err) {
          console.warn('Firestore user profile sync notice:', err);
        }

        try {
          let localUser = repository.getUserById(user.uid);
          if (!localUser) {
            localUser = {
              id: user.uid,
              email: user.email || '',
              role,
              accountStatus: 'active',
              emailVerified: user.emailVerified,
              ...(user.photoURL ? { avatarUrl: user.photoURL } : {}),
              createdAt: new Date().toISOString(),
            };
            await repository.createUser(localUser);

            if (role === 'student') {
              await repository.saveStudentProfile({
                userId: user.uid,
                fullName: user.displayName || 'OUTPOST Student',
                phone: '+234 800 000 0000',
                registrationNumber: `BUK/23/${user.uid.slice(0, 5).toUpperCase()}`,
                university: 'Bayero University Kano (BUK)',
                campus: 'New Campus (Gwarzo Road)',
                studyLevel: 'Undergraduate',
                programme: 'Computer Science',
                gender: 'Other',
                preferredLocation: 'Dambare',
                bio: 'Authenticated student member.',
                isProfileVerified: true,
              });
            } else if (role === 'landlord') {
              await repository.saveLandlordProfile({
                userId: user.uid,
                legalName: user.displayName || 'Verified Landlord',
                phone: '+234 800 000 0000',
                contactAddress: 'Gwarzo Road, Kano, Nigeria',
                idType: 'National ID (NIN)',
                idReference: 'NIN-ONLINE-VERIFIED',
                verificationStatus: 'approved',
                submittedAt: new Date().toISOString(),
              });
            }
          }
          repository.setActiveUserId(user.uid);
          setCurrentUser(localUser);
        } catch (err) {
          console.warn('Local user session setup notice:', err);
        }
      } else {
        setCurrentUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async (preferredRole: UserRole = 'student') => {
    try {
      const result = await signInWithPopup(auth, googleAuthProvider);
      const user = result.user;

      const userDocRef = doc(db, 'users', user.uid);
      const snap = await getDoc(userDocRef);

      let role = preferredRole;
      if (
        user.email === 'admin@outpost.ng' ||
        user.email === 'ethoppaofficial@gmail.com' ||
        user.email === 'mrrex0312@gmail.com'
      ) {
        role = 'admin';
      }

      if (!snap.exists()) {
        await setDoc(userDocRef, {
          id: user.uid,
          email: user.email || '',
          fullName: user.displayName || 'Google User',
          role,
          avatarUrl: user.photoURL || '',
          isActive: true,
          emailVerified: user.emailVerified,
          createdAt: new Date().toISOString(),
        });
      }

      repository.setActiveUserId(user.uid);
      return { success: true };
    } catch (error: any) {
      console.error('Google sign-in error:', error);
      return { success: false, error: error?.message || 'Authentication failed.' };
    }
  };

  const signInWithEmail = async (email: string, password?: string) => {
    return authService.loginWithFirebase(email, password);
  };

  const signOut = async () => {
    try {
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
