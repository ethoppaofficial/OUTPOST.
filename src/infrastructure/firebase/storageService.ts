import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage, auth } from './firebaseConfig';
import { appConfig } from '../config/appConfig';

export interface FileUploadResult {
  url: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  path: string;
}

export class StorageService {
  /**
   * Upload Student Verification Document (Admission letter, School ID, Fees receipt)
   * Max 5MB, PDF or Image only. Path: student-docs/{studentId}/{documentId}
   */
  async uploadStudentDocument(
    studentId: string,
    file: File | Blob,
    originalFileName: string
  ): Promise<FileUploadResult> {
    this.validateFileSize(file.size, 5 * 1024 * 1024, 'Student document');
    this.validateFileType(file.type, ['image/', 'application/pdf'], 'Student document');

    const cleanName = originalFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const docId = `doc_${Date.now()}_${cleanName}`;
    const storagePath = `student-docs/${studentId}/${docId}`;

    if (appConfig.backendMode === 'mock') {
      return {
        url: URL.createObjectURL(file),
        fileName: cleanName,
        fileSize: file.size,
        contentType: file.type || 'application/pdf',
        path: storagePath,
      };
    }

    const storageRef = ref(storage, storagePath);
    const snapshot = await uploadBytes(storageRef, file, {
      contentType: file.type || 'application/pdf',
      customMetadata: {
        uploaderUid: auth.currentUser?.uid || studentId,
        studentId,
        uploadedAt: new Date().toISOString(),
      },
    });

    const url = await getDownloadURL(snapshot.ref);
    return {
      url,
      fileName: cleanName,
      fileSize: file.size,
      contentType: file.type || 'application/pdf',
      path: storagePath,
    };
  }

  /**
   * Upload Landlord Identity or Ownership Verification Document
   * Max 5MB, PDF or Image only. Path: landlord-docs/{landlordId}/{documentId}
   */
  async uploadLandlordDocument(
    landlordId: string,
    file: File | Blob,
    originalFileName: string
  ): Promise<FileUploadResult> {
    this.validateFileSize(file.size, 5 * 1024 * 1024, 'Landlord document');
    this.validateFileType(file.type, ['image/', 'application/pdf'], 'Landlord document');

    const cleanName = originalFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const docId = `landlord_${Date.now()}_${cleanName}`;
    const storagePath = `landlord-docs/${landlordId}/${docId}`;

    if (appConfig.backendMode === 'mock') {
      return {
        url: URL.createObjectURL(file),
        fileName: cleanName,
        fileSize: file.size,
        contentType: file.type || 'application/pdf',
        path: storagePath,
      };
    }

    const storageRef = ref(storage, storagePath);
    const snapshot = await uploadBytes(storageRef, file, {
      contentType: file.type || 'application/pdf',
      customMetadata: {
        uploaderUid: auth.currentUser?.uid || landlordId,
        landlordId,
        uploadedAt: new Date().toISOString(),
      },
    });

    const url = await getDownloadURL(snapshot.ref);
    return {
      url,
      fileName: cleanName,
      fileSize: file.size,
      contentType: file.type || 'application/pdf',
      path: storagePath,
    };
  }

  /**
   * Upload Payment Receipt for a Reservation Hold
   * Max 10MB, PDF or Image. Path: receipts/{reservationId}/{receiptId}
   */
  async uploadPaymentReceipt(
    reservationId: string,
    file: File | Blob,
    originalFileName: string
  ): Promise<FileUploadResult> {
    this.validateFileSize(file.size, 10 * 1024 * 1024, 'Payment receipt');
    this.validateFileType(file.type, ['image/', 'application/pdf'], 'Payment receipt');

    const cleanName = originalFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const receiptId = `receipt_${Date.now()}_${cleanName}`;
    const storagePath = `receipts/${reservationId}/${receiptId}`;

    if (appConfig.backendMode === 'mock') {
      return {
        url: URL.createObjectURL(file),
        fileName: cleanName,
        fileSize: file.size,
        contentType: file.type || 'image/jpeg',
        path: storagePath,
      };
    }

    const storageRef = ref(storage, storagePath);
    const snapshot = await uploadBytes(storageRef, file, {
      contentType: file.type || 'image/jpeg',
      customMetadata: {
        reservationId,
        uploaderUid: auth.currentUser?.uid || '',
        uploadedAt: new Date().toISOString(),
      },
    });

    const url = await getDownloadURL(snapshot.ref);
    return {
      url,
      fileName: cleanName,
      fileSize: file.size,
      contentType: file.type || 'image/jpeg',
      path: storagePath,
    };
  }

  /**
   * Upload Public Property Image
   * Max 5MB, Image only. Path: property-images/{imageId}
   */
  async uploadPropertyImage(file: File | Blob, originalFileName: string): Promise<FileUploadResult> {
    this.validateFileSize(file.size, 5 * 1024 * 1024, 'Property image');
    this.validateFileType(file.type, ['image/'], 'Property image');

    const cleanName = originalFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const imageId = `prop_img_${Date.now()}_${cleanName}`;
    const storagePath = `property-images/${imageId}`;

    if (appConfig.backendMode === 'mock') {
      return {
        url: URL.createObjectURL(file),
        fileName: cleanName,
        fileSize: file.size,
        contentType: file.type || 'image/jpeg',
        path: storagePath,
      };
    }

    const storageRef = ref(storage, storagePath);
    const snapshot = await uploadBytes(storageRef, file, {
      contentType: file.type || 'image/jpeg',
    });

    const url = await getDownloadURL(snapshot.ref);
    return {
      url,
      fileName: cleanName,
      fileSize: file.size,
      contentType: file.type || 'image/jpeg',
      path: storagePath,
    };
  }

  private validateFileSize(size: number, maxBytes: number, label: string) {
    if (size > maxBytes) {
      const maxMb = Math.round(maxBytes / (1024 * 1024));
      throw new Error(`${label} exceeds maximum allowed size of ${maxMb}MB.`);
    }
  }

  private validateFileType(type: string, allowedPrefixes: string[], label: string) {
    const isAllowed = allowedPrefixes.some((prefix) => type.startsWith(prefix) || type === prefix);
    if (!isAllowed) {
      throw new Error(`${label} must be an image or PDF document.`);
    }
  }
}

export const storageService = new StorageService();
