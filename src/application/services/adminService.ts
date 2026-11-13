/**
 * @file adminService.ts
 * @module application/services/adminService
 * @description Authoritative Supabase-only administrator data access, live metrics, and governance service.
 *
 * Security & Correctness Invariants:
 * - Zero Local/Demo Fallback: Administrator reads NEVER fall back to in-memory seed records,
 *   localStorage, or synthetic fixture objects. Empty PostgreSQL tables return empty arrays / zeros cleanly.
 * - Active Admin Verification: Every admin operation validates via `supabase.auth.getUser()` and
 *   `public.profiles` (`id = auth.uid() AND role = 'admin' AND account_status = 'active'`).
 * - Authoritative Metrics: `getAdminMetrics()` queries DB-side counts via `admin_get_dashboard_metrics()` RPC
 *   (or DB `head: true, count: 'exact'` queries if Migration 07 RPC is not yet pushed), never downloading full
 *   tables into the browser merely to count rows.
 * - Uploaded Evidence Semantics:
 *   - Student verification files are counted strictly from `student_verification_documents`.
 *   - Landlord verification files are counted strictly from `landlord_verification_submissions`.
 *   - Payment receipts are counted strictly from `payment_receipts`.
 *   - Public property photos and private chat attachments are intentionally excluded; unlinked Storage objects
 *     without a corresponding authorized DB metadata record are never counted or surfaced.
 */

import { AuditLog, User } from '../../domain/types';
import { computePublicCoordinates } from '../../domain/geoUtils';
import { maskAccountNumber } from '../utils/validation';
import { supabase as defaultSupabase } from '../../infrastructure/supabase/supabaseClient';

export type AdminRecord = Record<string, any> & { id: string };

export type AdminUser = User & {
  name: string;
  status: string;
  studentProfile?: AdminRecord;
  landlordProfile?: AdminRecord;
};

export interface AdminLandlordPaymentAccountSummary {
  configured: boolean;
  bankName?: string;
  accountHolderName?: string;
  maskedAccountNumber?: string;
  accountType?: string | null;
  updatedAt?: string;
}

export interface AdminUserProfileDetails {
  user: AdminUser;
  studentProfile?: AdminRecord;
  landlordProfile?: AdminRecord;
  landlordPaymentAccount?: AdminLandlordPaymentAccountSummary;
  roommatePreferences?: AdminRecord;
  studentDocuments: AdminRecord[];
  landlordSubmissions: AdminRecord[];
  properties: AdminRecord[];
  reservations: AdminRecord[];
}

export interface AdminMetrics {
  totalUsers: number;
  totalStudents: number;
  totalLandlords: number;
  totalAdministrators: number;
  totalNonAdminUsers: number;
  totalUploadedStudentDocuments: number;
  totalLandlordVerificationSubmissions: number;
  totalPaymentReceipts: number;
  pendingStudentVerifications: number;
  pendingLandlordVerifications: number;
  approvedLandlordVerifications: number;
  rejectedLandlordVerifications: number;
  totalProperties: number;
  approvedProperties: number;
  pendingPropertyVerifications: number;
  activeProperties: number;
  activeReservations: number;
  pendingReceiptVerifications: number;
  expiredReservations: number;
}

export interface AdminDashboardData {
  metrics: AdminMetrics;
  recentActivity: AuditLog[];
  fetchedAt: string;
}

export type AdminErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN_ROLE'
  | 'ADMIN_SUSPENDED_OR_INACTIVE'
  | 'SCHEMA_OR_RLS_ERROR'
  | 'NETWORK_ERROR'
  | 'EDGE_FUNCTION_ERROR'
  | 'VALIDATION_ERROR'
  | 'UNKNOWN_ERROR';

export class AdminServiceError extends Error {
  public readonly code: AdminErrorCode;
  public readonly details?: string;
  public readonly hint?: string;
  public readonly table?: string;
  public readonly statusCode?: number;

  constructor(
    code: AdminErrorCode,
    message: string,
    options?: { details?: string; hint?: string; table?: string; statusCode?: number }
  ) {
    super(message);
    this.name = 'AdminServiceError';
    this.code = code;
    this.details = options?.details;
    this.hint = options?.hint;
    this.table = options?.table;
    this.statusCode = options?.statusCode;
  }
}

export interface ActiveAdminContext {
  id: string;
  email: string;
  role: 'admin';
  accountStatus: 'active';
  fullName: string;
}

export interface AdminMetricDefinition {
  key: keyof AdminMetrics;
  label: string;
  sourceTable: string;
  filterDescription: string;
}

/**
 * Shared documentation & UI legend defining exact SQL sources for every dashboard & report metric.
 */
export const ADMIN_METRICS_METADATA: readonly AdminMetricDefinition[] = [
  { key: 'totalUsers', label: 'Registered users', sourceTable: 'public.profiles', filterDescription: 'All registered profiles across all roles' },
  { key: 'totalStudents', label: 'Registered students', sourceTable: 'public.profiles', filterDescription: "role = 'student'" },
  { key: 'totalLandlords', label: 'Registered landlords', sourceTable: 'public.profiles', filterDescription: "role = 'landlord'" },
  { key: 'totalAdministrators', label: 'Administrators', sourceTable: 'public.profiles', filterDescription: "role = 'admin'" },
  { key: 'totalNonAdminUsers', label: 'Non-admin users', sourceTable: 'public.profiles', filterDescription: "role IN ('student', 'landlord')" },
  { key: 'totalUploadedStudentDocuments', label: 'Student documents uploaded', sourceTable: 'public.student_verification_documents', filterDescription: 'All student document metadata records' },
  { key: 'totalLandlordVerificationSubmissions', label: 'Landlord files uploaded', sourceTable: 'public.landlord_verification_submissions', filterDescription: 'All landlord verification submission records' },
  { key: 'totalPaymentReceipts', label: 'Payment receipts uploaded', sourceTable: 'public.payment_receipts', filterDescription: 'All uploaded payment receipt records' },
  { key: 'pendingStudentVerifications', label: 'Student checks pending', sourceTable: 'public.student_verification_documents', filterDescription: "status = 'pending'" },
  { key: 'pendingLandlordVerifications', label: 'Landlord checks pending', sourceTable: 'landlord_verification_submissions / landlord_profiles', filterDescription: "Distinct landlords with pending submission or verification_status = 'pending'" },
  { key: 'approvedLandlordVerifications', label: 'Approved landlords', sourceTable: 'public.landlord_profiles', filterDescription: "verification_status = 'approved'" },
  { key: 'rejectedLandlordVerifications', label: 'Rejected landlords', sourceTable: 'public.landlord_profiles', filterDescription: "verification_status = 'rejected'" },
  { key: 'totalProperties', label: 'Total submitted properties', sourceTable: 'public.properties', filterDescription: 'All property listings across review states' },
  { key: 'approvedProperties', label: 'Approved properties', sourceTable: 'public.properties', filterDescription: "approval_status = 'approved'" },
  { key: 'pendingPropertyVerifications', label: 'Property reviews pending', sourceTable: 'public.properties', filterDescription: "approval_status = 'pending'" },
  { key: 'activeProperties', label: 'Active published properties', sourceTable: 'public.properties', filterDescription: "approval_status = 'approved' AND is_published = true" },
  { key: 'activeReservations', label: 'Active reservations', sourceTable: 'public.reservations', filterDescription: "status IN ('pending_payment', 'payment_submitted', 'confirmed') AND hold_expires_at > now()" },
  { key: 'pendingReceiptVerifications', label: 'Receipts pending review', sourceTable: 'public.payment_receipts', filterDescription: "status = 'pending_review'" },
  { key: 'expiredReservations', label: 'Expired reservations', sourceTable: 'public.reservations', filterDescription: "status = 'expired' OR unpaid hold past hold_expires_at" },
] as const;

