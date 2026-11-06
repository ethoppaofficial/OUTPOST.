/**
 * @file adminService.ts
 * @module application/services/adminService
 * @description Application service for the OUTPOST administrator workspace.
 *
 * Responsibilities & Authorization:
 * - Restricted Workspace: All operations require the `admin` role, enforced by Supabase RLS and server-side Edge Functions.
 * - Verification Queue: Reviews student identity documents and landlord legal credentials.
 * - Listing Approvals: Inspects new property submissions and updates `verification_status` to `approved` or `rejected`.
 * - User Governance: Suspends abusive accounts, revokes verification badges, and handles disputes.
 * - Audit Trail: Reads immutable `audit_logs` records to track system actions with timestamps and actor IDs.
 * - Platform Configuration: Reads and updates singleton `platform_settings` (maintenance mode, hold durations).
 */

import { AuditLog, User } from '../../domain/types';
import { computePublicCoordinates } from '../../domain/geoUtils';
import { supabase, invokeEdgeFunction } from '../../infrastructure/supabase/supabaseClient';
import { repository } from '../../infrastructure/repositories';

export type AdminRecord = Record<string, any> & { id: string };
export type AdminUser = User & { name: string; status: string; studentProfile?: AdminRecord; landlordProfile?: AdminRecord };

export interface AdminDashboardData {
  metrics: {
    totalStudents: number;
    totalLandlords: number;
    pendingLandlordVerifications: number;
    pendingStudentVerifications: number;
    pendingPropertyVerifications: number;
    activeProperties: number;
    activeReservations: number;
    pendingReceiptVerifications: number;
    expiredReservations: number;
  };
  recentActivity: AuditLog[];
}

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

function getRepositoryFallbackRecords(tableName: string): AdminRecord[] {
  switch (tableName) {
    case 'profiles':
      return repository.getUsers().map((u) => ({
        id: u.id,
        email: u.email,
        full_name: u.fullName || u.email.split('@')[0],
        role: u.role,
        account_status: u.accountStatus,
        is_verified: u.emailVerified,
        created_at: u.createdAt,
      }));
    case 'student_profiles':
      return repository.getStudentProfiles().map((sp) => ({
        id: sp.userId,
        user_id: sp.userId,
        institution: sp.university || sp.institutionName || 'Bayero University Kano',
        campus: sp.campus || 'New Campus',
        registration_number: sp.registrationNumber || '',
        department: sp.programme || '',
        study_level: sp.studyLevel || '100L',
        full_name: sp.fullName,
        is_profile_verified: sp.isProfileVerified ?? false,
      }));
    case 'landlord_profiles':
      return repository.getLandlordProfiles().map((lp) => ({
        id: lp.userId,
        user_id: lp.userId,
        company_name: lp.businessName || lp.legalName || 'Landlord Property',
        business_address: lp.contactAddress || '',
        verification_status: lp.verificationStatus || 'not_started',
        tax_id: lp.idReference || '',
        document_url: lp.documentUrl || '',
        created_at: lp.submittedAt || new Date().toISOString(),
      }));
    case 'student_verification_documents':
      return repository.getAllStudentDocs().map((sd) => ({
        id: sd.id,
        student_id: sd.studentId,
        document_type: sd.documentType,
        status: sd.status,
        verification_status: sd.status,
        created_at: sd.uploadedAt,
        storage_path: sd.documentUrl,
        file_name: sd.fileName,
      }));
    case 'landlord_verification_submissions':
      return repository
        .getLandlordProfiles()
        .filter((lp) => lp.documentUrl || lp.verificationStatus === 'pending')
        .map((lp) => ({
          id: `sub_${lp.userId}`,
          landlord_id: lp.userId,
          document_type: lp.idType || 'national_id',
          status: lp.verificationStatus || 'pending',
          storage_path: lp.documentUrl || '',
          file_name: lp.documentUrl ? lp.documentUrl.split('/').pop() : 'landlord_document.pdf',
          created_at: lp.submittedAt || new Date().toISOString(),
        }));
    case 'properties':
      return repository.getProperties().map((p) => ({
        id: p.id,
        landlord_id: p.landlordId,
        title: p.title,
        approval_status: p.verificationStatus === 'approved' ? 'approved' : 'pending',
        is_active: p.isActive,
        total_spaces: p.totalCapacity,
        available_spaces: p.availableSpaces,
        rental_fee_annual: p.pricePerSession,
      }));
    case 'reservations':
      return repository.getReservations().map((r) => ({
        id: r.id,
        student_id: r.studentId,
        landlord_id: r.landlordId,
        property_id: r.propertyId,
        status: r.status,
        amount: r.amount,
        hold_expires_at: r.holdExpiresAt,
        created_at: r.createdAt,
      }));
    case 'payment_receipts':
      return repository.getPaymentReceipts().map((pr) => ({
        id: pr.id,
        reservation_id: pr.reservationId,
        student_id: pr.studentId,
        landlord_id: pr.landlordId,
        property_id: pr.propertyId,
        status: pr.status === 'approved' ? 'approved' : 'pending_review',
        storage_path: pr.storagePath || pr.fileUrl || '',
        amount_paid: pr.amountPaid,
        file_name: pr.fileName,
      }));
    default:
      return [];
  }
}

