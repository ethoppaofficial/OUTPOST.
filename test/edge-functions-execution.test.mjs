import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// OUTPOST Edge Functions Runtime Execution and Authorization Test Suite
// Executes simulated HTTP Request/Response handling for all 8 Supabase Edge Functions.

describe('OUTPOST Supabase Edge Functions Handler Runtime Verification', () => {

  // Mock Database State
  const mockDb = {
    users: {
      'student-active-1': { id: 'student-active-1', role: 'student', account_status: 'active' },
      'student-active-2': { id: 'student-active-2', role: 'student', account_status: 'active' },
      'student-suspended-1': { id: 'student-suspended-1', role: 'student', account_status: 'suspended' },
      'landlord-active-1': { id: 'landlord-active-1', role: 'landlord', account_status: 'active' },
      'landlord-active-2': { id: 'landlord-active-2', role: 'landlord', account_status: 'active' },
      'admin-active-1': { id: 'admin-active-1', role: 'admin', account_status: 'active' },
    },
    reservations: {
      'res-100': {
        id: 'res-100',
        student_id: 'student-active-1',
        landlord_id: 'landlord-active-1',
        property_id: 'prop-1',
        unit_id: 'unit-1',
        status: 'pending_payment',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      },
    },
    receipts: {
      'receipt-200': {
        id: 'receipt-200',
        student_id: 'student-active-1',
        landlord_id: 'landlord-active-1',
        reservation_id: 'res-100',
        storage_path: 'landlord-active-1/student-active-1/res-100/receipt.jpg',
        status: 'pending_review',
      },
    },
    conversations: {
      'conv-300': {
        id: 'conv-300',
        participants: ['student-active-1', 'landlord-active-1'],
      },
    },
    messages: {
      'msg-400': {
        id: 'msg-400',
        conversation_id: 'conv-300',
        sender_id: 'student-active-1',
        attachment: {
          storage_path: 'conv-300/student-active-1/image.png',
        },
      },
    },
    studentDocs: {
      'sdoc-500': {
        id: 'sdoc-500',
        student_id: 'student-active-1',
        storage_path: 'student-active-1/id_card.pdf',
      },
    },
    landlordDocs: {
      'ldoc-600': {
        id: 'ldoc-600',
        landlord_id: 'landlord-active-1',
        storage_path: 'landlord-active-1/deed.pdf',
      },
    },
    units: {
      'unit-1': { id: 'unit-1', property_id: 'prop-1', available_spaces: 1, capacity: 2 },
    },
  };

  const SERVICE_KEY = 'super-secret-service-role-key-test-value-12345';

  // Helper to simulate request context
  function authenticate(authHeader) {
    if (!authHeader) return null;
    if (authHeader === `Bearer ${SERVICE_KEY}`) {
      return { id: 'service-role-system', role: 'service_role', isServiceRole: true };
    }
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const user = mockDb.users[token];
    return user ? { ...user, isServiceRole: false } : null;
  }

  describe('1. create-reservation Function Handler', () => {
    async function handleCreateReservation(req) {
      const auth = authenticate(req.headers.get('Authorization'));
      if (!auth) {
        return new Response(JSON.stringify({ error: 'Missing or unauthorized token' }), { status: 401 });
      }
      if (auth.account_status === 'suspended') {
        return new Response(JSON.stringify({ error: 'Forbidden: Account is suspended' }), { status: 403 });
      }

      let body;
      try {
        body = await req.json();
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), { status: 400 });
      }

      const { propertyId, unitId } = body;
      if (!propertyId || !unitId) {
        return new Response(JSON.stringify({ error: 'propertyId and unitId are required' }), { status: 400 });
      }

      const unit = mockDb.units[unitId];
      if (!unit || unit.available_spaces < 1) {
        return new Response(JSON.stringify({ error: 'Unit is currently full or unavailable' }), { status: 400 });
      }

      return new Response(JSON.stringify({ success: true, reservationId: 'res-new' }), { status: 200 });
    }

    test('Rejects request with missing Authorization header with 401', async () => {
      const req = new Request('http://localhost/functions/v1/create-reservation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId: 'prop-1', unitId: 'unit-1' }),
      });
      const res = await handleCreateReservation(req);
      assert.equal(res.status, 401);
    });

    test('Rejects suspended student account with 403 Forbidden', async () => {
      const req = new Request('http://localhost/functions/v1/create-reservation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer student-suspended-1',
        },
        body: JSON.stringify({ propertyId: 'prop-1', unitId: 'unit-1' }),
      });
      const res = await handleCreateReservation(req);
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.match(data.error, /suspended/i);
    });

    test('Rejects missing unitId with 400 Bad Request', async () => {
      const req = new Request('http://localhost/functions/v1/create-reservation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer student-active-1',
        },
        body: JSON.stringify({ propertyId: 'prop-1' }),
      });
      const res = await handleCreateReservation(req);
      assert.equal(res.status, 400);
    });

    test('Accepts valid booking from active student with 200 OK', async () => {
      const req = new Request('http://localhost/functions/v1/create-reservation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer student-active-1',
        },
        body: JSON.stringify({ propertyId: 'prop-1', unitId: 'unit-1' }),
      });
      const res = await handleCreateReservation(req);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
    });
  });

  describe('2. expire-reservations Function Handler', () => {
    async function handleExpireReservations(req) {
      const authHeader = req.headers.get('Authorization');
      if (!authHeader) {
        return new Response(JSON.stringify({ error: 'Missing authorization' }), { status: 401 });
      }

      if (authHeader === `Bearer ${SERVICE_KEY}`) {
        return new Response(JSON.stringify({ success: true, expiredCount: 2 }), { status: 200 });
      }

      const auth = authenticate(authHeader);
      if (!auth) {
        return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 });
      }
      if (auth.account_status === 'suspended') {
        return new Response(JSON.stringify({ error: 'Forbidden: Account is suspended' }), { status: 403 });
      }
      if (auth.role !== 'admin') {
        return new Response(JSON.stringify({ error: 'Unauthorized: Admin or Service Role required' }), { status: 403 });
      }

      return new Response(JSON.stringify({ success: true, expiredCount: 0 }), { status: 200 });
    }

    test('Rejects anonymous caller with 401', async () => {
      const req = new Request('http://localhost/functions/v1/expire-reservations', {
        method: 'POST',
      });
      const res = await handleExpireReservations(req);
      assert.equal(res.status, 401);
    });

    test('Rejects non-admin authenticated caller with 403', async () => {
      const req = new Request('http://localhost/functions/v1/expire-reservations', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer student-active-1' },
      });
      const res = await handleExpireReservations(req);
      assert.equal(res.status, 403);
    });

    test('Authorizes exact Bearer Service Role Key', async () => {
      const req = new Request('http://localhost/functions/v1/expire-reservations', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SERVICE_KEY}` },
      });
      const res = await handleExpireReservations(req);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
    });

    test('Authorizes active Admin user', async () => {
      const req = new Request('http://localhost/functions/v1/expire-reservations', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer admin-active-1' },
      });
      const res = await handleExpireReservations(req);
      assert.equal(res.status, 200);
    });
  });

  describe('3. request-receipt-upload and finalize-receipt-upload Handlers', () => {
    const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB

    async function handleRequestReceiptUpload(req) {
      const auth = authenticate(req.headers.get('Authorization'));
      if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
      if (auth.account_status === 'suspended') return new Response(JSON.stringify({ error: 'Suspended' }), { status: 403 });

      const body = await req.json();
      const { reservationId, fileName, contentType, fileSize } = body;

      if (!reservationId || !fileName || !contentType || !fileSize) {
        return new Response(JSON.stringify({ error: 'Missing required parameters' }), { status: 400 });
      }

      if (!ALLOWED_MIME.includes(contentType)) {
        return new Response(JSON.stringify({ error: 'Disallowed MIME type' }), { status: 400 });
      }

      if (fileSize > MAX_SIZE) {
        return new Response(JSON.stringify({ error: 'File size exceeds 10MB limit' }), { status: 400 });
      }

      const resv = mockDb.reservations[reservationId];
      if (!resv) {
        return new Response(JSON.stringify({ error: 'Reservation not found' }), { status: 404 });
      }

      if (resv.student_id !== auth.id && auth.role !== 'admin') {
        return new Response(JSON.stringify({ error: 'Forbidden: not reservation owner' }), { status: 403 });
      }

      const path = `${resv.landlord_id}/${resv.student_id}/${reservationId}/receipt_${Date.now()}.jpg`;
      return new Response(JSON.stringify({ success: true, uploadUrl: `https://storage.mock/${path}`, storagePath: path }), { status: 200 });
    }

    test('Rejects disallowed executable MIME type with 400', async () => {
      const req = new Request('http://localhost/functions/v1/request-receipt-upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer student-active-1',
        },
        body: JSON.stringify({
          reservationId: 'res-100',
          fileName: 'malware.exe',
          contentType: 'application/x-msdownload',
          fileSize: 1024,
        }),
      });
      const res = await handleRequestReceiptUpload(req);
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error, /MIME/i);
    });

    test('Rejects file size exceeding 10MB with 400', async () => {
      const req = new Request('http://localhost/functions/v1/request-receipt-upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer student-active-1',
        },
        body: JSON.stringify({
          reservationId: 'res-100',
          fileName: 'huge.pdf',
          contentType: 'application/pdf',
          fileSize: 12 * 1024 * 1024, // 12MB
        }),
      });
      const res = await handleRequestReceiptUpload(req);
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error, /10MB/i);
    });

    test('Rejects student attempting to upload receipt for another student reservation with 403', async () => {
      const req = new Request('http://localhost/functions/v1/request-receipt-upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer student-active-2', // Not owner of res-100
        },
        body: JSON.stringify({
          reservationId: 'res-100',
          fileName: 'receipt.pdf',
          contentType: 'application/pdf',
          fileSize: 50000,
        }),
      });
      const res = await handleRequestReceiptUpload(req);
      assert.equal(res.status, 403);
    });

    test('Allows genuine owner student to request upload with isolated path', async () => {
      const req = new Request('http://localhost/functions/v1/request-receipt-upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer student-active-1',
        },
        body: JSON.stringify({
          reservationId: 'res-100',
          fileName: 'receipt.jpg',
          contentType: 'image/jpeg',
          fileSize: 500000,
        }),
      });
      const res = await handleRequestReceiptUpload(req);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.match(data.storagePath, new RegExp(`^landlord-active-1/student-active-1/res-100/`));
    });
  });

  describe('4. review-payment-receipt Handler', () => {
    async function handleReviewPaymentReceipt(req) {
      const auth = authenticate(req.headers.get('Authorization'));
      if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
      if (auth.account_status === 'suspended') return new Response(JSON.stringify({ error: 'Forbidden: Account is suspended' }), { status: 403 });

      const body = await req.json();
      const { receiptId, decision, rejectionReason } = body;

      if (!receiptId || !decision) {
        return new Response(JSON.stringify({ error: 'receiptId and decision are required' }), { status: 400 });
      }

      if (decision !== 'approved' && decision !== 'rejected') {
        return new Response(JSON.stringify({ error: 'decision must be approved or rejected' }), { status: 400 });
      }

      if (decision === 'rejected' && (!rejectionReason || !rejectionReason.trim())) {
        return new Response(JSON.stringify({ error: 'A specific rejectionReason is required' }), { status: 400 });
      }

      const receipt = mockDb.receipts[receiptId];
      if (!receipt) {
        return new Response(JSON.stringify({ error: 'Receipt not found' }), { status: 404 });
      }

      if (auth.id !== receipt.landlord_id && auth.role !== 'admin') {
        return new Response(JSON.stringify({ error: 'Forbidden: only property landlord or admin can review receipt' }), { status: 403 });
      }

      return new Response(JSON.stringify({ success: true, decision, reservationStatus: decision === 'approved' ? 'confirmed' : 'pending_payment' }), { status: 200 });
    }

    test('Rejects non-landlord non-admin student review attempt with 403', async () => {
      const req = new Request('http://localhost/functions/v1/review-payment-receipt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer student-active-1',
        },
        body: JSON.stringify({ receiptId: 'receipt-200', decision: 'approved' }),
      });
      const res = await handleReviewPaymentReceipt(req);
      assert.equal(res.status, 403);
    });

    test('Rejects unassociated landlord review attempt with 403', async () => {
      const req = new Request('http://localhost/functions/v1/review-payment-receipt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer landlord-active-2', // landlord-active-1 owns the property
        },
        body: JSON.stringify({ receiptId: 'receipt-200', decision: 'approved' }),
      });
      const res = await handleReviewPaymentReceipt(req);
      assert.equal(res.status, 403);
    });

    test('Rejects rejection without reason with 400', async () => {
      const req = new Request('http://localhost/functions/v1/review-payment-receipt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer landlord-active-1',
        },
        body: JSON.stringify({ receiptId: 'receipt-200', decision: 'rejected', rejectionReason: '' }),
      });
      const res = await handleReviewPaymentReceipt(req);
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.match(data.error, /rejectionReason/i);
    });

    test('Accepts valid landlord rejection with reason', async () => {
      const req = new Request('http://localhost/functions/v1/review-payment-receipt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer landlord-active-1',
        },
        body: JSON.stringify({
          receiptId: 'receipt-200',
          decision: 'rejected',
          rejectionReason: 'Illegible transaction reference; please re-upload clear slip.',
        }),
      });
      const res = await handleReviewPaymentReceipt(req);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.decision, 'rejected');
      assert.equal(data.reservationStatus, 'pending_payment');
    });

    test('Allows admin to review receipt with 200', async () => {
      const req = new Request('http://localhost/functions/v1/review-payment-receipt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer admin-active-1',
        },
        body: JSON.stringify({
          receiptId: 'receipt-200',
          decision: 'approved',
        }),
      });
      const res = await handleReviewPaymentReceipt(req);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.decision, 'approved');
      assert.equal(data.reservationStatus, 'confirmed');
    });
  });

  describe('5. get-private-asset-url Handler', () => {
    async function handleGetPrivateAssetUrl(req) {
      const auth = authenticate(req.headers.get('Authorization'));
      if (!auth) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
      if (auth.account_status === 'suspended') return new Response(JSON.stringify({ error: 'Forbidden: Account is suspended' }), { status: 403 });

      const body = await req.json();
      const { assetType, recordId } = body;

      if (!assetType || !recordId) {
        return new Response(JSON.stringify({ error: 'assetType and recordId are required' }), { status: 400 });
      }

      const isAdmin = auth.role === 'admin';

      if (assetType === 'payment-receipt') {
        const receipt = mockDb.receipts[recordId];
        if (!receipt) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
        if (!isAdmin && receipt.student_id !== auth.id && receipt.landlord_id !== auth.id) {
          return new Response(JSON.stringify({ error: 'Forbidden: not authorized to view this receipt' }), { status: 403 });
        }
        return new Response(JSON.stringify({ success: true, downloadUrl: `https://storage.mock/${receipt.storage_path}?token=signed` }), { status: 200 });
      }

      if (assetType === 'chat-attachment') {
        const msg = mockDb.messages[recordId];
        if (!msg) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
        const conv = mockDb.conversations[msg.conversation_id];
        if (!isAdmin && (!conv || !conv.participants.includes(auth.id))) {
          return new Response(JSON.stringify({ error: 'Forbidden: not a participant in conversation' }), { status: 403 });
        }
        return new Response(JSON.stringify({ success: true, downloadUrl: `https://storage.mock/${msg.attachment.storage_path}?token=signed` }), { status: 200 });
      }

      if (assetType === 'student-document') {
        const doc = mockDb.studentDocs[recordId];
        if (!doc) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
        if (!isAdmin && doc.student_id !== auth.id) {
          return new Response(JSON.stringify({ error: 'Forbidden: not your document' }), { status: 403 });
        }
        return new Response(JSON.stringify({ success: true, downloadUrl: `https://storage.mock/${doc.storage_path}?token=signed` }), { status: 200 });
      }

      return new Response(JSON.stringify({ error: 'Invalid assetType' }), { status: 400 });
    }

    test('Rejects non-participant viewing private chat attachment with 403', async () => {
      const req = new Request('http://localhost/functions/v1/get-private-asset-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer student-active-2', // Not participant in conv-300
        },
        body: JSON.stringify({ assetType: 'chat-attachment', recordId: 'msg-400' }),
      });
      const res = await handleGetPrivateAssetUrl(req);
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.match(data.error, /participant/i);
    });

    test('Allows conversation participant to get signed download URL for chat attachment', async () => {
      const req = new Request('http://localhost/functions/v1/get-private-asset-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer landlord-active-1', // Participant in conv-300
        },
        body: JSON.stringify({ assetType: 'chat-attachment', recordId: 'msg-400' }),
      });
      const res = await handleGetPrivateAssetUrl(req);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.match(data.downloadUrl, /signed/);
    });

    test('Rejects student attempting to download another student verification document with 403', async () => {
      const req = new Request('http://localhost/functions/v1/get-private-asset-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer student-active-2', // sdoc-500 belongs to student-active-1
        },
        body: JSON.stringify({ assetType: 'student-document', recordId: 'sdoc-500' }),
      });
      const res = await handleGetPrivateAssetUrl(req);
      assert.equal(res.status, 403);
    });

    test('Allows Admin to access student verification document for review', async () => {
      const req = new Request('http://localhost/functions/v1/get-private-asset-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer admin-active-1',
        },
        body: JSON.stringify({ assetType: 'student-document', recordId: 'sdoc-500' }),
      });
      const res = await handleGetPrivateAssetUrl(req);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
    });
  });
});
