# OUTPOST: Logical Data Model

## Core Entities & Invariants

1. **User**:
   - `id`, `email` (normalized, unique), `role` (`student` | `landlord` | `admin`), `accountStatus` (`active` | `email_unverified` | `profile_pending` | `profile_verified` | `rejected` | `suspended`), `emailVerified`, `avatarUrl`.

2. **StudentProfile**:
   - `userId` (FK -> User.id), `fullName`, `phone`, `registrationNumber` (unique in university scope), `university`, `campus`, `studyLevel`, `programme`, `gender`, `preferredLocation`, `isProfileVerified`.

3. **StudentVerificationDocument**:
   - `id`, `studentId`, `documentType` (`student_id` | `admission_letter` | `school_fees_receipt`), `documentUrl`, `fileName`, `fileSize`, `uploadedAt`, `status` (`pending` | `approved` | `rejected`), `rejectionReason`.

4. **LandlordProfile**:
   - `userId` (FK -> User.id), `legalName`, `phone`, `contactAddress`, `idType`, `idReference`, `businessName`, `verificationStatus` (`not_started` | `pending` | `approved` | `rejected`).

5. **Property & Unit**:
   - `id`, `landlordId`, `title`, `slug`, `description`, `propertyType`, `accommodationType`, `genderPolicy`, `address`, `city`, `neighbourhood`, `campus`, `university`, `distanceKm`, `pricePerSession`, `totalCapacity`, `availableSpaces`, `verificationStatus`.
   - Invariant: `availableSpaces` must never become negative.

6. **Reservation & Invoice**:
   - `id`, `reservationNumber`, `studentId`, `propertyId`, `unitId`, `status` (`pending_payment` | `receipt_submitted` | `confirmed` | `rejected` | `cancelled` | `expired`), `holdExpiresAt` (now + 7 days).
   - Invariant: A reservation cannot be confirmed twice.

7. **PaymentReceipt**:
   - `id`, `reservationId`, `invoiceId`, `studentId`, `landlordId`, `fileUrl`, `paymentReference`, `payerBankName`, `amountPaid`, `status` (`not_submitted` | `pending_review` | `approved` | `rejected`).

8. **RoommatePreference & Matching**:
   - Weighted compatibility factors: Budget (25%), Location (20%), Move-In Period (15%), Neatness & Habits (15%), Sleep & Noise (15%), Guest & Smoking (10%).

9. **AccommodationGroup & Members**:
   - `id`, `name`, `leaderId`, `memberIds`, `maxCapacity`.
   - Invariant: Members cannot exceed `maxCapacity`.

10. **Conversation & ChatMessage**:
    - `id`, `type` (`direct` | `group`), `participantIds`, `messages` (ordered by `createdAt`).