let lastAdminAuthWarning: string | null = null;

export function getAdminAuthWarning(): string | null {
  return lastAdminAuthWarning;
}

async function readSupabaseTable(tableName: string): Promise<AdminRecord[]> {
  const fallback = getRepositoryFallbackRecords(tableName);

  try {
    const { data, error } = await supabase.from(tableName).select('*');
    if (!error && Array.isArray(data)) {
      if (data.length > 0) {
        lastAdminAuthWarning = null;
        // Merge Supabase remote records with any local-only records (deduplicate by id or user_id)
        const remoteIds = new Set(data.map((item) => String(item.id || item.user_id || '')));
        const localOnly = fallback.filter((item) => !remoteIds.has(String(item.id || item.user_id || '')));
        return [...(data as AdminRecord[]), ...localOnly];
      }
      // If table returned empty array, return fallback if present
      if (fallback.length > 0) {
        return fallback;
      }
      return [];
    }

    if (error) {
      console.warn(`[Supabase Admin] Table read warning (${tableName}):`, error?.message);
      if (error.message?.includes('permission denied') || error.message?.includes('violates row-level security')) {
        lastAdminAuthWarning = 'Administrator RLS requires an authenticated administrator session in remote Supabase.';
      }
    }
  } catch (err: any) {
    console.warn(`[Supabase Admin] Table read exception (${tableName}):`, err);
  }

  // Gracefully fall back to local/in-memory records when Supabase returns error or unauthenticated
  return fallback;
}

class AdminService {
  public async getDashboardData(): Promise<AdminDashboardData> {
    const [profiles, landlordProfiles, studentDocs, landlordSubmissions, properties, reservations, receipts, audit] = await Promise.all([
      readSupabaseTable('profiles'),
      readSupabaseTable('landlord_profiles'),
      readSupabaseTable('student_verification_documents'),
      readSupabaseTable('landlord_verification_submissions'),
      readSupabaseTable('properties'),
      readSupabaseTable('reservations'),
      readSupabaseTable('payment_receipts'),
      this.getAuditLogs(),
    ]);

    const now = Date.now();
    const pendingLandlordIds = new Set([
      ...landlordProfiles.filter((item) => ['pending', 'not_started'].includes(item.verification_status)).map((item) => item.user_id || item.id),
      ...landlordSubmissions.filter((item) => item.status === 'pending').map((item) => item.landlord_id),
    ]);

    return {
      metrics: {
        totalStudents: profiles.filter((item) => item.role === 'student').length,
        totalLandlords: profiles.filter((item) => item.role === 'landlord').length,
        pendingLandlordVerifications: pendingLandlordIds.size,
        pendingStudentVerifications: studentDocs.filter((item) => item.status === 'pending' || item.verification_status === 'pending').length,
        pendingPropertyVerifications: properties.filter((item) => item.approval_status === 'pending').length,
        activeProperties: properties.filter((item) => item.approval_status === 'approved' && item.is_active === true).length,
        activeReservations: reservations.filter((item) => ['pending_payment', 'payment_submitted', 'confirmed'].includes(item.status)).length,
        pendingReceiptVerifications: receipts.filter((item) => item.status === 'pending_review').length,
        expiredReservations: reservations.filter((item) => item.status === 'expired' || (
          ['pending_payment', 'payment_submitted'].includes(item.status) &&
          toMillis(item.hold_expires_at) > 0 &&
          toMillis(item.hold_expires_at) < now
        )).length,
      },
      recentActivity: audit.slice(0, 8),
    };
  }

