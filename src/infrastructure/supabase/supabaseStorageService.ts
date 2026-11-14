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

import { supabase, invokeEdgeFunction, isEdgeFunctionUnavailableError } from './supabaseClient';

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

  private validateUploadPayload(
    file: File | Blob,
    maxBytes: number,
    allowedMimeTypes: string[],
    label: string,
    defaultMime: string
  ): string {
    if (!file || typeof file.size !== 'number' || file.size <= 0) {
      throw new Error(`${label} is empty (0 bytes). Please select a valid file.`);
    }
    if (file.size > maxBytes) {
      const maxMb = Math.round(maxBytes / (1024 * 1024));
      throw new Error(`${label} exceeds maximum allowed size of ${maxMb}MB.`);
    }
    const rawType = (file.type || defaultMime).toLowerCase();
    const normalizedType = rawType === 'image/jpg' ? 'image/jpeg' : rawType;
    if (!allowedMimeTypes.includes(normalizedType)) {
      throw new Error(`${label} has unsupported file type (${file.type || 'unknown'}).`);
    }
    return normalizedType;
  }

  private assertValidOwnerId(id: string | undefined, label: string): string {
    const clean = (id || '').trim();
    if (!clean || clean === 'anonymous' || clean === 'landlord' || clean === 'student') {
      throw new Error(`Authenticated ${label} ID is required before uploading files.`);
    }
    return clean;
  }

  /**
   * Upload Student Verification Document to private bucket 'student-docs' (max 5 MB).
   */
  async uploadStudentDocument(
    arg1: File | Blob | string,
    arg2: string | File | Blob,
    arg3: string = 'document.pdf',
    _arg4?: string
  ): Promise<SupabaseFileUploadResult> {
    const file = (typeof arg1 === 'string' ? arg2 : arg1) as File | Blob;
    const rawStudentId = (typeof arg1 === 'string' ? arg1 : arg2) as string;
    const studentId = this.assertValidOwnerId(rawStudentId, 'student');
    const originalName = typeof arg1 === 'string' && typeof arg3 === 'string' ? arg3 : (file as File).name || 'document.pdf';
    const contentType = this.validateUploadPayload(
      file,
      5 * 1024 * 1024,
      ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
      'Student document',
      'application/pdf'
    );
    const cleanName = this.sanitizeFileName(originalName);
    const docId = crypto.randomUUID();
    const storagePath = `${studentId}/${docId}/${cleanName}`;

    const { error } = await supabase.storage
      .from('student-docs')
      .upload(storagePath, file, {
        contentType,
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
      contentType,
    };
  }

  /**
   * Upload Landlord Verification Submission to private bucket 'landlord-docs' (max 10 MB).
   */
  async uploadLandlordDocument(
    arg1: File | Blob | string,
    arg2: string | File | Blob,
    arg3: string = 'document.pdf',
    _arg4?: string
  ): Promise<SupabaseFileUploadResult> {
    const file = (typeof arg1 === 'string' ? arg2 : arg1) as File | Blob;
    const rawLandlordId = (typeof arg1 === 'string' ? arg1 : arg2) as string;
    const landlordId = this.assertValidOwnerId(rawLandlordId, 'landlord');
    const originalName = typeof arg1 === 'string' && typeof arg3 === 'string' ? arg3 : (file as File).name || 'document.pdf';
    const contentType = this.validateUploadPayload(
      file,
      10 * 1024 * 1024,
      ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
      'Landlord document',
      'application/pdf'
    );
    const cleanName = this.sanitizeFileName(originalName);
    const docId = crypto.randomUUID();
    const storagePath = `${landlordId}/${docId}/${cleanName}`;

    const { error } = await supabase.storage
      .from('landlord-docs')
      .upload(storagePath, file, {
        contentType,
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
      contentType,
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
    const contentType = this.validateUploadPayload(
      file,
      10 * 1024 * 1024,
      ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
      'Payment receipt',
      'application/pdf'
    );
    const effectiveLandlordId = this.assertValidOwnerId(landlordId, 'landlord');
    const effectiveStudentId = this.assertValidOwnerId(studentId, 'student');
    const cleanName = this.sanitizeFileName(originalFileName);
    const storagePath = `${effectiveLandlordId}/${effectiveStudentId}/${reservationId}/${cleanName}`;

    const { error } = await supabase.storage
      .from('payment-receipts')
      .upload(storagePath, file, {
        contentType,
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
      contentType,
    };
  }

  /**
   * Upload Property Image to public media bucket 'property-images' (max 10 MB, JPEG/PNG/WebP).
   */
  async uploadPropertyImage(
    file: File | Blob,
    landlordId: string,
    propertyId: string
  ): Promise<SupabaseFileUploadResult> {
    const safeLandlordId = this.assertValidOwnerId(landlordId, 'landlord');
    const contentType = this.validateUploadPayload(
      file,
      10 * 1024 * 1024,
      ['image/jpeg', 'image/png', 'image/webp'],
      'Property image',
      'image/jpeg'
    );
    const cleanName = this.sanitizeFileName((file as File).name || 'image.jpg');
    const safePropId = (propertyId || '').trim() || crypto.randomUUID();
    const storagePath = `${safeLandlordId}/${safePropId}/${Date.now()}_${cleanName}`;

    const { error } = await supabase.storage
      .from('property-images')
      .upload(storagePath, file, {
        contentType,
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
      contentType,
    };
  }

  /**
   * Upload Profile Picture to public media bucket 'profile-pictures' (max 2 MB, JPEG/PNG/WebP).
   */
  async uploadProfilePicture(
    file: File | Blob,
    userId: string
  ): Promise<SupabaseFileUploadResult> {
    const safeUserId = this.assertValidOwnerId(userId, 'user');
    const contentType = this.validateUploadPayload(
      file,
      2 * 1024 * 1024,
      ['image/jpeg', 'image/png', 'image/webp'],
      'Profile avatar',
      'image/jpeg'
    );
    const cleanName = this.sanitizeFileName((file as File).name || 'avatar.jpg');
    const storagePath = `${safeUserId}/${Date.now()}_${cleanName}`;

    const { error } = await supabase.storage
      .from('profile-pictures')
      .upload(storagePath, file, {
        contentType,
        upsert: false,
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
      contentType,
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
    const contentType = this.validateUploadPayload(
      params.file,
      10 * 1024 * 1024,
      ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
      'Payment receipt',
      'application/pdf'
    );
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

    if (sessionError && isEdgeFunctionUnavailableError(sessionError)) {
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      const studentId = authData?.user?.id;
      if (authErr || !studentId) {
        throw new Error('Please sign in as the reservation student before uploading a receipt.');
      }

      const { data: reservation, error: resErr } = await supabase
        .from('reservations')
        .select('id, student_id, landlord_id, property_id, status, amount')
        .eq('id', params.reservationId)
        .single();

      if (resErr || !reservation) {
        throw new Error('Reservation record could not be verified for receipt upload.');
      }

      const { data: invoiceRow } = await supabase
        .from('invoices')
        .select('id')
        .eq('reservation_id', params.reservationId)
        .maybeSingle();

      const receiptId = crypto.randomUUID();
      const storagePath = `${reservation.landlord_id}/${studentId}/${params.reservationId}/${receiptId}/${cleanName}`;

      const { error: uploadError } = await supabase.storage
        .from('payment-receipts')
        .upload(storagePath, params.file, {
          contentType,
          upsert: false,
        });

      if (uploadError) {
        throw new Error(`Failed to upload receipt file: ${uploadError.message}`);
      }

      const { error: insertError } = await supabase.from('payment_receipts').insert({
        id: receiptId,
        reservation_id: params.reservationId,
        invoice_id: invoiceRow?.id ?? null,
        student_id: studentId,
        landlord_id: reservation.landlord_id,
        property_id: reservation.property_id,
        storage_path: storagePath,
        file_name: cleanName,
        content_type: contentType,
        file_size: params.file.size,
        amount_paid: params.amountPaid,
        payment_reference: params.paymentReference || 'DIRECT_TRANSFER',
        payer_bank_name: params.payerBankName || 'Bank',
        payment_date: params.paymentDate || new Date().toISOString(),
        status: 'pending_review',
      });

      if (insertError) {
        await this.deletePrivateAsset('payment-receipts', storagePath);
        throw new Error(`Failed to record payment receipt metadata: ${insertError.message}`);
      }

      return {
        receiptId,
        storagePath,
        fileName: cleanName,
        contentType,
        fileSize: params.file.size,
      };
    }

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
      await this.deletePrivateAsset('payment-receipts', storagePath);
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
    const contentType = this.validateUploadPayload(
      params.file,
      10 * 1024 * 1024,
      ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain'],
      'Chat attachment',
      'application/pdf'
    );
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

    if (!error && data?.downloadUrl) {
      return data.downloadUrl;
    }

    if (error && isEdgeFunctionUnavailableError(error)) {
      const cleanId = (recordId || '').trim();
      let bucketName: 'payment-receipts' | 'chat-attachments' | 'student-docs' | 'landlord-docs' | '' = '';
      let rawPath = '';

      if (assetType === 'payment-receipt') {
        const { data: row } = await supabase
          .from('payment_receipts')
          .select('storage_path')
          .eq('id', cleanId)
          .maybeSingle();
        bucketName = 'payment-receipts';
        rawPath = row?.storage_path || '';
      } else if (assetType === 'chat-attachment') {
        const { data: row } = await supabase
          .from('messages')
          .select('attachment')
          .eq('id', cleanId)
          .maybeSingle();
        bucketName = 'chat-attachments';
        rawPath = (row as any)?.attachment?.storage_path || '';
      } else if (assetType === 'student-document') {
        let { data: row } = await supabase
          .from('student_verification_documents')
          .select('storage_path')
          .eq('id', cleanId)
          .maybeSingle();
        if (!row) {
          const fallback = await supabase
            .from('student_verification_documents')
            .select('storage_path')
            .eq('student_id', cleanId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          row = fallback.data;
        }
        bucketName = 'student-docs';
        rawPath = row?.storage_path || '';
      } else if (assetType === 'landlord-document') {
        let { data: row } = await supabase
          .from('landlord_verification_submissions')
          .select('storage_path')
          .eq('id', cleanId)
          .maybeSingle();
        if (!row) {
          const fallback = await supabase
            .from('landlord_verification_submissions')
            .select('storage_path')
            .eq('landlord_id', cleanId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          row = fallback.data;
        }
        bucketName = 'landlord-docs';
        rawPath = row?.storage_path || '';
      }

      if (bucketName && rawPath) {
        const normalizedPath = rawPath.startsWith(`${bucketName}/`)
          ? rawPath.slice(bucketName.length + 1)
          : rawPath;
        const { data: signedData, error: signErr } = await supabase.storage
          .from(bucketName)
          .createSignedUrl(normalizedPath, 900);
        if (!signErr && signedData?.signedUrl) {
          return signedData.signedUrl;
        }
      }
    }

    throw new Error(`Could not retrieve private asset URL: ${error?.message || 'Access denied'}`);
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
   * Delete a public media asset (property photo or avatar) by storage path or public URL.
   */
  async deletePublicMediaAsset(
    bucket: 'property-images' | 'profile-pictures',
    pathOrUrl: string
  ): Promise<void> {
    if (!pathOrUrl || pathOrUrl.startsWith('data:') || pathOrUrl.startsWith('blob:')) return;
    let storagePath = pathOrUrl;
    const marker = `/storage/v1/object/public/${bucket}/`;
    const markerIdx = pathOrUrl.indexOf(marker);
    if (markerIdx >= 0) {
      storagePath = decodeURIComponent(pathOrUrl.slice(markerIdx + marker.length).split('?')[0]);
    } else if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
      return;
    } else if (pathOrUrl.startsWith(`${bucket}/`)) {
      storagePath = pathOrUrl.slice(bucket.length + 1);
    }
    if (!storagePath) return;
    const { error } = await supabase.storage.from(bucket).remove([storagePath]);
    if (error) {
      console.warn(`[SupabaseStorageService] Public asset cleanup failed for ${bucket}/${storagePath}:`, error.message);
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
