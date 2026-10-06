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
   * Path: property-images/{propertyId}/{fileName}
   */
  async uploadPropertyImage(
    file: File | Blob,
    originalFileName: string,
    propertyId: string = 'pending_submission'
  ): Promise<FileUploadResult> {
    this.validateFileSize(file.size, 5 * 1024 * 1024, 'Property image');
    this.validateFileType(file.type, ['image/'], 'Property image');

    const cleanName = originalFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `property-images/${propertyId}/${Date.now()}_${cleanName}`;

    const storageRef = ref(storage, storagePath);
    const snapshot = await uploadBytes(storageRef, file, {
      contentType: file.type || 'image/jpeg',
      customMetadata: {
        propertyId,
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
   * Upload Payment Receipt for a Reservation (image or PDF, max 5 MB)
   * Path: payment-receipts/{reservationId}/{fileName}
   */
  async uploadPaymentReceipt(
    reservationId: string,
    file: File | Blob,
    originalFileName: string
  ): Promise<FileUploadResult> {
    this.validateFileSize(file.size, 5 * 1024 * 1024, 'Payment receipt');
    this.validateFileType(file.type, ['image/', 'application/pdf'], 'Payment receipt');

    const cleanName = originalFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `payment-receipts/${reservationId}/${Date.now()}_${cleanName}`;

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
   * Upload Chat Attachment (image, PDF, text, max 5 MB)
   * Path: chat-attachments/{chatId}/{fileName}
   */
  async uploadChatAttachment(
    chatId: string,
    file: File | Blob,
    originalFileName: string
  ): Promise<FileUploadResult> {
    this.validateFileSize(file.size, 5 * 1024 * 1024, 'Chat attachment');
    const cleanName = originalFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `chat-attachments/${chatId}/${Date.now()}_${cleanName}`;

    const storageRef = ref(storage, storagePath);
    const snapshot = await uploadBytes(storageRef, file, {
      contentType: file.type || 'application/octet-stream',
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
        // Firebase storage URL or direct reference
        storageRef = ref(storage, pathOrUrl);
      } else {
        storageRef = ref(storage, pathOrUrl);
      }
      await deleteObject(storageRef);
    } catch (err: any) {
      // If object doesn't exist, ignore (already deleted)
      if (err?.code === 'storage/object-not-found') {
        return;
      }
      console.warn('Storage file deletion notice:', err);
    }
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