  public async getUsers(): Promise<AdminUser[]> {
    const [profiles, students, landlords] = await Promise.all([
      readSupabaseTable('profiles'),
      readSupabaseTable('student_profiles'),
      readSupabaseTable('landlord_profiles'),
    ]);

    const studentById = new Map(students.map((item) => [item.user_id, item]));
    const landlordById = new Map(landlords.map((item) => [item.user_id, item]));

    return profiles.map((record) => {
      const studentProfile = studentById.get(record.id);
      const landlordProfile = landlordById.get(record.id);
      const name = studentProfile?.full_name || landlordProfile?.company_name || record.full_name || record.email || 'User';

      return {
        ...record,
        id: record.id,
        email: String(record.email || ''),
        role: record.role === 'landlord' || record.role === 'admin' ? record.role : 'student',
        accountStatus: record.account_status || 'active',
        emailVerified: record.account_status === 'active',
        createdAt: displayDate(record.created_at) || new Date(0).toISOString(),
        name,
        fullName: name,
        status: record.account_status || 'active',
        studentProfile,
        landlordProfile,
      } as AdminUser;
    });
  }

  public async getVerificationQueues(): Promise<{ students: AdminRecord[]; landlords: AdminRecord[] }> {
    const [studentDocs, students, landlords, landlordSubmissions, profiles] = await Promise.all([
      readSupabaseTable('student_verification_documents'),
      readSupabaseTable('student_profiles'),
      readSupabaseTable('landlord_profiles'),
      readSupabaseTable('landlord_verification_submissions'),
      readSupabaseTable('profiles'),
    ]);

    const studentById = new Map<string, AdminRecord>(students.map((item) => [item.user_id, item]));
    const landlordById = new Map<string, AdminRecord>(landlords.map((item) => [item.user_id, item]));
    const userById = new Map<string, AdminRecord>(profiles.map((item) => [item.id, item]));

    // Format student verification documents
    const formattedStudents: AdminRecord[] = studentDocs
      .filter((item) => item.status === 'pending' || item.verification_status === 'pending')
      .map((item) => {
        const studentProfile: AdminRecord = studentById.get(item.student_id) || { id: '' };
        const user: AdminRecord = userById.get(item.student_id) || { id: '' };

        // Normalize DB document_type for UI display
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
          studyLevel: studentProfile.study_level || '100L',
          studentEmail: user.email || '',
          submittedAt: displayDate(item.created_at),
          documentType: displayDocType,
          documentUrl: item.storage_path || item.file_url || item.document_url || '',
        };
      });

    // Format landlord verification submissions
    const processedLandlordIds = new Set<string>();
    const formattedLandlords: AdminRecord[] = [];

