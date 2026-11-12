/**
 * @file verificationService.ts
 * @module application/services/verificationService
 * @description Application service for student academic status verification and landlord ownership vetting.
 *
 * Verification Lifecycle & Rules:
 * - Student Verification: Students upload official proof of student status at Bayero University Kano.
 *   - Permitted document types: `student_id` (ID Card), `admission_letter` (JAMB/BUK admission slip), `school_fees_receipt` (e-payment receipt).
 *   - File constraints: JPEG, PNG, or PDF; strictly limited to 5 MB per document.
 *   - Review states: `pending` -> `approved` | `rejected` | `resubmission_required`.
 * - Landlord Verification: Landlords upload legal property proof (Certificate of Occupancy, Governor's Consent, Tax Clearance, or Deed of Conveyance).
 * - Trust Boundary: Verification grants trusted status; immutable database triggers forbid users from self-approving their verification state.
 */

import {
  StudentDocumentType,
  StudentVerificationDocument,
  VerificationReviewStatus,
  LandlordProfile,
} from '../../domain/types';
import { repository } from '../../infrastructure/repositories';
import { supabase } from '../../infrastructure/supabase/supabaseClient';
import { supabaseStorageService } from '../../infrastructure/supabase/supabaseStorageService';

class VerificationService {
  public searchStudentByRegNumber(regNumber: string) {
    return repository.searchStudentByRegistrationNumber(regNumber);
  }

  public getStudentDocuments(studentId: string): StudentVerificationDocument[] {
    return repository.getStudentDocs(studentId);
  }

  public async loadStudentDocuments(studentId: string): Promise<StudentVerificationDocument[]> {
    return repository.fetchStudentDocumentsFromSupabase(studentId);
  }

  public async loadLandlordVerificationState(userId: string): Promise<{
    profile: LandlordProfile | null;
    submissions: Array<{
      id: string;
      documentType: string;
      fileName: string;
      status: VerificationReviewStatus;
      rejectionReason?: string;
      createdAt: string;
    }>;
  }> {
    const [{ data: lp, error: lpErr }, { data: subs, error: subsErr }] = await Promise.all([
      supabase.from('landlord_profiles').select('*').eq('user_id', userId).maybeSingle(),
      supabase
        .from('landlord_verification_submissions')
        .select('*')
        .eq('landlord_id', userId)
        .order('created_at', { ascending: false }),
    ]);

    if (lpErr) {
      throw new Error(`Could not load landlord verification profile: ${lpErr.message}`);
    }
    if (subsErr) {
      throw new Error(`Could not load landlord verification submissions: ${subsErr.message}`);
    }

    const mappedProfile: LandlordProfile | null = lp
      ? {
          userId: lp.user_id,
          legalName: lp.company_name || 'Landlord',
          businessName: lp.company_name || undefined,
          phone: '',
          contactAddress: lp.business_address || '',
          idType: 'National ID (NIN)',
          idReference: lp.tax_id || '',
          verificationStatus: (lp.verification_status as any) || 'not_started',
          rejectionReason: lp.rejection_reason || undefined,
          verifiedAt: lp.verified_at || undefined,
        }
      : null;

    return {
      profile: mappedProfile,
      submissions: (subs || []).map((s: any) => ({
        id: s.id,
        documentType: s.document_type,
        fileName: s.file_name,
        status: s.status,
        rejectionReason: s.rejection_reason || undefined,
        createdAt: s.created_at,
      })),
    };
  }

  public getAllPendingStudentDocuments(): StudentVerificationDocument[] {
    return repository.getStudentDocs().filter((d) => d.status === 'pending');
  }

  public async uploadStudentDocument(data: {
    studentId: string;
    studentName: string;
    documentType: StudentDocumentType;
    fileName: string;
    fileSize: number;
    fileUrl?: string;
    documentUrl?: string;
    contentType?: string;
  }): Promise<{ success: boolean; doc?: StudentVerificationDocument; error?: string }> {
    const allowedTypes: StudentDocumentType[] = ['student_id', 'admission_letter', 'school_fees_receipt'];
    if (!allowedTypes.includes(data.documentType)) {
      return {
        success: false,
        error: 'Invalid document type. Allowed: Student Identity Card, Letter of Admission, or School-fees Payment Receipt.',
      };
    }

    if (data.fileSize > 5 * 1024 * 1024) {
      return { success: false, error: 'Document file size exceeds 5MB limit.' };
    }

    const storagePath = data.documentUrl || data.fileUrl;
    if (!storagePath) {
      return { success: false, error: 'Document storage path is required. File upload must finish before metadata save.' };
    }

    try {
      const doc = await repository.addStudentDocumentPersisted({
        studentId: data.studentId,
        studentName: data.studentName,
        documentType: data.documentType,
        fileName: data.fileName,
        fileSize: data.fileSize,
        documentUrl: storagePath,
        contentType: data.contentType,
      });
      return { success: true, doc };
    } catch (err: any) {
      // Prevent orphaned storage files if DB metadata insertion fails
      await supabaseStorageService.deletePrivateAsset('student-docs', storagePath);
      return {
        success: false,
        error: err?.message || 'Could not persist student verification metadata.',
      };
    }
  }

