/**
 * @file PublicProfilePage.tsx
 * @description Read-only public profile views for Landlords (`/profiles/landlord/:userId`)
 * and Students (`/profiles/student/:userId`).
 *
 * Security & Privacy Discipline:
 * - Strictly renders non-PII public fields returned by scoped PostgreSQL RPCs.
 * - Never renders email, phone, NIN/Tax ID, verification documents, or landlord bank details.
 * - Student profiles require an authenticated session and enforce suspended-account handling.
 */

import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  Calendar,
  GraduationCap,
  IdCard,
  Loader2,
  Lock,
  MapPin,
  ShieldAlert,
  User as UserIcon,
} from 'lucide-react';
import { verificationService } from '../../application/services/verificationService';
import { useAuth } from '../../application/context/AuthContext';
import { PublicLandlordProfile, PublicStudentProfile } from '../../domain/types';
import { VerificationBadge, VerificationTick } from '../../components/ui/Badge';

export const PublicProfilePage: React.FC = () => {
  const { userId } = useParams<{ userId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, loading: authLoading } = useAuth();

  const isStudentRoute = location.pathname.includes('/profiles/student/');
  const profileKind: 'student' | 'landlord' = isStudentRoute ? 'student' : 'landlord';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [landlordProfile, setLandlordProfile] = useState<PublicLandlordProfile | null>(null);
  const [studentProfile, setStudentProfile] = useState<PublicStudentProfile | null>(null);

  const isAuthenticated = Boolean(currentUser && currentUser.id && currentUser.id !== 'anonymous');

  useEffect(() => {
    let active = true;
    if (!userId) {
      setLoading(false);
      setError('Profile identifier is missing.');
      return;
    }

    if (profileKind === 'student' && authLoading) {
      return;
    }

    if (profileKind === 'student' && !isAuthenticated) {
      setLoading(false);
      setStudentProfile(null);
      return;
    }

    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        if (profileKind === 'landlord') {
          const res = await verificationService.getPublicLandlordProfile(userId);
          if (!active) return;
          setLandlordProfile(res);
          setStudentProfile(null);
        } else {
          const res = await verificationService.getPublicStudentProfile(userId);
          if (!active) return;
          setStudentProfile(res);
          setLandlordProfile(null);
        }
      } catch (err: any) {
        if (!active) return;
        setError(err?.message || 'Unable to load public profile.');
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [userId, profileKind, isAuthenticated, authLoading]);

  if (loading || (profileKind === 'student' && authLoading)) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center space-y-3">
        <Loader2 className="w-7 h-7 animate-spin text-emerald-500 mx-auto" />
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Loading {profileKind === 'landlord' ? 'landlord' : 'student'} profile...
        </p>
      </div>
    );
  }

  if (profileKind === 'student' && !isAuthenticated) {
    return (
      <div className="max-w-xl mx-auto my-12 p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center mx-auto">
          <Lock className="w-6 h-6" />
        </div>
        <h1 className="text-lg font-bold text-slate-900 dark:text-white">
          Sign In Required for Student Profiles
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
          Student profiles and academic registration numbers are protected and visible only to signed-in OUTPOST members.
        </p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <Link
            to="/login"
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
          >
            Sign In to View Profile
          </Link>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const profile = profileKind === 'landlord' ? landlordProfile : studentProfile;

  if (error || !profile || !profile.found || profile.unavailable) {
    return (
      <div className="max-w-xl mx-auto my-12 p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 flex items-center justify-center mx-auto">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h1 className="text-lg font-bold text-slate-900 dark:text-white">
          {profile?.unavailable ? 'Account Unavailable' : 'Profile Not Found'}
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
          {error ||
            profile?.reason ||
            'This account profile is unavailable or does not exist.'}
        </p>
        <div className="pt-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 dark:bg-slate-800 text-white text-xs font-semibold"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Go Back</span>
          </button>
        </div>
      </div>
    );
  }

  const memberSince = profile.createdAt
    ? new Date(profile.createdAt).toLocaleDateString('en-NG', { month: 'short', year: 'numeric' })
    : 'OUTPOST Member';

  return (
    <div className="max-w-2xl mx-auto space-y-6 py-4">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:hover:text-white"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Back</span>
      </button>

      <div className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-5">
          {profile.avatarUrl ? (
            <img
              src={profile.avatarUrl}
              alt={profile.displayName}
              className="w-20 h-20 rounded-2xl object-cover border border-slate-200 dark:border-slate-700 shrink-0"
            />
          ) : (
            <div className="w-20 h-20 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 shrink-0 border border-slate-200 dark:border-slate-700">
              <UserIcon className="w-9 h-9" />
            </div>
          )}

          <div className="space-y-2 flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight truncate">
                {profile.displayName}
              </h1>
              <VerificationTick
                type={profile.role}
                isVerified={profile.isVerified}
                size="md"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <VerificationBadge
                type={profile.role}
                status={profile.isVerified ? 'approved' : 'not_started'}
              />
              <span className="text-xs text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                Joined {memberSince}
              </span>
            </div>
          </div>
        </div>

        {profile.role === 'landlord' && landlordProfile && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-5 border-t border-slate-100 dark:border-slate-800 text-xs">
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60 space-y-1">
              <span className="text-slate-400 font-medium flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-emerald-500" />
                Host / Business Name
              </span>
              <p className="font-bold text-slate-900 dark:text-white">
                {landlordProfile.companyName || landlordProfile.displayName}
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60 space-y-1">
              <span className="text-slate-400 font-medium flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-emerald-500" />
                Approved Listings on OUTPOST
              </span>
              <p className="font-bold text-slate-900 dark:text-white">
                {landlordProfile.approvedListingsCount ?? 0} verified accommodation(s)
              </p>
            </div>
          </div>
        )}

        {profile.role === 'student' && studentProfile && (
          <div className="space-y-4 pt-5 border-t border-slate-100 dark:border-slate-800 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60 space-y-1">
                <span className="text-slate-400 font-medium flex items-center gap-1.5">
                  <IdCard className="w-3.5 h-3.5 text-emerald-500" />
                  Registration Number
                </span>
                <p className="font-mono font-bold text-slate-900 dark:text-white">
                  {studentProfile.registrationNumber || 'Not provided'}
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60 space-y-1">
                <span className="text-slate-400 font-medium flex items-center gap-1.5">
                  <GraduationCap className="w-3.5 h-3.5 text-emerald-500" />
                  Academic Institution
                </span>
                <p className="font-bold text-slate-900 dark:text-white">
                  {studentProfile.university || 'Bayero University Kano'}
                </p>
                {studentProfile.campus && (
                  <p className="text-slate-500 dark:text-slate-400">{studentProfile.campus}</p>
                )}
              </div>
            </div>

            {(studentProfile.faculty || studentProfile.department || studentProfile.studyLevel) && (
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60 grid grid-cols-1 sm:grid-cols-3 gap-3">
                {studentProfile.faculty && (
                  <div>
                    <span className="text-slate-400 block">Faculty</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{studentProfile.faculty}</span>
                  </div>
                )}
                {studentProfile.department && (
                  <div>
                    <span className="text-slate-400 block">Department</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{studentProfile.department}</span>
                  </div>
                )}
                {studentProfile.studyLevel && (
                  <div>
                    <span className="text-slate-400 block">Study Level</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{studentProfile.studyLevel}</span>
                  </div>
                )}
              </div>
            )}

            {studentProfile.bio && (
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60 space-y-1">
                <span className="text-slate-400 font-medium block">About</span>
                <p className="text-slate-700 dark:text-slate-300 leading-relaxed">{studentProfile.bio}</p>
              </div>
            )}
          </div>
        )}

        <div className="pt-2 flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-400 border-t border-slate-100 dark:border-slate-800">
          <span>Public read-only profile • Private contact &amp; KYC records are never exposed.</span>
          <Link to="/properties" className="text-emerald-600 dark:text-emerald-400 font-semibold hover:underline">
            Browse Available Accommodations →
          </Link>
        </div>
      </div>
    </div>
  );
};
