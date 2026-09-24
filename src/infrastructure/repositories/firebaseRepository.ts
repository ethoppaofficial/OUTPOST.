import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '../firebase/firebaseConfig';
import { handleFirestoreError, OperationType } from '../firebase/errorHandler';
import { LocalStorageRepository } from './localStorageRepository';
import {
  User,
  StudentProfile,
  StudentVerificationDocument,
  LandlordProfile,
  Property,
  Reservation,
  PaymentReceipt,
  AppNotification,
  ChatMessage,
  MessageReplyReference,
  MessageMention,
  VerificationReviewStatus,
} from '../../domain/types';

export class FirebaseRepository extends LocalStorageRepository {
  private isLiveInitialized = false;

  constructor() {
    super();
    if (typeof window !== 'undefined') {
      this.init().catch((err) => console.warn('Firebase sync initialization notice:', err));
    }
  }

  public override async init(): Promise<void> {
    if (this.isLiveInitialized) return;
    this.isLiveInitialized = true;

    try {
      // 1. Real-time Properties Listener: syncs any landlord listing or admin approval
      onSnapshot(
        collection(db, 'properties'),
        (snapshot) => {
          snapshot.docChanges().forEach((change) => {
            const prop = change.doc.data() as Property;
            if (change.type === 'added' || change.type === 'modified') {
              const existing = this.getPropertyById(prop.id);
              if (!existing) {
                super.createProperty(prop);
              } else {
                super.updateProperty(prop);
              }
            }
          });
        },
        (err) => {
          console.info('Firestore properties listener notice:', err.message);
        }
      );

      // 2. Real-time Reservations Listener
      onSnapshot(
        collection(db, 'reservations'),
        (snapshot) => {
          snapshot.docChanges().forEach((change) => {
            const res = change.doc.data() as Reservation;
            if (change.type === 'added' || change.type === 'modified') {
              const reservations = this.getReservations();
              const idx = reservations.findIndex((r) => r.id === res.id);
              if (idx >= 0) {
                reservations[idx] = res;
              } else {
                reservations.push(res);
              }
            }
          });
        },
        () => {}
      );
    } catch (e) {
      console.warn('Firebase init snapshot listeners notice:', e);
    }
  }

  // Authoritative Firestore User Creation & Sync
  public override createUser(user: User): User {
    const created = super.createUser(user);
    setDoc(
      doc(db, 'users', user.id),
      {
        ...user,
        serverCreatedAt: serverTimestamp(),
      },
      { merge: true }
    ).catch((err) => handleFirestoreError(err, OperationType.WRITE, `users/${user.id}`));
    return created;
  }

  public override updateUser(user: User): User {
    const updated = super.updateUser(user);
    updateDoc(doc(db, 'users', user.id), {
      ...user,
      updatedAt: serverTimestamp(),
    }).catch((err) => handleFirestoreError(err, OperationType.WRITE, `users/${user.id}`));
    return updated;
  }

