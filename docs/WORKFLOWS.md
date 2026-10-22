# OUTPOST End-to-End System Workflows

> **Detailed operational workflows, state machines, sequence diagrams, and transaction boundaries across all personas.**

---

## 1. Student Academic Verification Workflow

Ensures only verified Bayero University Kano students access roommate matching and reserve accommodation holds.

```mermaid
sequenceDiagram
    autonumber
    actor Student
    participant UI as StudentVerificationPage.tsx
    participant Service as verificationService.ts
    participant Storage as Supabase Storage (student-docs)
    participant DB as PostgreSQL (student_verification_documents)
    actor Admin
    participant AdminUI as VerificationQueuePage.tsx
    
    Student->>UI: Selects file (ID Card / Admission Slip / Fees Receipt)
    UI->>UI: Validates format (JPG/PNG/PDF) and size (< 5MB)
    Student->>UI: Clicks "Submit for Verification"
    UI->>Storage: uploadStudentDocument(file, studentId, docType)
    Storage-->>UI: Returns storagePath
    UI->>Service: uploadStudentDocument({ studentId, storagePath, ... })
    Service->>DB: INSERT INTO student_verification_documents (status: 'pending')
    DB-->>Service: Record created
    Service-->>UI: Updates UI to "Pending Verification"
    
    Admin->>AdminUI: Opens Verification Queue
    AdminUI->>DB: SELECT * FROM student_verification_documents WHERE status = 'pending'
    Admin->>AdminUI: Inspects document via signed URL
    Admin->>AdminUI: Clicks "Approve Student"
    AdminUI->>DB: UPDATE student_verification_documents SET status = 'approved'
    AdminUI->>DB: UPDATE student_profiles SET is_profile_verified = true
    AdminUI->>DB: INSERT INTO audit_logs (action: 'admin_approve_student')
    Note over DB: Database trigger prevents student from self-approving
```

---

## 2. Landlord Property Listing & Administrative Approval

Protects students from phantom listings and unverified landlords.

```mermaid
sequenceDiagram
    autonumber
    actor Landlord
    participant Form as NewPropertyPage.tsx
    participant PropService as propertyService.ts
    participant Storage as Supabase Storage (property-images)
    participant DB as PostgreSQL (properties, units)
    actor Admin
    participant AdminUI as PropertyApprovalsPage.tsx
    
    Landlord->>Form: Enters lodge details, rooms, prices, corridor (Dambare/Rimin Gata)
    Landlord->>Form: Snaps/uploads hostel photos
    Form->>Storage: uploadPropertyImage(file, landlordId, propertyId)
    Storage-->>Form: Returns public URLs
    Landlord->>Form: Clicks "Submit Property for Review"
    Form->>PropService: saveProperty(payload)
    PropService->>DB: INSERT INTO properties (verification_status: 'pending')
    PropService->>DB: INSERT INTO units (capacity, available_spaces)
    Note over DB: RLS blocks unapproved properties from public search
    
    Admin->>AdminUI: Opens Property Approvals queue
    AdminUI->>DB: SELECT * FROM properties WHERE verification_status = 'pending'
    Admin->>AdminUI: Inspects lodge photos, amenities, unit capacities
    Admin->>AdminUI: Clicks "Approve Listing"
    AdminUI->>DB: UPDATE properties SET verification_status = 'approved'
    AdminUI->>DB: INSERT INTO audit_logs (action: 'admin_approve_property')
    Note over DB: Listing is now indexable by students in search
```

---

## 3. Explainable Roommate Matching & Coordination

Enables verified students to find compatible roommates through transparent arithmetic scoring.

```mermaid
flowchart TD
    A[Student navigates to /student/roommates/preferences] --> B[Fills out 6-attribute preference questionnaire]
    B --> C[Saves to database: roommate_preferences]
    C --> D[Navigates to /student/roommates]
    D --> E[roommateService.getSuggestedMatches]
    E --> F[calculateCompatibility Algorithm in src/domain/matching.ts]
    
    subgraph ScoringWeights["Deterministic Weight Matrix (100 pts)"]
        W1["1. Budget Range Overlap (25%)"]
        W2["2. Preferred Corridor: Dambare vs Rimin Gata (20%)"]
        W3["3. Move-in Timing Alignment (15%)"]
        W4["4. Neatness Routine & Study Lifestyle (15%)"]
        W5["5. Sleep Schedule & Noise Tolerance (15%)"]
        W6["6. Smoking & Guest Boundary (10%)"]
    end
    
    F --> ScoringWeights
    ScoringWeights --> G[Output CompatibilityResult: Score 0-100, Match Band, Matching vs Diverging Factors]
    G --> H[Render Match Cards with 'Why you matched' breakdown]
    H --> I[Student clicks 'Connect / Send Request']
    I --> J[Inserts row into roommate_requests]
```

---

## 4. Reservation, 7-Day Hold, External Payment & Receipt Review

The primary transactional workflow managing inventory allocation, invoicing, and bank transfer verification.

