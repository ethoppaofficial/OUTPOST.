# OUTPOST Security Model & Threat Specification

> **Comprehensive specification of the defense-in-depth security architecture, trust boundaries, Row Level Security (RLS) enforcement, storage path isolation, and auditability.**

---

## 1. Security Architecture & Threat Model

OUTPOST operates in an environment where financial incentives (securing scarce hostel rooms around BUK New Site) could encourage malicious manipulation: race conditions to double-book rooms, forging bank payment receipts, impersonating administrators, bypassing verification, or accessing private student documents.

To counteract these threats, the platform implements a **6-Layer Defense-in-Depth Model**:

```
Layer 1: Frontend Client Validation & Route Guards (ProtectedRoute)
Layer 2: Supabase Edge Gateway (JWT Verification, CORS Directives)
Layer 3: Supabase Edge Functions (Account Suspension Checks, Parameter Validation)
Layer 4: Supabase Storage Bucket Policies (Tenant Path Isolation, MIME & Size Whitelists)
Layer 5: PostgreSQL Row Level Security (RLS) (23 Tables, Tenant Isolation)
Layer 6: PostgreSQL Database Triggers & Hard Constraints (Immutability, Non-Negative CHECKs)
```

---

## 2. Authentication & Session Security

- **Provider**: Supabase Authentication (backed by PostgreSQL `auth.users`).
- **Token Mechanism**: Standard JSON Web Tokens (JWT) signed via HMAC-SHA256 or asymmetric ES256 with 1-hour expiry and automated refresh token rotation.
- **Client Storage**: Tokens are persisted securely in browser storage by `@supabase/supabase-js`.
- **Account Suspension Enforcement**:
  - If an administrator marks a user `account_status = 'suspended'`, all 8 Edge Functions actively reject requests with `403 Forbidden: Account is suspended`.
  - Database stored procedures (`create_reservation_atomic`, `review_payment_receipt_atomic`) verify that the calling user is active and not suspended before executing database state transitions.

---

## 3. Role-Based Access Control (RBAC) & Trust Boundaries

The system supports three strict roles: `student`, `landlord`, and `admin`.

### Zero Client Trust Boundary
The frontend client application is treated as completely untrusted:
1. **Self-Promotion Prevention**:
   - Direct SQL updates to `profiles.role` or `profiles.account_status` are blocked by PostgreSQL trigger `protect_profile_immutable_fields`.
   - Only database operations executing with `service_role` or verified administrators can elevate user roles or alter verification status.
2. **Student Self-Verification Prevention**:
   - Trigger `protect_student_profile_immutable_fields` raises an exception if a student attempts to set `is_profile_verified = true` via direct database write.
3. **No Admin Persona Switcher**:
   - There are no client-side admin toggles, demo administrator logins, or backdoor bypasses in the codebase. Admin status requires server-side verification.

---

## 4. Database & Row Level Security (RLS) Enforcement

RLS is enabled on **all 23 tables** in `public`. Default behavior without an explicit matching policy is complete denial of access.

### Critical RLS Invariants
- **Student Data Isolation**: Students can only read and mutate their own profile, preferences, requests, and reservations (`auth.uid() = student_id`).
- **Landlord Data Isolation**: Landlords can only manage properties, units, and review receipts associated with their own landlord account (`auth.uid() = landlord_id`). Cross-landlord receipt access is blocked.
- **Conversation Isolation**: Messages and chat threads are strictly restricted to users registered in `conversation_participants` for that specific `conversation_id`.
- **Property Location Privacy**: The table `property_locations` containing raw device GPS points has RLS restricting read access exclusively to the owning landlord and administrators. Students can never query exact landlord coordinates.

---

## 5. Storage Security & Path Isolation

Media and documents are partitioned across 6 Supabase Storage buckets:

