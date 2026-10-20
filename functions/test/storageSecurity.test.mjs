import { test } from 'node:test';
import assert from 'node:assert';

// Simulated storage path and security policy validators matching storage.rules and storageOperations.ts

const MAX_RECEIPT_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_CHAT_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_PROPERTY_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB

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

const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
];

// Helper: validate storage.rules policy for receipt creation
function validateReceiptStorageUpload({
  authUid,
  pathLandlordId,
  pathStudentId,
  pathReservationId,
  pathReceiptId,
  metadata,
  contentType,
  fileSize,
}) {
  if (!authUid) return { allowed: false, reason: 'Unauthenticated' };
  if (authUid !== pathStudentId) return { allowed: false, reason: 'Path studentId does not match auth UID' };
  if (metadata.studentId !== pathStudentId) return { allowed: false, reason: 'Metadata studentId mismatch' };
  if (metadata.landlordId !== pathLandlordId) return { allowed: false, reason: 'Metadata landlordId mismatch' };
  if (metadata.reservationId !== pathReservationId) return { allowed: false, reason: 'Metadata reservationId mismatch' };
  if (metadata.receiptId !== pathReceiptId) return { allowed: false, reason: 'Metadata receiptId mismatch' };
  if (metadata.uploaderUid !== authUid) return { allowed: false, reason: 'Metadata uploaderUid mismatch' };
  if (!ALLOWED_RECEIPT_TYPES.includes(contentType)) return { allowed: false, reason: 'Invalid content type' };
  if (fileSize > MAX_RECEIPT_BYTES) return { allowed: false, reason: 'File size exceeds 10MB limit' };
  return { allowed: true };
}

// Helper: validate private asset access via getPrivateAssetDownloadUrl
function authorizePrivateAssetRead({
  authUid,
  isAdmin = false,
  assetType,
  record,
}) {
  if (!authUid) return { allowed: false, reason: 'Unauthenticated' };
  if (isAdmin) return { allowed: true, role: 'admin' };

  if (assetType === 'payment-receipt') {
    if (record.studentId === authUid) return { allowed: true, role: 'student' };
    if (record.landlordId === authUid) return { allowed: true, role: 'landlord' };
    return { allowed: false, reason: 'Cross-landlord or unauthorized receipt access' };
  }

  if (assetType === 'chat-attachment') {
    const participants = record.participantIds || [];
    if (participants.includes(authUid)) return { allowed: true, role: 'participant' };
    return { allowed: false, reason: 'Not an active conversation participant' };
  }

  if (assetType === 'property-image') {
    if (record.isPendingSubmission) return { allowed: false, reason: 'pending_submission path permanently disabled' };
    if (record.landlordId === authUid) return { allowed: true, role: 'landlord_owner' };
    return { allowed: false, reason: 'Cross-landlord property image write' };
  }

  return { allowed: false, reason: 'Unknown asset type' };
}

test('11.1 Payment receipts: Student A upload to own server-issued path', () => {
  const res = validateReceiptStorageUpload({
    authUid: 'student_123',
    pathLandlordId: 'landlord_456',
    pathStudentId: 'student_123',
    pathReservationId: 'res_789',
    pathReceiptId: 'rcpt_001',
    metadata: {
      studentId: 'student_123',
      landlordId: 'landlord_456',
      reservationId: 'res_789',
      receiptId: 'rcpt_001',
      uploaderUid: 'student_123',
    },
    contentType: 'image/png',
    fileSize: 1024 * 500, // 500KB
  });
  assert.strictEqual(res.allowed, true);
});

test('11.1 Payment receipts: Student A upload to Student B path is DENIED', () => {
  const res = validateReceiptStorageUpload({
    authUid: 'student_123',
    pathLandlordId: 'landlord_456',
    pathStudentId: 'student_999', // Student B
    pathReservationId: 'res_789',
    pathReceiptId: 'rcpt_001',
    metadata: {
      studentId: 'student_999',
      landlordId: 'landlord_456',
      reservationId: 'res_789',
      receiptId: 'rcpt_001',
      uploaderUid: 'student_123',
    },
    contentType: 'image/png',
    fileSize: 1024 * 500,
  });
  assert.strictEqual(res.allowed, false);
});

