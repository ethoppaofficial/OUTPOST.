import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { AuditLog, User } from '../../domain/types';
import { computePublicCoordinates } from '../../domain/geoUtils';
import { db, functions } from '../../infrastructure/firebase/firebaseConfig';

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

function rows<T extends Record<string, any>>(snapshot: { docs: Array<{ id: string; data(): T }> }): Array<T & { id: string }> {
  return snapshot.docs.map((item) => ({ ...item.data(), id: item.id }));
}

function toMillis(value: unknown): number {
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value && typeof (value as { toMillis?: unknown }).toMillis === 'function') return (value as { toMillis: () => number }).toMillis();
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') return (value as { toDate: () => Date }).toDate().getTime();
  return 0;
}

function displayDate(value: unknown): string {
  const millis = toMillis(value);
  return millis ? new Date(millis).toISOString() : '';
}

async function readCollection(name: string): Promise<AdminRecord[]> {
  return rows(await getDocs(collection(db, name)));
}

class AdminService {
  public async getDashboardData(): Promise<AdminDashboardData> {
    const [users, landlords, studentDocs, properties, reservations, receipts, audit] = await Promise.all([
      readCollection('users'), readCollection('landlordProfiles'), readCollection('studentVerificationDocuments'),
      readCollection('properties'), readCollection('reservations'), readCollection('paymentReceipts'), this.getAuditLogs(),
    ]);
    const now = Date.now();
    return {
      metrics: {
        totalStudents: users.filter((item) => item.role === 'student').length,
        totalLandlords: users.filter((item) => item.role === 'landlord').length,
        pendingLandlordVerifications: landlords.filter((item) => item.verificationStatus === 'pending').length,
        pendingStudentVerifications: studentDocs.filter((item) => item.status === 'pending').length,
        pendingPropertyVerifications: properties.filter((item) => item.verificationStatus === 'pending').length,
        activeProperties: properties.filter((item) => item.verificationStatus === 'approved' && item.isActive === true).length,
        activeReservations: reservations.filter((item) => ['pending_payment', 'receipt_submitted', 'confirmed'].includes(item.status)).length,
        pendingReceiptVerifications: receipts.filter((item) => item.status === 'pending_review').length,
        expiredReservations: reservations.filter((item) => item.status === 'expired' || (
          ['pending_payment', 'receipt_submitted'].includes(item.status)
          && toMillis(item.holdExpiresAt) > 0 && toMillis(item.holdExpiresAt) < now
        )).length,
      },
      recentActivity: audit.slice(0, 8),
    };
  }

  public async getUsers(): Promise<AdminUser[]> {
    const [users, students, landlords] = await Promise.all([readCollection('users'), readCollection('studentProfiles'), readCollection('landlordProfiles')]);
    const studentById = new Map(students.map((item) => [item.id, item]));
    const landlordById = new Map(landlords.map((item) => [item.id, item]));
    return users.map((record) => {
      const studentProfile = studentById.get(record.id);
      const landlordProfile = landlordById.get(record.id);
      const name = studentProfile?.fullName || landlordProfile?.legalName || record.fullName || record.name || record.email || 'User';
      return {
        ...record,
        id: record.id,
        email: String(record.email || ''),
        role: record.role === 'landlord' || record.role === 'admin' ? record.role : 'student',
        accountStatus: record.accountStatus || record.status || 'active',
        emailVerified: record.emailVerified === true,
        createdAt: displayDate(record.createdAt) || new Date(0).toISOString(),
        name,
        fullName: name,
        status: record.accountStatus || record.status || 'active',
        studentProfile,
        landlordProfile,
      } as AdminUser;
    });
  }