function toMillis(value: unknown): number {
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function displayDate(value: unknown): string {
  const millis = toMillis(value);
  return millis ? new Date(millis).toISOString() : '';
}

function classifySupabaseError(err: any, table?: string): AdminServiceError {
  if (err instanceof AdminServiceError) return err;

  const rawMessage = String(err?.message || err?.error_description || 'Unknown database error');
  const lower = rawMessage.toLowerCase();
  const code = String(err?.code || '');

  if (code === '42501' || lower.includes('permission denied') || lower.includes('row-level security') || lower.includes('forbidden')) {
    return new AdminServiceError(
      'SCHEMA_OR_RLS_ERROR',
      `Database authorization or RLS policy denied access${table ? ` to ${table}` : ''}: ${rawMessage}`,
      { details: err?.details, hint: err?.hint || 'Verify your profile has role = admin, account_status = active, and latest migrations are pushed.', table }
    );
  }

  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network request failed') ||
    lower.includes('timeout') ||
    lower.includes('econnrefused')
  ) {
    return new AdminServiceError(
      'NETWORK_ERROR',
      `Network error communicating with Supabase${table ? ` while querying ${table}` : ''}. Check your connection and retry.`,
      { details: err?.details, table }
    );
  }

  return new AdminServiceError(
    'SCHEMA_OR_RLS_ERROR',
    `Supabase query failed${table ? ` on ${table}` : ''}: ${rawMessage}`,
    { details: err?.details, hint: err?.hint, table }
  );
}

function isRpcMissingError(error: any): boolean {
  const code = String(error?.code || '');
  const msg = String(error?.message || '').toLowerCase();
  return code === '42883' || code === 'PGRST202' || msg.includes('could not find the function') || msg.includes('does not exist');
}