  public reviewStudentDocument(
    docId: string,
    status: VerificationReviewStatus,
    reviewerId: string,
    rejectionReason?: string
  ) {
    return repository.reviewStudentDocument(docId, status, reviewerId, rejectionReason);
  }

  public getLandlordProfile(userId: string): LandlordProfile | undefined {
    return repository.getLandlordProfile(userId);
  }

  public async submitLandlordVerification(
    userIdOrData: string | any,
    possibleData?: any
  ): Promise<LandlordProfile & { success: boolean; error?: string }> {
    const isSingleObject = typeof userIdOrData === 'object';
    const userId = isSingleObject
      ? userIdOrData.landlordId || userIdOrData.userId || repository.getActiveUserId()
      : userIdOrData;
    const rawData = isSingleObject ? userIdOrData : (possibleData || {});

    const docUrl = rawData.documentUrl || rawData.idDocumentUrl || rawData.proofOfOwnershipUrl || '';
    if (!docUrl) {
      throw new Error('Verification document storage path is required. Physical credential upload must succeed before submission.');
    }

    const data = {
      legalName: rawData.legalName || 'Landlord',
      phone: rawData.phone || '+234 802 345 6789',
      contactAddress: rawData.contactAddress || 'Danbare / Rimin Gata Accommodation Corridor, Kano',
      idType: rawData.idType || 'National ID (NIN)',
      idReference: rawData.idReference || rawData.idNumber || 'NIN-REQUIRED',
      documentUrl: docUrl,
      businessName: rawData.businessName,
    };

    const existing = repository.getLandlordProfile(userId) || {
      userId,
      verificationStatus: 'pending' as const,
      ...data,
      submittedAt: new Date().toISOString(),
    };

    const updated: LandlordProfile = {
      ...existing,
      ...data,
      verificationStatus: 'pending',
      submittedAt: new Date().toISOString(),
      rejectionReason: undefined,
    };

    try {
      const persisted = await repository.submitLandlordVerificationPersisted({
        profile: updated,
        storagePath: docUrl,
        fileName: rawData.fileName || docUrl.split('/').pop() || 'landlord_document.pdf',
        fileSize: Number(rawData.fileSize || 1048576),
        contentType: rawData.contentType || 'application/pdf',
        ownershipDocType: rawData.ownershipDocType || data.idType,
      });

      return Object.assign(persisted, { success: true });
    } catch (err: any) {
      // Remove orphaned storage object if DB submission insert failed
      await supabaseStorageService.deletePrivateAsset('landlord-docs', docUrl);
      throw err;
    }
  }

  public getAllPendingLandlords(): LandlordProfile[] {
    return repository.getLandlordProfiles().filter((p) => p.verificationStatus === 'pending');
  }

  public getPendingStudentVerifications() {
    return this.getAllPendingStudentDocuments().map((doc) => {
      const student = repository.getStudentProfile(doc.studentId);
      const user = repository.getUserById(doc.studentId);
      return {
        id: doc.id,
        studentId: doc.studentId,
        fullName: student?.fullName || doc.studentName,
        registrationNumber: student?.registrationNumber || '',
        university: student?.university || 'Bayero University Kano',
        campus: student?.campus || 'New Campus',
        programme: student?.programme || '',
        studyLevel: student?.studyLevel || '',
        studentEmail: user?.email || '',
        submittedAt: doc.uploadedAt,
        documentType: doc.documentType,
        documentUrl: doc.documentUrl,
        fileName: doc.fileName,
        fileSize: doc.fileSize,
        status: doc.status,
      };
    });
  }

  public getPendingLandlordVerifications() {
    return this.getAllPendingLandlords().map((lp) => {
      const user = repository.getUserById(lp.userId);
      return {
        id: lp.userId,
        userId: lp.userId,
        legalName: lp.legalName,
        businessName: lp.businessName || 'Independent Landlord',
        phone: lp.phone,
        email: user?.email || '',
        idType: lp.idType,
        idReference: lp.idReference,
        idNumber: lp.idReference,
        ownershipDocType: 'Property / Identity Verification Document',
        contactAddress: lp.contactAddress,
        documentUrl: lp.documentUrl || '',
        submittedAt: lp.submittedAt || new Date().toISOString(),
        verificationStatus: lp.verificationStatus,
      };
    });
  }

  public reviewStudentVerification(
    docId: string,
    status: VerificationReviewStatus,
    reviewerId: string,
    rejectionReason?: string
  ) {
    const doc = repository.reviewStudentDocument(docId, status, reviewerId, rejectionReason);
    return { success: !!doc, doc };
  }

  public reviewLandlordVerification(
    userId: string,
    decision: 'approved' | 'rejected',
    reviewerId: string,
    reason?: string
  ) {
    const profile = repository.reviewLandlordVerification(userId, decision, reviewerId, reason);
    return { success: !!profile, profile };
  }
}

export const verificationService = new VerificationService();
