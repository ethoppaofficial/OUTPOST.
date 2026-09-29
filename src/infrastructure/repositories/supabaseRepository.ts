import { getSupabaseClient } from '../../lib/supabase/client';
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

/**
 * SupabaseRepository
 * Implements IRepository while synchronizing reads/writes with Supabase PostgreSQL & Realtime.
 * Retains synchronous in-memory/local cache for existing React hooks & components,
 * and gracefully handles unmigrated database tables prior to SQL execution.
 */
export class SupabaseRepository extends LocalStorageRepository {
  private isLiveInitialized = false;

  constructor() {
    super();
    if (typeof window !== 'undefined') {
      this.init().catch((err) => console.info('Supabase sync initialization notice:', err));
    }
  }

  public override async init(): Promise<void> {
    if (this.isLiveInitialized) return;
    this.isLiveInitialized = true;

    const supabase = getSupabaseClient();
    if (!supabase) return;

    try {
      const { data: propsData, error: propsErr } = await supabase
        .from('properties')
        .select('*')
        .eq('verification_status', 'approved')
        .eq('location_verification_status', 'verified')
        .eq('is_active', true);

      if (!propsErr && Array.isArray(propsData)) {
        for (const row of propsData) {
          const existing = this.getPropertyById(row.id);
          if (!existing) {
            super.createProperty({
              id: row.id,
              slug: row.slug,
              title: row.title,
              description: row.description,
              landlordId: row.landlord_id,
              landlordName: row.landlord_name,
              landlordVerified: Boolean(row.landlord_verified),
              propertyType: row.property_type,
              accommodationType: row.accommodation_type,
              genderPolicy: row.gender_policy,
              university: row.university || 'Bayero University Kano (BUK)',
              campus: row.campus || 'New Campus (Gwarzo Road)',
              city: 'Kano',
              state: 'Kano State',
              neighbourhood: row.neighbourhood,
              address: row.address,
              distanceToCampusKm: Number(row.distance_km || 0.5),
              pricePerYear: Number(row.price_per_session),
              currency: 'NGN',
              totalUnits: Number(row.total_units || 1),
              availableUnits: Number(row.available_units || 1),
              rooms: [],
              amenities: Array.isArray(row.amenities) ? row.amenities : [],
              houseRules: Array.isArray(row.house_rules) ? row.house_rules : [],
              images: Array.isArray(row.images) ? row.images : [],
              verificationStatus: row.verification_status,
              locationVerificationStatus: row.location_verification_status,
              isActive: Boolean(row.is_active),
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            } as unknown as Property);
          }
        }
      }
    } catch {
      // Schema may not yet be applied to remote Supabase project
    }
  }