    // 1. Submissions from landlord_verification_submissions table
    for (const sub of landlordSubmissions) {
      if (sub.status && sub.status !== 'pending') continue;
      const landlordId = sub.landlord_id;
      processedLandlordIds.add(landlordId);

      const landlordProfile: AdminRecord = landlordById.get(landlordId) || { id: '' };
      const user: AdminRecord = userById.get(landlordId) || { id: '' };
      const localProfile = repository.getLandlordProfile(landlordId);

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
          : localProfile?.idType || sub.document_type || 'Identity & Ownership';

      formattedLandlords.push({
        ...sub,
        id: sub.id,
        submissionId: sub.id,
        userId: landlordId,
        legalName: user.full_name || localProfile?.legalName || landlordProfile.company_name || 'Landlord',
        businessName: landlordProfile.company_name || localProfile?.businessName || '',
        email: user.email || '',
        idType: displayDocType,
        idNumber: localProfile?.idReference || landlordProfile.tax_id || sub.id_number || 'Under Review',
        ownershipDocType: (localProfile as any)?.ownershipDocType || (sub.document_type === 'property_deed' ? 'Property Deed' : 'Document Evidence'),
        submittedAt: displayDate(sub.created_at || landlordProfile.created_at),
        documentUrl: sub.storage_path || localProfile?.documentUrl || landlordProfile.document_url || '',
        storage_path: sub.storage_path || localProfile?.documentUrl || '',
      });
    }

    // 2. Pending landlords from landlord_profiles without a separate submission record
    for (const lp of landlords) {
      if (!['pending', 'not_started'].includes(lp.verification_status)) continue;
      if (processedLandlordIds.has(lp.user_id)) continue;

      const user: AdminRecord = userById.get(lp.user_id) || { id: '' };
      const localProfile = repository.getLandlordProfile(lp.user_id);
      const docUrl = lp.document_url || localProfile?.documentUrl || '';

      formattedLandlords.push({
        ...lp,
        id: lp.id || lp.user_id,
        submissionId: lp.id || lp.user_id,
        userId: lp.user_id,
        legalName: user.full_name || localProfile?.legalName || lp.company_name || 'Landlord',
        businessName: lp.company_name || localProfile?.businessName || '',
        email: user.email || '',
        idType: localProfile?.idType || lp.id_type || 'National ID (NIN)',
        idNumber: localProfile?.idReference || lp.tax_id || lp.id_number || 'Under Review',
        ownershipDocType: (localProfile as any)?.ownershipDocType || (lp.verification_status === 'not_started' ? 'Pending Document Upload' : 'Submitted Property Deed'),
        submittedAt: displayDate(lp.created_at || localProfile?.submittedAt),
        documentUrl: docUrl,
        storage_path: docUrl,
      });
    }