| Bucket Name | Public / Private | Allowed Content Types | Max Size | Tenant-Isolated Storage Path |
| :--- | :--- | :--- | :--- | :--- |
| `student-docs` | Private | `image/jpeg`, `image/png`, `application/pdf` | 10 MB | `{studentId}/{docId}/{fileName}` |
| `landlord-docs` | Private | `image/jpeg`, `image/png`, `application/pdf` | 10 MB | `{landlordId}/{docId}/{fileName}` |
| `payment-receipts` | Private | `image/jpeg`, `image/png`, `image/webp`, `application/pdf` | 10 MB | `{landlordId}/{studentId}/{reservationId}/{fileName}` |
| `chat-attachments` | Private | `image/jpeg`, `image/png`, `image/webp`, `application/pdf` | 10 MB | `{conversationId}/{senderId}/{fileName}` |
| `property-images` | Public | `image/jpeg`, `image/png`, `image/webp` | 10 MB | `{landlordId}/{propertyId}/{fileName}` |
| `profile-pictures` | Public | `image/jpeg`, `image/png`, `image/webp` | 2 MB | `{userId}/{fileName}` |

### Signed URL Access Gate
Private documents (`student-docs`, `landlord-docs`, `payment-receipts`, `chat-attachments`) cannot be accessed through public CDN URLs. Any download request must go through the `get-private-asset-url` Edge Function, which:
1. Validates the caller's JWT.
2. Checks that the caller is the student owner, property landlord, conversation peer, or administrator.
3. Generates a signed URL expiring in **900 seconds (15 minutes)**.

---

## 6. Financial & Inventory Concurrency Security

### Race Condition & Overbooking Prevention
To prevent multiple students from simultaneously booking the final space in a hostel room:
1. All booking requests invoke the stored procedure `create_reservation_atomic`.
2. The procedure executes an exclusive row-level lock:
   ```sql
   SELECT * FROM public.units WHERE id = p_unit_id FOR UPDATE;
   ```
3. Checks `available_spaces > 0`. If `available_spaces = 0`, it raises an exception and aborts.
4. Decrements `available_spaces = available_spaces - 1`.
5. An engine-level CHECK constraint enforces integrity at all times:
   ```sql
   CHECK (available_spaces >= 0 AND available_spaces <= capacity)
   ```
   If any concurrency error or transaction defect attempts to decrement `available_spaces` below zero, PostgreSQL rejects the transaction with a check constraint violation.

### Receipt Review Race Condition Protection
Stored procedure `review_payment_receipt_atomic` prevents a landlord from approving a receipt on a reservation that has already expired or been cancelled. The review transaction validates:
```sql
IF v_reservation.status NOT IN ('pending_payment', 'payment_submitted') THEN
  RAISE EXCEPTION 'Cannot review receipt: reservation status is %', v_reservation.status;
END IF;
```

---

## 7. Append-Only Tamper-Evident Audit Ledger

The `public.audit_logs` table records sensitive actions:
- `admin_approve_student`, `admin_reject_student`
- `admin_approve_property`, `admin_reject_property`
- `admin_suspend_user`
- `system_expire_reservation`
- `receipt_approved`, `receipt_rejected`

### Security Hardening on `audit_logs`
1. **Mutation Privileges Revoked**: Direct `UPDATE`, `DELETE`, and `TRUNCATE` privileges on `audit_logs` are revoked from `PUBLIC`, `authenticated`, and `anon`. Rows can never be altered or deleted from the client.
2. **Action Forgery Prevention**: RLS policy restricts `actor_id = auth.uid()` and blocks regular authenticated users from inserting administrative action types (`admin_%`, `system_%`, `approve_receipt`, `suspend_user`).

---

## 8. Server-Side Secret Management

- **Public Variables (`VITE_*`)**:
  - `VITE_SUPABASE_URL`: Public endpoint URL.
  - `VITE_SUPABASE_ANON_KEY`: Public anon token (constrained by PostgreSQL RLS).
  - Safe for inclusion in client bundles.
- **Private Secrets**:
  - `SUPABASE_SERVICE_ROLE_KEY`: Service role secret that bypasses RLS.
  - **MANDATE**: Never prefix with `VITE_`. Only configured in Supabase Edge Function environment secrets via `supabase secrets set`.

---

## 9. Non-Destructive Rollback Discipline

Destructive rollback commands, specifically:
- `DROP SCHEMA public CASCADE;`
- `DROP TABLE ... CASCADE;`
- `TRUNCATE ...;`

are **strictly prohibited** in all documentation, migration scripts, and operational procedures. Rollback procedures must follow the 4-phase non-destructive strategy detailed in `docs/backend-migration.md`.
