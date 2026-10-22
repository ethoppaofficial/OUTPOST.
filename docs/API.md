# OUTPOST API Specification: Supabase Edge Functions

> **Authoritative API documentation for the 8 Supabase Edge Functions providing privileged transactions, secure upload sessions, and private asset retrieval.**

---

## 1. API Architecture & Standards

All OUTPOST Edge Functions are hosted under `/functions/v1/` on the Supabase Edge Network and implemented in TypeScript using the Deno runtime:

- **Base URL**: `https://<project-ref>.supabase.co/functions/v1/`
- **Transport & Security**: HTTPS strictly enforced. All error responses return generic sanitized messages for 500 errors to prevent secret or stack leakage.
- **CORS Directives**:
  ```http
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Headers: authorization, x-client-info, apikey, content-type
  Access-Control-Allow-Methods: POST, OPTIONS
  ```
- **Preflight Handling**: All endpoints handle `OPTIONS` requests and return `200 OK` with CORS headers.

---

## 2. Authentication & Authorization Standard

Every privileged request must supply the user's Supabase JWT in the `Authorization` header:

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Account Suspension Verification
Every privileged Edge Function inspects the caller's active record in `public.profiles`. If `account_status === 'suspended'`, the function aborts immediately with:

```json
{
  "error": "Forbidden: Account is suspended"
}
```
**HTTP Status**: `403 Forbidden`

---

## 3. Edge Functions Directory

### 3.1 `create-reservation`
Atomically decrements unit inventory, reserves a room space, sets a 7-day hold timer, and issues an official invoice.

- **Endpoint**: `POST /functions/v1/create-reservation`
- **Auth**: Authenticated student or administrator (`Bearer <jwt>`).
- **Request Body**:
  ```json
  {
    "propertyId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "unitId": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    "groupId": "c3d4e5f6-a7b8-9012-cdef-123456789012",
    "idempotencyKey": "uuid-v4-optional-string"
  }
  ```
- **Response (200 OK)**:
  ```json
  {
    "success": true,
    "reservation": {
      "id": "d4e5f6a7-b8c9-0123-def1-234567890123",
      "student_id": "...",
      "unit_id": "...",
      "status": "pending_payment",
      "hold_expires_at": "2026-10-29T15:30:00.000Z"
    },
    "invoice": {
      "id": "e5f6a7b8-c9d0-1234-ef12-345678901234",
      "invoice_number": "INV-2026-84920",
      "amount": 180000.00,
      "payment_status": "pending"
    }
  }
  ```
- **Error Responses**:
  - `400 Bad Request`: `{"error": "propertyId and unitId are required"}` or `{"error": "Unit is currently full or unavailable"}`
  - `401 Unauthorized`: `{"error": "Missing authorization header"}`
  - `403 Forbidden`: `{"error": "Forbidden: Account is suspended"}`

---

### 3.2 `review-payment-receipt`
Allows the property landlord (or administrator) to confirm or reject a student's submitted bank transfer receipt.

- **Endpoint**: `POST /functions/v1/review-payment-receipt`
- **Auth**: Landlord who owns the property or administrator (`Bearer <jwt>`).
- **Request Body**:
  ```json
  {
    "receiptId": "f6a7b8c9-d0e1-2345-f123-456789012345",
    "decision": "approved",
    "rejectionReason": "Illegible transaction receipt; please re-upload clear slip."
  }
  ```
  *(Note: `rejectionReason` is required when `decision === 'rejected'`)*
- **Response (200 OK)**:
  ```json
  {
    "success": true,
    "receipt_id": "f6a7b8c9-d0e1-2345-f123-456789012345",
    "decision": "approved",
    "reservation_status": "confirmed"
  }
  ```
- **Error Responses**:
  - `400 Bad Request`: `{"error": "A specific rejectionReason is required when declining a receipt"}`
  - `403 Forbidden`: `{"error": "Forbidden: not authorized to review this receipt"}`

---

### 3.3 `expire-reservations`
Idempotent scheduled worker releasing held unit spaces on reservations that exceeded 7 days without payment.

- **Endpoint**: `POST /functions/v1/expire-reservations`
- **Auth**: Exact Supabase Service Role key (`Bearer <service_role_key>`) or active administrator session.
- **Request Body**: Empty `{}`.
- **Response (200 OK)**:
  ```json
  {
    "success": true,
    "expired_count": 3,
    "timestamp": "2026-10-22T08:30:00.000Z"
  }
  ```
- **Error Responses**:
  - `401 Unauthorized`: `{"error": "Missing or unauthorized authorization header"}`
  - `403 Forbidden`: `{"error": "Unauthorized: Admin or Service Role required"}`

---

### 3.4 `request-receipt-upload`
Pre-validates student ownership, MIME format, and file size before issuing a scoped storage path for bank transfer receipt uploads.

- **Endpoint**: `POST /functions/v1/request-receipt-upload`
- **Auth**: Authenticated student who owns the reservation (`Bearer <jwt>`).
- **Request Body**:
  ```json
  {
    "reservationId": "d4e5f6a7-b8c9-0123-def1-234567890123",
    "fileName": "teller_slip.jpg",
    "contentType": "image/jpeg",
    "fileSize": 450200
  }
  ```
