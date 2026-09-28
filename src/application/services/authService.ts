import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut as fbSignOut,
  updateProfile,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../../infrastructure/firebase/firebaseConfig';
import { User, UserRole, StudentProfile, LandlordProfile } from '../../domain/types';
import { repository } from '../../infrastructure/repositories';
import { appConfig } from '../../infrastructure/config/appConfig';

export interface AuthSession {
  user: User;
  displayName: string;
}

const EMPTY_USER: User = {
  id: '',
  email: '',
  role: 'student',
  accountStatus: 'email_unverified',
  emailVerified: false,
  createdAt: '',
};

class AuthService {
  public getAuthenticatedUser(): User | null {
    if (appConfig.backendMode === 'firebase') {
      const fbUser = auth.currentUser;
      if (!fbUser) {
        return null;
      }
      const existing = repository.getUserById(fbUser.uid);
      if (existing && existing.id) {
        return {
          ...existing,
          emailVerified: fbUser.emailVerified || existing.emailVerified,
        };
      }
      return {
        id: fbUser.uid,
        email: fbUser.email || '',
        role: 'student',
        accountStatus: fbUser.emailVerified ? 'active' : 'email_unverified',
        emailVerified: fbUser.emailVerified,
        createdAt: new Date().toISOString(),
      };
    }

    const id = repository.getActiveUserId();
    if (!id) return null;
    const user = repository.getUserById(id);
    return user && user.id ? user : null;
  }

  public getCurrentUser(): User {
    return this.getAuthenticatedUser() || EMPTY_USER;
  }

  public isAuthenticated(): boolean {
    return Boolean(this.getAuthenticatedUser()?.id);
  }

  public getSession(): AuthSession {
    const authUser = this.getAuthenticatedUser();
    if (!authUser || !authUser.id) {
      return {
        user: EMPTY_USER,
        displayName: '',
      };
    }

    let displayName = authUser.fullName || authUser.name || authUser.email;

    if (authUser.role === 'student') {
      const student = repository.getStudentProfile(authUser.id);
      if (student?.fullName) displayName = student.fullName;
    } else if (authUser.role === 'landlord') {
      const landlord = repository.getLandlordProfile(authUser.id);
      if (landlord?.legalName) displayName = landlord.legalName;
    } else if (authUser.role === 'admin') {
      displayName = authUser.fullName || 'Platform Administrator';
    }

    return { user: authUser, displayName };
  }

  /**
   * Resolves a user's authoritative role and profile records from Firestore
   */
  public async syncUserFromFirestore(fbUser: {
    uid: string;
    email: string | null;
    displayName: string | null;
    photoURL: string | null;
    emailVerified: boolean;
    getIdTokenResult?: () => Promise<{ claims: Record<string, any> }>;
  }): Promise<User> {
    let resolvedRole: UserRole = 'student';
    let existingUserDoc: Partial<User> | null = null;

    // 1. Check custom claims if available
    if (fbUser.getIdTokenResult) {
      try {
        const tokenResult = await fbUser.getIdTokenResult();
        if (tokenResult.claims.role === 'admin' || tokenResult.claims.admin === true) {
          resolvedRole = 'admin';
        } else if (tokenResult.claims.role === 'landlord') {
          resolvedRole = 'landlord';
        }
      } catch {
        // Ignore token claim lookup failure
      }
    }

    // 2. Check /admins/{uid} collection in Firestore
    try {
      const adminSnap = await getDoc(doc(db, 'admins', fbUser.uid));
      if (adminSnap.exists()) {
        resolvedRole = 'admin';
      }
    } catch {
      // Non-admin or offline
    }

    // 3. Check /users/{uid} document in Firestore
    try {
      const userSnap = await getDoc(doc(db, 'users', fbUser.uid));
      if (userSnap.exists()) {
        const data = userSnap.data() as Partial<User>;
        existingUserDoc = data;
        if (resolvedRole !== 'admin' && (data.role === 'student' || data.role === 'landlord' || data.role === 'admin')) {
          resolvedRole = data.role;
        }
      }
    } catch {
      // Ignore read error
    }

    // 4. Sync role-specific profile from Firestore into repository cache
    if (resolvedRole === 'student') {
      try {
        const studentSnap = await getDoc(doc(db, 'studentProfiles', fbUser.uid));
        if (studentSnap.exists()) {
          repository.saveStudentProfile(studentSnap.data() as StudentProfile);
        }
      } catch {
        // Ignore
      }
    } else if (resolvedRole === 'landlord') {
      try {
        const landlordSnap = await getDoc(doc(db, 'landlordProfiles', fbUser.uid));
        if (landlordSnap.exists()) {
          repository.saveLandlordProfile(landlordSnap.data() as LandlordProfile);
        }
      } catch {
        // Ignore
      }
    }

    const localExisting = repository.getUserById(fbUser.uid);
    const mergedUser: User = {
      id: fbUser.uid,
      email: fbUser.email || existingUserDoc?.email || localExisting?.email || '',
      role: resolvedRole !== 'student' ? resolvedRole : (existingUserDoc?.role || localExisting?.role || 'student'),
      accountStatus: existingUserDoc?.accountStatus || localExisting?.accountStatus || (fbUser.emailVerified ? 'active' : 'email_unverified'),
      emailVerified: fbUser.emailVerified || Boolean(existingUserDoc?.emailVerified),
      fullName: existingUserDoc?.fullName || fbUser.displayName || localExisting?.fullName || undefined,
      avatarUrl: fbUser.photoURL || existingUserDoc?.avatarUrl || localExisting?.avatarUrl || undefined,
      createdAt: existingUserDoc?.createdAt || localExisting?.createdAt || new Date().toISOString(),
    };

    if (!localExisting) {
      repository.createUser(mergedUser);
    } else {
      repository.updateUser(mergedUser);
    }

    return mergedUser;
  }

