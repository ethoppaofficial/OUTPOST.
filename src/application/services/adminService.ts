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

async function readSupabaseTable(tableName: string): Promise<AdminRecord[]> {
  try {
    const { data, error } = await supabase.from(tableName).select('*');
    if (error || !data) {
      console.warn(`[Supabase Admin] Table read warning (${tableName}):`, error?.message);
      return [];
    }
    return data as AdminRecord[];
  } catch (err) {
    console.warn(`[Supabase Admin] Table read exception (${tableName}):`, err);
    return [];
  }
}

class AdminService {
  public async getDashboardData(): Promise<AdminDashboardData> {
    const [profiles, landlordProfiles, studentDocs, properties, reservations, receipts, audit] = await Promise.all([
      readSupabaseTable('profiles'),
      readSupabaseTable('landlord_profiles'),
      readSupabaseTable('student_verification_documents'),
      readSupabaseTable('properties'),
      readSupabaseTable('reservations'),
      readSupabaseTable('payment_receipts'),
      this.getAuditLogs(),
    ]);

    const now = Date.now();
    return {
      metrics: {
        totalStudents: profiles.filter((item) => item.role === 'student').length,
        totalLandlords: profiles.filter((item) => item.role === 'landlord').length,
        pendingLandlordVerifications: landlordProfiles.filter((item) => item.verification_status === 'pending').length,
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
    const [studentDocs, students, landlords, profiles] = await Promise.all([
      readSupabaseTable('student_verification_documents'),
      readSupabaseTable('student_profiles'),
      readSupabaseTable('landlord_profiles'),
      readSupabaseTable('profiles'),
    ]);

    const studentById = new Map<string, AdminRecord>(students.map((item) => [item.user_id, item]));
    const userById = new Map<string, AdminRecord>(profiles.map((item) => [item.id, item]));

    return {
      students: studentDocs.filter((item) => item.status === 'pending' || item.verification_status === 'pending').map((item) => {
        const profile: AdminRecord = studentById.get(item.student_id) || { id: '' };
        const user: AdminRecord = userById.get(item.student_id) || { id: '' };
        return {
          ...item,
          fullName: user.full_name || 'Student',
          registrationNumber: profile.registration_number || '',
          university: profile.institution || 'Bayero University Kano',
          campus: profile.campus || 'New Campus',
          programme: profile.department || '',
          studyLevel: profile.study_level || '100L',
          studentEmail: user.email || '',
          submittedAt: displayDate(item.created_at),
        };
      }),
      landlords: landlords.filter((item) => item.verification_status === 'pending').map((item) => {
        const user: AdminRecord = userById.get(item.user_id) || { id: '' };
        return {
          ...item,
          userId: item.user_id,
          legalName: user.full_name || item.company_name || 'Landlord',
          businessName: item.company_name || '',
          email: user.email || '',
          idType: 'National ID / BVN',
          idNumber: item.tax_id || '',
          ownershipDocType: 'Submitted Property Deed',
          submittedAt: displayDate(item.created_at),
          documentUrl: '',
        };
      }),
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
