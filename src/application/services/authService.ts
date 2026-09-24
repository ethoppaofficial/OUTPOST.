import { User, UserRole, AccountStatus } from '../../domain/types';
import { repository } from '../../infrastructure/repositories/localStorageRepository';

export interface AuthSession {
  user: User;
  displayName: string;
}

class AuthService {
  public getCurrentUser(): User {
    const id = repository.getActiveUserId();
    const user = repository.getUserById(id);
    if (user) return user;

    // Fallback to first student if not found
    const fallback = repository.getUsers()[3];
    repository.setActiveUserId(fallback.id);
    return fallback;
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
    // 1. Validate active email format
    const emailNorm = data.email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailNorm) || emailNorm.includes('tempmail') || emailNorm.includes('disposable')) {
      return { success: false, error: 'A valid, active academic or personal email is required.' };
    }

    // 2. Prevent duplicate email
    if (repository.getUserByEmail(emailNorm)) {
      return { success: false, error: 'An account with this email address already exists.' };
    }

    // 3. Prevent duplicate registration number
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
      emailVerified: true, // Mark verified on demo submission
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

  public logout(): void {
    // Return to public or standard student
    repository.setActiveUserId('user-student-1');
  }
}

export const authService = new AuthService();
