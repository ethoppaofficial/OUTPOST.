import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { UserPlus, AlertCircle, CheckCircle2 } from 'lucide-react';
import { authService } from '../../application/services/authService';
import { configValidationError, isSupabaseMode } from '../../infrastructure/config/appConfig';

export const RegisterPage: React.FC = () => {
  const [role, setRole] = useState<'student' | 'landlord'>('student');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  // Student specifics
  const [university, setUniversity] = useState('Bayero University Kano (BUK)');
  const [campus, setCampus] = useState('New Campus (Gwarzo Road)');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [studyLevel, setStudyLevel] = useState('200 Level');
  const [programme, setProgramme] = useState('Computer Science');
  const [gender, setGender] = useState<'Male' | 'Female' | 'Other'>('Male');
  // Landlord specifics
  const [legalName, setLegalName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [idType, setIdType] = useState('NIN');
  const [idReference, setIdReference] = useState('');
  const [address, setAddress] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [requiresConfirmation, setRequiresConfirmation] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const configError = configValidationError;
  const isSupabaseMisconfigured = !isSupabaseMode() || Boolean(configError);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSupabaseMisconfigured) {
      setError(configError || 'Supabase authentication is not configured.');
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      if (role === 'student') {
        const res = await authService.registerStudentWithSupabase({
          email,
          password,
          fullName,
          phone,
          registrationNumber,
          university,
          campus,
          studyLevel,
          programme,
          gender,
        });

        if (res.success && res.user) {
          setSuccess(true);
          if (res.requiresEmailConfirmation) {
            setRequiresConfirmation(true);
          } else {
            setTimeout(() => navigate('/student/verification'), 1200);
          }
        } else {
          setError(res.error || 'Failed to complete student registration.');
        }
      } else {
        const res = await authService.registerLandlordWithSupabase({
          email,
          password,
          legalName: legalName || fullName,
          phone,
          contactAddress: address || 'Dambare / Rimin Gata, Kano State, Nigeria',
          idType,
          idReference,
          businessName,
        });

        if (res.success && res.user) {
          setSuccess(true);
          if (res.requiresEmailConfirmation) {
            setRequiresConfirmation(true);
          } else {
            setTimeout(() => navigate('/landlord/verification'), 1200);
          }
        } else {
          setError(res.error || 'Failed to complete landlord registration.');
        }
      }
    } catch (err: any) {
      setError(err?.message || 'An unexpected error occurred during registration.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto my-6 sm:my-10 space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
          Create an OUTPOST Account
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Verified off-campus accommodation platform for Bayero University Kano (Dambare & Rimin Gata)
        </p>
      </div>

      {isSupabaseMisconfigured && (
        <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-600" />
          <div>
            <span className="font-bold block">Supabase Authentication Unavailable</span>
            <span>{configError}</span>
          </div>
        </div>
      )}

      {/* Role Picker (Public registration strictly allows Student or Landlord only) */}
      <div className="flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 text-xs font-semibold">
        <button
          type="button"
          onClick={() => setRole('student')}
          className={`flex-1 py-2 rounded-lg transition ${
            role === 'student'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-500'
          }`}
        >
          Student Account
        </button>
        <button
          type="button"
          onClick={() => setRole('landlord')}
          className={`flex-1 py-2 rounded-lg transition ${
            role === 'landlord'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-500'
          }`}
        >
          Landlord / Property Owner
        </button>
      </div>

      <div className="bg-white dark:bg-slate-900 p-6 sm:p-8 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xl space-y-4">
        {success ? (
          <div className="text-center py-8 space-y-3">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Account Created!</h3>
            {requiresConfirmation ? (
              <div className="space-y-3">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  We sent a confirmation link to <strong className="text-slate-800 dark:text-slate-200">{email}</strong>. Confirm your email address, then sign in to upload your verification documents.
                </p>
                <Link
                  to="/login"
                  className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  Continue to Sign In
                </Link>
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                Welcome to OUTPOST. Redirecting to your verification portal...
              </p>
            )}
          </div>
        ) : (
          <form onSubmit={handleRegister} className="space-y-4 text-xs">
            {/* Common fields */}
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700 dark:text-slate-300">Full Name</label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Aliyu Abubakar"
                className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="font-semibold text-slate-700 dark:text-slate-300">Active Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@buk.edu.ng"
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-slate-700 dark:text-slate-300">Phone (WhatsApp)</label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0803 123 4567"
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700 dark:text-slate-300">Password</label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
              />
            </div>

            {/* Student Specific Fields */}
            {role === 'student' && (
              <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="font-semibold text-slate-700 dark:text-slate-300">University</label>
                    <select
                      value={university}
                      onChange={(e) => setUniversity(e.target.value)}
                      className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                    >
                      <option value="Bayero University Kano (BUK)">Bayero University Kano (BUK)</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold text-slate-700 dark:text-slate-300">Registration Number</label>
                    <input
                      type="text"
                      required
                      value={registrationNumber}
                      onChange={(e) => setRegistrationNumber(e.target.value.toUpperCase())}
                      placeholder="e.g. BUK/23/SCI/01842"
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className="font-semibold text-slate-700 dark:text-slate-300">Study Level</label>
                    <select
                      value={studyLevel}
                      onChange={(e) => setStudyLevel(e.target.value)}
                      className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                    >
                      <option value="100 Level">100 Level</option>
                      <option value="200 Level">200 Level</option>
                      <option value="300 Level">300 Level</option>
                      <option value="400 Level">400 Level</option>
                      <option value="500 Level">500 Level</option>
                      <option value="Postgraduate">Postgraduate</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold text-slate-700 dark:text-slate-300">Programme</label>
                    <input
                      type="text"
                      required
                      value={programme}
                      onChange={(e) => setProgramme(e.target.value)}
                      placeholder="e.g. Biochemistry"
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold text-slate-700 dark:text-slate-300">Gender</label>
                    <select
                      value={gender}
                      onChange={(e) => setGender(e.target.value as 'Male' | 'Female' | 'Other')}
                      className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                    >
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Landlord Specific Fields */}
            {role === 'landlord' && (
              <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="font-semibold text-slate-700 dark:text-slate-300">Business / Trade Name</label>
                    <input
                      type="text"
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      placeholder="e.g. Danbatta Student Lodges Ltd"
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold text-slate-700 dark:text-slate-300">ID Document Type</label>
                    <select
                      value={idType}
                      onChange={(e) => setIdType(e.target.value)}
                      className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                    >
                      <option value="NIN">National Identity Number (NIN)</option>
                      <option value="VotersCard">Voter's Card (INEC)</option>
                      <option value="DriversLicense">FRSC Driver's License</option>
                      <option value="Passport">International Passport</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="font-semibold text-slate-700 dark:text-slate-300">ID Reference Number</label>
                  <input
                    type="text"
                    required
                    value={idReference}
                    onChange={(e) => setIdReference(e.target.value)}
                    placeholder="e.g. 11-digit NIN or License Number"
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono"
                  />
                </div>
              </div>
            )}

            {error && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || isSupabaseMisconfigured}
              className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-xs transition shadow-md flex items-center justify-center gap-2"
            >
              <UserPlus className="w-4 h-4" />
              <span>{submitting ? 'Creating Account...' : 'Register & Continue to Verification'}</span>
            </button>
          </form>
        )}

        <div className="text-center text-xs text-slate-500 pt-2">
          Already registered?{' '}
          <Link to="/login" className="font-semibold text-emerald-600 hover:underline">
            Sign In here
          </Link>
        </div>
      </div>
    </div>
  );
};
