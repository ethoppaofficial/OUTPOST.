import {
  StudentDocumentType,
  StudentVerificationDocument,
  VerificationReviewStatus,
  LandlordProfile,
} from '../../domain/types';
import { repository } from '../../infrastructure/repositories';

class VerificationService {
  public searchStudentByRegNumber(regNumber: string) {
    return repository.searchStudentByRegistrationNumber(regNumber);
  }

  public getStudentDocuments(studentId: string): StudentVerificationDocument[] {
    return repository.getStudentDocs(studentId);
  }

  public getAllPendingStudentDocuments(): StudentVerificationDocument[] {
    return repository.getStudentDocs().filter((d) => d.status === 'pending');
  }

  public uploadStudentDocument(data: {
    studentId: string;
    studentName: string;
    documentType: StudentDocumentType;
    fileName: string;
    fileSize: number;
    fileUrl?: string;
    documentUrl?: string;
  }): { success: boolean; doc?: StudentVerificationDocument; error?: string } {
    // Validate document type explicitly
    const allowedTypes: StudentDocumentType[] = ['student_id', 'admission_letter', 'school_fees_receipt'];
    if (!allowedTypes.includes(data.documentType)) {
      return {
        success: false,
        error: 'Invalid document type. Allowed: Student Identity Card, Letter of Admission, or School-fees Payment Receipt.',
      };
    }

    // Validate size (max 5MB)
    if (data.fileSize > 5 * 1024 * 1024) {
      return { success: false, error: 'Document file size exceeds 5MB limit.' };
    }

    const doc = repository.addStudentDocument({
      studentId: data.studentId,
      studentName: data.studentName,
      documentType: data.documentType,
      fileName: data.fileName,
      fileSize: data.fileSize,
      documentUrl: data.documentUrl || data.fileUrl || 'https://images.unsplash.com/photo-1544717305-2782549b5136?w=600',
    });
    return { success: true, doc };
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

  public submitLandlordVerification(
    userIdOrData: string | any,
    possibleData?: any
  ) {
    const isSingleObject = typeof userIdOrData === 'object';
    const userId = isSingleObject
      ? userIdOrData.landlordId || userIdOrData.userId || repository.getActiveUserId()
      : userIdOrData;
    const rawData = isSingleObject ? userIdOrData : (possibleData || {});

    const data = {
      legalName: rawData.legalName || 'Landlord',
      phone: rawData.phone || '+234 802 345 6789',
      contactAddress: rawData.contactAddress || 'Central District, Metro City',
      idType: rawData.idType || 'National ID (NIN)',
      idReference: rawData.idReference || rawData.idNumber || 'NIN-8291048291',
      documentUrl: rawData.documentUrl || rawData.idDocumentUrl || rawData.proofOfOwnershipUrl || 'https://outpost-storage.ng/docs/landlord_nin.pdf',
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

    repository.saveLandlordProfile(updated);

    // Notify admins
    repository.createNotification({
      userId: 'user-admin-1',
      title: 'Landlord Verification Submitted',
      message: `${data.legalName} submitted identification details (${data.idType} - ${data.idReference}) for review.`,
      type: 'info',
      link: '/admin/landlord-verifications',
    });

    return updated;
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
        registrationNumber: student?.registrationNumber || 'STU-2026-4821',
        university: student?.university || 'Higher Institution',
        campus: student?.campus || 'Main Campus',
        programme: student?.programme || 'Undergraduate Programme',
        studyLevel: student?.studyLevel || 'Undergraduate (300L)',
        studentEmail: user?.email || 'student@campus.edu.ng',
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
        email: user?.email || 'landlord@lagoshousing.ng',
        idType: lp.idType,
        idReference: lp.idReference,
        idNumber: lp.idReference,
        ownershipDocType: 'Certificate of Ownership / Utility Bill',
        contactAddress: lp.contactAddress,
        documentUrl: lp.documentUrl || 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=500',
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
