import {
  ref,
  uploadBytes,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
  UploadTask,
  UploadMetadata,
} from 'firebase/storage';
import { storage, auth } from './firebaseConfig';

export interface FileUploadResult {
  url: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  path: string;
}

export class StorageService {
  /**
   * Upload Profile Photo (images only, max 2 MB)
   * Path: profile-pictures/{uid}/{fileName}
   */
  async uploadProfilePicture(
    uid: string,
    file: File | Blob,
    fileName: string = 'avatar.jpg'
  ): Promise<FileUploadResult> {
    this.validateFileSize(file.size, 2 * 1024 * 1024, 'Profile photo');
    this.validateFileType(file.type, ['image/'], 'Profile photo');

    const cleanName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `profile-pictures/${uid}/${cleanName}`;
    const storageRef = ref(storage, storagePath);

    const snapshot = await uploadBytes(storageRef, file, {
      contentType: file.type || 'image/jpeg',
      customMetadata: {
        uploaderUid: uid,
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
   * Upload Student Verification Document (image or PDF, max 5 MB)
   * Path: student-docs/{uid}/{docId}/{fileName}
   */
  async uploadStudentDocument(
    studentId: string,
    file: File | Blob,
    originalFileName: string,
    customDocId?: string
  ): Promise<FileUploadResult> {
    this.validateFileSize(file.size, 5 * 1024 * 1024, 'Student document');
    this.validateFileType(file.type, ['image/', 'application/pdf'], 'Student document');

    const cleanName = originalFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const docId = customDocId || `doc_${Date.now()}`;
    const storagePath = `student-docs/${studentId}/${docId}/${cleanName}`;

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
   * Upload Landlord Identity or Ownership Verification Document (image or PDF, max 5 MB)
   * Path: landlord-docs/{uid}/{docId}/{fileName}
   */
  async uploadLandlordDocument(
    landlordId: string,
    file: File | Blob,
    originalFileName: string,
    customDocId?: string
  ): Promise<FileUploadResult> {
    this.validateFileSize(file.size, 5 * 1024 * 1024, 'Landlord document');
    this.validateFileType(file.type, ['image/', 'application/pdf'], 'Landlord document');

    const cleanName = originalFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const docId = customDocId || `landlord_${Date.now()}`;
    const storagePath = `landlord-docs/${landlordId}/${docId}/${cleanName}`;

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
   * Upload Property Listing Image (images only, max 5 MB)
   * Tenant-isolated path: property-images/{landlordId}/{propertyId}/{fileName}
   */
  async uploadPropertyImage(
    file: File | Blob,
    originalFileName: string,
    propertyId?: string,
    landlordId?: string
  ): Promise<FileUploadResult> {
    this.validateFileSize(file.size, 5 * 1024 * 1024, 'Property image');
    this.validateFileType(file.type, ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'], 'Property image');

    const uploaderUid = auth.currentUser?.uid || '';
    const resolvedLandlordId = (landlordId || uploaderUid || 'unknown_landlord').replace(/[^a-zA-Z0-9_-]/g, '_');
    const resolvedPropId = (propertyId || `draft_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    const cleanName = this.sanitizeFileName(originalFileName);
    const storagePath = `property-images/${resolvedLandlordId}/${resolvedPropId}/${Date.now()}_${cleanName}`;

    const storageRef = ref(storage, storagePath);
    const snapshot = await uploadBytes(storageRef, file, {
      contentType: file.type || 'image/jpeg',
      customMetadata: {
        landlordId: resolvedLandlordId,
        propertyId: resolvedPropId,
        uploaderUid,
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
   * Upload Payment Receipt for a Reservation (image or PDF, max 5 MB)
   * Tenant-isolated path: payment-receipts/{landlordId}/{studentId}/{reservationId}/{fileName}
   */
  async uploadPaymentReceipt(
    reservationId: string,
    file: File | Blob,
    originalFileName: string,
    landlordId?: string,
    studentId?: string
  ): Promise<FileUploadResult> {
    this.validateFileSize(file.size, 5 * 1024 * 1024, 'Payment receipt');
    this.validateFileType(file.type, ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf'], 'Payment receipt');

    const uploaderUid = auth.currentUser?.uid || '';
    const resolvedStudentId = (studentId || uploaderUid || 'unknown_student').replace(/[^a-zA-Z0-9_-]/g, '_');
    const resolvedLandlordId = (landlordId || 'landlord').replace(/[^a-zA-Z0-9_-]/g, '_');
    const cleanResId = reservationId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const cleanName = this.sanitizeFileName(originalFileName);

    const storagePath = `payment-receipts/${resolvedLandlordId}/${resolvedStudentId}/${cleanResId}/${Date.now()}_${cleanName}`;

    const storageRef = ref(storage, storagePath);
    const snapshot = await uploadBytes(storageRef, file, {
      contentType: file.type || 'image/jpeg',
      customMetadata: {
        reservationId: cleanResId,
        landlordId: resolvedLandlordId,
        studentId: resolvedStudentId,
        uploaderUid,
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
   * Upload Chat Attachment (image, PDF, text, max 5 MB)
   * Sender-isolated path: chat-attachments/{conversationId}/{senderId}/{fileName}
   */
  async uploadChatAttachment(
    conversationId: string,
    file: File | Blob,
    originalFileName: string,
    senderId?: string
  ): Promise<FileUploadResult> {
    this.validateFileSize(file.size, 5 * 1024 * 1024, 'Chat attachment');
    const uploaderUid = auth.currentUser?.uid || '';
    const resolvedSenderId = (senderId || uploaderUid || 'unknown_sender').replace(/[^a-zA-Z0-9_-]/g, '_');
    const cleanConvoId = conversationId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const cleanName = this.sanitizeFileName(originalFileName);

    const storagePath = `chat-attachments/${cleanConvoId}/${resolvedSenderId}/${Date.now()}_${cleanName}`;

    const storageRef = ref(storage, storagePath);
    const snapshot = await uploadBytes(storageRef, file, {
      contentType: file.type || 'application/octet-stream',
      customMetadata: {
        conversationId: cleanConvoId,
        senderId: resolvedSenderId,
        uploaderUid,
        uploadedAt: new Date().toISOString(),
      },
    });

    const url = await getDownloadURL(snapshot.ref);
    return {
      url,
      fileName: cleanName,
      fileSize: file.size,
      contentType: file.type || 'application/octet-stream',
      path: storagePath,
    };
  }

  /**
   * Start a Resumable Upload Task with Progress Reporting
   */
  uploadResumable(
    storagePath: string,
    file: File | Blob,
    metadata?: UploadMetadata
  ): UploadTask {
    const storageRef = ref(storage, storagePath);
    return uploadBytesResumable(storageRef, file, metadata);
  }

  /**
   * Delete a File from Storage by path or URL
   */
  async deleteFile(pathOrUrl: string): Promise<void> {
    if (!pathOrUrl || !pathOrUrl.trim()) return;

    try {
      let storageRef;
      if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
        storageRef = ref(storage, pathOrUrl);
      } else {
        storageRef = ref(storage, pathOrUrl);
      }
      await deleteObject(storageRef);
    } catch (err: any) {
      if (err?.code === 'storage/object-not-found') {
        return;
      }
      console.warn('Storage file deletion notice:', err?.code || 'notice');
    }
  }

  /**
   * Redact sensitive query parameters (e.g. Firebase bearer tokens) for safe logging.
   */
  public sanitizeUrlForLog(url: string): string {
    if (!url) return '';
    try {
      const parsed = new URL(url);
      if (parsed.searchParams.has('token')) {
        parsed.searchParams.set('token', 'REDACTED');
      }
      return parsed.toString();
    } catch {
      return url.split('?')[0] + '?REDACTED_QUERY';
    }
  }

  private sanitizeFileName(fileName: string): string {
    const base = fileName.split('/').pop()?.split('\\').pop() || 'file';
    return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
  }

  private validateFileSize(size: number, maxBytes: number, label: string) {
    if (size > maxBytes) {
      const maxMb = Math.round(maxBytes / (1024 * 1024));
      throw new Error(`${label} exceeds maximum allowed size of ${maxMb}MB.`);
    }
  }

  private validateFileType(type: string, allowedTypes: string[], label: string) {
    const isAllowed = allowedTypes.some((allowed) => {
      if (allowed.endsWith('/')) {
        return type.startsWith(allowed);
      }
      return type === allowed;
    });
    if (!isAllowed) {
      throw new Error(`${label} format is invalid. Accepted types: ${allowedTypes.join(', ')}.`);
    }
  }
}

export const storageService = new StorageService();
