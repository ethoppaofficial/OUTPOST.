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
import { repository } from '../../infrastructure/repositories/localStorageRepository';
import { User, UserRole } from '../../domain/types';

interface FirebaseContextType {
  firebaseUser: FirebaseUser | null;
  loading: boolean;
  connected: boolean;
  signInWithGoogle: (preferredRole?: UserRole) => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
  firestoreDatabaseId: string;
}

const FirebaseContext = createContext<FirebaseContextType>({
  firebaseUser: null,
  loading: true,
  connected: false,
  signInWithGoogle: async () => ({ success: false }),
  signOut: async () => {},
  firestoreDatabaseId: '',
});

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [connected, setConnected] = useState<boolean>(false);

  useEffect(() => {
    // 1. Verify Firestore connectivity
    testConnection().then((isOk) => {
      setConnected(isOk);
    });

    // 2. Listen to Auth State
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        // Sync user document in Firestore
        try {
          const userDocRef = doc(db, 'users', user.uid);
          const snap = await getDoc(userDocRef);

          let role: UserRole = 'student';
          if (user.email === 'admin@outpost.ng' || user.email === 'ethoppaofficial@gmail.com') {
            role = 'admin';
          }

          if (!snap.exists()) {
            // Create user document in Firestore
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
          } else {
            const data = snap.data();
            if (data?.role) {
              role = data.role as UserRole;
            }
          }

          // Keep in-memory / local repository user state aligned
          let existingLocal = repository.getUserById(user.uid);
          if (!existingLocal) {
            const localUser: User = {
              id: user.uid,
              email: user.email || '',
              role,
              accountStatus: 'active',
              emailVerified: user.emailVerified,
              avatarUrl: user.photoURL || undefined,
              createdAt: new Date().toISOString(),
            };
            repository.createUser(localUser);

            if (role === 'student') {
              repository.saveStudentProfile({
                userId: user.uid,
                fullName: user.displayName || 'OUTPOST Student',
                phone: '+234 800 000 0000',
                registrationNumber: `REG-${user.uid.slice(0, 6).toUpperCase()}`,
                university: 'University of Lagos (UNILAG)',
                campus: 'Main Akoka Campus',
                studyLevel: 'Undergraduate',
                programme: 'Computer Science',
                gender: 'Other',
                preferredLocation: 'Akoka / Yaba',
                bio: 'Google authenticated student member.',
                isProfileVerified: true,
              });
            } else if (role === 'landlord') {
              repository.saveLandlordProfile({
                userId: user.uid,
                legalName: user.displayName || 'Verified Landlord',
                phone: '+234 800 000 0000',
                contactAddress: 'Lagos, Nigeria',
                idType: 'National ID (NIN)',
                idReference: 'NIN-ONLINE-VERIFIED',
                verificationStatus: 'approved',
                submittedAt: new Date().toISOString(),
              });
            }
          }
          repository.setActiveUserId(user.uid);
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
        }
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
      if (user.email === 'admin@outpost.ng' || user.email === 'ethoppaofficial@gmail.com') {
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

  const signOut = async () => {
    try {
      await fbSignOut(auth);
      authService.logout();
    } catch (err) {
      console.error('Sign out error:', err);
    }
  };

  return (
    <FirebaseContext.Provider
      value={{
        firebaseUser,
        loading,
        connected,
        signInWithGoogle,
        signOut,
        firestoreDatabaseId: 'ai-studio-outpoststudentho-f2f5cd38-bc33-486e-897b-2f36813511f0',
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
};

export const useFirebase = () => useContext(FirebaseContext);