  /**
   * Firebase-backed Email/Password Login
   */
  public async loginWithFirebase(email: string, password?: string): Promise<{ success: boolean; user?: User; error?: string }> {
    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      return { success: false, error: 'Please enter your email address.' };
    }
    if (!password) {
      return { success: false, error: 'Please enter your password.' };
    }

    if (appConfig.backendMode !== 'firebase') {
      return { success: false, error: 'Firebase Authentication is required to sign in.' };
    }

    try {
      const cred = await signInWithEmailAndPassword(auth, normalized, password);
      const fbUser = cred.user;

      const syncedUser = await this.syncUserFromFirestore(fbUser);

      if (syncedUser.accountStatus === 'suspended') {
        await fbSignOut(auth);
        repository.clearActiveUserId();
        return { success: false, error: 'Your account has been suspended by an administrator.' };
      }

      repository.setActiveUserId(fbUser.uid);
      return { success: true, user: syncedUser };
    } catch (err: any) {
      const msg =
        err.code === 'auth/invalid-credential' ||
        err.code === 'auth/user-not-found' ||
        err.code === 'auth/wrong-password'
          ? 'Invalid email or password.'
          : err.code === 'auth/too-many-requests'
          ? 'Too many unsuccessful sign-in attempts. Please wait a moment or reset your password.'
          : err.message || 'Authentication failed.';
      return { success: false, error: msg };
    }
  }

  /**
   * Firebase-backed Student Registration with Verification Email
   * Public registration strictly assigns 'student' role.
   */
  public async registerStudentWithFirebase(data: {
    fullName: string;
    email: string;
    password?: string;
    phone: string;
    registrationNumber: string;
    university: string;
    campus: string;
    studyLevel: any;
    programme: string;
    gender: 'Male' | 'Female' | 'Other';
    preferredLocation?: string;
  }): Promise<{ success: boolean; user?: User; error?: string }> {
    const emailNorm = data.email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailNorm) || emailNorm.includes('tempmail') || emailNorm.includes('disposable')) {
      return { success: false, error: 'A valid, active academic or personal email is required.' };
    }

    if (!data.password || data.password.length < 6) {
      return { success: false, error: 'Password must be at least 6 characters long.' };
    }

    const regNorm = data.registrationNumber.trim().toUpperCase();
    if (!regNorm || regNorm.length < 4) {
      return { success: false, error: 'Please provide a valid student registration number.' };
    }

    const existingProfiles = repository.getStudentProfiles();
    if (existingProfiles.some((p) => p.registrationNumber.toUpperCase() === regNorm)) {
      return { success: false, error: 'This student registration number is already registered on OUTPOST.' };
    }

    try {
      const cred = await createUserWithEmailAndPassword(auth, emailNorm, data.password);
      const fbUser = cred.user;

      await updateProfile(fbUser, { displayName: data.fullName.trim() });
      try {
        await sendEmailVerification(fbUser);
      } catch (e) {
        console.warn('Verification email dispatch notice:', e);
      }

      const newUser: User = {
        id: fbUser.uid,
        email: emailNorm,
        fullName: data.fullName.trim(),
        role: 'student', // Public student registration strictly creates a student account
        accountStatus: 'email_unverified',
        emailVerified: fbUser.emailVerified,
        createdAt: new Date().toISOString(),
      };

      repository.createUser(newUser);
      repository.saveStudentProfile({
        userId: fbUser.uid,
        fullName: data.fullName.trim(),
        phone: data.phone.trim(),
        registrationNumber: regNorm,
        institutionName: 'Bayero University Kano (BUK)',
        university: 'Bayero University Kano (BUK)',
        campus: data.campus || 'New Campus (Gwarzo Road)',
        studyLevel: data.studyLevel,
        programme: data.programme.trim(),
        gender: data.gender,
        preferredLocation: data.preferredLocation?.trim() || 'Dambare',
        bio: 'BUK student looking for verified off-campus accommodation.',
        isProfileVerified: false,
      });

      repository.setActiveUserId(fbUser.uid);
      return { success: true, user: newUser };
    } catch (err: any) {
      const msg =
        err.code === 'auth/email-already-in-use'
          ? 'An account with this email address already exists.'
          : err.code === 'auth/weak-password'
          ? 'Password must be at least 6 characters long.'
          : err.message || 'Registration failed.';
      return { success: false, error: msg };
    }
  }

  /**
   * Firebase-backed Landlord Registration
   * Public registration strictly assigns 'landlord' role.
   */
  public async registerLandlordWithFirebase(data: {
    legalName: string;
    email: string;
    password?: string;
    phone: string;
    businessName?: string;
    contactAddress: string;
    idType: any;
    idReference: string;
  }): Promise<{ success: boolean; user?: User; error?: string }> {
    const emailNorm = data.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
      return { success: false, error: 'A valid business or personal email is required.' };
    }

    if (!data.password || data.password.length < 6) {
      return { success: false, error: 'Password must be at least 6 characters long.' };
    }

    try {
      const cred = await createUserWithEmailAndPassword(auth, emailNorm, data.password);
      const fbUser = cred.user;

      await updateProfile(fbUser, { displayName: data.legalName.trim() });
      try {
        await sendEmailVerification(fbUser);
      } catch (e) {
        console.warn('Verification email dispatch notice:', e);
      }

      const newUser: User = {
        id: fbUser.uid,
        email: emailNorm,
        fullName: data.legalName.trim(),
        role: 'landlord', // Public landlord registration strictly creates a landlord account
        accountStatus: 'profile_pending',
        emailVerified: fbUser.emailVerified,
        createdAt: new Date().toISOString(),
      };

      repository.createUser(newUser);
      repository.saveLandlordProfile({
        userId: fbUser.uid,
        legalName: data.legalName.trim(),
        phone: data.phone.trim(),
        contactAddress: data.contactAddress.trim(),
        idType: data.idType,
        idReference: data.idReference.trim(),
        businessName: data.businessName?.trim(),
        verificationStatus: 'pending',
        submittedAt: new Date().toISOString(),
      });

      repository.setActiveUserId(fbUser.uid);
      return { success: true, user: newUser };
    } catch (err: any) {
      const msg =
        err.code === 'auth/email-already-in-use'
          ? 'An account with this email address already exists.'
          : err.code === 'auth/weak-password'
          ? 'Password must be at least 6 characters long.'
          : err.message || 'Registration failed.';
      return { success: false, error: msg };
    }
  }

  public async sendPasswordReset(email: string): Promise<{ success: boolean; error?: string }> {
    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      return { success: false, error: 'Please enter your registered email address.' };
    }
    try {
      await sendPasswordResetEmail(auth, normalized);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to send password reset email.' };
    }
  }

  public async resendVerificationEmail(): Promise<{ success: boolean; error?: string }> {
    if (!auth.currentUser) {
      return { success: false, error: 'No authenticated user session.' };
    }
    try {
      await sendEmailVerification(auth.currentUser);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to resend verification email.' };
    }
  }

  public async refreshEmailVerification(): Promise<{ verified: boolean; error?: string }> {
    if (!auth.currentUser) {
      return { verified: false, error: 'No authenticated user session.' };
    }
    try {
      await auth.currentUser.reload();
      const isVerified = auth.currentUser.emailVerified;
      const existing = repository.getUserById(auth.currentUser.uid);
      if (existing) {
        existing.emailVerified = isVerified;
        if (isVerified && existing.accountStatus === 'email_unverified') {
          existing.accountStatus = 'active';
        }
        repository.updateUser(existing);
      }
      return { verified: isVerified };
    } catch (err: any) {
      return { verified: false, error: err.message || 'Could not refresh verification status.' };
    }
  }

  public getCurrentStudentProfile() {
    const user = this.getAuthenticatedUser();
    if (!user?.id) return undefined;
    return repository.getStudentProfile(user.id);
  }

  public getCurrentLandlordProfile() {
    const user = this.getAuthenticatedUser();
    if (!user?.id) return undefined;
    return repository.getLandlordProfile(user.id);
  }

  public async logout(): Promise<void> {
    try {
      await fbSignOut(auth);
    } catch {}
    repository.clearActiveUserId();
  }
}

export const authService = new AuthService();