  public override createUser(user: User): User {
    const created = super.createUser(user);
    const supabase = getSupabaseClient();
    if (supabase && user.id) {
      supabase
        .from('users')
        .upsert(
          {
            id: user.id,
            email: user.email,
            role: user.role === 'admin' ? 'student' : user.role,
            display_name: user.fullName || user.name || user.email,
            email_verified: Boolean(user.emailVerified),
            account_status: user.accountStatus || 'active',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id' }
        )
        .then(({ error }) => {
          if (error && error.code !== 'PGRST205') {
            console.info('Supabase user sync notice:', error.message);
          }
        });
    }
    return created;
  }

  public override updateUser(user: User): User {
    const updated = super.updateUser(user);
    const supabase = getSupabaseClient();
    if (supabase && user.id) {
      supabase
        .from('users')
        .update({
          display_name: user.fullName || user.name || user.email,
          email_verified: Boolean(user.emailVerified),
          account_status: user.accountStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id)
        .then(() => {});
    }
    return updated;
  }

  public override saveStudentProfile(profile: StudentProfile): StudentProfile {
    const saved = super.saveStudentProfile(profile);
    const supabase = getSupabaseClient();
    if (supabase && profile.userId) {
      supabase
        .from('student_profiles')
        .upsert(
          {
            user_id: profile.userId,
            full_name: profile.fullName,
            phone: profile.phone,
            registration_number: profile.registrationNumber.trim().toUpperCase(),
            institution_name: 'Bayero University Kano (BUK)',
            university: 'Bayero University Kano (BUK)',
            campus: profile.campus || 'New Campus (Gwarzo Road)',
            study_level: profile.studyLevel,
            programme: profile.programme,
            gender: profile.gender,
            preferred_location:
              profile.preferredLocation === 'Rimin Gata' ? 'Rimin Gata' : 'Dambare',
            bio: profile.bio || '',
            is_profile_verified: Boolean(profile.isProfileVerified),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        )
        .then(() => {});
    }
    return saved;
  }

  public override saveLandlordProfile(profile: LandlordProfile): LandlordProfile {
    const saved = super.saveLandlordProfile(profile);
    const supabase = getSupabaseClient();
    if (supabase && profile.userId) {
      supabase
        .from('landlord_profiles')
        .upsert(
          {
            user_id: profile.userId,
            legal_name: profile.legalName,
            business_name: profile.businessName || null,
            phone: profile.phone,
            contact_address: profile.contactAddress,
            id_type: profile.idType,
            id_reference: profile.idReference,
            verification_status: profile.verificationStatus || 'pending',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        )
        .then(() => {});
    }
    return saved;
  }

  public override submitStudentVerificationDocument(
    docData: Omit<StudentVerificationDocument, 'id' | 'uploadedAt' | 'status'>
  ): StudentVerificationDocument {
    const created = super.submitStudentVerificationDocument(docData);
    const supabase = getSupabaseClient();
    if (supabase) {
      supabase
        .from('student_verification_documents')
        .insert({
          student_id: created.studentId,
          student_name: created.studentName,
          document_type: created.documentType,
          storage_path: created.documentUrl,
          file_name: created.fileName,
          file_size: created.fileSize,
          status: 'pending',
        })
        .then(() => {});
    }
    return created;
  }

  public override reviewStudentDocument(
    docId: string,
    status: VerificationReviewStatus,
    reviewerId: string,
    rejectionReason?: string
  ): StudentVerificationDocument | undefined {
    const updated = super.reviewStudentDocument(docId, status, reviewerId, rejectionReason);
    const supabase = getSupabaseClient();
    if (supabase && updated) {
      supabase
        .from('student_verification_documents')
        .update({
          status,
          rejection_reason: rejectionReason || null,
          reviewer_id: reviewerId,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', docId)
        .then(() => {});
    }
    return updated;
  }

  public override createReservation(params: {
    studentId: string;
    propertyId: string;
    roomId: string;
    groupId?: string;
  }): Reservation | { error: string } {
    const result = super.createReservation(params);
    if ('error' in result) return result;

    const supabase = getSupabaseClient();
    if (supabase) {
      supabase
        .rpc('create_reservation_atomic', {
          p_property_id: params.propertyId,
          p_unit_id: params.roomId,
          p_group_id: params.groupId || null,
        })
        .then(() => {});
    }
    return result;
  }

  public override submitPaymentReceipt(
    data: Omit<PaymentReceipt, 'id' | 'uploadedAt' | 'status'>
  ): PaymentReceipt {
    const receipt = super.submitPaymentReceipt(data);
    const supabase = getSupabaseClient();
    if (supabase) {
      supabase
        .from('payment_receipts')
        .insert({
          reservation_id: receipt.reservationId,
          invoice_id: receipt.invoiceId,
          student_id: receipt.studentId,
          landlord_id: receipt.landlordId,
          property_id: receipt.propertyId || '',
          storage_path: receipt.fileUrl,
          file_name: receipt.fileName,
          file_size: receipt.fileSize,
          payment_reference: receipt.paymentReference,
          payer_bank_name: receipt.payerBankName,
          amount_paid: receipt.amountPaid,
          status: 'pending_review',
        })
        .then(() => {});
    }
    return receipt;
  }

  public override sendMessage(
    conversationId: string,
    senderId: string,
    text: string,
    options?: {
      replyTo?: MessageReplyReference;
      mentions?: MessageMention[];
    }
  ): ChatMessage {
    const msg = super.sendMessage(conversationId, senderId, text, options);
    const supabase = getSupabaseClient();
    if (supabase) {
      supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: senderId,
          text: msg.text,
          status: 'sent',
          reply_to: options?.replyTo || null,
          mentions: options?.mentions || null,
        })
        .then(() => {});
    }
    return msg;
  }

  public override createNotification(
    data: Omit<AppNotification, 'id' | 'createdAt' | 'isRead'>
  ): AppNotification {
    const notif = super.createNotification(data);
    const supabase = getSupabaseClient();
    if (supabase) {
      supabase
        .from('notifications')
        .insert({
          user_id: notif.userId,
          title: notif.title,
          message: notif.message,
          type: notif.type,
          is_read: false,
          link: notif.link || null,
        })
        .then(() => {});
    }
    return notif;
  }
}
