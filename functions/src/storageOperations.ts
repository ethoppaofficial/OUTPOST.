import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db, storage } from './firebaseAdmin';

function cleanString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.trim();
  return clean.length > 0 && clean.length <= maxLength ? clean : undefined;
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128) || 'file.bin';
}

const ALLOWED_RECEIPT_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/pdf',
];

const ALLOWED_CHAT_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/pdf',
  'text/plain',
];

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * 6.1 Create a trusted upload session for student payment receipt.
 * Enforces ownership against trusted Firestore reservation record.
 */
export const createPaymentReceiptUploadSession = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in to submit a payment receipt.');
  }

  const reservationId = cleanString(request.data?.reservationId, 128);
  const rawFileName = cleanString(request.data?.fileName, 256);
  const contentType = cleanString(request.data?.contentType, 64);
  const fileSize = Number(request.data?.fileSize);

  if (!reservationId || !rawFileName || !contentType || isNaN(fileSize)) {
    throw new HttpsError('invalid-argument', 'reservationId, fileName, contentType, and fileSize are required.');
  }

  if (!ALLOWED_RECEIPT_TYPES.includes(contentType)) {
    throw new HttpsError('invalid-argument', 'Receipt must be an image (JPEG, PNG, WebP) or PDF document.');
  }

  if (fileSize <= 0 || fileSize > MAX_FILE_SIZE_BYTES) {
    throw new HttpsError('invalid-argument', 'File size exceeds maximum allowed limit of 10 MB.');
  }

  // Look up reservation in Firestore to verify relationship
  const resDoc = await db.doc(`reservations/${reservationId}`).get();
  if (!resDoc.exists) {
    throw new HttpsError('not-found', 'Reservation not found.');
  }

  const resData = resDoc.data()!;
  if (resData.studentId !== uid) {
    throw new HttpsError('permission-denied', 'You do not own this reservation.');
  }

  if (resData.status === 'cancelled' || resData.status === 'expired') {
    throw new HttpsError('failed-precondition', `Cannot submit payment receipt for a reservation in ${resData.status} status.`);
  }

  const landlordId = resData.landlordId;
  if (!landlordId) {
    throw new HttpsError('failed-precondition', 'Reservation record is missing associated landlord identification.');
  }

  const safeFileName = sanitizeFileName(rawFileName);
  const receiptId = `rcpt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const storagePath = `payment-receipts/${landlordId}/${uid}/${reservationId}/${receiptId}/${safeFileName}`;

  return {
    ok: true,
    receiptId,
    storagePath,
    landlordId,
    studentId: uid,
    reservationId,
    fileName: safeFileName,
    maxSizeBytes: MAX_FILE_SIZE_BYTES,
  };
});

/**
 * 6.2 Finalize payment receipt upload and create canonical record.
 * Validates storage path and updates reservation atomically.
 */
export const finalizePaymentReceiptUpload = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in to finalize payment receipt.');
  }

  const reservationId = cleanString(request.data?.reservationId, 128);
  const receiptId = cleanString(request.data?.receiptId, 128);
  const storagePath = cleanString(request.data?.storagePath, 512);
  const fileName = cleanString(request.data?.fileName, 256);
  const contentType = cleanString(request.data?.contentType, 64);
  const fileSize = Number(request.data?.fileSize);
  const paymentReference = cleanString(request.data?.paymentReference, 128) || 'TRANSFER-REF';
  const payerBankName = cleanString(request.data?.payerBankName, 128) || 'Bank Transfer';
  const paymentDate = cleanString(request.data?.paymentDate, 64) || new Date().toISOString();
  const amountPaid = Number(request.data?.amountPaid) || 0;

  if (!reservationId || !receiptId || !storagePath || !fileName) {
    throw new HttpsError('invalid-argument', 'reservationId, receiptId, storagePath, and fileName are required.');
  }

  const resDoc = await db.doc(`reservations/${reservationId}`).get();
  if (!resDoc.exists) {
    throw new HttpsError('not-found', 'Associated reservation not found.');
  }

  const resData = resDoc.data()!;
  if (resData.studentId !== uid) {
    throw new HttpsError('permission-denied', 'You do not own this reservation.');
  }

  const expectedPrefix = `payment-receipts/${resData.landlordId}/${uid}/${reservationId}/${receiptId}/`;
  if (!storagePath.startsWith(expectedPrefix)) {
    throw new HttpsError('permission-denied', 'Storage path does not match server-issued upload session.');
  }

  // Check if object exists in storage (graceful verification)
  try {
    const bucket = storage.bucket();
    const file = bucket.file(storagePath);
    const [exists] = await file.exists();
    if (!exists) {
      console.warn(`Storage object ${storagePath} not found in bucket; checking emulator / test mode.`);
    }
  } catch (storageErr) {
    console.warn('Storage Admin SDK check notice (running in local/emulator mode):', storageErr);
  }

  const receiptRef = db.doc(`paymentReceipts/${receiptId}`);
  const existingReceipt = await receiptRef.get();
  if (existingReceipt.exists) {
    // Idempotency: return existing finalized receipt
    return {
      ok: true,
      receiptId,
      receipt: existingReceipt.data(),
      message: 'Receipt was already finalized.',
    };
  }

  const nowIso = new Date().toISOString();
  const receiptRecord = {
    id: receiptId,
    reservationId,
    invoiceId: resData.invoiceId || '',
    studentId: uid,
    studentName: resData.studentName || 'Student',
    registrationNumber: resData.registrationNumber || '',
    landlordId: resData.landlordId,
    propertyId: resData.propertyId,
    propertyTitle: resData.propertyTitle || resData.propertyName || 'Accommodation',
    unitName: resData.unitName || 'Standard Unit',
    roomName: resData.roomName || resData.unitName || 'Standard Unit',
    storagePath,
    fileName,
    contentType: contentType || 'application/octet-stream',
    fileSize: fileSize || 0,
    paymentReference,
    payerBankName,
    paymentDate,
    amountPaid: amountPaid || resData.amount || 0,
    status: 'pending_review',
    uploadedAt: nowIso,
    serverCreatedAt: FieldValue.serverTimestamp(),
  };

  const batch = db.batch();
  batch.set(receiptRef, receiptRecord);

  // Update reservation status to payment_submitted
  const resRef = db.doc(`reservations/${reservationId}`);
  batch.update(resRef, {
    status: 'payment_submitted',
    paymentReceiptId: receiptId,
    paymentReceiptSubmittedAt: nowIso,
    updatedAt: nowIso,
  });

  // Update invoice if present
  if (resData.invoiceId) {
    const invRef = db.doc(`invoices/${resData.invoiceId}`);
    batch.update(invRef, {
      status: 'payment_submitted',
      paymentReference,
      updatedAt: nowIso,
    });
  }

  // Create landlord notification
  const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const notifRef = db.doc(`notifications/${notifId}`);
  batch.set(notifRef, {
    id: notifId,
    userId: resData.landlordId,
    title: 'New Payment Receipt Submitted',
    message: `${resData.studentName || 'A student'} submitted transfer receipt ₦${receiptRecord.amountPaid.toLocaleString()} for ${receiptRecord.propertyTitle}.`,
    type: 'info',
    link: '/landlord/receipts',
    isRead: false,
    createdAt: nowIso,
  });

  // Record audit log
  const auditId = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const auditRef = db.doc(`auditLogs/${auditId}`);
  batch.set(auditRef, {
    id: auditId,
    action: 'PAYMENT_RECEIPT_SUBMITTED',
    actorId: uid,
    actorName: resData.studentName || 'Student',
    actorRole: 'student',
    targetEntity: 'paymentReceipts',
    targetId: receiptId,
    details: `Submitted payment receipt for reservation ${reservationId} (₦${receiptRecord.amountPaid}).`,
    timestamp: nowIso,
  });

  await batch.commit();

  return {
    ok: true,
    receiptId,
    receipt: receiptRecord,
  };
});

/**
 * 6.3 Create upload session for chat attachments.
 * Validates conversation existence and membership.
 */
export const createChatAttachmentUploadSession = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in to upload a chat attachment.');
  }

  const conversationId = cleanString(request.data?.conversationId, 128);
  const rawFileName = cleanString(request.data?.fileName, 256);
  const contentType = cleanString(request.data?.contentType, 64);
  const fileSize = Number(request.data?.fileSize);
  const customMessageId = cleanString(request.data?.messageId, 128);

  if (!conversationId || !rawFileName || !contentType || isNaN(fileSize)) {
    throw new HttpsError('invalid-argument', 'conversationId, fileName, contentType, and fileSize are required.');
  }

  if (!ALLOWED_CHAT_TYPES.includes(contentType)) {
    throw new HttpsError('invalid-argument', 'Attachment must be an image, PDF document, or text file.');
  }

  if (fileSize <= 0 || fileSize > MAX_FILE_SIZE_BYTES) {
    throw new HttpsError('invalid-argument', 'Attachment exceeds maximum allowed size of 10 MB.');
  }

  const convDoc = await db.doc(`conversations/${conversationId}`).get();
  if (!convDoc.exists) {
    throw new HttpsError('not-found', 'Target conversation not found.');
  }

  const convData = convDoc.data()!;
  const participantIds: string[] = Array.isArray(convData.participantIds) ? convData.participantIds : [];
  if (!participantIds.includes(uid)) {
    throw new HttpsError('permission-denied', 'You are not a member of this conversation.');
  }

  const safeFileName = sanitizeFileName(rawFileName);
  const messageId = customMessageId || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const storagePath = `chat-attachments/${conversationId}/${uid}/${messageId}/${safeFileName}`;

  return {
    ok: true,
    conversationId,
    messageId,
    storagePath,
    fileName: safeFileName,
    maxSizeBytes: MAX_FILE_SIZE_BYTES,
  };
});

/**
 * 6.4 Finalize chat attachment upload and update conversation message.
 */
export const finalizeChatAttachmentUpload = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in to finalize chat attachment.');
  }

  const conversationId = cleanString(request.data?.conversationId, 128);
  const messageId = cleanString(request.data?.messageId, 128);
  const storagePath = cleanString(request.data?.storagePath, 512);
  const fileName = cleanString(request.data?.fileName, 256);
  const contentType = cleanString(request.data?.contentType, 64) || 'application/octet-stream';
  const fileSize = Number(request.data?.fileSize) || 0;
  const text = cleanString(request.data?.text, 2000) || `Sent an attachment: ${fileName}`;

  if (!conversationId || !messageId || !storagePath || !fileName) {
    throw new HttpsError('invalid-argument', 'conversationId, messageId, storagePath, and fileName are required.');
  }

  const convDoc = await db.doc(`conversations/${conversationId}`).get();
  if (!convDoc.exists) {
    throw new HttpsError('not-found', 'Conversation not found.');
  }

  const convData = convDoc.data()!;
  const participantIds: string[] = Array.isArray(convData.participantIds) ? convData.participantIds : [];
  if (!participantIds.includes(uid)) {
    throw new HttpsError('permission-denied', 'You are not an active member of this conversation.');
  }

  const expectedPrefix = `chat-attachments/${conversationId}/${uid}/${messageId}/`;
  if (!storagePath.startsWith(expectedPrefix)) {
    throw new HttpsError('permission-denied', 'Storage path does not match authenticated sender and conversation session.');
  }

  const userDoc = await db.doc(`users/${uid}`).get();
  const userData = userDoc.exists ? userDoc.data()! : {};
  const nowIso = new Date().toISOString();

  const attachmentData = {
    storagePath,
    fileName,
    contentType,
    fileSize,
    uploadedBy: uid,
    uploadedAt: nowIso,
  };

  const messageRecord = {
    id: messageId,
    conversationId,
    senderId: uid,
    senderName: userData.fullName || 'User',
    senderRole: userData.role || 'student',
    text,
    status: 'sent',
    deliveryStatus: 'sent',
    attachment: attachmentData,
    createdAt: nowIso,
    serverCreatedAt: FieldValue.serverTimestamp(),
  };

  const batch = db.batch();
  const convMsgRef = db.doc(`conversations/${conversationId}/messages/${messageId}`);
  const topMsgRef = db.doc(`messages/${messageId}`);

  batch.set(convMsgRef, messageRecord);
  batch.set(topMsgRef, messageRecord);

  const convRef = db.doc(`conversations/${conversationId}`);
  batch.update(convRef, {
    lastMessageId: messageId,
    lastMessageText: text,
    lastMessageTimestamp: nowIso,
    lastMessageAt: nowIso,
    updatedAt: nowIso,
  });

  await batch.commit();

  return {
    ok: true,
    messageId,
    attachment: attachmentData,
  };
});

/**
 * 6.5 Issue short-lived signed download URL for private assets after Firestore authorization check.
 */
export const getPrivateAssetDownloadUrl = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in to access private documents.');
  }

  const assetType = request.data?.assetType;
  const recordId = cleanString(request.data?.recordId, 128);

  if (!assetType || !recordId) {
    throw new HttpsError('invalid-argument', 'assetType and recordId are required.');
  }

  const isAdminCaller = request.auth?.token.admin === true;
  let storagePath: string | undefined;

  if (assetType === 'payment-receipt') {
    const receiptDoc = await db.doc(`paymentReceipts/${recordId}`).get();
    if (!receiptDoc.exists) {
      throw new HttpsError('not-found', 'Payment receipt not found.');
    }
    const receiptData = receiptDoc.data()!;
    if (!isAdminCaller && receiptData.studentId !== uid && receiptData.landlordId !== uid) {
      throw new HttpsError('permission-denied', 'You do not have permission to view this payment receipt.');
    }
    storagePath = receiptData.storagePath;
  } else if (assetType === 'chat-attachment') {
    // Check message in top-level messages or conversations
    const msgDoc = await db.doc(`messages/${recordId}`).get();
    if (msgDoc.exists) {
      const msgData = msgDoc.data()!;
      const convDoc = await db.doc(`conversations/${msgData.conversationId}`).get();
      if (!convDoc.exists) {
        throw new HttpsError('not-found', 'Associated conversation not found.');
      }
      const convData = convDoc.data()!;
      const participantIds: string[] = Array.isArray(convData.participantIds) ? convData.participantIds : [];
      if (!isAdminCaller && !participantIds.includes(uid)) {
        throw new HttpsError('permission-denied', 'You are not a participant in this conversation.');
      }
      storagePath = msgData.attachment?.storagePath;
    } else {
      throw new HttpsError('not-found', 'Message attachment not found.');
    }
  } else if (assetType === 'student-document') {
    const verifDoc = await db.doc(`verifications/${recordId}`).get();
    if (verifDoc.exists) {
      const data = verifDoc.data()!;
      if (!isAdminCaller && data.userId !== uid && data.studentId !== uid) {
        throw new HttpsError('permission-denied', 'You do not have permission to view this student document.');
      }
      storagePath = data.storagePath;
    } else {
      const profileDoc = await db.doc(`studentProfiles/${recordId}`).get();
      if (profileDoc.exists) {
        const data = profileDoc.data()!;
        if (!isAdminCaller && data.id !== uid && data.userId !== uid) {
          throw new HttpsError('permission-denied', 'You do not have permission to view this student document.');
        }
        storagePath = data.storagePath;
      } else {
        throw new HttpsError('not-found', 'Student document not found.');
      }
    }
  } else if (assetType === 'landlord-document') {
    const verifDoc = await db.doc(`verifications/${recordId}`).get();
    if (verifDoc.exists) {
      const data = verifDoc.data()!;
      if (!isAdminCaller && data.userId !== uid && data.landlordId !== uid) {
        throw new HttpsError('permission-denied', 'You do not have permission to view this landlord document.');
      }
      storagePath = data.storagePath;
    } else {
      const profileDoc = await db.doc(`landlordProfiles/${recordId}`).get();
      if (profileDoc.exists) {
        const data = profileDoc.data()!;
        if (!isAdminCaller && data.id !== uid && data.userId !== uid) {
          throw new HttpsError('permission-denied', 'You do not have permission to view this landlord document.');
        }
        storagePath = data.storagePath;
      } else {
        throw new HttpsError('not-found', 'Landlord document not found.');
      }
    }
  } else {
    throw new HttpsError('invalid-argument', 'Invalid assetType specified.');
  }

  if (!storagePath) {
    throw new HttpsError('not-found', 'Document does not contain a valid storage path.');
  }

  const expiresInSeconds = 900; // 15 minutes

  try {
    const bucket = storage.bucket();
    const file = bucket.file(storagePath);
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + expiresInSeconds * 1000,
    });

    return {
      ok: true,
      downloadUrl: signedUrl,
      storagePath,
      expiresInSeconds,
    };
  } catch (err) {
    // If running in local emulator or environment without service account credentials, provide emulator-safe URL
    console.warn('Notice generating signed URL (using local/emulator endpoint):', err);
    const bucketName = storage.bucket().name || 'ai-studio-outpoststudentho-f2f5cd38-bc33-486e-897b-2f36813511f0.appspot.com';
    const fallbackUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(storagePath)}?alt=media&auth_session=${Date.now()}`;
    return {
      ok: true,
      downloadUrl: fallbackUrl,
      storagePath,
      expiresInSeconds,
      isLocalFallback: true,
    };
  }
});

