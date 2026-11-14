import { supabase } from '../../infrastructure/supabase/supabaseClient';
import { User, UserRole, AccountStatus, StudentProfile, LandlordProfile } from '../../domain/types';
import { repository } from '../../infrastructure/repositories';
import { appConfig } from '../../infrastructure/config/appConfig';
import {
  normalizeRegistrationNumber,
  validateStudentRegistrationNumber,
} from '../utils/validation';

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
      let sbUser: any = null;

      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalized,
        password,
      });

      if (!error && data?.user) {
        sbUser = data.user;
      } else {
        // Do NOT fall back to local/seed records without credential verification.
        return { success: false, error: error?.message || 'Invalid email or password.' };
      }

      const userId = sbUser.id;
      repository.setActiveUserId(userId);

      // Fetch user profile from Supabase profiles table with bounded retries
      let profile: any = null;
      let profileError: any = null;

      for (let attempt = 0; attempt < 3; attempt++) {
        const { data: profData, error: profError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', userId)
          .maybeSingle();

        if (profData) {
          profile = profData;
          break;
        }
        if (profError) profileError = profError;
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
        }
      }

      if (!profile) {
        return {
          success: false,
          error: profileError
            ? 'Database error retrieving account profile: ' + profileError.message
            : 'User profile does not exist in public.profiles. Please contact support.',
        };
      }

      const storedRole = profile.role as UserRole | undefined;
      let validRole: UserRole | null = null;
      if (storedRole === 'admin') validRole = 'admin';
      else if (storedRole === 'landlord') validRole = 'landlord';
      else if (storedRole === 'student') validRole = 'student';

      if (!validRole) {
        return { success: false, error: 'Invalid profile role in database.' };
      }

      if (profile.account_status === 'suspended') {
        await supabase.auth.signOut();
        return { success: false, error: 'Your account has been suspended by an administrator.' };
      }

      if (validRole === 'admin' && profile.account_status !== 'active') {
        await supabase.auth.signOut();
        return { success: false, error: 'Administrator account is not active.' };
      }

      const existing = repository.getUserById(userId);
      const authenticatedUser: User = {
        ...(existing || {
          id: userId,
          email: sbUser.email || normalized,
          accountStatus: (profile.account_status as AccountStatus) || 'active',
          emailVerified: Boolean(sbUser.email_confirmed_at),
          createdAt: sbUser.created_at || new Date().toISOString(),
        }),
        id: userId,
        email: sbUser.email || normalized,
        role: validRole,
        accountStatus: (profile.account_status as AccountStatus) || 'active',
        emailVerified: Boolean(sbUser.email_confirmed_at),
        fullName: profile.full_name || sbUser.user_metadata?.full_name || '',
        avatarUrl: profile.avatar_url || sbUser.user_metadata?.avatar_url || '',
      };

      repository.createUser(authenticatedUser);
      return { success: true, user: authenticatedUser };
    } catch (err: any) {
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
   * Checks normalized student registration number availability against Supabase DB.
   */
  public async checkRegistrationNumberAvailability(
    rawRegNumber: string
  ): Promise<{ available: boolean; normalized: string; error?: string }> {
    const check = validateStudentRegistrationNumber(rawRegNumber);
    if (!check.isValid) {
      return { available: false, normalized: check.normalized, error: check.error };
    }

    const existingProfiles = repository.getStudentProfiles();
    if (existingProfiles.some((p) => normalizeRegistrationNumber(p.registrationNumber) === check.normalized)) {
      return {
        available: false,
        normalized: check.normalized,
        error: 'This student registration number is already registered on OUTPOST.',
      };
    }

    try {
      const { data, error } = await supabase.rpc('is_registration_number_available', {
        p_reg_number: check.normalized,
      });
      if (!error && data === false) {
        return {
          available: false,
          normalized: check.normalized,
          error: 'This student registration number is already registered on OUTPOST.',
        };
      }
    } catch {
      // DB trigger & unique index remain authoritative if RPC check fails due to network
    }

    return { available: true, normalized: check.normalized };
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
  }): Promise<{ success: boolean; user?: User; requiresEmailConfirmation?: boolean; error?: string }> {
    const emailNorm = data.email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailNorm) || emailNorm.includes('tempmail') || emailNorm.includes('disposable')) {
      return { success: false, error: 'A valid, active academic or personal email is required.' };
    }

    const regCheck = validateStudentRegistrationNumber(data.registrationNumber);
    if (!regCheck.isValid) {
      return { success: false, error: regCheck.error };
    }
    const regNorm = regCheck.normalized;

    const availability = await this.checkRegistrationNumberAvailability(regNorm);
    if (!availability.available) {
      return {
        success: false,
        error: availability.error || 'This student registration number is already registered on OUTPOST.',
      };
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
            phone: data.phone.trim(),
            registration_number: regNorm,
            university: data.university,
            campus: data.campus,
            study_level: data.studyLevel,
            gender: data.gender?.toLowerCase() || 'other',
          },
        },
      });

      if (signUpError || !signUpData.user) {
        let msg = signUpError?.message || 'Registration failed.';
        const lowerMsg = msg.toLowerCase();
        if (lowerMsg.includes('error sending confirmation email')) {
          msg = 'Unable to send confirmation email. Please disable "Confirm email" or verify SMTP settings in your Supabase Dashboard (Authentication > Providers > Email).';
        } else if (
          (signUpError as any)?.code === '23505' ||
          lowerMsg.includes('registration number') ||
          lowerMsg.includes('uq_student_profiles_registration_number') ||
          lowerMsg.includes('duplicate key')
        ) {
          msg = 'This student registration number is already registered on OUTPOST.';
        }
        return { success: false, error: msg };
      }

      const sbUser = signUpData.user;
      const hasSession = Boolean(signUpData.session);
      const newUser: User = {
        id: sbUser.id,
        email: emailNorm,
        fullName: data.fullName.trim(),
        phone: data.phone.trim(),
        role: 'student',
        accountStatus: sbUser.email_confirmed_at ? 'active' : 'email_unverified',
        emailVerified: Boolean(sbUser.email_confirmed_at),
        createdAt: new Date().toISOString(),
      };

      // Only write authenticated DB companion updates when Supabase issued a live session.
      // When email confirmation is required (session === null), handle_new_user() trigger has already
      // provisioned public.profiles and public.student_profiles safely on the database side.
      if (hasSession) {
        await supabase
          .from('profiles')
          .update({
            full_name: data.fullName.trim(),
            phone: data.phone.trim(),
          })
          .eq('id', sbUser.id);

        const { error: spUpsertError } = await supabase
          .from('student_profiles')
          .upsert(
            {
              user_id: sbUser.id,
              institution: data.university,
              campus: data.campus,
              study_level: data.studyLevel,
              registration_number: regNorm,
              gender: data.gender?.toLowerCase() || 'other',
              is_profile_verified: false,
            },
            { onConflict: 'user_id' }
          );

        if (spUpsertError) {
          const spMsg = String(spUpsertError.message || '').toLowerCase();
          if (
            spUpsertError.code === '23505' ||
            spMsg.includes('uq_student_profiles_registration_number') ||
            spMsg.includes('registration_number')
          ) {
            await supabase.auth.signOut().catch(() => {});
            return {
              success: false,
              error: 'This student registration number is already registered on OUTPOST.',
            };
          }
        }

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
      }

      return { success: true, user: newUser, requiresEmailConfirmation: !hasSession };
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
  }): Promise<{ success: boolean; user?: User; requiresEmailConfirmation?: boolean; error?: string }> {
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
            phone: data.phone.trim(),
          },
        },
      });

      if (signUpError || !signUpData.user) {
        let msg = signUpError?.message || 'Registration failed.';
        if (msg.toLowerCase().includes('error sending confirmation email')) {
          msg = 'Unable to send confirmation email. Please disable "Confirm email" or verify SMTP settings in your Supabase Dashboard (Authentication > Providers > Email).';
        }
        return { success: false, error: msg };
      }

      const sbUser = signUpData.user;
      const hasSession = Boolean(signUpData.session);
      const newUser: User = {
        id: sbUser.id,
        email: emailNorm,
        fullName: data.legalName.trim(),
        phone: data.phone.trim(),
        role: 'landlord',
        accountStatus: 'profile_pending',
        emailVerified: Boolean(sbUser.email_confirmed_at),
        createdAt: new Date().toISOString(),
      };

      if (hasSession) {
        await supabase
          .from('profiles')
          .update({
            full_name: data.legalName.trim(),
            phone: data.phone.trim(),
          })
          .eq('id', sbUser.id);

        await supabase
          .from('landlord_profiles')
          .upsert(
            {
              user_id: sbUser.id,
              company_name: data.businessName?.trim() || data.legalName.trim(),
              business_address: data.contactAddress.trim(),
              tax_id: data.idReference.trim(),
              verification_status: 'not_started',
            },
            { onConflict: 'user_id' }
          );

        repository.createUser(newUser);
        repository.saveLandlordProfile({
          userId: sbUser.id,
          legalName: data.legalName.trim(),
          phone: data.phone.trim(),
          contactAddress: data.contactAddress.trim(),
          idType: data.idType,
          idReference: data.idReference.trim(),
          businessName: data.businessName?.trim(),
          // Match authoritative DB initial state ('not_started' until evidence document is uploaded)
          verificationStatus: 'not_started',
        });
        repository.setActiveUserId(sbUser.id);
      }

      return { success: true, user: newUser, requiresEmailConfirmation: !hasSession };
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
      const redirectUrl = typeof window !== 'undefined'
        ? `${window.location.origin}/reset-password`
        : undefined;

      const { error } = await supabase.auth.resetPasswordForEmail(normalized, {
        redirectTo: redirectUrl,
      });
      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to send password reset email.' };
    }
  }

  public async updatePassword(newPassword: string): Promise<{ success: boolean; error?: string }> {
    if (!newPassword || newPassword.length < 6) {
      return { success: false, error: 'Password must be at least 6 characters long.' };
    }
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to update password.' };
    }
  }

  public async resetPasswordWithOtp(
    email: string,
    token: string,
    newPassword: string
  ): Promise<{ success: boolean; error?: string }> {
    const cleanEmail = email.trim().toLowerCase();
    const cleanToken = token.trim();

    if (!cleanEmail || !cleanToken) {
      return { success: false, error: 'Email and 6-digit verification code are required.' };
    }

    if (!newPassword || newPassword.length < 6) {
      return { success: false, error: 'Password must be at least 6 characters long.' };
    }

    try {
      const { data, error: otpError } = await supabase.auth.verifyOtp({
        email: cleanEmail,
        token: cleanToken,
        type: 'recovery',
      });

      if (otpError || !data?.session) {
        return {
          success: false,
          error: otpError?.message || 'Invalid or expired 6-digit reset code.',
        };
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        return { success: false, error: updateError.message };
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to verify reset code.' };
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
