/**
 * @file supabaseStorageService.ts
 * @module infrastructure/supabase/supabaseStorageService
 * @description Storage service managing file uploads and downloads across Supabase Storage buckets.
 *
 * Bucket Segmentation & Security:
 * - `student-docs` (Private): Stores academic verification files; access restricted to owner student and admin.
 * - `landlord-docs` (Private): Stores legal property ownership documents; restricted to landlord and admin.
 * - `payment-receipts` (Private): Tenant-isolated path `{landlordId}/{studentId}/{reservationId}/{file}`;
 *   accessible only to student owner, property landlord, or admin via short-lived signed URLs.
 * - `chat-attachments` (Private): Sender-isolated path `{conversationId}/{senderId}/{file}`; restricted to conversation participants.
 * - `property-images` (Public): Publicly viewable listing photos; uploads restricted to owning landlord.
 * - `profile-pictures` (Public): Public avatars; uploads restricted to owning user.
 *
 * Edge Function Sessions:
 * - Sensitive uploads (`payment-receipts`, `chat-attachments`) use server-authoritative upload sessions
 *   (`request-receipt-upload`, `finalize-receipt-upload`) ensuring validation before database registration.
 */

import { supabase, invokeEdgeFunction } from './supabaseClient';

export interface SupabaseFileUploadResult {
  url: string;
  path: string;
  fileName: string;
  fileSize: number;
  contentType: string;
}