  // Student Profiles & Documents
  public override saveStudentProfile(profile: StudentProfile): StudentProfile {
    const saved = super.saveStudentProfile(profile);
    setDoc(
      doc(db, 'studentProfiles', profile.userId),
      {
        ...profile,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    ).catch((err) => handleFirestoreError(err, OperationType.WRITE, `studentProfiles/${profile.userId}`));
    return saved;
  }

  public override addStudentDocument(docData: {
    studentId: string;
    studentName: string;
    documentType: any;
    fileName: string;
    fileSize: number;
    documentUrl: string;
  }): StudentVerificationDocument {
    const newDoc = super.addStudentDocument(docData);
    setDoc(doc(db, 'studentVerificationDocuments', newDoc.id), {
      ...newDoc,
      serverUploadedAt: serverTimestamp(),
    }).catch((err) => handleFirestoreError(err, OperationType.WRITE, `studentVerificationDocuments/${newDoc.id}`));
    return newDoc;
  }

  public override reviewStudentDocument(
    docId: string,
    status: VerificationReviewStatus,
    reviewerId: string,
    rejectionReason?: string
  ): StudentVerificationDocument | undefined {
    const reviewed = super.reviewStudentDocument(docId, status, reviewerId, rejectionReason);
    if (reviewed) {
      updateDoc(doc(db, 'studentVerificationDocuments', docId), {
        status,
        reviewerId,
        reviewedAt: serverTimestamp(),
        rejectionReason: rejectionReason || null,
      }).catch((err) => handleFirestoreError(err, OperationType.WRITE, `studentVerificationDocuments/${docId}`));
    }
    return reviewed;
  }

  // Landlord Profiles & Verifications
  public override saveLandlordProfile(profile: LandlordProfile): LandlordProfile {
    const saved = super.saveLandlordProfile(profile);
    setDoc(
      doc(db, 'landlordProfiles', profile.userId),
      {
        ...profile,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    ).catch((err) => handleFirestoreError(err, OperationType.WRITE, `landlordProfiles/${profile.userId}`));
    return saved;
  }

  public override reviewLandlordVerification(
    userId: string,
    decision: 'approved' | 'rejected',
    reviewerId: string,
    reason?: string
  ): LandlordProfile | undefined {
    const reviewed = super.reviewLandlordVerification(userId, decision, reviewerId, reason);
    if (reviewed) {
      updateDoc(doc(db, 'landlordProfiles', userId), {
        verificationStatus: decision,
        verifiedAt: decision === 'approved' ? serverTimestamp() : null,
        rejectionReason: reason || null,
        reviewedBy: reviewerId,
      }).catch((err) => handleFirestoreError(err, OperationType.WRITE, `landlordProfiles/${userId}`));
    }
    return reviewed;
  }

  // Properties
  public override createProperty(prop: Property): Property {
    const created = super.createProperty(prop);
    setDoc(doc(db, 'properties', prop.id), {
      ...prop,
      serverCreatedAt: serverTimestamp(),
    }).catch((err) => handleFirestoreError(err, OperationType.WRITE, `properties/${prop.id}`));
    return created;
  }

  public override updateProperty(prop: Property): Property {
    const updated = super.updateProperty(prop);
    setDoc(doc(db, 'properties', prop.id), {
      ...prop,
      serverUpdatedAt: serverTimestamp(),
    }, { merge: true }).catch((err) => handleFirestoreError(err, OperationType.WRITE, `properties/${prop.id}`));
    return updated;
  }

  // Reservations & Invoices
  public override createReservation(
    studentId: string,
    propertyId: string,
    unitId: string,
    groupId?: string
  ): { success: boolean; reservation?: Reservation; invoice?: any; error?: string } {
    const result = super.createReservation(studentId, propertyId, unitId, groupId);
    if (result.success && result.reservation) {
      const res = result.reservation;
      setDoc(doc(db, 'reservations', res.id), {
        ...res,
        serverCreatedAt: serverTimestamp(),
      }).catch((err) => console.warn('Reservation Firestore write error:', err));

      if (result.invoice) {
        setDoc(doc(db, 'invoices', result.invoice.id), {
          ...result.invoice,
          serverCreatedAt: serverTimestamp(),
        }).catch(() => {});
      }

      const prop = this.getPropertyById(propertyId);
      if (prop) {
        setDoc(doc(db, 'properties', propertyId), prop, { merge: true }).catch(() => {});
      }
    }
    return result;
  }

  public override cancelReservation(reservationId: string, reason?: string): { success: boolean; message?: string } {
    const result = super.cancelReservation(reservationId, reason);
    if (result.success) {
      updateDoc(doc(db, 'reservations', reservationId), {
        status: 'cancelled',
        cancellationReason: reason || 'Cancelled by student',
        serverCancelledAt: serverTimestamp(),
      }).catch(() => {});
    }
    return result;
  }

  // Payment Receipts
  public override uploadPaymentReceipt(receiptData: any): { success: boolean; receipt?: PaymentReceipt; error?: string } {
    const result = super.uploadPaymentReceipt(receiptData);
    if (result.success && result.receipt) {
      setDoc(doc(db, 'paymentReceipts', result.receipt.id), {
        ...result.receipt,
        serverUploadedAt: serverTimestamp(),
      }).catch(() => {});

      updateDoc(doc(db, 'reservations', result.receipt.reservationId), {
        status: 'receipt_submitted',
        serverReceiptSubmittedAt: serverTimestamp(),
      }).catch(() => {});
    }
    return result;
  }

  public override reviewPaymentReceipt(
    receiptId: string,
    decision: 'approved' | 'rejected',
    landlordId: string,
    rejectionReason?: string
  ): { success: boolean; error?: string } {
    const result = super.reviewPaymentReceipt(receiptId, decision, landlordId, rejectionReason);
    if (result.success) {
      updateDoc(doc(db, 'paymentReceipts', receiptId), {
        status: decision,
        reviewedAt: serverTimestamp(),
        reviewedBy: landlordId,
        rejectionReason: rejectionReason || null,
      }).catch(() => {});

      const rcpt = this.getReceiptByReservationId(receiptId) || this.getPaymentReceipts().find((r) => r.id === receiptId);
      if (rcpt) {
        updateDoc(doc(db, 'reservations', rcpt.reservationId), {
          status: decision === 'approved' ? 'confirmed' : 'rejected',
          confirmedAt: decision === 'approved' ? serverTimestamp() : null,
          cancellationReason: decision === 'rejected' ? (rejectionReason || null) : null,
        }).catch(() => {});
      }
    }
    return result;
  }

  // Real-Time Chat & Messages
  public override sendMessage(
    conversationId: string,
    senderId: string,
    text: string,
    options?: { replyTo?: MessageReplyReference; mentions?: MessageMention[] }
  ): ChatMessage {
    const message = super.sendMessage(conversationId, senderId, text, options);
    setDoc(doc(db, 'messages', message.id), {
      ...message,
      serverCreatedAt: serverTimestamp(),
    }).catch(() => {});

    updateDoc(doc(db, 'conversations', conversationId), {
      lastMessageText: text,
      lastMessageTimestamp: serverTimestamp(),
    }).catch(() => {});

    return message;
  }

  public subscribeToMessages(conversationId: string, callback: (messages: ChatMessage[]) => void): () => void {
    const q = query(
      collection(db, 'messages'),
      where('conversationId', '==', conversationId),
      orderBy('createdAt', 'asc')
    );

    return onSnapshot(
      q,
      (snapshot) => {
        const msgs: ChatMessage[] = [];
        snapshot.forEach((d) => msgs.push(d.data() as ChatMessage));
        if (msgs.length > 0) {
          callback(msgs);
        } else {
          callback(this.getMessages(conversationId));
        }
      },
      (err) => {
        console.info('Live messages snapshot notice:', err.message);
        callback(this.getMessages(conversationId));
      }
    );
  }

  // Notifications
  public override createNotification(notification: Omit<AppNotification, 'id' | 'createdAt'>): AppNotification {
    const notif = super.createNotification(notification);
    setDoc(doc(db, 'notifications', notif.id), {
      ...notif,
      serverCreatedAt: serverTimestamp(),
    }).catch(() => {});
    return notif;
  }
}