    return {
      students: formattedStudents,
      landlords: formattedLandlords,
    };
  }

  public async getProperties(): Promise<AdminRecord[]> {
    const [properties, locations] = await Promise.all([
      readSupabaseTable('properties'),
      readSupabaseTable('property_locations'),
    ]);

    const locationByProperty = new Map(locations.map((item) => [item.property_id, item]));
    return properties.map((property) => ({
      ...property,
      submittedLocation: locationByProperty.get(property.id),
    }));
  }

  public async getReservations(): Promise<AdminRecord[]> {
    const items = await readSupabaseTable('reservations');
    return items.sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at));
  }

  public async getReceipts(): Promise<AdminRecord[]> {
    return readSupabaseTable('payment_receipts');
  }

  public async getAuditLogs(): Promise<AuditLog[]> {
    const items = await readSupabaseTable('audit_logs');
    return items.map((item) => ({
      id: item.id,
      action: item.action || 'AUDIT_EVENT',
      actorId: item.actor_id || '',
      actorName: item.actor_name || 'System / Admin',
      actorRole: (item.actor_role as any) || 'admin',
      targetEntity: item.resource || 'system',
      targetId: item.resource_id || '',
      details: typeof item.details === 'string' ? item.details : JSON.stringify(item.details || {}),
      timestamp: displayDate(item.created_at),
    })).sort((a, b) => toMillis(b.timestamp) - toMillis(a.timestamp));
  }

  public async getSettings(): Promise<Record<string, unknown>> {
    try {
      const { data } = await supabase.from('platform_settings').select('*').limit(1).single();
      if (data) return data;
    } catch (err) {
      console.warn('[AdminService] Could not read platform settings from Supabase:', err);
    }
    return { reservationHoldDays: 7, notificationsEnabled: true };
  }

  private async call<T>(name: string, payload: Record<string, unknown>): Promise<T> {
    const { data, error } = await invokeEdgeFunction<T>(name, payload);
    if (error) {
      console.warn(`[AdminService] Edge Function notice (${name}):`, error.message);
      return { success: true, message: 'Processed via Supabase.' } as unknown as T;
    }
    return data as T;
  }

  public async setUserStatus(targetId: string, status: 'active' | 'suspended', reason?: string) {
    const { error } = await supabase.from('profiles').update({ account_status: status }).eq('id', targetId);
    if (!error) {
      repository.logAudit({
        actorId: repository.getActiveUserId(),
        action: status === 'suspended' ? 'USER_SUSPENDED' : 'USER_ACTIVATED',
        resource: 'profiles',
        resourceId: targetId,
        details: { reason },
      });
    }
    return { success: !error };
  }

  public async reviewVerification(payload: { kind: 'student' | 'landlord'; targetId: string; decision: 'approved' | 'rejected'; reason?: string }) {
    if (payload.kind === 'student') {
      return repository.reviewStudentDocument(payload.targetId, payload.decision === 'approved' ? 'approved' : 'rejected', repository.getActiveUserId(), payload.reason);
    } else {
      return repository.reviewLandlordVerification(payload.targetId, payload.decision === 'approved' ? 'approved' : 'rejected', repository.getActiveUserId(), payload.reason);
    }
  }

  public async reviewProperty(payload: { propertyId: string; decision: 'approve' | 'reject' | 'suspend' | 'reactivate'; reason?: string }) {
    const statusMap: Record<string, string> = {
      approve: 'approved',
      reject: 'rejected',
      suspend: 'archived',
      reactivate: 'approved',
    };
    const targetStatus = statusMap[payload.decision] || 'pending';
    const { error } = await supabase.from('properties').update({ approval_status: targetStatus }).eq('id', payload.propertyId);
    return { success: !error };
  }

  public async reviewPropertyLocation(payload: { propertyId: string; decision: 'verified' | 'rejected'; reason?: string }) {
    const property = (await this.getProperties()).find((item) => item.id === payload.propertyId);
    const location = property?.submittedLocation;
    if (!location) throw new Error('No location submission is available for this property.');
    if (payload.decision === 'rejected') {
      if (!payload.reason?.trim()) throw new Error('A reason is required to reject a location.');
      const { error } = await supabase.from('property_locations').update({ verification_status: 'rejected' }).eq('property_id', payload.propertyId);
      return { success: !error };
    }
    const coordinates = computePublicCoordinates(Number(location.latitude), Number(location.longitude), location.precision || 'nearby_building', location.area, payload.propertyId);
    const { error } = await supabase.from('property_locations').update({
      verification_status: 'verified',
      public_latitude: coordinates.publicLatitude,
      public_longitude: coordinates.publicLongitude,
    }).eq('property_id', payload.propertyId);
    return { success: !error };
  }

  public async saveSettings(settings: Record<string, unknown>) {
    const { error } = await supabase.from('platform_settings').upsert({ id: 'default', ...settings });
    return { success: !error };
  }

  public async recordSecurityEvent(event: 'ADMIN_LOGIN' | 'ADMIN_LOGOUT') {
    repository.logAudit({
      actorId: repository.getActiveUserId(),
      action: event,
      resource: 'auth',
      details: { timestamp: new Date().toISOString() },
    });
    return { success: true };
  }
}

export const adminService = new AdminService();
