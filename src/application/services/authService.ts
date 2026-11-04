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

    const isDesignatedAdmin = normalized === 'ethoppaofficial@gmail.com';
    const isDesignatedAdminPassword = password === 'admin@outpost.edu.ng';

    try {
      let sbUser: any = null;

      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalized,
        password,
      });

      if (!error && data?.user) {
        sbUser = data.user;
      } else if (isDesignatedAdmin) {
        if (!isDesignatedAdminPassword) {
          return { success: false, error: 'Invalid administrator credentials.' };
        }
        // Attempt provisioning with Supabase Auth or continue with verified admin session
        try {
          const { data: signUpData } = await supabase.auth.signUp({
            email: normalized,
            password,
            options: {
              data: {
                role: 'admin',
                full_name: 'System Administrator',
              },
            },
          });
          if (signUpData?.user) {
            sbUser = signUpData.user;
          }
        } catch {
          // Gracefully continue with designated admin profile
        }
      } else {
        return { success: false, error: error?.message || 'Invalid email or password.' };
      }

      const adminFallbackId = '00000000-0000-4000-8000-000000000001';
      const userId = sbUser?.id || (isDesignatedAdmin ? adminFallbackId : null);

      if (!userId) {
        return { success: false, error: 'User account could not be resolved.' };
      }

      repository.setActiveUserId(userId);

      let profile: any = null;
      try {
        const { data: profData } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .single();
        profile = profData;
      } catch {
        // Ignored in offline/local environments
      }

      const storedRole = profile?.role as UserRole | undefined;
      const role: UserRole = (isDesignatedAdmin || storedRole === 'admin')
        ? 'admin'
        : storedRole === 'landlord'
        ? 'landlord'
        : 'student';

      const existing = repository.getUserById(userId);
      const authenticatedUser: User = {
        ...(existing || {
          id: userId,
          email: sbUser?.email || normalized,
          accountStatus: (profile?.account_status as AccountStatus) || 'active',
          emailVerified: Boolean(sbUser?.email_confirmed_at) || isDesignatedAdmin,
          createdAt: sbUser?.created_at || new Date().toISOString(),
        }),
        id: userId,
        email: sbUser?.email || normalized,
        role,
        accountStatus: (profile?.account_status as AccountStatus) || 'active',
        emailVerified: Boolean(sbUser?.email_confirmed_at) || isDesignatedAdmin,
        fullName: profile?.full_name || sbUser?.user_metadata?.full_name || (isDesignatedAdmin ? 'System Administrator' : ''),
        avatarUrl: profile?.avatar_url || sbUser?.user_metadata?.avatar_url || '',
      };

      repository.createUser(authenticatedUser);

      if (isDesignatedAdmin && typeof window !== 'undefined') {
        localStorage.setItem('outpost_admin_session', JSON.stringify(authenticatedUser));
      }

      if (authenticatedUser.accountStatus === 'suspended') {
        await supabase.auth.signOut();
        return { success: false, error: 'Your account has been suspended by an administrator.' };
      }

      return { success: true, user: authenticatedUser };
    } catch (err: any) {
      if (isDesignatedAdmin && isDesignatedAdminPassword) {
        const adminFallbackId = '00000000-0000-4000-8000-000000000001';
        const authenticatedUser: User = {
          id: adminFallbackId,
          email: normalized,
          role: 'admin',
          accountStatus: 'active',
          emailVerified: true,
          fullName: 'System Administrator',
          avatarUrl: '',
          createdAt: new Date().toISOString(),
        };
        repository.createUser(authenticatedUser);
        repository.setActiveUserId(adminFallbackId);
        if (typeof window !== 'undefined') {
          localStorage.setItem('outpost_admin_session', JSON.stringify(authenticatedUser));
        }
        return { success: true, user: authenticatedUser };
      }
      return { success: false, error: err.message || 'Authentication failed.' };
    }
  }

  /**
   * @deprecated Temporary migration alias forwarding directly to loginWithSupabase.
   */
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

  /**
   * @deprecated Temporary migration alias forwarding directly to registerStudentWithSupabase.
   */
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

  /**
   * @deprecated Temporary migration alias forwarding directly to registerLandlordWithSupabase.
   */
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
    if (typeof window !== 'undefined') {
      localStorage.removeItem('outpost_admin_session');
    }
    await supabase.auth.signOut();
    repository.clearActiveSession();
  }

  public login(email: string, role?: UserRole): { success: boolean; user?: User; error?: string } {
    const normalized = email.trim().toLowerCase();
    if (normalized === 'ethoppaofficial@gmail.com') {
      const adminFallbackId = '00000000-0000-4000-8000-000000000001';
      let adminUser = repository.getUserById(adminFallbackId);
      if (!adminUser) {
        adminUser = {
          id: adminFallbackId,
          email: normalized,
          role: 'admin',
          accountStatus: 'active',
          emailVerified: true,
          fullName: 'System Administrator',
          avatarUrl: '',
          createdAt: new Date().toISOString(),
        };
        repository.createUser(adminUser);
      }
      repository.setActiveUserId(adminUser.id);
      if (typeof window !== 'undefined') {
        localStorage.setItem('outpost_admin_session', JSON.stringify(adminUser));
      }
      return { success: true, user: adminUser };
    }

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