test('11.1 Payment receipts: Cross-landlord receipt access is DENIED', () => {
  const receiptRecord = {
    id: 'rcpt_001',
    reservationId: 'res_789',
    studentId: 'student_123',
    landlordId: 'landlord_456', // Legitimate landlord
  };

  // Landlord X (legitimate)
  const legitLandlord = authorizePrivateAssetRead({
    authUid: 'landlord_456',
    isAdmin: false,
    assetType: 'payment-receipt',
    record: receiptRecord,
  });
  assert.strictEqual(legitLandlord.allowed, true);

  // Landlord Y (unrelated landlord)
  const rogueLandlord = authorizePrivateAssetRead({
    authUid: 'landlord_999',
    isAdmin: false,
    assetType: 'payment-receipt',
    record: receiptRecord,
  });
  assert.strictEqual(rogueLandlord.allowed, false);
  assert.strictEqual(rogueLandlord.reason, 'Cross-landlord or unauthorized receipt access');

  // Student B (unrelated student)
  const unrelatedStudent = authorizePrivateAssetRead({
    authUid: 'student_999',
    isAdmin: false,
    assetType: 'payment-receipt',
    record: receiptRecord,
  });
  assert.strictEqual(unrelatedStudent.allowed, false);

  // Administrator
  const admin = authorizePrivateAssetRead({
    authUid: 'admin_1',
    isAdmin: true,
    assetType: 'payment-receipt',
    record: receiptRecord,
  });
  assert.strictEqual(admin.allowed, true);
});

test('11.1 Payment receipts: File size and MIME type limits enforced', () => {
  // Over 10MB
  const oversize = validateReceiptStorageUpload({
    authUid: 'student_123',
    pathLandlordId: 'landlord_456',
    pathStudentId: 'student_123',
    pathReservationId: 'res_789',
    pathReceiptId: 'rcpt_001',
    metadata: {
      studentId: 'student_123',
      landlordId: 'landlord_456',
      reservationId: 'res_789',
      receiptId: 'rcpt_001',
      uploaderUid: 'student_123',
    },
    contentType: 'image/png',
    fileSize: 12 * 1024 * 1024, // 12 MB
  });
  assert.strictEqual(oversize.allowed, false);

  // Disallowed MIME type
  const badType = validateReceiptStorageUpload({
    authUid: 'student_123',
    pathLandlordId: 'landlord_456',
    pathStudentId: 'student_123',
    pathReservationId: 'res_789',
    pathReceiptId: 'rcpt_001',
    metadata: {
      studentId: 'student_123',
      landlordId: 'landlord_456',
      reservationId: 'res_789',
      receiptId: 'rcpt_001',
      uploaderUid: 'student_123',
    },
    contentType: 'application/x-sh',
    fileSize: 1024,
  });
  assert.strictEqual(badType.allowed, false);
});

test('11.2 Chat attachments: Conversation participant verification', () => {
  const conversation = {
    id: 'conv_101',
    participantIds: ['user_alpha', 'user_beta'],
  };

  // Participant A
  const memberA = authorizePrivateAssetRead({
    authUid: 'user_alpha',
    isAdmin: false,
    assetType: 'chat-attachment',
    record: conversation,
  });
  assert.strictEqual(memberA.allowed, true);

  // Participant B
  const memberB = authorizePrivateAssetRead({
    authUid: 'user_beta',
    isAdmin: false,
    assetType: 'chat-attachment',
    record: conversation,
  });
  assert.strictEqual(memberB.allowed, true);

  // Unrelated authenticated user C
  const outsider = authorizePrivateAssetRead({
    authUid: 'user_gamma',
    isAdmin: false,
    assetType: 'chat-attachment',
    record: conversation,
  });
  assert.strictEqual(outsider.allowed, false);
  assert.strictEqual(outsider.reason, 'Not an active conversation participant');
});

test('11.3 Property images: pending_submission path is permanently blocked and cross-landlord write is denied', () => {
  // pending_submission attempt
  const pendingAttempt = authorizePrivateAssetRead({
    authUid: 'landlord_alpha',
    isAdmin: false,
    assetType: 'property-image',
    record: { landlordId: 'landlord_alpha', isPendingSubmission: true },
  });
  assert.strictEqual(pendingAttempt.allowed, false);

  // Landlord B modifying Landlord A image
  const crossLandlord = authorizePrivateAssetRead({
    authUid: 'landlord_beta',
    isAdmin: false,
    assetType: 'property-image',
    record: { landlordId: 'landlord_alpha', isPendingSubmission: false },
  });
  assert.strictEqual(crossLandlord.allowed, false);
  assert.strictEqual(crossLandlord.reason, 'Cross-landlord property image write');

  // Landlord A modifying Landlord A image
  const legitimate = authorizePrivateAssetRead({
    authUid: 'landlord_alpha',
    isAdmin: false,
    assetType: 'property-image',
    record: { landlordId: 'landlord_alpha', isPendingSubmission: false },
  });
  assert.strictEqual(legitimate.allowed, true);
});
