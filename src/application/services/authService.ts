import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut as fbSignOut,
  updateProfile,
} from 'firebase/auth';
import { auth } from '../../infrastructure/firebase/firebaseConfig';
import { User, UserRole, AccountStatus } from '../../domain/types';
import { repository } from '../../infrastructure/repositories';
import { appConfig } from '../../infrastructure/config/appConfig';

export interface AuthSession {
  user: User;
  displayName: string;
}

class AuthService {
  public getCurrentUser(): User {
    const id = repository.getActiveUserId();
    const user = repository.getUserById(id);
    if (user) return user;

    // Fallback to active student
    const all = repository.getUsers();
    const fallback = all.find((u) => u.role === 'student') || all[0];
    if (fallback) {
      repository.setActiveUserId(fallback.id);
      return fallback;
    }

    return {
      id: 'user-student-1',
      email: 'student@outpost.ng',
      role: 'student',
      accountStatus: 'active',
      emailVerified: true,
      createdAt: new Date().toISOString(),
    };
  }

  public getSession(): AuthSession {
    const user = this.getCurrentUser();
    let displayName = user.email;

    if (user.role === 'student') {
      const student = repository.getStudentProfile(user.id);
      if (student) displayName = student.fullName;
    } else if (user.role === 'landlord') {
      const landlord = repository.getLandlordProfile(user.id);
      if (landlord) displayName = landlord.legalName;
    } else if (user.role === 'admin') {
      displayName = 'Platform Administrator';
    }

    return { user, displayName };
  }

  /**
   * Firebase-backed Email/Password Login
   */
  public async loginWithFirebase(email: string, password?: string): Promise<{ success: boolean; user?: User; error?: string }> {
    const normalized = email.trim().toLowerCase();

    if (appConfig.backendMode === 'mock' || !password) {
      return this.login(normalized);
    }

    try {
      const cred = await signInWithEmailAndPassword(auth, normalized, password);
      const fbUser = cred.user;
      repository.setActiveUserId(fbUser.uid);

      let existing = repository.getUserById(fbUser.uid);
      if (!existing) {
        let role: UserRole = 'student';
        if (fbUser.email === 'admin@outpost.ng' || fbUser.email === 'ethoppaofficial@gmail.com') {
          role = 'admin';
        }
        existing = {
          id: fbUser.uid,
          email: fbUser.email || normalized,
          role,
          accountStatus: 'active',
          emailVerified: fbUser.emailVerified,
          avatarUrl: fbUser.photoURL || undefined,
          createdAt: new Date().toISOString(),
        };
        await repository.createUser(existing);
      }

      if (existing.accountStatus === 'suspended') {
        await fbSignOut(auth);
        return { success: false, error: 'Your account has been suspended by an administrator.' };
      }

      return { success: true, user: existing };
    } catch (err: any) {
      const msg = err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password'
        ? 'Invalid email or password.'
        : err.message || 'Authentication failed.';
      return { success: false, error: msg };
    }
  }

