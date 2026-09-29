import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage, auth } from './firebaseConfig';
import { appConfig } from '../config/appConfig';
import { getSupabaseClient } from '../../lib/supabase/client';

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
    const docId = `doc_${Date.now()}`;
    const storagePath = `student-docs/${studentId}/${docId}/${cleanName}`;

    if (appConfig.backendMode === 'mock') {
      return {
        url: URL.createObjectURL(file),
        fileName: cleanName,
        fileSize: file.size,
        contentType: file.type || 'application/pdf',
        path: storagePath,
      };
    }

    if (appConfig.backendMode === 'supabase') {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client is not configured.');
      }
      const { error } = await supabase.storage
        .from('verification-documents')
        .upload(storagePath, file, {
          contentType: file.type || 'application/pdf',
          upsert: false,
        });
      if (error) {
        throw new Error(`Supabase Storage upload failed: ${error.message}`);
      }
      const { data: signedData } = await supabase.storage
        .from('verification-documents')
        .createSignedUrl(storagePath, 3600);
      return {
        url: signedData?.signedUrl || storagePath,
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
    const docId = `landlord_${Date.now()}`;
    const storagePath = `landlord-docs/${landlordId}/${docId}/${cleanName}`;

    if (appConfig.backendMode === 'mock') {
      return {
        url: URL.createObjectURL(file),
        fileName: cleanName,
        fileSize: file.size,
        contentType: file.type || 'application/pdf',
        path: storagePath,
      };
    }

    if (appConfig.backendMode === 'supabase') {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client is not configured.');
      }
      const { error } = await supabase.storage
        .from('verification-documents')
        .upload(storagePath, file, {
          contentType: file.type || 'application/pdf',
          upsert: false,
        });
      if (error) {
        throw new Error(`Supabase Storage upload failed: ${error.message}`);
      }
      const { data: signedData } = await supabase.storage
        .from('verification-documents')
        .createSignedUrl(storagePath, 3600);
      return {
        url: signedData?.signedUrl || storagePath,
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
    const receiptId = `receipt_${Date.now()}`;
    const storagePath = `receipts/${reservationId}/${receiptId}/${cleanName}`;

    if (appConfig.backendMode === 'mock') {
      return {
        url: URL.createObjectURL(file),
        fileName: cleanName,
        fileSize: file.size,
        contentType: file.type || 'image/jpeg',
        path: storagePath,
      };
    }

    if (appConfig.backendMode === 'supabase') {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client is not configured.');
      }
      const { error } = await supabase.storage
        .from('payment-receipts')
        .upload(storagePath, file, {
          contentType: file.type || 'image/jpeg',
          upsert: false,
        });
      if (error) {
        throw new Error(`Supabase Storage upload failed: ${error.message}`);
      }
      const { data: signedData } = await supabase.storage
        .from('payment-receipts')
        .createSignedUrl(storagePath, 3600);
      return {
        url: signedData?.signedUrl || storagePath,
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
   * Max 10MB, Image only. Path: property-images/{propertyId}/{fileName}
   */
  async uploadPropertyImage(
    file: File | Blob,
    originalFileName: string,
    propertyId: string = 'pending_submission'
  ): Promise<FileUploadResult> {
    this.validateFileSize(file.size, 10 * 1024 * 1024, 'Property image');
    this.validateFileType(file.type, ['image/'], 'Property image');

    const cleanName = originalFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `property-images/${propertyId}/${Date.now()}_${cleanName}`;

    if (appConfig.backendMode === 'mock') {
      return {
        url: URL.createObjectURL(file),
        fileName: cleanName,
        fileSize: file.size,
        contentType: file.type || 'image/jpeg',
        path: storagePath,
      };
    }

    if (appConfig.backendMode === 'supabase') {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error('Supabase client is not configured.');
      }
      const { error } = await supabase.storage
        .from('property-images')
        .upload(storagePath, file, {
          contentType: file.type || 'image/jpeg',
          upsert: false,
        });
      if (error) {
        throw new Error(`Supabase Storage upload failed: ${error.message}`);
      }
      const { data: pubData } = supabase.storage
        .from('property-images')
        .getPublicUrl(storagePath);
      return {
        url: pubData.publicUrl,
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