- **Response (200 OK)**:
  ```json
  {
    "success": true,
    "storagePath": "landlord-123/student-456/res-789/receipt_1729582000.jpg",
    "uploadUrl": "https://<project-ref>.supabase.co/storage/v1/object/payment-receipts/...",
    "token": "signed-upload-token"
  }
  ```
- **Validation Constraints**:
  - Allowed MIME: `image/jpeg`, `image/png`, `image/webp`, `application/pdf`.
  - Maximum size: 10,485,760 bytes (10 MB).

---

### 3.5 `finalize-receipt-upload`
Confirms file upload into storage, inserts the canonical record into `payment_receipts`, and transitions reservation status to `payment_submitted`.

- **Endpoint**: `POST /functions/v1/finalize-receipt-upload`
- **Auth**: Authenticated student owner (`Bearer <jwt>`).
- **Request Body**:
  ```json
  {
    "reservationId": "d4e5f6a7-b8c9-0123-def1-234567890123",
    "storagePath": "landlord-123/student-456/res-789/receipt_1729582000.jpg",
    "paymentReference": "TRX-829402840",
    "payerBankName": "GTBank",
    "amountPaid": 180000.00,
    "paymentDate": "2026-10-22T08:15:00.000Z"
  }
  ```
- **Response (200 OK)**:
  ```json
  {
    "success": true,
    "receiptId": "f6a7b8c9-d0e1-2345-f123-456789012345",
    "reservationStatus": "payment_submitted"
  }
  ```

---

### 3.6 `request-chat-attachment-upload`
Issues an upload session for images and documents shared within conversation threads.

- **Endpoint**: `POST /functions/v1/request-chat-attachment-upload`
- **Auth**: Conversation participant (`Bearer <jwt>`).
- **Request Body**:
  ```json
  {
    "conversationId": "c3d4e5f6-a7b8-9012-cdef-123456789012",
    "fileName": "room_measurement.pdf",
    "contentType": "application/pdf",
    "fileSize": 1205000
  }
  ```
- **Response (200 OK)**:
  ```json
  {
    "success": true,
    "storagePath": "conv-123/sender-456/1729582000_room_measurement.pdf",
    "token": "signed-upload-token"
  }
  ```

---

### 3.7 `finalize-chat-attachment-upload`
Registers the attachment record and inserts a chat message row into `messages`.

- **Endpoint**: `POST /functions/v1/finalize-chat-attachment-upload`
- **Auth**: Conversation participant (`Bearer <jwt>`).
- **Request Body**:
  ```json
  {
    "conversationId": "c3d4e5f6-a7b8-9012-cdef-123456789012",
    "storagePath": "conv-123/sender-456/1729582000_room_measurement.pdf",
    "fileName": "room_measurement.pdf",
    "contentType": "application/pdf",
    "fileSize": 1205000,
    "text": "Attached room dimensions document"
  }
  ```
- **Response (200 OK)**:
  ```json
  {
    "success": true,
    "messageId": "msg-8392019"
  }
  ```

---

### 3.8 `get-private-asset-url`
Authorizes access to private evidence and issues a 15-minute signed download URL.

- **Endpoint**: `POST /functions/v1/get-private-asset-url`
- **Auth**: Authenticated user with relationship to the asset (`Bearer <jwt>`).
- **Request Body**:
  ```json
  {
    "assetType": "payment-receipt",
    "recordId": "f6a7b8c9-d0e1-2345-f123-456789012345"
  }
  ```
  *(Supported `assetType` values: `'payment-receipt'`, `'chat-attachment'`, `'student-document'`, `'landlord-document'`)*
- **Authorization Logic**:
  - `payment-receipt`: Caller must be student who paid, landlord of property, or admin.
  - `chat-attachment`: Caller must be participant in conversation or admin.
  - `student-document`: Caller must be the student or admin.
  - `landlord-document`: Caller must be the landlord or admin.
- **Response (200 OK)**:
  ```json
  {
    "success": true,
    "downloadUrl": "https://<project-ref>.supabase.co/storage/v1/object/sign/payment-receipts/...?token=...",
    "expiresInSeconds": 900
  }
  ```
- **Error Responses**:
  - `403 Forbidden`: `{"error": "Forbidden: not authorized to view this receipt"}`
  - `404 Not Found`: `{"error": "Receipt not found"}`

---

## 4. Frontend Client Integration

Edge Functions are invoked using the helper `invokeEdgeFunction<T>` in `src/infrastructure/supabase/supabaseClient.ts`:

```typescript
import { invokeEdgeFunction } from '../supabase/supabaseClient';

// Example: Calling review-payment-receipt
const { data, error } = await invokeEdgeFunction<{ success: boolean }>(
  'review-payment-receipt',
  {
    receiptId: 'receipt-123',
    decision: 'approved',
  }
);
```

The helper automatically attaches the active session token `Authorization: Bearer <token>` and handles error parsing.