  /**
   * Firebase-backed Student Registration with Verification Email
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

    const regNorm = data.registrationNumber.trim().toUpperCase();
    const existingProfiles = repository.getStudentProfiles();
    if (existingProfiles.some((p) => p.registrationNumber.toUpperCase() === regNorm)) {
      return { success: false, error: 'This student registration number is already registered on OUTPOST.' };
    }

    if (appConfig.backendMode === 'mock' || !data.password) {
      return this.registerStudent(data);
    }

    try {
      const cred = await createUserWithEmailAndPassword(auth, emailNorm, data.password);
      const fbUser = cred.user;

      await updateProfile(fbUser, { displayName: data.fullName.trim() });
      try {
        await sendEmailVerification(fbUser);
      } catch (e) {
        console.warn('Verification email rate-limit notice:', e);
      }

      const newUser: User = {
        id: fbUser.uid,
        email: emailNorm,
        role: 'student', // Strict student role enforcement
        accountStatus: 'email_unverified',
        emailVerified: fbUser.emailVerified,
        createdAt: new Date().toISOString(),
      };

      await repository.createUser(newUser);
      await repository.saveStudentProfile({
        userId: fbUser.uid,
        fullName: data.fullName.trim(),
        phone: data.phone.trim(),
        registrationNumber: regNorm,
        university: data.university,
        campus: data.campus,
        studyLevel: data.studyLevel,
        programme: data.programme.trim(),
        gender: data.gender,
        preferredLocation: data.preferredLocation?.trim() || 'Dambare',
        bio: 'New student on Outpost.',
        isProfileVerified: false,
      });

      repository.setActiveUserId(fbUser.uid);
      return { success: true, user: newUser };
    } catch (err: any) {
      const msg = err.code === 'auth/email-already-in-use'
        ? 'An account with this email address already exists.'
        : err.code === 'auth/weak-password'
        ? 'Password must be at least 6 characters long.'
        : err.message || 'Registration failed.';
      return { success: false, error: msg };
    }
  }

  /**
   * Firebase-backed Landlord Registration
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

    if (appConfig.backendMode === 'mock' || !data.password) {
      return this.registerLandlord(data);
    }

    try {
      const cred = await createUserWithEmailAndPassword(auth, emailNorm, data.password);
      const fbUser = cred.user;

      await updateProfile(fbUser, { displayName: data.legalName.trim() });
      try {
        await sendEmailVerification(fbUser);
      } catch (e) {
        console.warn('Verification email rate-limit notice:', e);
      }

      const newUser: User = {
        id: fbUser.uid,
        email: emailNorm,
        role: 'landlord', // Strict landlord role
        accountStatus: 'profile_pending',
        emailVerified: fbUser.emailVerified,
        createdAt: new Date().toISOString(),
      };

      await repository.createUser(newUser);
      await repository.saveLandlordProfile({
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
      const msg = err.code === 'auth/email-already-in-use'
        ? 'An account with this email address already exists.'
        : err.message || 'Registration failed.';
      return { success: false, error: msg };
    }
  }

  public async sendPasswordReset(email: string): Promise<{ success: boolean; error?: string }> {
    const normalized = email.trim().toLowerCase();
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

  public login(email: string, role?: UserRole): { success: boolean; user?: User; error?: string } {
    const normalized = email.trim().toLowerCase();
    const existing = repository.getUserByEmail(normalized);

    if (!existing) {
      return { success: false, error: 'Invalid credentials or account does not exist.' };
    }

    if (existing.accountStatus === 'suspended') {
      return { success: false, error: 'Your account has been suspended by an administrator.' };
    }

    if (role && existing.role !== role) {
      return { success: false, error: `Account exists as ${existing.role}, not ${role}.` };
    }

    repository.setActiveUserId(existing.id);
    return { success: true, user: existing };
  }

  public registerStudent(data: {
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
  }): { success: boolean; user?: User; error?: string } {
    const emailNorm = data.email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailNorm) || emailNorm.includes('tempmail') || emailNorm.includes('disposable')) {
      return { success: false, error: 'A valid, active academic or personal email is required.' };
    }

    if (repository.getUserByEmail(emailNorm)) {
      return { success: false, error: 'An account with this email address already exists.' };
    }

    const existingProfiles = repository.getStudentProfiles();
    const regNorm = data.registrationNumber.trim().toUpperCase();
    if (existingProfiles.some((p) => p.registrationNumber.toUpperCase() === regNorm)) {
      return { success: false, error: 'This student registration number is already registered on OUTPOST.' };
    }

    const userId = `user-student-${Date.now()}`;
    const newUser: User = {
      id: userId,
      email: emailNorm,
      role: 'student',
      accountStatus: 'email_unverified',
      emailVerified: true,
      createdAt: new Date().toISOString(),
      avatarUrl: `https://images.unsplash.com/photo-${1534528741775 + Math.floor(Math.random() * 1000)}?w=200&auto=format&fit=crop&q=80`,
    };

    repository.createUser(newUser);
    repository.saveStudentProfile({
      userId,
      fullName: data.fullName.trim(),
      phone: data.phone.trim(),
      registrationNumber: regNorm,
      university: data.university,
      campus: data.campus,
      studyLevel: data.studyLevel,
      programme: data.programme.trim(),
      gender: data.gender,
      preferredLocation: data.preferredLocation?.trim() || 'Near Campus',
      bio: 'New student on Outpost.',
      isProfileVerified: false,
    });

    repository.setActiveUserId(userId);
    return { success: true, user: newUser };
  }

  public registerLandlord(data: {
    legalName: string;
    email: string;
    password?: string;
    fullName?: string;
    phone: string;
    businessName?: string;
    contactAddress: string;
    idType: any;
    idReference: string;
  }): { success: boolean; user?: User; error?: string } {
    const emailNorm = data.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
      return { success: false, error: 'A valid business or personal email is required.' };
    }

    if (repository.getUserByEmail(emailNorm)) {
      return { success: false, error: 'An account with this email address already exists.' };
    }

    const userId = `user-landlord-${Date.now()}`;
    const newUser: User = {
      id: userId,
      email: emailNorm,
      role: 'landlord',
      accountStatus: 'profile_pending',
      emailVerified: true,
      createdAt: new Date().toISOString(),
      avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80',
    };

    repository.createUser(newUser);
    repository.saveLandlordProfile({
      userId,
      legalName: data.legalName.trim(),
      phone: data.phone.trim(),
      contactAddress: data.contactAddress.trim(),
      idType: data.idType,
      idReference: data.idReference.trim(),
      businessName: data.businessName?.trim(),
      verificationStatus: 'pending',
      submittedAt: new Date().toISOString(),
    });

    repository.setActiveUserId(userId);
    return { success: true, user: newUser };
  }

  public getCurrentStudentProfile() {
    const user = this.getCurrentUser();
    return repository.getStudentProfile(user.id);
  }

  public getCurrentLandlordProfile() {
    const user = this.getCurrentUser();
    return repository.getLandlordProfile(user.id);
  }

  public switchPersona(userId: string): void {
    repository.setActiveUserId(userId);
  }

  public async logout(): Promise<void> {
    try {
      await fbSignOut(auth);
    } catch {}
    repository.setActiveUserId('user-student-1');
  }
}

export const authService = new AuthService();