export class SupabaseStorageService {
  private sanitizeFileName(fileName: string): string {
    const base = fileName.split(/[\/\\]/).pop() || 'upload';
    const clean = base
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/\.{2,}/g, '.')
      .replace(/^_+/, '')
      .slice(0, 100);
    return clean || `file_${Date.now()}`;
  }

  private validateFileSize(size: number, maxBytes: number, label: string): void {
    if (size > maxBytes) {
      const maxMb = Math.round(maxBytes / (1024 * 1024));
      throw new Error(`${label} exceeds maximum allowed size of ${maxMb}MB.`);
    }
  }

  /**
   * Upload Student Verification Document to private bucket 'student-docs'
  /**
   * Upload Student Verification Document to private bucket 'student-docs'
   */
  async uploadStudentDocument(
    arg1: File | Blob | string,
    arg2: string | File | Blob,
    arg3: string = 'document.pdf',
    arg4?: string
  ): Promise<SupabaseFileUploadResult> {
    const file = (typeof arg1 === 'string' ? arg2 : arg1) as File | Blob;
    const studentId = (typeof arg1 === 'string' ? arg1 : arg2) as string;
    const originalName = typeof arg1 === 'string' && typeof arg3 === 'string' ? arg3 : (file as File).name || 'document.pdf';
    this.validateFileSize(file.size, 10 * 1024 * 1024, 'Student document');
    const cleanName = this.sanitizeFileName(originalName);
    const docId = crypto.randomUUID();
    const storagePath = `${studentId}/${docId}/${cleanName}`;

    const { error } = await supabase.storage
      .from('student-docs')
      .upload(storagePath, file, {
        contentType: file.type || 'application/pdf',
        upsert: false,
      });

    if (error) {
      throw new Error(`Failed to upload student document: ${error.message}`);
    }

    return {
      url: storagePath,
      path: storagePath,
      fileName: cleanName,
      fileSize: file.size,
      contentType: file.type || 'application/pdf',
    };
  }

  /**
   * Upload Landlord Verification Submission to private bucket 'landlord-docs'
   */
  async uploadLandlordDocument(
    arg1: File | Blob | string,
    arg2: string | File | Blob,
    arg3: string = 'document.pdf',
    arg4?: string
  ): Promise<SupabaseFileUploadResult> {
    const file = (typeof arg1 === 'string' ? arg2 : arg1) as File | Blob;
    const landlordId = (typeof arg1 === 'string' ? arg1 : arg2) as string;
    const originalName = typeof arg1 === 'string' && typeof arg3 === 'string' ? arg3 : (file as File).name || 'document.pdf';
    this.validateFileSize(file.size, 10 * 1024 * 1024, 'Landlord document');
    const cleanName = this.sanitizeFileName(originalName);
    const docId = crypto.randomUUID();
    const storagePath = `${landlordId}/${docId}/${cleanName}`;

    const { error } = await supabase.storage
      .from('landlord-docs')
      .upload(storagePath, file, {
        contentType: file.type || 'application/pdf',
        upsert: false,
      });

    if (error) {
      throw new Error(`Failed to upload landlord document: ${error.message}`);
    }

    return {
      url: storagePath,
      path: storagePath,
      fileName: cleanName,
      fileSize: file.size,
      contentType: file.type || 'application/pdf',
    };
  }

  /**
   * Upload Payment Receipt for a Reservation to tenant-isolated 'payment-receipts' bucket
   */
  async uploadPaymentReceipt(
    reservationId: string,
    file: File | Blob,
    originalFileName: string = 'receipt.pdf',
    landlordId?: string,
    studentId?: string
  ): Promise<SupabaseFileUploadResult> {
    this.validateFileSize(file.size, 10 * 1024 * 1024, 'Payment receipt');
    const cleanName = this.sanitizeFileName(originalFileName);
    const effectiveLandlordId = landlordId || 'landlord';
    const effectiveStudentId = studentId || 'student';
    const storagePath = `${effectiveLandlordId}/${effectiveStudentId}/${reservationId}/${cleanName}`;

    const { error } = await supabase.storage
      .from('payment-receipts')
      .upload(storagePath, file, {
        contentType: file.type || 'application/pdf',
        upsert: false,
      });

    if (error) {
      throw new Error(`Failed to upload payment receipt: ${error.message}`);
    }

    return {
      url: storagePath,
      path: storagePath,
      fileName: cleanName,
      fileSize: file.size,
      contentType: file.type || 'application/pdf',
    };
  }

  /**
   * Upload Property Image to public media bucket 'property-images'
   */
  async uploadPropertyImage(
    file: File | Blob,
    landlordId: string,
    propertyId: string
  ): Promise<SupabaseFileUploadResult> {
    this.validateFileSize(file.size, 10 * 1024 * 1024, 'Property image');
    const cleanName = this.sanitizeFileName((file as File).name || 'image.jpg');
    const storagePath = `${landlordId}/${propertyId}/${Date.now()}_${cleanName}`;

    const { error } = await supabase.storage
      .from('property-images')
      .upload(storagePath, file, {
        contentType: file.type || 'image/jpeg',
        upsert: true,
      });

    if (error) {
      throw new Error(`Failed to upload property image: ${error.message}`);
    }

    const { data: publicUrlData } = supabase.storage
      .from('property-images')
      .getPublicUrl(storagePath);

    return {
      url: publicUrlData.publicUrl,
      path: storagePath,
      fileName: cleanName,
      fileSize: file.size,
      contentType: file.type || 'image/jpeg',
    };
  }

  /**
   * Upload Profile Picture to public media bucket 'profile-pictures'
   */
  async uploadProfilePicture(
    file: File | Blob,
    userId: string
  ): Promise<SupabaseFileUploadResult> {
    this.validateFileSize(file.size, 2 * 1024 * 1024, 'Profile avatar');
    const cleanName = this.sanitizeFileName((file as File).name || 'avatar.jpg');
    const storagePath = `${userId}/${Date.now()}_${cleanName}`;

    const { error } = await supabase.storage
      .from('profile-pictures')
      .upload(storagePath, file, {
        contentType: file.type || 'image/jpeg',
        upsert: true,
      });

    if (error) {
      throw new Error(`Failed to upload avatar: ${error.message}`);
    }

    const { data: publicUrlData } = supabase.storage
      .from('profile-pictures')
      .getPublicUrl(storagePath);

    return {
      url: publicUrlData.publicUrl,
      path: storagePath,
      fileName: cleanName,
      fileSize: file.size,
      contentType: file.type || 'image/jpeg',
    };
  }

  /**
   * Upload Payment Receipt through Supabase Edge Function session
   */
  async uploadPaymentReceiptWithSession(params: {
    reservationId: string;
    file: File | Blob;
    originalFileName: string;
    amountPaid: number;
    paymentReference: string;
    payerBankName: string;
    paymentDate: string;
  }): Promise<{
    receiptId: string;
    storagePath: string;
    fileName: string;
    contentType: string;
    fileSize: number;
  }> {
    this.validateFileSize(params.file.size, 10 * 1024 * 1024, 'Payment receipt');
    const contentType = params.file.type || 'application/octet-stream';
    const cleanName = this.sanitizeFileName(params.originalFileName);

    // 1. Request upload session from Edge Function
    const { data: sessionData, error: sessionError } = await invokeEdgeFunction<{
      receiptId: string;
      storagePath: string;
      uploadUrl: string;
      token: string;
    }>('request-receipt-upload', {
      reservationId: params.reservationId,
      fileName: cleanName,
      contentType,
      fileSize: params.file.size,
    });

    if (sessionError || !sessionData?.receiptId) {
      throw new Error(`Failed to initialize receipt upload: ${sessionError?.message || 'Unknown session error'}`);
    }

    const { receiptId, storagePath } = sessionData;

    // 2. Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('payment-receipts')
      .upload(storagePath, params.file, {
        contentType,
        upsert: false,
      });

    if (uploadError) {
      throw new Error(`Failed to upload receipt file: ${uploadError.message}`);
    }

    // 3. Finalize upload session via Edge Function
    const { error: finalizeError } = await invokeEdgeFunction('finalize-receipt-upload', {
      reservationId: params.reservationId,
      receiptId,
      storagePath,
      fileName: cleanName,
      contentType,
      fileSize: params.file.size,
      amountPaid: params.amountPaid,
      paymentReference: params.paymentReference,
      payerBankName: params.payerBankName,
      paymentDate: params.paymentDate,
    });

    if (finalizeError) {
      throw new Error(`Failed to finalize receipt upload: ${finalizeError.message}`);
    }

    return {
      receiptId,
      storagePath,
      fileName: cleanName,
      contentType,
      fileSize: params.file.size,
    };
  }

  /**
   * Upload Chat Attachment through Supabase Edge Function session
   */
  async uploadChatAttachmentWithSession(params: {
    conversationId: string;
    file: File | Blob;
    originalFileName: string;
    text?: string;
  }): Promise<{
    messageId: string;
    storagePath: string;
    fileName: string;
    contentType: string;
    fileSize: number;
    createdAt?: string;
    text?: string;
  }> {
    this.validateFileSize(params.file.size, 10 * 1024 * 1024, 'Chat attachment');
    const contentType = params.file.type || 'application/octet-stream';
    const cleanName = this.sanitizeFileName(params.originalFileName);

    // 1. Request upload session from Edge Function
    const { data: sessionData, error: sessionError } = await invokeEdgeFunction<{
      messageId: string;
      storagePath: string;
      uploadUrl: string;
      token: string;
    }>('request-chat-attachment-upload', {
      conversationId: params.conversationId,
      fileName: cleanName,
      contentType,
      fileSize: params.file.size,
    });

    if (sessionError || !sessionData?.messageId) {
      throw new Error(`Failed to initialize chat attachment upload: ${sessionError?.message || 'Session failed'}`);
    }

    const { messageId, storagePath } = sessionData;

    // 2. Upload file to chat-attachments bucket
    const { error: uploadError } = await supabase.storage
      .from('chat-attachments')
      .upload(storagePath, params.file, {
        contentType,
        upsert: false,
      });

    if (uploadError) {
      throw new Error(`Failed to upload attachment file: ${uploadError.message}`);
    }

    // 3. Finalize chat attachment via Edge Function (creates the authoritative public.messages row)
    const { data: finalizeData, error: finalizeError } = await invokeEdgeFunction<{
      success: boolean;
      message?: { id?: string; created_at?: string; text?: string };
    }>('finalize-chat-attachment-upload', {
      conversationId: params.conversationId,
      messageId,
      storagePath,
      fileName: cleanName,
      contentType,
      fileSize: params.file.size,
      text: params.text,
    });

    if (finalizeError) {
      throw new Error(`Failed to finalize chat attachment: ${finalizeError.message}`);
    }

    return {
      messageId: finalizeData?.message?.id || messageId,
      storagePath,
      fileName: cleanName,
      contentType,
      fileSize: params.file.size,
      createdAt: finalizeData?.message?.created_at || new Date().toISOString(),
      text: finalizeData?.message?.text,
    };
  }

  /**
   * Request short-lived signed URL for private assets via Edge Function
   */
  async getPrivateAssetDownloadUrl(
    assetType: 'payment-receipt' | 'chat-attachment' | 'student-document' | 'landlord-document',
    recordId: string
  ): Promise<string> {
    const { data, error } = await invokeEdgeFunction<{
      downloadUrl: string;
      expiresInSeconds: number;
    }>('get-private-asset-url', {
      assetType,
      recordId,
    });

    if (error || !data?.downloadUrl) {
      throw new Error(`Could not retrieve private asset URL: ${error?.message || 'Access denied'}`);
    }

    return data.downloadUrl;
  }

  /**
   * Delete a private storage object (used to roll back orphaned uploads if DB metadata insert fails).
   */
  async deletePrivateAsset(
    bucket: 'student-docs' | 'landlord-docs' | 'payment-receipts' | 'chat-attachments',
    storagePath: string
  ): Promise<void> {
    if (!storagePath) return;
    const normalizedPath = storagePath.startsWith(`${bucket}/`)
      ? storagePath.slice(bucket.length + 1)
      : storagePath;
    const { error } = await supabase.storage.from(bucket).remove([normalizedPath]);
    if (error) {
      console.warn(`[SupabaseStorageService] Orphan cleanup failed for ${bucket}/${normalizedPath}:`, error.message);
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

export const supabaseStorageService = new SupabaseStorageService();
