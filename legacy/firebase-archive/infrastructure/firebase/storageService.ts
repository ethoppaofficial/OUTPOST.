/**
 * Outpost Storage Service
 * Fully migrated to Supabase Storage and Supabase Edge Functions.
 * Replaces legacy Firebase Storage calls with tenant-isolated Supabase storage buckets.
 */
import {
  supabaseStorageService,
  SupabaseStorageService,
  SupabaseFileUploadResult,
} from '../../../../src/infrastructure/supabase/supabaseStorageService';
import { supabase, invokeEdgeFunction } from '../../../../src/infrastructure/supabase/supabaseClient';

export interface FileUploadResult {
  url: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  path: string;
}

export class StorageService {
  private delegate: SupabaseStorageService = supabaseStorageService;

  /**
   * Upload Profile Photo (images only, max 2 MB)
   * Stored in Supabase 'profile-pictures' bucket
   */
  async uploadProfilePicture(
    uid: string,
    file: File | Blob,
    fileName: string = 'avatar.jpg'
  ): Promise<FileUploadResult> {
    const res = await this.delegate.uploadProfilePicture(file, uid);
    return {
      url: res.url,
      path: res.path,
      fileName: res.fileName,
      fileSize: res.fileSize,
      contentType: res.contentType,
    };
  }

  /**
   * Upload Student Verification Document (image or PDF, max 10 MB)
   * Stored in private Supabase 'student-docs' bucket
   */
  async uploadStudentDocument(
    studentId: string,
    file: File | Blob,
    originalFileName: string = 'document.pdf',
    customDocId?: string
  ): Promise<FileUploadResult> {
    const res = await this.delegate.uploadStudentDocument(file, studentId, customDocId || 'student_id');
    return {
      url: res.url,
      path: res.path,
      fileName: res.fileName,
      fileSize: res.fileSize,
      contentType: res.contentType,
    };
  }

  /**
   * Upload Landlord Identity or Ownership Document (image or PDF, max 10 MB)
   * Stored in private Supabase 'landlord-docs' bucket
   */
  async uploadLandlordDocument(
    landlordId: string,
    file: File | Blob,
    originalFileName: string = 'document.pdf',
    customDocId?: string
  ): Promise<FileUploadResult> {
    const res = await this.delegate.uploadLandlordDocument(file, landlordId, customDocId || 'c_of_o');
    return {
      url: res.url,
      path: res.path,
      fileName: res.fileName,
      fileSize: res.fileSize,
      contentType: res.contentType,
    };
  }

  /**
   * Upload Property Listing Image (images only, max 10 MB)
   * Stored in public Supabase 'property-images' bucket
   */
  async uploadPropertyImage(
    file: File | Blob,
    originalFileName: string,
    propertyId?: string,
    landlordId?: string
  ): Promise<FileUploadResult> {
    const effectiveLandlordId = landlordId || (await supabase.auth.getUser()).data.user?.id || 'landlord';
    const effectivePropId = propertyId || `prop_${Date.now()}`;
    const res = await this.delegate.uploadPropertyImage(file, effectiveLandlordId, effectivePropId);
    return {
      url: res.url,
      path: res.path,
      fileName: res.fileName,
      fileSize: res.fileSize,
      contentType: res.contentType,
    };
  }

  /**
   * Upload Payment Receipt for a Reservation (image or PDF, max 10 MB)
   * Stored in tenant-isolated Supabase 'payment-receipts' bucket via Edge Function
   */
  async uploadPaymentReceipt(
    reservationId: string,
    file: File | Blob,
    originalFileName: string,
    landlordId?: string,
    studentId?: string
  ): Promise<FileUploadResult> {
    try {
      const sessionResult = await this.delegate.uploadPaymentReceiptWithSession({
        reservationId,
        file,
        originalFileName,
        amountPaid: 0,
        paymentReference: `ref_${Date.now()}`,
        payerBankName: 'Direct',
        paymentDate: new Date().toISOString(),
      });
      return {
        url: sessionResult.storagePath,
        path: sessionResult.storagePath,
        fileName: sessionResult.fileName,
        fileSize: sessionResult.fileSize,
        contentType: sessionResult.contentType,
      };
    } catch {
      // Direct bucket fallback using authenticated user session
      const user = (await supabase.auth.getUser()).data.user;
      const effectiveStudentId = studentId || user?.id || 'student';
      const effectiveLandlordId = landlordId || 'landlord';
      const cleanName = originalFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `${effectiveLandlordId}/${effectiveStudentId}/${reservationId}/${Date.now()}_${cleanName}`;

      const { error } = await supabase.storage
        .from('payment-receipts')
        .upload(storagePath, file, {
          contentType: file.type || 'image/jpeg',
          upsert: false,
        });

      if (error) {
        throw new Error(`Receipt upload failed: ${error.message}`);
      }

      return {
        url: storagePath,
        path: storagePath,
        fileName: cleanName,
        fileSize: file.size,
        contentType: file.type || 'image/jpeg',
      };
    }
  }

  /**
   * Upload Chat Attachment (image, PDF, max 10 MB)
   * Stored in sender-isolated Supabase 'chat-attachments' bucket
   */
  async uploadChatAttachment(
    conversationId: string,
    file: File | Blob,
    originalFileName: string,
    senderId?: string
  ): Promise<FileUploadResult> {
    const user = (await supabase.auth.getUser()).data.user;
    const effectiveSenderId = senderId || user?.id || 'sender';
    const cleanName = originalFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${conversationId}/${effectiveSenderId}/${Date.now()}_${cleanName}`;

    const { error } = await supabase.storage
      .from('chat-attachments')
      .upload(storagePath, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });

    if (error) {
      throw new Error(`Chat attachment upload failed: ${error.message}`);
    }

    return {
      url: storagePath,
      path: storagePath,
      fileName: cleanName,
      fileSize: file.size,
      contentType: file.type || 'application/octet-stream',
    };
  }

  /**
   * Upload Chat Attachment through Edge Function Session
   */
  async uploadChatAttachmentWithSession(params: {
    conversationId: string;
    file: File | Blob;
    originalFileName: string;
    text?: string;
  }) {
    return this.delegate.uploadChatAttachmentWithSession(params);
  }

  /**
   * Request short-lived signed URL for private assets via Edge Function
   */
  async getPrivateAssetDownloadUrl(
    assetType: 'payment-receipt' | 'chat-attachment' | 'student-document' | 'landlord-document',
    recordId: string
  ): Promise<string> {
    return this.delegate.getPrivateAssetDownloadUrl(assetType, recordId);
  }

  /**
   * Delete a File from Storage by path
   */
  async deleteFile(pathOrUrl: string, bucketName: string = 'property-images'): Promise<void> {
    if (!pathOrUrl || !pathOrUrl.trim()) return;
    try {
      const cleanPath = pathOrUrl.split('?')[0].replace(/^https?:\/\/[^\/]+\//, '');
      await supabase.storage.from(bucketName).remove([cleanPath]);
    } catch (err: any) {
      console.warn('Storage file deletion notice:', err?.message || 'notice');
    }
  }

  /**
   * Redact sensitive query parameters for safe logging.
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
}

export const storageService = new StorageService();