  public async getVerificationQueues(): Promise<{ students: AdminRecord[]; landlords: AdminRecord[] }> {
    const [studentDocs, students, landlords, users] = await Promise.all([
      readCollection('studentVerificationDocuments'), readCollection('studentProfiles'), readCollection('landlordProfiles'), readCollection('users'),
    ]);
    const studentById = new Map(students.map((item) => [item.id, item]));
    const userById = new Map(users.map((item) => [item.id, item]));
    return {
      students: studentDocs.filter((item) => item.status === 'pending').map((item) => {
        const profile: AdminRecord = studentById.get(item.studentId) || { id: '' };
        const user: AdminRecord = userById.get(item.studentId) || { id: '' };
        return { ...item, fullName: profile.fullName || item.studentName || user.fullName || 'Student', registrationNumber: profile.registrationNumber || '', university: profile.university || profile.institutionName || '', campus: profile.campus || '', programme: profile.programme || '', studyLevel: profile.studyLevel || '', studentEmail: user.email || '', submittedAt: displayDate(item.uploadedAt || item.submittedAt) };
      }),
      landlords: landlords.filter((item) => item.verificationStatus === 'pending').map((item) => {
        const user: AdminRecord = userById.get(item.id) || { id: '' };
        return { ...item, userId: item.userId || item.id, legalName: item.legalName || '', businessName: item.businessName || '', email: user.email || '', idType: item.idType || '', idNumber: item.idReference || item.idNumber || '', ownershipDocType: item.ownershipDocType || 'Submitted supporting documents', submittedAt: displayDate(item.submittedAt), documentUrl: item.documentUrl || item.idDocumentUrl || item.proofOfOwnershipUrl || '' };
      }),
    };
  }

  public async getProperties(): Promise<AdminRecord[]> {
    const [properties, locations] = await Promise.all([readCollection('properties'), readCollection('propertyLocations')]);
    const locationByProperty = new Map(locations.map((item) => [item.propertyId || item.id, item]));
    return properties.map((property) => ({ ...property, submittedLocation: locationByProperty.get(property.id) || property.location }));
  }

  public async getReservations(): Promise<AdminRecord[]> {
    const items = await readCollection('reservations');
    return items.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  }

  public async getReceipts(): Promise<AdminRecord[]> {
    return readCollection('paymentReceipts');
  }

  public async getAuditLogs(): Promise<AuditLog[]> {
    const items = await readCollection('auditLogs');
    return items.map((item) => ({ ...item, timestamp: displayDate(item.timestamp || item.createdAt) } as AuditLog))
      .sort((a, b) => toMillis(b.timestamp) - toMillis(a.timestamp));
  }

  public async getSettings(): Promise<Record<string, unknown>> {
    const snapshot = await getDoc(doc(db, 'platformSettings', 'default'));
    return snapshot.exists() ? snapshot.data() : { reservationHoldDays: 7, notificationsEnabled: true };
  }

  private async call<T>(name: string, payload: Record<string, unknown>): Promise<T> {
    const callable = httpsCallable<Record<string, unknown>, T>(functions, name);
    return (await callable(payload)).data;
  }

  public async setUserStatus(targetId: string, status: 'active' | 'suspended', reason?: string) {
    return this.call('adminSetUserStatus', { targetId, status, reason });
  }

  public async reviewVerification(payload: { kind: 'student' | 'landlord'; targetId: string; decision: 'approved' | 'rejected'; reason?: string }) {
    return this.call('adminReviewVerification', payload);
  }

  public async reviewProperty(payload: { propertyId: string; decision: 'approve' | 'reject' | 'suspend' | 'reactivate'; reason?: string }) {
    return this.call('adminReviewProperty', payload);
  }

  public async reviewPropertyLocation(payload: { propertyId: string; decision: 'verified' | 'rejected'; reason?: string }) {
    const property = (await this.getProperties()).find((item) => item.id === payload.propertyId);
    const location = property?.submittedLocation;
    if (!location) throw new Error('No location submission is available for this property.');
    if (payload.decision === 'rejected') {
      if (!payload.reason?.trim()) throw new Error('A reason is required to reject a location.');
      return this.call('reviewPropertyLocation', { propertyId: payload.propertyId, decision: 'rejected', reviewReason: payload.reason.trim() });
    }
    const coordinates = computePublicCoordinates(Number(location.latitude), Number(location.longitude), location.precision || 'nearby_building', location.area, payload.propertyId);
    return this.call('reviewPropertyLocation', {
      propertyId: payload.propertyId,
      decision: 'verified',
      publicLatitude: coordinates.publicLatitude,
      publicLongitude: coordinates.publicLongitude,
      precision: location.precision || 'nearby_building',
    });
  }

  public async saveSettings(settings: Record<string, unknown>) {
    return this.call('adminSaveSettings', { settings });
  }

  public async recordSecurityEvent(event: 'ADMIN_LOGIN' | 'ADMIN_LOGOUT') {
    return this.call('adminRecordSecurityEvent', { event });
  }
}

export const adminService = new AdminService();
