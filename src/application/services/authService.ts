import { supabase } from '../../infrastructure/supabase/supabaseClient';
import { User, UserRole, AccountStatus, StudentProfile, LandlordProfile } from '../../domain/types';
import { repository } from '../../infrastructure/repositories';
import { appConfig } from '../../infrastructure/config/appConfig';

export interface AuthSession {
  user: User;
  displayName: string;
}

class AuthService {
  public getCurrentUser(): User {
    const activeId = repository.getActiveUserId();
    if (activeId) {
      const u = repository.getUserById(activeId);
      if (u) return u;
    }

    return {
      id: activeId || 'anonymous',
      email: '',
      role: 'student',
      accountStatus: 'email_unverified',
      emailVerified: false,
      createdAt: new Date().toISOString(),
    };
  }

  public getCurrentStudentProfile(): StudentProfile | undefined {
    const user = this.getCurrentUser();
    return repository.getStudentProfile(user.id);
  }

  public getCurrentLandlordProfile(): LandlordProfile | undefined {
    const user = this.getCurrentUser();
    return repository.getLandlordProfile(user.id);
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
   * Supabase-backed Email/Password Login
   */
  public async loginWithSupabase(email: string, password?: string): Promise<{ success: boolean; user?: User; error?: string }> {
    const normalized = email.trim().toLowerCase();

    if (!password) {
      return { success: false, error: 'Enter your password to sign in.' };
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalized,
        password,
      });

      if (error || !data.user) {
        return { success: false, error: error?.message || 'Invalid email or password.' };
      }

      const sbUser = data.user;
      repository.setActiveUserId(sbUser.id);

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', sbUser.id)
        .single();

      const storedRole = profile?.role as UserRole | undefined;
      const role: UserRole = storedRole === 'admin'
        ? 'admin'
        : storedRole === 'landlord'
        ? 'landlord'
        : 'student';

      const existing = repository.getUserById(sbUser.id);
      const authenticatedUser: User = {
        ...(existing || {
          id: sbUser.id,
          email: sbUser.email || normalized,
          accountStatus: (profile?.account_status as AccountStatus) || 'active',
          emailVerified: Boolean(sbUser.email_confirmed_at),
          createdAt: sbUser.created_at || new Date().toISOString(),
        }),
        id: sbUser.id,
        email: sbUser.email || normalized,
        role,
        accountStatus: (profile?.account_status as AccountStatus) || 'active',
        emailVerified: Boolean(sbUser.email_confirmed_at),
        fullName: profile?.full_name || sbUser.user_metadata?.full_name || '',
        avatarUrl: profile?.avatar_url || sbUser.user_metadata?.avatar_url || '',
      };

      if (!existing) repository.createUser(authenticatedUser);

      if (authenticatedUser.accountStatus === 'suspended') {
        await supabase.auth.signOut();
        return { success: false, error: 'Your account has been suspended by an administrator.' };
      }

      return { success: true, user: authenticatedUser };
    } catch (err: any) {
      return { success: false, error: err.message || 'Authentication failed.' };
    }
  }

  public async loginWithFirebase(email: string, password?: string) {
    return this.loginWithSupabase(email, password);
  }

  /**
   * Supabase-backed Student Registration
   */
  public async registerStudentWithSupabase(data: {
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
    if (existingProfiles.some((p) => p.registrationNumber?.toUpperCase() === regNorm)) {
      return { success: false, error: 'This student registration number is already registered on OUTPOST.' };
    }

    if (!data.password) {
      return { success: false, error: 'A password is required to create an account.' };
    }

    try {
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: emailNorm,
        password: data.password,
        options: {
          data: {
            full_name: data.fullName.trim(),
            role: 'student',
          },
        },
      });

      if (signUpError || !signUpData.user) {
        return { success: false, error: signUpError?.message || 'Registration failed.' };
      }

      const sbUser = signUpData.user;
      const newUser: User = {
        id: sbUser.id,
        email: emailNorm,
        role: 'student',
        accountStatus: 'email_unverified',
        emailVerified: Boolean(sbUser.email_confirmed_at),
        createdAt: new Date().toISOString(),
      };

      repository.createUser(newUser);
      repository.saveStudentProfile({
        userId: sbUser.id,
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

      repository.setActiveUserId(sbUser.id);
      return { success: true, user: newUser };
    } catch (err: any) {
      return { success: false, error: err.message || 'Registration failed.' };
    }
  }

  public async registerStudentWithFirebase(data: any) {
    return this.registerStudentWithSupabase(data);
  }

  /**
   * Supabase-backed Landlord Registration
   */
  public async registerLandlordWithSupabase(data: {
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

    if (!data.password) {
      return { success: false, error: 'A password is required to create an account.' };
    }

    try {
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: emailNorm,
        password: data.password,
        options: {
          data: {
            full_name: data.legalName.trim(),
            role: 'landlord',
          },
        },
      });

      if (signUpError || !signUpData.user) {
        return { success: false, error: signUpError?.message || 'Registration failed.' };
      }

      const sbUser = signUpData.user;
      const newUser: User = {
        id: sbUser.id,
        email: emailNorm,
        role: 'landlord',
        accountStatus: 'profile_pending',
        emailVerified: Boolean(sbUser.email_confirmed_at),
        createdAt: new Date().toISOString(),
      };

      repository.createUser(newUser);
      repository.saveLandlordProfile({
        userId: sbUser.id,
        legalName: data.legalName.trim(),
        phone: data.phone.trim(),
        contactAddress: data.contactAddress.trim(),
        idType: data.idType,
        idReference: data.idReference.trim(),
        businessName: data.businessName?.trim(),
        verificationStatus: 'pending',
        submittedAt: new Date().toISOString(),
      });

      repository.setActiveUserId(sbUser.id);
      return { success: true, user: newUser };
    } catch (err: any) {
      return { success: false, error: err.message || 'Registration failed.' };
    }
  }

  public async registerLandlordWithFirebase(data: any) {
    return this.registerLandlordWithSupabase(data);
  }

  public async sendPasswordReset(email: string): Promise<{ success: boolean; error?: string }> {
    const normalized = email.trim().toLowerCase();
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(normalized);
      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to send password reset email.' };
    }
  }

  public async resendVerificationEmail(): Promise<{ success: boolean; error?: string }> {
    const user = this.getCurrentUser();
    if (!user || !user.email) {
      return { success: false, error: 'No active user session.' };
    }
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email: user.email });
      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to resend verification email.' };
    }
  }

  public async refreshEmailVerification(): Promise<{ verified: boolean; error?: string }> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const isVerified = Boolean(user?.email_confirmed_at);
      if (user) {
        const existing = repository.getUserById(user.id);
        if (existing) {
          existing.emailVerified = isVerified;
          if (isVerified && existing.accountStatus === 'email_unverified') {
            existing.accountStatus = 'active';
          }
          repository.updateUser(existing);
        }
      }
      return { verified: isVerified };
    } catch (err: any) {
      return { verified: false, error: err.message || 'Could not refresh verification status.' };
    }
  }

  public async logout(): Promise<void> {
    await supabase.auth.signOut();
    repository.clearActiveSession();
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
}

export const authService = new AuthService();