export function createAdminService(deps?: { client?: any }) {
  const client = deps?.client ?? defaultSupabase;

  async function verifyActiveAdmin(): Promise<ActiveAdminContext> {
    let authUser: any = null;
    try {
      const { data, error } = await client.auth.getUser();
      if (error || !data?.user) {
        throw new AdminServiceError(
          'UNAUTHENTICATED',
          'Your Supabase session is missing or expired. Please sign in through the administrator portal.'
        );
      }
      authUser = data.user;
    } catch (err: any) {
      if (err instanceof AdminServiceError) throw err;
      throw classifySupabaseError(err, 'auth.users');
    }

    const { data: profile, error: profileErr } = await client
      .from('profiles')
      .select('id, email, role, account_status, full_name')
      .eq('id', authUser.id)
      .maybeSingle();

    if (profileErr) {
      throw classifySupabaseError(profileErr, 'public.profiles');
    }

    if (!profile) {
      throw new AdminServiceError(
        'FORBIDDEN_ROLE',
        'Access denied: no profile record exists for this authenticated user in public.profiles.',
        { table: 'public.profiles' }
      );
    }

    if (profile.role !== 'admin') {
      throw new AdminServiceError(
        'FORBIDDEN_ROLE',
        `Access denied: account role is '${profile.role || 'unknown'}'. Active administrator role is required.`,
        { table: 'public.profiles' }
      );
    }

    if (profile.account_status !== 'active') {
      throw new AdminServiceError(
        'ADMIN_SUSPENDED_OR_INACTIVE',
        `Access denied: administrator account status is '${profile.account_status}'. Only active administrator accounts can access live operations.`,
        { table: 'public.profiles' }
      );
    }

    return {
      id: profile.id,
      email: profile.email || authUser.email || '',
      role: 'admin',
      accountStatus: 'active',
      fullName: profile.full_name || 'Administrator',
    };
  }

  async function readTable(tableName: string, columns: string = '*'): Promise<AdminRecord[]> {
    const { data, error } = await client.from(tableName).select(columns);
    if (error) {
      throw classifySupabaseError(error, tableName);
    }
    return Array.isArray(data) ? (data as AdminRecord[]) : [];
  }

  async function countHead(
    tableName: string,
    applyFilter?: (q: any) => any
  ): Promise<number> {
    let query = client.from(tableName).select('*', { count: 'exact', head: true });
    if (applyFilter) {
      query = applyFilter(query);
    }
    const { count, error } = await query;
    if (error) {
      throw classifySupabaseError(error, tableName);
    }
    return Number(count ?? 0);
  }

  /**
   * Authoritative metrics contract shared between AdminDashboard and AdminReportsPage.
   * Uses the server-side `admin_get_dashboard_metrics()` RPC first, falling back ONLY to
   * DB-side `head: true, count: 'exact'` queries if Migration 07 has not been pushed yet.
   * Never downloads entire tables or synthesizes mock numbers on failure.
   */
  async function getAdminMetrics(): Promise<AdminMetrics> {
    await verifyActiveAdmin();

    const { data: rpcData, error: rpcError } = await client.rpc('admin_get_dashboard_metrics');
    if (!rpcError && rpcData && typeof rpcData === 'object') {
      const hasExtendedKeys =
        rpcData.totalNonAdminUsers !== undefined &&
        rpcData.approvedLandlordVerifications !== undefined &&
        rpcData.rejectedLandlordVerifications !== undefined &&
        rpcData.totalProperties !== undefined &&
        rpcData.approvedProperties !== undefined;

      if (hasExtendedKeys) {
        return {
          totalUsers: Number(rpcData.totalUsers ?? 0),
          totalStudents: Number(rpcData.totalStudents ?? 0),
          totalLandlords: Number(rpcData.totalLandlords ?? 0),
          totalAdministrators: Number(rpcData.totalAdministrators ?? 0),
          totalNonAdminUsers: Number(rpcData.totalNonAdminUsers ?? 0),
          totalUploadedStudentDocuments: Number(rpcData.totalUploadedStudentDocuments ?? 0),
          totalLandlordVerificationSubmissions: Number(rpcData.totalLandlordVerificationSubmissions ?? 0),
          totalPaymentReceipts: Number(rpcData.totalPaymentReceipts ?? 0),
          pendingStudentVerifications: Number(rpcData.pendingStudentVerifications ?? 0),
          pendingLandlordVerifications: Number(rpcData.pendingLandlordVerifications ?? 0),
          approvedLandlordVerifications: Number(rpcData.approvedLandlordVerifications ?? 0),
          rejectedLandlordVerifications: Number(rpcData.rejectedLandlordVerifications ?? 0),
          totalProperties: Number(rpcData.totalProperties ?? 0),
          approvedProperties: Number(rpcData.approvedProperties ?? 0),
          pendingPropertyVerifications: Number(rpcData.pendingPropertyVerifications ?? 0),
          activeProperties: Number(rpcData.activeProperties ?? 0),
          activeReservations: Number(rpcData.activeReservations ?? 0),
          pendingReceiptVerifications: Number(rpcData.pendingReceiptVerifications ?? 0),
          expiredReservations: Number(rpcData.expiredReservations ?? 0),
        };
      }

      // Supplement missing extended keys via head-only DB counts if Migration 08 RPC is not yet pushed remotely
      const [
        totalNonAdminUsers,
        approvedLandlordVerifications,
        rejectedLandlordVerifications,
        totalProperties,
        approvedProperties,
      ] = await Promise.all([
        rpcData.totalNonAdminUsers !== undefined
          ? Promise.resolve(Number(rpcData.totalNonAdminUsers))
          : countHead('profiles', (q) => q.in('role', ['student', 'landlord'])),
        rpcData.approvedLandlordVerifications !== undefined
          ? Promise.resolve(Number(rpcData.approvedLandlordVerifications))
          : countHead('landlord_profiles', (q) => q.eq('verification_status', 'approved')),
        rpcData.rejectedLandlordVerifications !== undefined
          ? Promise.resolve(Number(rpcData.rejectedLandlordVerifications))
          : countHead('landlord_profiles', (q) => q.eq('verification_status', 'rejected')),
        rpcData.totalProperties !== undefined
          ? Promise.resolve(Number(rpcData.totalProperties))
          : countHead('properties'),
        rpcData.approvedProperties !== undefined
          ? Promise.resolve(Number(rpcData.approvedProperties))
          : countHead('properties', (q) => q.eq('approval_status', 'approved')),
      ]);

      return {
        totalUsers: Number(rpcData.totalUsers ?? 0),
        totalStudents: Number(rpcData.totalStudents ?? 0),
        totalLandlords: Number(rpcData.totalLandlords ?? 0),
        totalAdministrators: Number(rpcData.totalAdministrators ?? 0),
        totalNonAdminUsers,
        totalUploadedStudentDocuments: Number(rpcData.totalUploadedStudentDocuments ?? 0),
        totalLandlordVerificationSubmissions: Number(rpcData.totalLandlordVerificationSubmissions ?? 0),
        totalPaymentReceipts: Number(rpcData.totalPaymentReceipts ?? 0),
        pendingStudentVerifications: Number(rpcData.pendingStudentVerifications ?? 0),
        pendingLandlordVerifications: Number(rpcData.pendingLandlordVerifications ?? 0),
        approvedLandlordVerifications,
        rejectedLandlordVerifications,
        totalProperties,
        approvedProperties,
        pendingPropertyVerifications: Number(rpcData.pendingPropertyVerifications ?? 0),
        activeProperties: Number(rpcData.activeProperties ?? 0),
        activeReservations: Number(rpcData.activeReservations ?? 0),
        pendingReceiptVerifications: Number(rpcData.pendingReceiptVerifications ?? 0),
        expiredReservations: Number(rpcData.expiredReservations ?? 0),
      };
    }

    if (rpcError && !isRpcMissingError(rpcError)) {
      throw classifySupabaseError(rpcError, 'admin_get_dashboard_metrics');
    }

    // Fallback ONLY when RPC function is not yet deployed: use PostgREST head-only exact DB counts.
    const nowIso = new Date().toISOString();
    const [
      totalUsers,
      totalStudents,
      totalLandlords,
      totalAdministrators,
      totalNonAdminUsers,
      totalUploadedStudentDocuments,
      totalLandlordVerificationSubmissions,
      totalPaymentReceipts,
      pendingStudentVerifications,
      pendingLandlordSubmissions,
      pendingLandlordProfiles,
      approvedLandlordVerifications,
      rejectedLandlordVerifications,
      totalProperties,
      approvedProperties,
      pendingPropertyVerifications,
      activeProperties,
      activeReservations,
      pendingReceiptVerifications,
      explicitExpiredReservations,
      overdueReservations,
    ] = await Promise.all([
      countHead('profiles'),
      countHead('profiles', (q) => q.eq('role', 'student')),
      countHead('profiles', (q) => q.eq('role', 'landlord')),
      countHead('profiles', (q) => q.eq('role', 'admin')),
      countHead('profiles', (q) => q.in('role', ['student', 'landlord'])),
      countHead('student_verification_documents'),
      countHead('landlord_verification_submissions'),
      countHead('payment_receipts'),
      countHead('student_verification_documents', (q) => q.eq('status', 'pending')),
      countHead('landlord_verification_submissions', (q) => q.eq('status', 'pending')),
      countHead('landlord_profiles', (q) => q.eq('verification_status', 'pending')),
      countHead('landlord_profiles', (q) => q.eq('verification_status', 'approved')),
      countHead('landlord_profiles', (q) => q.eq('verification_status', 'rejected')),
      countHead('properties'),
      countHead('properties', (q) => q.eq('approval_status', 'approved')),
      countHead('properties', (q) => q.eq('approval_status', 'pending')),
      countHead('properties', (q) => q.eq('approval_status', 'approved').eq('is_published', true)),
      countHead('reservations', (q) => q.in('status', ['pending_payment', 'payment_submitted', 'confirmed']).gt('hold_expires_at', nowIso)),
      countHead('payment_receipts', (q) => q.eq('status', 'pending_review')),
      countHead('reservations', (q) => q.eq('status', 'expired')),
      countHead('reservations', (q) => q.in('status', ['pending_payment', 'payment_submitted']).lte('hold_expires_at', nowIso)),
    ]);

    return {
      totalUsers,
      totalStudents,
      totalLandlords,
      totalAdministrators,
      totalNonAdminUsers,
      totalUploadedStudentDocuments,
      totalLandlordVerificationSubmissions,
      totalPaymentReceipts,
      pendingStudentVerifications,
      pendingLandlordVerifications: Math.max(pendingLandlordSubmissions, pendingLandlordProfiles),
      approvedLandlordVerifications,
      rejectedLandlordVerifications,
      totalProperties,
      approvedProperties,
      pendingPropertyVerifications,
      activeProperties,
      activeReservations,
      pendingReceiptVerifications,
      expiredReservations: explicitExpiredReservations + overdueReservations,
    };
  }

  async function getAuditLogs(): Promise<AuditLog[]> {
    await verifyActiveAdmin();

    const [items, profiles] = await Promise.all([
      readTable('audit_logs'),
      readTable('profiles', 'id, full_name, email, role'),
    ]);

    const actorMap = new Map(profiles.map((p) => [p.id, p]));

    return items
      .map((item) => {
        const actor = actorMap.get(item.actor_id);
        return {
          id: item.id,
          action: item.action || 'AUDIT_EVENT',
          actorId: item.actor_id || '',
          actorName: item.actor_name || actor?.full_name || actor?.email || 'System / Admin',
          actorRole: (item.actor_role || actor?.role || 'admin') as any,
          targetEntity: item.entity_type || item.resource || 'system',
          targetId: item.entity_id || item.resource_id || '',
          details: typeof item.details === 'string' ? item.details : JSON.stringify(item.details || {}),
          timestamp: displayDate(item.created_at),
        };
      })
      .sort((a, b) => toMillis(b.timestamp) - toMillis(a.timestamp));
  }

  async function getDashboardData(): Promise<AdminDashboardData> {
    const [metrics, audit] = await Promise.all([getAdminMetrics(), getAuditLogs()]);
    return {
      metrics,
      recentActivity: audit.slice(0, 8),
      fetchedAt: new Date().toISOString(),
    };
  }

  async function getUsers(): Promise<AdminUser[]> {
    await verifyActiveAdmin();

    const [profiles, students, landlords] = await Promise.all([
      readTable('profiles'),
      readTable('student_profiles'),
      readTable('landlord_profiles'),
    ]);

    const studentById = new Map(students.map((item) => [item.user_id, item]));
    const landlordById = new Map(landlords.map((item) => [item.user_id, item]));

    return profiles
      .map((record) => {
        const rawStudent = studentById.get(record.id);
        const rawLandlord = landlordById.get(record.id);
        const studentProfile = rawStudent
          ? {
              ...rawStudent,
              registrationNumber: rawStudent.registration_number || '',
              isProfileVerified: Boolean(rawStudent.is_profile_verified),
            }
          : undefined;
        const landlordProfile = rawLandlord
          ? {
              ...rawLandlord,
              businessName: rawLandlord.company_name || '',
              verificationStatus: rawLandlord.verification_status || 'not_started',
            }
          : undefined;

        const name =
          record.full_name ||
          landlordProfile?.businessName ||
          record.email ||
          'User';

        return {
          ...record,
          id: record.id,
          email: String(record.email || ''),
          role: record.role === 'landlord' || record.role === 'admin' ? record.role : 'student',
          accountStatus: record.account_status || 'active',
          emailVerified: Boolean(record.is_verified || record.account_status === 'active' || record.account_status === 'profile_verified'),
          createdAt: displayDate(record.created_at) || new Date(0).toISOString(),
          name,
          fullName: name,
          status: record.account_status || 'active',
          studentProfile,
          landlordProfile,
        } as AdminUser;
      })
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  }

  async function getVerificationQueues(): Promise<{ students: AdminRecord[]; landlords: AdminRecord[] }> {
    await verifyActiveAdmin();

    const [studentDocs, students, landlords, landlordSubmissions, profiles] = await Promise.all([
      readTable('student_verification_documents'),
      readTable('student_profiles'),
      readTable('landlord_profiles'),
      readTable('landlord_verification_submissions'),
      readTable('profiles', 'id, email, full_name, role, account_status'),
    ]);

    const studentById = new Map<string, AdminRecord>(students.map((item) => [item.user_id, item]));
    const landlordById = new Map<string, AdminRecord>(landlords.map((item) => [item.user_id, item]));
    const userById = new Map<string, AdminRecord>(profiles.map((item) => [item.id, item]));

    const formattedStudents: AdminRecord[] = studentDocs
      .filter((item) => item.status === 'pending')
      .map((item) => {
        const studentProfile: AdminRecord = studentById.get(item.student_id) || { id: '' };
        const user: AdminRecord = userById.get(item.student_id) || { id: '' };

        const displayDocType =
          item.document_type === 'student_id_card' || item.document_type === 'student_id'
            ? 'Student ID Card'
            : item.document_type === 'admission_letter'
            ? 'Official Admission Letter'
            : item.document_type === 'course_registration' || item.document_type === 'school_fees_receipt'
            ? 'Course Registration / School Fees'
            : item.document_type === 'nin_slip'
            ? 'National Identity (NIN) Slip'
            : item.document_type || 'Academic Identity Proof';

        return {
          ...item,
          id: item.id,
          studentId: item.student_id,
          fullName: user.full_name || studentProfile.full_name || 'Student',
          registrationNumber: studentProfile.registration_number || '',
          university: studentProfile.institution || 'Bayero University Kano',
          campus: studentProfile.campus || 'New Campus',
          programme: studentProfile.department || '',
          studyLevel: studentProfile.study_level || '',
          studentEmail: user.email || '',
          submittedAt: displayDate(item.created_at),
          documentType: displayDocType,
          documentUrl: item.storage_path || '',
          storage_path: item.storage_path || '',
          hasUploadedEvidence: Boolean(item.storage_path),
        };
      })
      .sort((a, b) => toMillis(b.submittedAt) - toMillis(a.submittedAt));

    const processedLandlordIds = new Set<string>();
    const formattedLandlords: AdminRecord[] = [];

    for (const sub of landlordSubmissions) {
      if (sub.status !== 'pending') continue;
      const landlordId = sub.landlord_id;
      processedLandlordIds.add(landlordId);

      const landlordProfile: AdminRecord = landlordById.get(landlordId) || { id: '' };
      const user: AdminRecord = userById.get(landlordId) || { id: '' };

      const displayDocType =
        sub.document_type === 'national_id'
          ? 'National ID (NIN)'
          : sub.document_type === 'passport'
          ? 'International Passport'
          : sub.document_type === 'voters_card'
          ? "Voter's Card"
          : sub.document_type === 'property_deed'
          ? 'Property Deed / C of O'
          : sub.document_type === 'utility_bill'
          ? 'Utility Bill'
          : sub.document_type === 'cac_certificate'
          ? 'CAC Certificate'
          : sub.document_type || 'Identity & Ownership';

      formattedLandlords.push({
        ...sub,
        id: sub.id,
        submissionId: sub.id,
        userId: landlordId,
        legalName: user.full_name || landlordProfile.company_name || 'Landlord',
        businessName: landlordProfile.company_name || '',
        email: user.email || '',
        idType: displayDocType,
        idNumber: landlordProfile.tax_id || '',
        ownershipDocType: sub.file_name || displayDocType,
        submittedAt: displayDate(sub.created_at),
        documentUrl: sub.storage_path || '',
        storage_path: sub.storage_path || '',
        hasUploadedEvidence: Boolean(sub.storage_path),
      });
    }

    // Surface pending landlord_profiles that have not yet linked a submission row
    for (const lp of landlords) {
      if (lp.verification_status !== 'pending') continue;
      if (processedLandlordIds.has(lp.user_id)) continue;

      const user: AdminRecord = userById.get(lp.user_id) || { id: '' };
      formattedLandlords.push({
        ...lp,
        id: lp.id || lp.user_id,
        submissionId: lp.id || lp.user_id,
        userId: lp.user_id,
        legalName: user.full_name || lp.company_name || 'Landlord',
        businessName: lp.company_name || '',
        email: user.email || '',
        idType: 'Pending Verification Profile',
        idNumber: lp.tax_id || '',
        ownershipDocType: 'No document row recorded',
        submittedAt: displayDate(lp.updated_at || lp.created_at),
        documentUrl: '',
        storage_path: '',
        hasUploadedEvidence: false,
      });
    }

    return {
      students: formattedStudents,
      landlords: formattedLandlords.sort((a, b) => toMillis(b.submittedAt) - toMillis(a.submittedAt)),
    };
  }

  async function readOptionalPropertyImages(): Promise<AdminRecord[]> {
    const { data, error } = await client
      .from('property_images')
      .select('property_id, public_url, is_cover, sort_order, created_at');
    if (error) {
      const code = String(error?.code || '');
      const msg = String(error?.message || '').toLowerCase();
      if (
        code === '42P01' ||
        code === 'PGRST205' ||
        msg.includes('does not exist') ||
        msg.includes('could not find the table')
      ) {
        return [];
      }
      throw classifySupabaseError(error, 'property_images');
    }
    return Array.isArray(data) ? (data as AdminRecord[]) : [];
  }

  async function getProperties(): Promise<AdminRecord[]> {
    await verifyActiveAdmin();

    const [properties, locations, profiles, propertyImages] = await Promise.all([
      readTable('properties'),
      readTable('property_locations'),
      readTable('profiles', 'id, full_name, email'),
      readOptionalPropertyImages(),
    ]);

    const locationByProperty = new Map(locations.map((item) => [item.property_id, item]));
    const landlordById = new Map(profiles.map((item) => [item.id, item]));
    const imagesByProperty = new Map<string, AdminRecord[]>();
    for (const img of propertyImages) {
      if (!img.property_id) continue;
      const list = imagesByProperty.get(img.property_id) || [];
      list.push(img);
      imagesByProperty.set(img.property_id, list);
    }

    return properties
      .map((property) => {
        const loc = locationByProperty.get(property.id);
        const landlord = landlordById.get(property.landlord_id);
        const approvalStatus = property.approval_status || 'pending';
        const locStatus = loc?.verification_status || 'not_submitted';

        const relationalUrls = (imagesByProperty.get(property.id) || [])
          .slice()
          .sort((a, b) => {
            const coverDiff = Number(Boolean(b.is_cover)) - Number(Boolean(a.is_cover));
            if (coverDiff !== 0) return coverDiff;
            return Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0);
          })
          .map((row) => String(row.public_url || '').trim());

        const rawFallbackUrls: string[] = [
          ...relationalUrls,
          ...(Array.isArray(property.images) ? property.images.map((u: unknown) => String(u || '').trim()) : []),
          ...(property.featured_image_url ? [String(property.featured_image_url).trim()] : []),
        ];
        const mergedImages = Array.from(
          new Set(rawFallbackUrls.filter((u) => Boolean(u) && !/^(data:|blob:)/i.test(u)))
        );

        return {
          ...property,
          propertyType: property.property_type || 'Property',
          verificationStatus: approvalStatus,
          moderationStatus: approvalStatus === 'archived' ? 'suspended' : approvalStatus,
          locationVerificationStatus: locStatus,
          pricePerSession: Number(property.rental_fee_annual ?? 0),
          neighbourhood: property.area || 'Dambare',
          landlordName: landlord?.full_name || landlord?.email || property.landlord_id,
          adminReviewReason: property.rejection_reason || undefined,
          createdAt: displayDate(property.created_at),
          images: mergedImages,
          featuredImageUrl: mergedImages[0],
          submittedLocation: loc
            ? {
                ...loc,
                area: property.area || 'Dambare',
                formattedAddress: loc.formatted_address || property.address,
                verificationStatus: loc.verification_status,
                publicLocationLabel: loc.directions || loc.formatted_address,
              }
            : undefined,
        };
      })
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  }

  async function getReservations(): Promise<AdminRecord[]> {
    await verifyActiveAdmin();

    const [items, properties, profiles] = await Promise.all([
      readTable('reservations'),
      readTable('properties', 'id, title'),
      readTable('profiles', 'id, full_name, email'),
    ]);

    const propMap = new Map(properties.map((p) => [p.id, p.title]));
    const userMap = new Map(profiles.map((u) => [u.id, u.full_name || u.email]));

    return items
      .map((item) => ({
        ...item,
        reservationNumber: item.id.slice(0, 8).toUpperCase(),
        propertyTitle: propMap.get(item.property_id) || 'Property',
        studentId: item.student_id,
        landlordId: item.landlord_id,
        studentName: userMap.get(item.student_id) || item.student_id,
        landlordName: userMap.get(item.landlord_id) || item.landlord_id,
        holdExpiresAt: displayDate(item.hold_expires_at),
        createdAt: displayDate(item.created_at),
      }))
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  }

  async function getReceipts(): Promise<AdminRecord[]> {
    await verifyActiveAdmin();

    const [items, properties, profiles] = await Promise.all([
      readTable('payment_receipts'),
      readTable('properties', 'id, title'),
      readTable('profiles', 'id, full_name, email'),
    ]);

    const propMap = new Map(properties.map((p) => [p.id, p.title]));
    const userMap = new Map(profiles.map((u) => [u.id, u.full_name || u.email]));

    return items
      .map((item) => ({
        ...item,
        propertyName: propMap.get(item.property_id) || 'Property',
        studentId: item.student_id,
        studentName: userMap.get(item.student_id) || item.student_id,
        paymentReference: item.payment_reference || '',
        amountPaid: Number(item.amount_paid ?? 0),
        uploadedAt: displayDate(item.created_at),
        storagePath: item.storage_path || '',
      }))
      .sort((a, b) => toMillis(b.uploadedAt) - toMillis(a.uploadedAt));
  }

  async function getSettings(): Promise<Record<string, unknown>> {
    await verifyActiveAdmin();

    const { data, error } = await client
      .from('platform_settings')
      .select('*')
      .eq('id', 'default')
      .maybeSingle();

    if (error) {
      throw classifySupabaseError(error, 'platform_settings');
    }

    if (!data) {
      return {
        reservationHoldDays: 7,
        receiptReviewDeadlineHours: null,
        notificationsEnabled: true,
        maintenanceMode: false,
        studentVerificationRequired: true,
        landlordVerificationRequired: true,
        propertyVerificationRequired: true,
      };
    }

    const nested = (data.settings && typeof data.settings === 'object' ? data.settings : {}) as Record<string, unknown>;
    return {
      ...nested,
      reservationHoldDays: Number(data.reservation_hold_days ?? 7),
      notificationsEnabled: data.notifications_enabled !== false,
      maintenanceMode: data.maintenance_mode === true,
      updatedAt: data.updated_at,
    };
  }

  async function setUserStatus(targetId: string, status: 'active' | 'suspended', reason?: string) {
    const admin = await verifyActiveAdmin();
    if (status === 'suspended' && (!reason || reason.trim().length < 5)) {
      throw new AdminServiceError('VALIDATION_ERROR', 'A suspension reason of at least 5 characters is required.');
    }

    const { data, error } = await client.rpc('admin_set_user_status', {
      p_target_id: targetId,
      p_status: status,
      p_reason: reason?.trim() || null,
    });

    if (error) {
      if (!isRpcMissingError(error)) {
        throw classifySupabaseError(error, 'profiles');
      }

      // Direct RLS-enforced fallback if Migration 07 RPC is not yet pushed
      const { error: updateErr } = await client
        .from('profiles')
        .update({ account_status: status, updated_at: new Date().toISOString() })
        .eq('id', targetId);
      if (updateErr) throw classifySupabaseError(updateErr, 'profiles');

      await client.from('audit_logs').insert({
        actor_id: admin.id,
        action: status === 'suspended' ? 'ADMIN_SUSPEND_USER' : 'ADMIN_ACTIVATE_USER',
        entity_type: 'profiles',
        entity_id: targetId,
        details: { status, reason: reason?.trim() || null },
      });

      return { success: true };
    }

    return data || { success: true };
  }

  async function reviewVerification(payload: {
    kind: 'student' | 'landlord';
    targetId: string;
    decision: 'approved' | 'rejected';
    reason?: string;
  }) {
    const admin = await verifyActiveAdmin();
    if (payload.decision === 'rejected' && (!payload.reason || payload.reason.trim().length < 3)) {
      throw new AdminServiceError('VALIDATION_ERROR', 'A rejection reason is required.');
    }

    if (payload.kind === 'student') {
      const { data, error } = await client.rpc('admin_review_student_verification', {
        p_doc_id: payload.targetId,
        p_decision: payload.decision,
        p_reason: payload.reason?.trim() || null,
      });

      if (error) {
        if (!isRpcMissingError(error)) {
          throw classifySupabaseError(error, 'student_verification_documents');
        }
        const nowIso = new Date().toISOString();
        const { data: docRow, error: updErr } = await client
          .from('student_verification_documents')
          .update({
            status: payload.decision,
            reviewer_id: admin.id,
            reviewed_at: nowIso,
            rejection_reason: payload.decision === 'rejected' ? payload.reason?.trim() || null : null,
          })
          .eq('id', payload.targetId)
          .select('student_id')
          .single();

        if (updErr) throw classifySupabaseError(updErr, 'student_verification_documents');

        if (payload.decision === 'approved' && docRow?.student_id) {
          await client
            .from('student_profiles')
            .update({ is_profile_verified: true, verification_date: nowIso })
            .eq('user_id', docRow.student_id);
        }

        return { success: true, id: payload.targetId, status: payload.decision };
      }
      return data || { success: true };
    } else {
      const { data, error } = await client.rpc('admin_review_landlord_verification', {
        p_target_id: payload.targetId,
        p_decision: payload.decision,
        p_reason: payload.reason?.trim() || null,
      });

      if (error) {
        if (!isRpcMissingError(error)) {
          throw classifySupabaseError(error, 'landlord_profiles');
        }
        const nowIso = new Date().toISOString();
        const { error: lpErr } = await client
          .from('landlord_profiles')
          .update({
            verification_status: payload.decision,
            verified_by: admin.id,
            verified_at: nowIso,
            rejection_reason: payload.decision === 'rejected' ? payload.reason?.trim() || null : null,
          })
          .eq('user_id', payload.targetId);
        if (lpErr) throw classifySupabaseError(lpErr, 'landlord_profiles');

        await client
          .from('landlord_verification_submissions')
          .update({
            status: payload.decision,
            reviewer_id: admin.id,
            reviewed_at: nowIso,
            rejection_reason: payload.decision === 'rejected' ? payload.reason?.trim() || null : null,
          })
          .eq('landlord_id', payload.targetId);

        return { success: true, landlordId: payload.targetId, status: payload.decision };
      }

      return data || { success: true };
    }
  }

  async function reviewProperty(payload: {
    propertyId: string;
    decision: 'approve' | 'reject' | 'suspend' | 'reactivate';
    reason?: string;
  }) {
    const admin = await verifyActiveAdmin();
    if ((payload.decision === 'reject' || payload.decision === 'suspend') && (!payload.reason || payload.reason.trim().length < 3)) {
      throw new AdminServiceError('VALIDATION_ERROR', 'A moderation reason is required.');
    }

    const { data, error } = await client.rpc('admin_review_property', {
      p_property_id: payload.propertyId,
      p_decision: payload.decision,
      p_reason: payload.reason?.trim() || null,
    });

    if (error) {
      if (!isRpcMissingError(error)) {
        throw classifySupabaseError(error, 'properties');
      }

      const statusMap: Record<string, { approval_status: string; is_published: boolean }> = {
        approve: { approval_status: 'approved', is_published: true },
        reject: { approval_status: 'rejected', is_published: false },
        suspend: { approval_status: 'archived', is_published: false },
        reactivate: { approval_status: 'approved', is_published: true },
      };
      const mapped = statusMap[payload.decision];
      if (!mapped) throw new AdminServiceError('VALIDATION_ERROR', `Unsupported decision: ${payload.decision}`);

      const { error: updErr } = await client
        .from('properties')
        .update({
          approval_status: mapped.approval_status,
          is_published: mapped.is_published,
          approved_at: mapped.is_published ? new Date().toISOString() : null,
          approved_by: mapped.is_published ? admin.id : null,
          rejection_reason: mapped.is_published ? null : payload.reason?.trim() || null,
        })
        .eq('id', payload.propertyId);
      if (updErr) throw classifySupabaseError(updErr, 'properties');

      return { success: true };
    }

    return data || { success: true };
  }

  async function reviewPropertyLocation(payload: {
    propertyId: string;
    decision: 'verified' | 'approved' | 'rejected';
    reason?: string;
  }) {
    const admin = await verifyActiveAdmin();
    // PostgreSQL verification_status ENUM uses 'approved' | 'rejected' (UI labels it 'verified')
    const dbDecision: 'approved' | 'rejected' = payload.decision === 'rejected' ? 'rejected' : 'approved';

    if (dbDecision === 'rejected' && (!payload.reason || payload.reason.trim().length < 3)) {
      throw new AdminServiceError('VALIDATION_ERROR', 'A reason is required to reject a property location.');
    }

    const { data: location, error: locFetchErr } = await client
      .from('property_locations')
      .select('*, properties(area)')
      .eq('property_id', payload.propertyId)
      .maybeSingle();

    if (locFetchErr) {
      throw classifySupabaseError(locFetchErr, 'property_locations');
    }
    if (!location) {
      throw new AdminServiceError('VALIDATION_ERROR', 'No location submission is available for this property.');
    }

    let pubLat: number | null = null;
    let pubLng: number | null = null;
    if (dbDecision === 'approved') {
      const area = (location.properties as any)?.area || 'Dambare';
      const coords = computePublicCoordinates(
        Number(location.latitude),
        Number(location.longitude),
        location.precision || 'nearby_building',
        area,
        payload.propertyId
      );
      pubLat = coords.publicLatitude;
      pubLng = coords.publicLongitude;
    }

    const { data, error } = await client.rpc('admin_review_property_location', {
      p_property_id: payload.propertyId,
      p_decision: dbDecision,
      p_public_latitude: pubLat,
      p_public_longitude: pubLng,
      p_reason: payload.reason?.trim() || null,
    });

    if (error) {
      if (!isRpcMissingError(error)) {
        throw classifySupabaseError(error, 'property_locations');
      }

      const { error: updErr } = await client
        .from('property_locations')
        .update({
          verification_status: dbDecision,
          public_latitude: pubLat,
          public_longitude: pubLng,
          reviewed_by: admin.id,
          reviewed_at: new Date().toISOString(),
          rejection_reason: dbDecision === 'rejected' ? payload.reason?.trim() || null : null,
        })
        .eq('property_id', payload.propertyId);
      if (updErr) throw classifySupabaseError(updErr, 'property_locations');

      return { success: true };
    }

    return data || { success: true };
  }

  async function saveSettings(input: Record<string, unknown>) {
    const admin = await verifyActiveAdmin();

    const reservationHoldDays = Math.min(7, Math.max(1, Number(input.reservationHoldDays ?? 7)));
    const maintenanceMode = input.maintenanceMode === true;
    const notificationsEnabled = input.notificationsEnabled !== false;

    const nestedSettings = {
      receiptReviewDeadlineHours:
        input.receiptReviewDeadlineHours === '' || input.receiptReviewDeadlineHours == null
          ? null
          : Number(input.receiptReviewDeadlineHours),
      studentVerificationRequired: input.studentVerificationRequired !== false,
      landlordVerificationRequired: input.landlordVerificationRequired !== false,
      propertyVerificationRequired: input.propertyVerificationRequired !== false,
    };

    const { error } = await client.from('platform_settings').upsert(
      {
        id: 'default',
        reservation_hold_days: reservationHoldDays,
        maintenance_mode: maintenanceMode,
        notifications_enabled: notificationsEnabled,
        settings: nestedSettings,
        updated_at: new Date().toISOString(),
        updated_by: admin.id,
      },
      { onConflict: 'id' }
    );

    if (error) {
      throw classifySupabaseError(error, 'platform_settings');
    }

    await client.from('audit_logs').insert({
      actor_id: admin.id,
      action: 'ADMIN_UPDATE_SETTINGS',
      entity_type: 'platform_settings',
      entity_id: 'default',
      details: {
        reservationHoldDays,
        maintenanceMode,
        notificationsEnabled,
        ...nestedSettings,
      },
    });

    return { success: true };
  }

  async function recordSecurityEvent(event: 'ADMIN_LOGIN' | 'ADMIN_LOGOUT') {
    try {
      const { data } = await client.auth.getUser();
      const actorId = data?.user?.id || null;
      if (!actorId) return { success: false };

      const { error } = await client.from('audit_logs').insert({
        actor_id: actorId,
        action: event,
        entity_type: 'auth',
        entity_id: actorId,
        details: { timestamp: new Date().toISOString() },
      });
      if (error) {
        console.warn('[AdminService] Could not record security event:', error.message);
        return { success: false };
      }
      return { success: true };
    } catch {
      return { success: false };
    }
  }

  async function getUserProfileDetails(userId: string): Promise<AdminUserProfileDetails> {
    await verifyActiveAdmin();
    const cleanUserId = (userId || '').trim();
    if (!cleanUserId) {
      throw new AdminServiceError('VALIDATION_ERROR', 'A valid user ID is required.');
    }

    const { data: profile, error: profileErr } = await client
      .from('profiles')
      .select('*')
      .eq('id', cleanUserId)
      .maybeSingle();

    if (profileErr) {
      throw classifySupabaseError(profileErr, 'profiles');
    }
    if (!profile) {
      throw new AdminServiceError('VALIDATION_ERROR', 'User profile not found in public.profiles.', {
        table: 'profiles',
      });
    }

    const role = profile.role === 'landlord' || profile.role === 'admin' ? profile.role : 'student';

    const [
      studentProfRes,
      landlordProfRes,
      studentDocsRes,
      roommatePrefsRes,
      landlordSubsRes,
      propertiesRes,
      studentReservationsRes,
      landlordReservationsRes,
      landlordPaymentAcctRes,
    ] = await Promise.all([
      client.from('student_profiles').select('*').eq('user_id', cleanUserId).maybeSingle(),
      client.from('landlord_profiles').select('*').eq('user_id', cleanUserId).maybeSingle(),
      role === 'student'
        ? client
            .from('student_verification_documents')
            .select('*')
            .eq('student_id', cleanUserId)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      role === 'student'
        ? client.from('roommate_preferences').select('*').eq('student_id', cleanUserId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      role === 'landlord'
        ? client
            .from('landlord_verification_submissions')
            .select('*')
            .eq('landlord_id', cleanUserId)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      role === 'landlord'
        ? client
            .from('properties')
            .select('*')
            .eq('landlord_id', cleanUserId)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      role === 'student'
        ? client
            .from('reservations')
            .select('*')
            .eq('student_id', cleanUserId)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      role === 'landlord'
        ? client
            .from('reservations')
            .select('*')
            .eq('landlord_id', cleanUserId)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      role === 'landlord'
        ? client
            .from('landlord_payment_accounts')
            .select('id, landlord_id, account_holder_name, bank_name, account_number, account_type, is_active, updated_at')
            .eq('landlord_id', cleanUserId)
            .eq('is_active', true)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    if (studentProfRes.error) throw classifySupabaseError(studentProfRes.error, 'student_profiles');
    if (landlordProfRes.error) throw classifySupabaseError(landlordProfRes.error, 'landlord_profiles');
    if ((studentDocsRes as any).error) {
      throw classifySupabaseError((studentDocsRes as any).error, 'student_verification_documents');
    }
    if ((roommatePrefsRes as any).error) {
      throw classifySupabaseError((roommatePrefsRes as any).error, 'roommate_preferences');
    }
    if ((landlordSubsRes as any).error) {
      throw classifySupabaseError((landlordSubsRes as any).error, 'landlord_verification_submissions');
    }
    if ((propertiesRes as any).error) {
      throw classifySupabaseError((propertiesRes as any).error, 'properties');
    }
    if ((studentReservationsRes as any).error) {
      throw classifySupabaseError((studentReservationsRes as any).error, 'reservations');
    }
    if ((landlordReservationsRes as any).error) {
      throw classifySupabaseError((landlordReservationsRes as any).error, 'reservations');
    }

    const rawStudent = studentProfRes.data || undefined;
    const rawLandlord = landlordProfRes.data || undefined;
    const rawPaymentAcct = !(landlordPaymentAcctRes as any)?.error
      ? (landlordPaymentAcctRes as any)?.data || null
      : null;

    const landlordPaymentAccount: AdminLandlordPaymentAccountSummary | undefined =
      role === 'landlord'
        ? rawPaymentAcct
          ? {
              configured: true,
              bankName: rawPaymentAcct.bank_name,
              accountHolderName: rawPaymentAcct.account_holder_name,
              maskedAccountNumber: maskAccountNumber(rawPaymentAcct.account_number),
              accountType: rawPaymentAcct.account_type || null,
              updatedAt: displayDate(rawPaymentAcct.updated_at),
            }
          : rawLandlord?.bank_name && rawLandlord?.bank_account_number
          ? {
              configured: true,
              bankName: rawLandlord.bank_name,
              accountHolderName: rawLandlord.bank_account_name || '',
              maskedAccountNumber: maskAccountNumber(rawLandlord.bank_account_number),
              accountType: null,
            }
          : { configured: false }
        : undefined;

    const studentProfile = rawStudent
      ? {
          ...rawStudent,
          registrationNumber: rawStudent.registration_number || '',
          isProfileVerified: Boolean(rawStudent.is_profile_verified),
        }
      : undefined;

    const landlordProfile = rawLandlord
      ? {
          ...rawLandlord,
          businessName: rawLandlord.company_name || '',
          verificationStatus: rawLandlord.verification_status || 'not_started',
        }
      : undefined;

    const rawReservations: AdminRecord[] =
      role === 'student'
        ? ((studentReservationsRes as any).data || [])
        : role === 'landlord'
        ? ((landlordReservationsRes as any).data || [])
        : [];

    const propIds = Array.from(new Set(rawReservations.map((r) => r.property_id).filter(Boolean)));
    const propertyTitleMap = new Map<string, string>(
      ((propertiesRes as any).data || []).map((p: AdminRecord) => [p.id, p.title || 'Property'])
    );
    const missingPropIds = propIds.filter((id) => !propertyTitleMap.has(id));
    if (missingPropIds.length > 0) {
      const { data: resProps } = await client.from('properties').select('id, title').in('id', missingPropIds);
      for (const p of resProps || []) {
        propertyTitleMap.set(p.id, p.title || 'Property');
      }
    }

    const reservations = rawReservations.map((item) => ({
      ...item,
      reservationNumber: String(item.id || '').slice(0, 8).toUpperCase(),
      propertyTitle: propertyTitleMap.get(item.property_id) || 'Property',
      holdExpiresAt: displayDate(item.hold_expires_at),
      createdAt: displayDate(item.created_at),
    }));

    const name = profile.full_name || landlordProfile?.businessName || profile.email || 'User';

    const user: AdminUser = {
      ...profile,
      id: profile.id,
      email: String(profile.email || ''),
      role,
      accountStatus: profile.account_status || 'active',
      emailVerified: Boolean(
        profile.is_verified || profile.account_status === 'active' || profile.account_status === 'profile_verified'
      ),
      createdAt: displayDate(profile.created_at) || new Date(0).toISOString(),
      name,
      fullName: name,
      avatarUrl: profile.avatar_url || undefined,
      phone: profile.phone || undefined,
      status: profile.account_status || 'active',
      studentProfile,
      landlordProfile,
    };

    return {
      user,
      studentProfile,
      landlordProfile,
      landlordPaymentAccount,
      roommatePreferences: (roommatePrefsRes as any).data || undefined,
      studentDocuments: (studentDocsRes as any).data || [],
      landlordSubmissions: (landlordSubsRes as any).data || [],
      properties: ((propertiesRes as any).data || []).map((p: AdminRecord) => ({
        ...p,
        createdAt: displayDate(p.created_at),
      })),
      reservations,
    };
  }

  return {
    verifyActiveAdmin,
    getAdminMetrics,
    getDashboardData,
    getUsers,
    getUserProfileDetails,
    getVerificationQueues,
    getProperties,
    getReservations,
    getReceipts,
    getAuditLogs,
    getSettings,
    setUserStatus,
    reviewVerification,
    reviewProperty,
    reviewPropertyLocation,
    saveSettings,
    recordSecurityEvent,
  };
}

export const adminService = createAdminService();
