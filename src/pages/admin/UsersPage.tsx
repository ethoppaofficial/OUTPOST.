/**
 * @file UsersPage.tsx
 * @module pages/admin/UsersPage
 * @description Administrative user directory for inspecting live profiles and enforcing account suspensions.
 */

import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Ban,
  Building2,
  CalendarCheck,
  ExternalLink,
  Eye,
  FileCheck2,
  GraduationCap,
  Loader2,
  Mail,
  Megaphone,
  Phone,
  Search,
  ShieldCheck,
  ShieldOff,
  UserCheck,
} from 'lucide-react';
import {
  adminService,
  AdminRecord,
  AdminUser,
  AdminUserProfileDetails,
} from '../../application/services/adminService';
import { storageService } from '../../application/services/storageService';
import { useAdminData } from '../../application/hooks/useAdminData';
import { UserRole } from '../../domain/types';
import { AdminStatusBar } from '../../components/admin/AdminStatusBar';
import { Badge, VerificationBadge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';

type EvidencePreviewKind = 'image' | 'pdf' | null;

function getEvidencePreviewKind(item: AdminRecord): EvidencePreviewKind {
  const contentType = String(item.content_type || item.contentType || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (contentType) {
    if (contentType === 'application/pdf') return 'pdf';
    if (['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) return 'image';
    return null;
  }

  const extension = String(item.file_name || item.fileName || '')
    .toLowerCase()
    .split('.')
    .pop();
  if (extension === 'pdf') return 'pdf';
  if (['jpg', 'jpeg', 'png', 'webp'].includes(extension || '')) return 'image';
  return null;
}

function formatDate(value?: string | null): string {
  if (!value) return 'Not recorded';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Not recorded' : parsed.toLocaleString();
}

export const UsersPage: React.FC = () => {
  const {
    data: usersData,
    loading,
    refreshing,
    error: loadError,
    isLive,
    lastUpdatedAt,
    refresh,
  } = useAdminData<AdminUser[]>(() => adminService.getUsers(), [], {
    realtimeTables: ['profiles', 'student_profiles', 'landlord_profiles'],
  });

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [target, setTarget] = useState<AdminUser | null>(null);
  const [reason, setReason] = useState('');
  const [revokeTarget, setRevokeTarget] = useState<AdminUser | null>(null);
  const [revokeReason, setRevokeReason] = useState('');

  // Profile viewer modal state
  const [viewingUser, setViewingUser] = useState<AdminUser | null>(null);
  const [profileDetails, setProfileDetails] = useState<AdminUserProfileDetails | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [openingDocId, setOpeningDocId] = useState<string | null>(null);
  const [signedPreview, setSignedPreview] = useState<{
    id: string;
    url: string;
    fileName?: string;
    previewKind: EvidencePreviewKind;
  } | null>(null);

  const users = !loadError && usersData ? usersData : [];

  const filtered = useMemo(
    () =>
      users.filter((user) => {
        const query = search.trim().toLowerCase();
        const profileNumber = user.studentProfile?.registrationNumber || user.studentProfile?.registration_number || '';
        const business = user.landlordProfile?.businessName || user.landlordProfile?.company_name || '';
        const roleMatches = roleFilter === 'all' || user.role === roleFilter;
        const textMatches =
          !query ||
          [user.name, user.fullName, user.email, user.id, profileNumber, business].some((value) =>
            String(value || '').toLowerCase().includes(query)
          );
        return roleMatches && textMatches;
      }),
    [users, search, roleFilter]
  );

  const openProfileModal = async (user: AdminUser) => {
    setViewingUser(user);
    setProfileDetails(null);
    setProfileError(null);
    setSignedPreview(null);
    setProfileLoading(true);
    try {
      const details = await adminService.getUserProfileDetails(user.id);
      setProfileDetails(details);
    } catch (cause) {
      setProfileError(cause instanceof Error ? cause.message : 'Unable to load full user profile details.');
    } finally {
      setProfileLoading(false);
    }
  };

  const closeProfileModal = () => {
    setViewingUser(null);
    setProfileDetails(null);
    setProfileError(null);
    setSignedPreview(null);
  };

  const handleOpenEvidence = async (
    kind: 'student-document' | 'landlord-document',
    doc: AdminRecord
  ) => {
    setOpeningDocId(doc.id);
    setProfileError(null);
    setSignedPreview(null);
    try {
      const url = await storageService.getPrivateAssetDownloadUrl(kind, doc.id);
      setSignedPreview({
        id: doc.id,
        url,
        fileName: doc.file_name || doc.fileName,
        previewKind: getEvidencePreviewKind(doc),
      });
    } catch (cause) {
      setProfileError(cause instanceof Error ? cause.message : 'Unable to retrieve signed evidence link.');
    } finally {
      setOpeningDocId(null);
    }
  };

  const changeStatus = async (user: AdminUser, status: 'active' | 'suspended', note?: string) => {
    setBusyId(user.id);
    setActionError(null);
    setSuccess(null);
    try {
      await adminService.setUserStatus(user.id, status, note);
      await refresh();
      if (viewingUser?.id === user.id) {
        void openProfileModal({ ...user, status, accountStatus: status });
      }
      setSuccess(`${user.email} account ${status === 'suspended' ? 'suspended' : 'reactivated'}; the action was audited.`);
      setTarget(null);
      setReason('');
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'The account status could not be changed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleRevokeVerification = async (user: AdminUser, reasonText: string) => {
    setBusyId(user.id);
    setActionError(null);
    setSuccess(null);
    try {
      await adminService.revokeUserVerification(user.id, reasonText);
      await refresh();
      if (viewingUser?.id === user.id) {
        void openProfileModal({ ...user, isVerified: false });
      }
      setSuccess(`Verification revoked for ${user.email}; authoritative badge removed and action audited.`);
      setRevokeTarget(null);
      setRevokeReason('');
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Verification could not be revoked.');
    } finally {
      setBusyId(null);
    }
  };

  const isUserVerified = (user: AdminUser): boolean => {
    if (user.role === 'student') {
      return Boolean(
        user.isVerified ||
          user.studentProfile?.isProfileVerified ||
          user.studentProfile?.is_profile_verified
      );
    }
    if (user.role === 'landlord') {
      return Boolean(
        user.isVerified ||
          user.landlordProfile?.verificationStatus === 'approved' ||
          user.landlordProfile?.verification_status === 'approved'
      );
    }
    return false;
  };

  const inspectedUser = profileDetails?.user || viewingUser;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white">User management</h1>
          <p className="mt-1 text-sm text-slate-500">
            Live Supabase user profiles. Identity documents are reviewed separately in the verification queue.
          </p>
        </div>
        <Link
          to="/admin/broadcasts"
          className="inline-flex items-center gap-1.5 self-start rounded-xl bg-purple-600 px-4 py-2 text-xs font-semibold text-white hover:bg-purple-500"
        >
          <Megaphone className="h-3.5 w-3.5" />
          Broadcast message
        </Link>
      </header>

      <AdminStatusBar
        isLive={isLive}
        loading={loading}
        refreshing={refreshing}
        error={loadError}
        lastUpdatedAt={lastUpdatedAt}
        onRefresh={() => void refresh()}
      />

      {actionError && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
          {actionError}
        </div>
      )}
      {success && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
          {success}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            maxLength={120}
            placeholder="Search name, email, UID, matriculation, or business"
            className="w-full bg-transparent text-sm outline-none"
          />
        </label>
        <select
          value={roleFilter}
          onChange={(event) => setRoleFilter(event.target.value as 'all' | UserRole)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-800 dark:bg-slate-900"
        >
          <option value="all">All roles</option>
          <option value="student">Students</option>
          <option value="landlord">Landlords</option>
          <option value="admin">Administrators</option>
        </select>
      </div>

      {loading && !usersData ? (
        <p className="text-sm text-slate-500">Loading users…</p>
      ) : loadError ? null : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-700">
          No matching platform users.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-slate-50 uppercase text-slate-500 dark:bg-slate-800/70">
              <tr>
                <th className="p-3">Account</th>
                <th className="p-3">Role</th>
                <th className="p-3">Account status</th>
                <th className="p-3">Verification</th>
                <th className="p-3 text-right">Admin action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((user) => {
                const suspended = user.status === 'suspended' || user.accountStatus === 'suspended';
                return (
                  <tr key={user.id} className="align-top">
                    <td className="p-3">
                      <p className="font-bold text-slate-900 dark:text-white">{user.name || user.fullName || 'User'}</p>
                      <p className="mt-1 text-slate-500">{user.email}</p>
                      <p className="mt-1 break-all font-mono text-[10px] text-slate-400">{user.id}</p>
                    </td>
                    <td className="p-3">
                      <Badge variant={user.role === 'admin' ? 'danger' : user.role === 'landlord' ? 'warning' : 'info'}>
                        {user.role}
                      </Badge>
                    </td>
                    <td className="p-3">{user.status || user.accountStatus || 'active'}</td>
                    <td className="space-y-1 p-3">
                      {user.role === 'student' && (
                        <VerificationBadge
                          type="student"
                          status={Boolean(user.studentProfile?.isProfileVerified || user.studentProfile?.is_profile_verified)}
                        />
                      )}
                      {user.role === 'landlord' && (
                        <VerificationBadge
                          type="landlord"
                          status={user.landlordProfile?.verificationStatus || user.landlordProfile?.verification_status || 'not_started'}
                        />
                      )}
                      {user.role === 'admin' && <Badge variant="danger">Administrator</Badge>}
                    </td>
                    <td className="p-3 text-right">
                      <div className="inline-flex flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => void openProfileModal(user)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          View profile
                        </button>
                        <Link
                          to={`/admin/broadcasts?userId=${encodeURIComponent(user.id)}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 font-semibold text-purple-700 hover:bg-purple-100 dark:border-purple-800 dark:bg-purple-950/30 dark:text-purple-300"
                        >
                          <Megaphone className="h-3.5 w-3.5" />
                          Notify
                        </Link>
                        {user.role !== 'admin' && isUserVerified(user) && (
                          <button
                            type="button"
                            disabled={busyId === user.id}
                            onClick={() => {
                              setRevokeTarget(user);
                              setRevokeReason('');
                            }}
                            className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-3 py-2 font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:bg-amber-950/30 dark:text-amber-300 cursor-pointer"
                          >
                            <ShieldOff className="h-3.5 w-3.5" />
                            Revoke verification
                          </button>
                        )}
                        {user.role !== 'admin' && (
                          <button
                            type="button"
                            disabled={busyId === user.id}
                            onClick={() => {
                              if (suspended) void changeStatus(user, 'active');
                              else {
                                setTarget(user);
                                setReason('');
                              }
                            }}
                            className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 font-semibold disabled:opacity-50 cursor-pointer ${
                              suspended
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                                : 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300'
                            }`}
                          >
                            {suspended ? <UserCheck className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                            {busyId === user.id ? 'Saving…' : suspended ? 'Reactivate' : 'Suspend'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
        Suspensions update the PostgreSQL account record via the privileged <span className="font-mono">admin_set_user_status</span> RPC with audit logging. Administrators cannot be suspended here.
      </div>

      {/* User Profile Inspection Modal */}
      <Modal
        isOpen={!!viewingUser}
        onClose={closeProfileModal}
        title={inspectedUser ? `${inspectedUser.fullName || inspectedUser.name} — User Profile` : 'User Profile'}
        maxWidth="3xl"
      >
        {inspectedUser && (
          <div className="space-y-5 text-xs">
            {/* Account Header */}
            <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/50 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3.5 min-w-0">
                {inspectedUser.avatarUrl ? (
                  <img
                    src={inspectedUser.avatarUrl}
                    alt={inspectedUser.fullName || inspectedUser.name}
                    className="h-12 w-12 shrink-0 rounded-full object-cover ring-2 ring-emerald-500/30"
                  />
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-base font-bold text-white">
                    {(inspectedUser.fullName || inspectedUser.name || 'U').trim().charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900 dark:text-white truncate">
                      {inspectedUser.fullName || inspectedUser.name || 'User'}
                    </h3>
                    <Badge variant={inspectedUser.role === 'admin' ? 'danger' : inspectedUser.role === 'landlord' ? 'warning' : 'info'}>
                      {inspectedUser.role}
                    </Badge>
                    <Badge variant={(inspectedUser.status || inspectedUser.accountStatus) === 'suspended' ? 'danger' : 'success'}>
                      {inspectedUser.status || inspectedUser.accountStatus || 'active'}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-slate-600 dark:text-slate-300">
                    <span className="inline-flex items-center gap-1">
                      <Mail className="h-3.5 w-3.5 text-slate-400" />
                      {inspectedUser.email || 'No email'}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Phone className="h-3.5 w-3.5 text-slate-400" />
                      {inspectedUser.phone || 'No phone supplied'}
                    </span>
                  </div>
                  <p className="break-all font-mono text-[10px] text-slate-400">
                    UID: {inspectedUser.id} · Joined: {formatDate(inspectedUser.createdAt)}
                  </p>
                </div>
              </div>
              <div className="shrink-0">
                {inspectedUser.role === 'student' && (
                  <VerificationBadge
                    type="student"
                    status={Boolean(
                      profileDetails?.studentProfile?.isProfileVerified ||
                        profileDetails?.studentProfile?.is_profile_verified ||
                        inspectedUser.studentProfile?.isProfileVerified
                    )}
                  />
                )}
                {inspectedUser.role === 'landlord' && (
                  <VerificationBadge
                    type="landlord"
                    status={
                      profileDetails?.landlordProfile?.verificationStatus ||
                      profileDetails?.landlordProfile?.verification_status ||
                      inspectedUser.landlordProfile?.verificationStatus ||
                      'not_started'
                    }
                  />
                )}
              </div>
            </div>

            {profileLoading && (
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 p-4 text-slate-500 dark:border-slate-800">
                <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                <span>Loading full database profile, documents, and activity…</span>
              </div>
            )}

            {profileError && (
              <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
                {profileError}
              </div>
            )}

            {!profileLoading && profileDetails && inspectedUser.role === 'student' && (
              <div className="space-y-4">
                {/* Student Academic Profile */}
                <section className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800 space-y-3">
                  <h4 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                    <GraduationCap className="h-4 w-4 text-emerald-600" /> Student Academic Profile
                  </h4>
                  {profileDetails.studentProfile ? (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <div>
                        <span className="text-slate-400">Registration / Matric No.</span>
                        <p className="mt-0.5 font-mono font-semibold text-slate-900 dark:text-white">
                          {profileDetails.studentProfile.registration_number || 'Not supplied'}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-400">Institution</span>
                        <p className="mt-0.5 font-semibold text-slate-900 dark:text-white">
                          {profileDetails.studentProfile.institution || 'Not supplied'}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-400">Campus</span>
                        <p className="mt-0.5 font-semibold text-slate-900 dark:text-white">
                          {profileDetails.studentProfile.campus || 'Not supplied'}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-400">Faculty / Department</span>
                        <p className="mt-0.5 font-semibold text-slate-900 dark:text-white">
                          {[profileDetails.studentProfile.faculty, profileDetails.studentProfile.department]
                            .filter(Boolean)
                            .join(' · ') || 'Not supplied'}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-400">Study Level</span>
                        <p className="mt-0.5 font-semibold text-slate-900 dark:text-white">
                          {profileDetails.studentProfile.study_level || 'Not supplied'}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-400">Gender</span>
                        <p className="mt-0.5 font-semibold capitalize text-slate-900 dark:text-white">
                          {String(profileDetails.studentProfile.gender || 'Not supplied').replace(/_/g, ' ')}
                        </p>
                      </div>
                      {profileDetails.studentProfile.verification_date && (
                        <div className="sm:col-span-2 lg:col-span-3">
                          <span className="text-slate-400">Verified On</span>
                          <p className="mt-0.5 font-semibold text-emerald-700 dark:text-emerald-400">
                            {formatDate(profileDetails.studentProfile.verification_date)}
                          </p>
                        </div>
                      )}
                      {profileDetails.studentProfile.bio && (
                        <div className="sm:col-span-2 lg:col-span-3">
                          <span className="text-slate-400">Bio</span>
                          <p className="mt-0.5 text-slate-700 dark:text-slate-300">
                            {profileDetails.studentProfile.bio}
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-slate-500">No student_profiles row recorded yet.</p>
                  )}
                </section>

                {/* Roommate Preferences */}
                {profileDetails.roommatePreferences && (
                  <section className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800 space-y-3">
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">Roommate Preferences</h4>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <div>
                        <span className="text-slate-400">Annual Budget Range</span>
                        <p className="mt-0.5 font-semibold text-slate-900 dark:text-white">
                          ₦{Number(profileDetails.roommatePreferences.budget_min || 0).toLocaleString()} – ₦
                          {Number(profileDetails.roommatePreferences.budget_max || 0).toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-400">Preferred Areas</span>
                        <p className="mt-0.5 font-semibold text-slate-900 dark:text-white">
                          {Array.isArray(profileDetails.roommatePreferences.preferred_area)
                            ? profileDetails.roommatePreferences.preferred_area.join(', ')
                            : 'Not set'}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-400">Habits</span>
                        <p className="mt-0.5 font-semibold capitalize text-slate-900 dark:text-white">
                          {String(profileDetails.roommatePreferences.sleep_habit || '').replace(/_/g, ' ')} ·{' '}
                          {String(profileDetails.roommatePreferences.study_habit || '').replace(/_/g, ' ')}
                        </p>
                      </div>
                    </div>
                  </section>
                )}

                {/* Student Verification Documents */}
                <section className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800 space-y-3">
                  <h4 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                    <FileCheck2 className="h-4 w-4 text-amber-600" /> Verification Documents (
                    {profileDetails.studentDocuments.length})
                  </h4>
                  {profileDetails.studentDocuments.length === 0 ? (
                    <p className="text-slate-500">No verification documents uploaded yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {profileDetails.studentDocuments.map((doc) => (
                        <div
                          key={doc.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60"
                        >
                          <div>
                            <p className="font-semibold text-slate-900 dark:text-white">
                              {String(doc.document_type || 'Document').replace(/_/g, ' ')} · {doc.file_name}
                            </p>
                            <p className="mt-0.5 text-slate-500">
                              Status: <span className="font-semibold capitalize">{doc.status}</span> · Uploaded{' '}
                              {formatDate(doc.created_at)}
                            </p>
                            {doc.rejection_reason && (
                              <p className="mt-1 text-rose-600 dark:text-rose-400">
                                Rejection reason: {doc.rejection_reason}
                              </p>
                            )}
                          </div>
                          {doc.storage_path && (
                            <button
                              type="button"
                              disabled={openingDocId === doc.id}
                              onClick={() => void handleOpenEvidence('student-document', doc)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 cursor-pointer"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              {openingDocId === doc.id ? 'Generating…' : 'View file'}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}

            {!profileLoading && profileDetails && inspectedUser.role === 'landlord' && (
              <div className="space-y-4">
                {/* Landlord Business & KYC Profile */}
                <section className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800 space-y-3">
                  <h4 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                    <Building2 className="h-4 w-4 text-emerald-600" /> Landlord Business &amp; KYC Profile
                  </h4>
                  {profileDetails.landlordProfile ? (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <div>
                        <span className="text-slate-400">Business / Company Name</span>
                        <p className="mt-0.5 font-semibold text-slate-900 dark:text-white">
                          {profileDetails.landlordProfile.company_name || 'Individual landlord'}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-400">Contact / Business Address</span>
                        <p className="mt-0.5 font-semibold text-slate-900 dark:text-white">
                          {profileDetails.landlordProfile.business_address || 'Not supplied'}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-400">ID / Tax Reference</span>
                        <p className="mt-0.5 font-mono font-semibold text-slate-900 dark:text-white">
                          {profileDetails.landlordProfile.tax_id || 'Not supplied'}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-400">Payment Account Status</span>
                        <p className="mt-0.5 font-semibold text-slate-900 dark:text-white">
                          {profileDetails.landlordPaymentAccount?.configured ? (
                            <span className="text-emerald-700 dark:text-emerald-400">Configured</span>
                          ) : (
                            <span className="text-amber-700 dark:text-amber-400">Not configured</span>
                          )}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-400">Bank Name</span>
                        <p className="mt-0.5 font-semibold text-slate-900 dark:text-white">
                          {profileDetails.landlordPaymentAccount?.bankName || 'Not configured'}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-400">Account Holder &amp; Number</span>
                        <p className="mt-0.5 font-semibold text-slate-900 dark:text-white">
                          {profileDetails.landlordPaymentAccount?.configured
                            ? `${profileDetails.landlordPaymentAccount.accountHolderName || 'Landlord'} (${profileDetails.landlordPaymentAccount.maskedAccountNumber})`
                            : 'Not configured'}
                        </p>
                      </div>
                      {profileDetails.landlordProfile.verified_at && (
                        <div className="sm:col-span-2 lg:col-span-3">
                          <span className="text-slate-400">Verified On</span>
                          <p className="mt-0.5 font-semibold text-emerald-700 dark:text-emerald-400">
                            {formatDate(profileDetails.landlordProfile.verified_at)}
                          </p>
                        </div>
                      )}
                      {profileDetails.landlordProfile.rejection_reason && (
                        <div className="sm:col-span-2 lg:col-span-3">
                          <span className="text-slate-400">Last Rejection Reason</span>
                          <p className="mt-0.5 text-rose-600 dark:text-rose-400">
                            {profileDetails.landlordProfile.rejection_reason}
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-slate-500">No landlord_profiles row recorded yet.</p>
                  )}
                </section>

                {/* Landlord KYC Submissions */}
                <section className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800 space-y-3">
                  <h4 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                    <FileCheck2 className="h-4 w-4 text-amber-600" /> KYC Submissions (
                    {profileDetails.landlordSubmissions.length})
                  </h4>
                  {profileDetails.landlordSubmissions.length === 0 ? (
                    <p className="text-slate-500">No landlord KYC documents uploaded yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {profileDetails.landlordSubmissions.map((sub) => (
                        <div
                          key={sub.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60"
                        >
                          <div>
                            <p className="font-semibold text-slate-900 dark:text-white">
                              {String(sub.document_type || 'Document').replace(/_/g, ' ')} · {sub.file_name}
                            </p>
                            <p className="mt-0.5 text-slate-500">
                              Status: <span className="font-semibold capitalize">{sub.status}</span> · Submitted{' '}
                              {formatDate(sub.created_at)}
                            </p>
                            {sub.rejection_reason && (
                              <p className="mt-1 text-rose-600 dark:text-rose-400">
                                Rejection reason: {sub.rejection_reason}
                              </p>
                            )}
                          </div>
                          {sub.storage_path && (
                            <button
                              type="button"
                              disabled={openingDocId === sub.id}
                              onClick={() => void handleOpenEvidence('landlord-document', sub)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 cursor-pointer"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              {openingDocId === sub.id ? 'Generating…' : 'View file'}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Landlord Properties Portfolio */}
                <section className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800 space-y-3">
                  <h4 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                    <Building2 className="h-4 w-4 text-blue-600" /> Submitted Properties (
                    {profileDetails.properties.length})
                  </h4>
                  {profileDetails.properties.length === 0 ? (
                    <p className="text-slate-500">No properties submitted by this landlord yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {profileDetails.properties.map((prop) => (
                        <div
                          key={prop.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60"
                        >
                          <div>
                            <p className="font-semibold text-slate-900 dark:text-white">{prop.title}</p>
                            <p className="mt-0.5 text-slate-500">
                              {prop.area} · {String(prop.property_type || '').replace(/_/g, ' ')} · ₦
                              {Number(prop.rental_fee_annual || 0).toLocaleString()}/yr · {prop.available_spaces}/
                              {prop.total_spaces} spaces available
                            </p>
                          </div>
                          <Badge
                            variant={
                              prop.approval_status === 'approved'
                                ? 'success'
                                : prop.approval_status === 'rejected' || prop.approval_status === 'archived'
                                ? 'danger'
                                : 'warning'
                            }
                          >
                            {prop.approval_status}
                            {prop.is_published ? ' · published' : ''}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}

            {/* Inline Signed Evidence Preview */}
            {signedPreview && (
              <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-emerald-900 dark:text-emerald-200">
                    Signed preview ready{signedPreview.fileName ? ` (${signedPreview.fileName})` : ''}
                  </span>
                  <div className="flex items-center gap-3">
                    <a
                      href={signedPreview.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-emerald-700 underline dark:text-emerald-300"
                    >
                      Open in new tab
                    </a>
                    <button
                      type="button"
                      onClick={() => setSignedPreview(null)}
                      className="text-slate-500 hover:text-slate-900 dark:hover:text-white"
                    >
                      Close preview
                    </button>
                  </div>
                </div>
                {signedPreview.previewKind === 'image' && (
                  <img
                    src={signedPreview.url}
                    alt={signedPreview.fileName || 'Submitted evidence'}
                    className="max-h-80 w-full rounded-lg border border-emerald-200 bg-white object-contain dark:border-emerald-900 dark:bg-slate-950"
                  />
                )}
                {signedPreview.previewKind === 'pdf' && (
                  <iframe
                    src={signedPreview.url}
                    title={signedPreview.fileName || 'Submitted PDF evidence'}
                    className="h-80 w-full rounded-lg border border-emerald-200 bg-white dark:border-emerald-900"
                  />
                )}
              </div>
            )}

            {/* Reservations Activity (for Students & Landlords) */}
            {!profileLoading && profileDetails && inspectedUser.role !== 'admin' && (
              <section className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800 space-y-3">
                <h4 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                  <CalendarCheck className="h-4 w-4 text-purple-600" /> Reservations (
                  {profileDetails.reservations.length})
                </h4>
                {profileDetails.reservations.length === 0 ? (
                  <p className="text-slate-500">No reservations associated with this account.</p>
                ) : (
                  <div className="space-y-2">
                    {profileDetails.reservations.slice(0, 5).map((res) => (
                      <div
                        key={res.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60"
                      >
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-white">
                            {res.propertyTitle} · <span className="font-mono">{res.reservationNumber}</span>
                          </p>
                          <p className="mt-0.5 text-slate-500">
                            ₦{Number(res.amount || 0).toLocaleString()} · Hold expires {formatDate(res.holdExpiresAt)}
                          </p>
                        </div>
                        <Badge
                          variant={
                            res.status === 'confirmed'
                              ? 'success'
                              : res.status === 'rejected' || res.status === 'cancelled' || res.status === 'expired'
                              ? 'danger'
                              : 'warning'
                          }
                        >
                          {String(res.status || '').replace(/_/g, ' ')}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Modal Footer Actions */}
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              {inspectedUser.role !== 'admin' && isUserVerified(inspectedUser) && (
                <button
                  type="button"
                  disabled={busyId === inspectedUser.id}
                  onClick={() => {
                    closeProfileModal();
                    setRevokeTarget(inspectedUser);
                    setRevokeReason('');
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-3 py-2 font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:bg-amber-950/30 dark:text-amber-300 cursor-pointer"
                >
                  <ShieldOff className="h-3.5 w-3.5" />
                  Revoke verification
                </button>
              )}
              {inspectedUser.role !== 'admin' && (
                <button
                  type="button"
                  disabled={busyId === inspectedUser.id}
                  onClick={() => {
                    const isSuspended =
                      inspectedUser.status === 'suspended' || inspectedUser.accountStatus === 'suspended';
                    if (isSuspended) {
                      void changeStatus(inspectedUser, 'active');
                    } else {
                      closeProfileModal();
                      setTarget(inspectedUser);
                      setReason('');
                    }
                  }}
                  className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 font-semibold disabled:opacity-50 cursor-pointer ${
                    inspectedUser.status === 'suspended' || inspectedUser.accountStatus === 'suspended'
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                      : 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300'
                  }`}
                >
                  {inspectedUser.status === 'suspended' || inspectedUser.accountStatus === 'suspended' ? (
                    <UserCheck className="h-3.5 w-3.5" />
                  ) : (
                    <Ban className="h-3.5 w-3.5" />
                  )}
                  {inspectedUser.status === 'suspended' || inspectedUser.accountStatus === 'suspended'
                    ? 'Reactivate account'
                    : 'Suspend account'}
                </button>
              )}
              <Link
                to={`/admin/broadcasts?userId=${encodeURIComponent(inspectedUser.id)}`}
                onClick={closeProfileModal}
                className="inline-flex items-center gap-1 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 font-semibold text-purple-700 hover:bg-purple-100 dark:border-purple-800 dark:bg-purple-950/30 dark:text-purple-300"
              >
                <Megaphone className="h-3.5 w-3.5" />
                Send notification
              </Link>
              <button
                type="button"
                onClick={closeProfileModal}
                className="rounded-lg border border-slate-200 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!target}
        onClose={() => {
          setTarget(null);
          setReason('');
        }}
        title="Suspend account"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (target) void changeStatus(target, 'suspended', reason);
          }}
          className="space-y-4 text-sm"
        >
          <p>
            Suspending <strong>{target?.email}</strong> disables access and records the reason in the audit ledger.
          </p>
          <label className="block font-semibold">
            Reason
            <textarea
              required
              minLength={5}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={4}
              className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setTarget(null)} className="rounded-lg px-3 py-2 text-xs">
              Cancel
            </button>
            <button disabled={!!busyId} className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white">
              {busyId ? 'Saving…' : 'Suspend account'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={!!revokeTarget}
        onClose={() => {
          setRevokeTarget(null);
          setRevokeReason('');
        }}
        title="Revoke user verification"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (revokeTarget) void handleRevokeVerification(revokeTarget, revokeReason);
          }}
          className="space-y-4 text-sm"
        >
          <p>
            Revoking verification for <strong>{revokeTarget?.fullName || revokeTarget?.email}</strong> immediately removes their verified badge and requires fresh document approval to verify again.
          </p>
          <label className="block font-semibold">
            Revocation reason
            <textarea
              required
              minLength={5}
              maxLength={500}
              value={revokeReason}
              onChange={(event) => setRevokeReason(event.target.value)}
              rows={4}
              placeholder="e.g. Expired or altered credential detected during re-audit"
              className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setRevokeTarget(null)} className="rounded-lg px-3 py-2 text-xs">
              Cancel
            </button>
            <button
              disabled={!!busyId}
              className="rounded-lg bg-amber-600 hover:bg-amber-500 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
            >
              {busyId ? 'Revoking…' : 'Revoke verification'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