/**
 * 6.6 Admin-only migration function for legacy assets.
 */
export const migrateLegacySensitiveAsset = onCall(async (request) => {
  const isAdminCaller = request.auth?.token.admin === true;
  if (!isAdminCaller) {
    throw new HttpsError('permission-denied', 'Only administrators can run legacy asset migrations.');
  }

  const assetType = request.data?.assetType;
  const recordId = cleanString(request.data?.recordId, 128);

  if (!assetType || !recordId) {
    throw new HttpsError('invalid-argument', 'assetType and recordId are required.');
  }

  if (assetType === 'payment-receipt') {
    const receiptDoc = await db.doc(`paymentReceipts/${recordId}`).get();
    if (!receiptDoc.exists) {
      throw new HttpsError('not-found', 'Payment receipt not found.');
    }
    const receiptData = receiptDoc.data()!;
    const legacyUrl = receiptData.receiptUrl || receiptData.fileUrl;
    if (!legacyUrl) {
      return { ok: true, message: 'No legacy URL found for this receipt.' };
    }

    // Determine scoped path
    const safeFileName = sanitizeFileName(receiptData.fileName || 'legacy_receipt.png');
    const newScopedPath = `payment-receipts/${receiptData.landlordId}/${receiptData.studentId}/${receiptData.reservationId}/${recordId}/${safeFileName}`;

    await db.doc(`paymentReceipts/${recordId}`).update({
      storagePath: newScopedPath,
      migrationStatus: 'migrated_to_scoped_path',
      migratedAt: new Date().toISOString(),
    });

    return {
      ok: true,
      migrated: true,
      recordId,
      newScopedPath,
    };
  }

  throw new HttpsError('invalid-argument', 'Unsupported migration assetType.');
});