```mermaid
sequenceDiagram
    autonumber
    actor Student
    participant DetailUI as PropertyDetailPage.tsx
    participant ResService as reservationService.ts
    participant EdgeReserve as Edge Function: create-reservation
    participant DB as PostgreSQL 15
    participant Storage as Supabase Storage (payment-receipts)
    actor Landlord
    participant LandlordUI as LandlordReceiptsPage.tsx
    participant EdgeReview as Edge Function: review-payment-receipt
    
    Student->>DetailUI: Clicks "Hold Room Space" on Unit
    DetailUI->>ResService: createReservation(studentId, propId, unitId)
    ResService->>EdgeReserve: POST /functions/v1/create-reservation
    EdgeReserve->>DB: CALL create_reservation_atomic(...)
    Note over DB: 1. SELECT ... FOR UPDATE (Row Lock on Unit)<br/>2. CHECK available_spaces > 0<br/>3. available_spaces = available_spaces - 1<br/>4. INSERT reservations (status: 'pending_payment', hold_expires_at: NOW() + 7 days)<br/>5. INSERT invoices (payment_status: 'pending')
    DB-->>EdgeReserve: Created reservation & invoice
    EdgeReserve-->>ResService: Success
    ResService-->>DetailUI: Redirects to /student/reservations/:id
    
    Note over Student: Student transfers funds via direct bank transfer<br/>using Landlord Bank details on the Invoice
    
    Student->>DetailUI: Uploads Bank Transfer Receipt slip
    DetailUI->>Storage: uploadPaymentReceiptWithSession()
    Storage-->>DetailUI: Uploaded to payment-receipts/{landlordId}/{studentId}/{resId}/...
    DetailUI->>DB: INSERT INTO payment_receipts (status: 'pending_review')
    DetailUI->>DB: UPDATE reservations SET status = 'payment_submitted'
    
    Landlord->>LandlordUI: Opens /landlord/receipts
    LandlordUI->>DB: Queries pending receipts for own properties
    Landlord->>LandlordUI: Clicks "View Slip" (Gets 15-min signed URL)
    
    alt Landlord Confirms Credit
        Landlord->>LandlordUI: Clicks "Approve Receipt"
        LandlordUI->>EdgeReview: POST /functions/v1/review-payment-receipt (decision: 'approved')
        EdgeReview->>DB: CALL review_payment_receipt_atomic(...)
        Note over DB: UPDATE payment_receipts SET status = 'approved'<br/>UPDATE reservations SET status = 'confirmed'<br/>UPDATE invoices SET payment_status = 'paid'
    else Landlord Declines
        Landlord->>LandlordUI: Enters rejection reason and clicks "Reject"
        LandlordUI->>EdgeReview: POST /functions/v1/review-payment-receipt (decision: 'rejected', reason)
        EdgeReview->>DB: CALL review_payment_receipt_atomic(...)
        Note over DB: UPDATE payment_receipts SET status = 'rejected'<br/>UPDATE reservations SET status = 'pending_payment'<br/>UPDATE units SET available_spaces = available_spaces + 1 (Restores inventory)
    end
```

---

## 5. 7-Day Hold Expiration Lifecycle

Automated process releasing held unit spaces back into general availability if no payment receipt is submitted within 7 days.

```mermaid
stateDiagram-v2
    [*] --> PendingPayment: Student reserves room (available_spaces - 1)
    
    PendingPayment --> PaymentSubmitted: Student uploads transfer receipt
    PaymentSubmitted --> Confirmed: Landlord approves receipt
    PaymentSubmitted --> PendingPayment: Landlord rejects receipt (inventory restored)
    
    PendingPayment --> Cancelled: Student voluntarily cancels hold (inventory restored)
    
    PendingPayment --> Expired: 7-Day hold expires (NOW() > hold_expires_at)
    
    state Expired {
        [*] --> ReleaseInventory: Stored procedure: expire_pending_reservations()
        ReleaseInventory --> RestoredSpace: available_spaces = available_spaces + 1
        RestoredSpace --> InvalidateInvoice: invoices.payment_status = 'cancelled'
        InvalidateInvoice --> LogAudit: audit_logs.action = 'system_expire_reservation'
    }
    
    Confirmed --> [*]
    Expired --> [*]
    Cancelled --> [*]
```

---

## 6. Real-Time Chat & File Attachment Sharing

Peer-to-peer and group messaging with real-time push and strict 15-minute edit boundaries.

```mermaid
sequenceDiagram
    autonumber
    actor Sender
    participant ChatUI as ChatPage.tsx
    participant ChatService as chatService.ts
    participant EdgeChat as Edge Function: finalize-chat-attachment-upload
    participant DB as PostgreSQL (messages)
    participant Realtime as Supabase Realtime Channel
    actor Recipient
    
    Sender->>ChatUI: Types message and attaches room photo
    ChatUI->>ChatService: sendAttachmentMessage(convId, senderId, file)
    ChatService->>EdgeChat: Uploads file to private bucket chat-attachments
    EdgeChat->>DB: INSERT INTO messages (conversation_id, sender_id, text, attachment)
    DB-->>Realtime: PostgreSQL CDC triggers broadcast
    Realtime-->>Recipient: Pushes new message payload instantly
    Recipient->>Recipient: Plays notification sound and appends message bubble
    
    opt Within 15 minutes
        Sender->>ChatUI: Edits sent message
        ChatUI->>DB: UPDATE messages SET text = 'corrected text' WHERE id = msg_id
        Note over DB: PostgreSQL trigger verifies created_at + 15 min >= NOW()
        DB-->>Realtime: Broadcasts edit event
    end
    
    opt After 15 minutes
        Sender->>ChatUI: Attempts edit
        ChatUI->>DB: UPDATE messages ...
        DB-->>ChatUI: Exception: Message edit window has expired (15 minutes maximum)
    end
```
