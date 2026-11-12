/**
 * @file supabaseRepository.ts
 * @module infrastructure/supabase/supabaseRepository
 * @description Authoritative data repository implementation backed by Supabase PostgreSQL tables and Edge Functions.
 *
 * Architecture Role:
 * - Implements `IRepository` contract used by all application services (`authService`, `propertyService`, etc.).
 * - Synchronizes domain entities across 23 Supabase PostgreSQL tables:
 *   `profiles`, `student_profiles`, `student_verification_documents`, `landlord_profiles`,
 *   `landlord_verification_submissions`, `properties`, `units`, `property_locations`,
 *   `roommate_preferences`, `roommate_requests`, `accommodation_groups`, `group_members`,
 *   `group_invitations`, `group_join_requests`, `reservations`, `invoices`, `payment_receipts`,
 *   `conversations`, `conversation_participants`, `messages`, `notifications`, `audit_logs`, `platform_settings`.
 * - Maintains an in-memory cache for synchronous UI performance with optimistic local writes and remote PostgreSQL sync.
 * - Production Discipline: In production (`IS_PROD`), silent fallback to browser `localStorage` or mock data is strictly prohibited.
 * - Realtime Channels: Subscribes to Supabase Realtime for instant messaging and notification delivery.
 */

import { supabase, invokeEdgeFunction, isSupabaseConfigured } from './supabaseClient';
import { supabaseStorageService } from './supabaseStorageService';
import { appEventBus } from '../events/eventBus';
import { calculateCompatibility, CompatibilityResult } from '../../domain/matching';
import { encodeGeohash } from '../../domain/geoUtils';
import {
  User,
  StudentProfile,
  StudentVerificationDocument,
  StudentDocumentType,
  VerificationReviewStatus,
  LandlordProfile,
  Property,
  PropertyLocation,
  UnitOrRoom,
  RoommatePreference,
  RoommateRequest,
  AccommodationGroup,
  GroupInvitation,
  GroupJoinRequest,
  Reservation,
  Invoice,
  PaymentReceipt,
  AppNotification,
  Conversation,
  ConversationParticipant,
  ChatMessage,
  MessageReplyReference,
  MessageMention,
  AuditLog,
  PublicProfile,
} from '../../domain/types';

const IS_PROD = Boolean((import.meta as any)?.env?.PROD);

/**
 * In-memory synchronized repository for domain entities backed by Supabase PostgreSQL.
 */
export class SupabaseRepository {
  private isLiveInitialized = false;
  private activeUserId: string = '';

  // In-memory cache synced with Supabase PostgreSQL tables
  private users: User[] = [];
  private studentProfiles: StudentProfile[] = [];
  private studentDocs: StudentVerificationDocument[] = [];
  private landlordProfiles: LandlordProfile[] = [];
  private properties: Property[] = [];
  private propertyLocations: PropertyLocation[] = [];
  private roommatePreferences: RoommatePreference[] = [];
  private roommateRequests: RoommateRequest[] = [];
  private groups: AccommodationGroup[] = [];
  private invitations: GroupInvitation[] = [];
  private joinRequests: GroupJoinRequest[] = [];
  private reservations: Reservation[] = [];
  private invoices: Invoice[] = [];
  private receipts: PaymentReceipt[] = [];
  private notifications: AppNotification[] = [];
  private conversations: Conversation[] = [];
  private messages: Record<string, ChatMessage[]> = {};
  private auditLogs: AuditLog[] = [];

  constructor() {
    // Only pre-load synthetic test users in non-production Node test runners (never in browser/production).
    if (!IS_PROD && typeof window === 'undefined') {
      this.loadSeedProfiles();
    }
    if (typeof window !== 'undefined') {
      this.init().catch((err) => console.warn('[SupabaseRepository] Initialization notice:', err));
    }
  }

  private loadSeedProfiles(): void {
    this.users = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        email: 'student1@outpost.edu.ng',
        fullName: 'Amina Garba',
        role: 'student',
        accountStatus: 'active',
        emailVerified: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        email: 'student2@outpost.edu.ng',
        fullName: 'Ibrahim Musa',
        role: 'student',
        accountStatus: 'active',
        emailVerified: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        email: 'landlord1@outpost.ng',
        fullName: 'Alhaji Sani Bello',
        role: 'landlord',
        accountStatus: 'active',
        emailVerified: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        email: 'landlord2@outpost.ng',
        fullName: 'Hajiya Fatima Umar',
        role: 'landlord',
        accountStatus: 'active',
        emailVerified: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: '55555555-5555-4555-8555-555555555555',
        email: 'admin@outpost.edu.ng',
        fullName: 'Platform Moderator',
        role: 'admin',
        accountStatus: 'active',
        emailVerified: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: '00000000-0000-4000-8000-000000000001',
        email: 'ethoppaofficial@gmail.com',
        fullName: 'System Administrator',
        role: 'admin',
        accountStatus: 'active',
        emailVerified: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];

    this.studentProfiles = [
      {
        userId: '11111111-1111-4111-8111-111111111111',
        fullName: 'Amina Garba',
        phone: '+234 803 000 1111',
        institutionName: 'Bayero University Kano',
        university: 'Bayero University Kano',
        campus: 'New Campus',
        programme: 'B.Sc. Software Engineering',
        studyLevel: 'Undergraduate (Year 3)',
        registrationNumber: 'CST/22/SWE/00142',
        gender: 'Female',
        preferredLocation: 'Dambare',
        isProfileVerified: true,
      },
      {
        userId: '22222222-2222-4222-8222-222222222222',
        fullName: 'Ibrahim Musa',
        phone: '+234 803 000 2222',
        institutionName: 'Bayero University Kano',
        university: 'Bayero University Kano',
        campus: 'New Campus',
        programme: 'B.Eng. Civil Engineering',
        studyLevel: 'Undergraduate (Year 4)',
        registrationNumber: 'ENG/21/CVE/00088',
        gender: 'Male',
        preferredLocation: 'Rimin Gata',
        isProfileVerified: true,
      },
    ];

    this.landlordProfiles = [
      {
        userId: '33333333-3333-4333-8333-333333333333',
        legalName: 'Alhaji Sani Bello',
        businessName: 'Bello Danbare Executive Properties',
        phone: '+234 803 123 4567',
        contactAddress: 'Danbare Near Gate 2, Kano',
        idType: 'National ID (NIN)',
        idReference: 'NIN-33333333',
        verificationStatus: 'approved',
      },
      {
        userId: '44444444-4444-4444-8444-444444444444',
        legalName: 'Hajiya Fatima Umar',
        businessName: 'Umar Rimin Gata Lodge Suites',
        phone: '+234 802 987 6543',
        contactAddress: 'Rimin Gata Road, Kano',
        idType: 'National ID (NIN)',
        idReference: 'NIN-44444444',
        verificationStatus: 'approved',
      },
    ];

    const seedGroupId = 'g1111111-1111-4111-8111-111111111111';
    const seedGroup: AccommodationGroup = {
      id: seedGroupId,
      name: 'Danbare Tech Cohort',
      description: 'BUK Computer Science & Engineering students pooling together for a vetted lodge in Danbare.',
      ownerId: '11111111-1111-4111-8111-111111111111',
      ownerName: 'Amina Garba',
      leaderId: '11111111-1111-4111-8111-111111111111',
      leaderName: 'Amina Garba',
      adminIds: ['11111111-1111-4111-8111-111111111111'],
      memberIds: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'],
      members: [
        {
          userId: '11111111-1111-4111-8111-111111111111',
          name: 'Amina Garba',
          role: 'owner',
          status: 'active',
          joinedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          userId: '22222222-2222-4222-8222-222222222222',
          name: 'Ibrahim Musa',
          role: 'member',
          status: 'active',
          joinedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      maxCapacity: 4,
      status: 'active',
      visibility: 'discoverable',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    };
    this.groups = [seedGroup];

    this.conversations = [
      {
        id: 'c-group-danbare-tech',
        type: 'group',
        groupId: seedGroupId,
        title: 'Danbare Tech Cohort (Cohort)',
        name: 'Danbare Tech Cohort (Cohort)',
        participantIds: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'],
        participants: [
          { userId: '11111111-1111-4111-8111-111111111111', name: 'Amina Garba', role: 'student' },
          { userId: '22222222-2222-4222-8222-222222222222', name: 'Ibrahim Musa', role: 'student' },
        ],
        createdBy: '11111111-1111-4111-8111-111111111111',
        lastMessageText: 'Welcome to the cohort! Let us review the verified listings near Gate 2.',
        lastMessageAt: '2026-01-02T10:00:00.000Z',
        unreadCount: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T10:00:00.000Z',
      },
      {
        id: 'c-direct-landlord-sani',
        type: 'direct',
        title: 'Alhaji Sani Bello (Landlord)',
        name: 'Alhaji Sani Bello (Landlord)',
        participantIds: ['11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333'],
        participants: [
          { userId: '11111111-1111-4111-8111-111111111111', name: 'Amina Garba', role: 'student' },
          { userId: '33333333-3333-4333-8333-333333333333', name: 'Alhaji Sani Bello', role: 'landlord' },
        ],
        createdBy: '11111111-1111-4111-8111-111111111111',
        lastMessageText: 'Hello Amina, the property inspection for Danbare Lodge is scheduled for 3 PM.',
        lastMessageAt: '2026-01-03T11:00:00.000Z',
        unreadCount: 0,
        createdAt: '2026-01-03T10:00:00.000Z',
        updatedAt: '2026-01-03T11:00:00.000Z',
      },
      {
        id: 'c-direct-admin-support',
        type: 'direct',
        title: 'Platform Moderator (Support)',
        name: 'Platform Moderator (Support)',
        participantIds: ['11111111-1111-4111-8111-111111111111', '55555555-5555-4555-8555-555555555555'],
        participants: [
          { userId: '11111111-1111-4111-8111-111111111111', name: 'Amina Garba', role: 'student' },
          { userId: '55555555-5555-4555-8555-555555555555', name: 'Platform Moderator', role: 'admin' },
        ],
        createdBy: '55555555-5555-4555-8555-555555555555',
        lastMessageText: 'Welcome to OUTPOST BUK. Let us know if you need help with verification or reservations.',
        lastMessageAt: '2026-01-01T08:00:00.000Z',
        unreadCount: 0,
        createdAt: '2026-01-01T08:00:00.000Z',
        updatedAt: '2026-01-01T08:00:00.000Z',
      },
    ];

    this.messages = {
      'c-group-danbare-tech': [
        {
          id: 'm-group-1',
          conversationId: 'c-group-danbare-tech',
          senderId: '11111111-1111-4111-8111-111111111111',
          senderName: 'Amina Garba',
          senderRole: 'student',
          text: 'Hello Ibrahim! Thanks for joining the cohort.',
          status: 'sent',
          createdAt: '2026-01-02T09:50:00.000Z',
        },
        {
          id: 'm-group-2',
          conversationId: 'c-group-danbare-tech',
          senderId: '22222222-2222-4222-8222-222222222222',
          senderName: 'Ibrahim Musa',
          senderRole: 'student',
          text: 'Welcome to the cohort! Let us review the verified listings near Gate 2.',
          status: 'sent',
          createdAt: '2026-01-02T10:00:00.000Z',
        },
      ],
      'c-direct-landlord-sani': [
        {
          id: 'm-sani-1',
          conversationId: 'c-direct-landlord-sani',
          senderId: '11111111-1111-4111-8111-111111111111',
          senderName: 'Amina Garba',
          senderRole: 'student',
          text: 'Good day Alhaji, I am interested in viewing the 2-bedroom unit in Danbare.',
          status: 'sent',
          createdAt: '2026-01-03T10:00:00.000Z',
        },
        {
          id: 'm-sani-2',
          conversationId: 'c-direct-landlord-sani',
          senderId: '33333333-3333-4333-8333-333333333333',
          senderName: 'Alhaji Sani Bello',
          senderRole: 'landlord',
          text: 'Hello Amina, the property inspection for Danbare Lodge is scheduled for 3 PM.',
          status: 'sent',
          createdAt: '2026-01-03T11:00:00.000Z',
        },
      ],
      'c-direct-admin-support': [
        {
          id: 'm-admin-1',
          conversationId: 'c-direct-admin-support',
          senderId: '55555555-5555-4555-8555-555555555555',
          senderName: 'Platform Moderator',
          senderRole: 'admin',
          text: 'Welcome to OUTPOST BUK. Let us know if you need help with verification or reservations.',
          status: 'sent',
          createdAt: '2026-01-01T08:00:00.000Z',
        },
      ],
    };
  }

  public async init(): Promise<void> {
    if (this.isLiveInitialized) return;
    this.isLiveInitialized = true;

    try {
      // 1. Fetch active properties from Supabase PostgreSQL
      const { data: propsData, error: propsError } = await supabase
        .from('properties')
        .select(`
          id,
          landlord_id,
          title,
          description,
          property_type,
          rental_fee_annual,
          caution_deposit,
          service_charge,
          total_spaces,
          available_spaces,
          approval_status,
          is_published,
          featured_image_url,
          images,
          amenities,
          created_at,
          updated_at,
          property_locations (
            id,
            property_id,
            submitted_by,
            latitude,
            longitude,
            public_latitude,
            public_longitude,
            precision,
            verification_status,
            formatted_address
          ),
          units (
            id,
            property_id,
            name,
            unit_type,
            capacity,
            available_spaces,
            price_annual,
            is_active
          )
        `)
        .eq('is_published', true)
        .eq('approval_status', 'approved');

      if (!propsError && propsData) {
        this.properties = propsData.map((row: any) => {
          const loc = row.property_locations?.[0];
          const rooms: UnitOrRoom[] = (row.units || []).map((u: any) => ({
            id: u.id,
            propertyId: row.id,
            name: u.name,
            type: u.unit_type || 'self_contained',
            totalCapacity: u.capacity || 1,
            availableSpaces: u.available_spaces || 1,
            pricePerSession: Number(u.price_annual || row.rental_fee_annual || 250000),
          }));

          return {
            id: row.id,
            locationId: loc?.id || row.id,
            landlordId: row.landlord_id,
            landlordName: 'Verified Property Manager',
            landlordVerified: true,
            title: row.title,
            slug: row.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            description: row.description || '',
            propertyType: (row.property_type || 'self_contained') as any,
            accommodationType: 'off_campus' as any,
            genderPolicy: 'mixed' as any,
            address: loc?.formatted_address || 'Near BUK Gate 2, Dambare, Kano',
            city: 'Kano',
            neighbourhood: 'Dambare',
            campus: 'New Campus',
            university: 'Bayero University Kano',
            distanceKm: 0.8,
            pricePerSession: Number(row.rental_fee_annual || 250000),
            billingPeriod: 'Academic Session (1 Year)',
            depositAmount: Number(row.caution_deposit || 30000),
            utilitiesIncluded: true,
            amenities: Array.isArray(row.amenities) && row.amenities.length > 0 ? row.amenities : ['Electricity', 'Water', 'Gated Security'],
            houseRules: ['No loud music after 10PM'],
            images: Array.isArray(row.images) && row.images.length > 0
              ? row.images
              : (row.featured_image_url ? [row.featured_image_url] : []),
            totalCapacity: row.total_spaces || 10,
            availableSpaces: row.available_spaces || 8,
            verificationStatus: 'approved',
            isActive: row.is_published ?? true,
            rooms: rooms.length > 0 ? rooms : [
              {
                id: `unit-${row.id}-1`,
                propertyId: row.id,
                name: 'Deluxe Studio Block A-1',
                type: 'self_contained',
                totalCapacity: 1,
                availableSpaces: 1,
                pricePerSession: Number(row.rental_fee_annual || 250000),
              },
            ],
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          };
        });
      }

      // 2. Setup Realtime subscription on messages & newly added conversation memberships
      supabase
        .channel('public:messages')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages' },
          (payload) => {
            const row: any = payload.new;
            if (!row || !row.conversation_id) return;
            const conv = this.getConversationById(row.conversation_id);
            if (!conv && this.activeUserId) {
              // New conversation created remotely for this user: hydrate conversations & participants from Supabase
              this.hydrateUserConversationsAndMessages(this.activeUserId).catch(() => {});
              return;
            }
            const senderUser = this.getUserById(row.sender_id);
            const participant = conv?.participants?.find((p) => p.userId === row.sender_id);
            const msg: ChatMessage = {
              id: row.id,
              conversationId: row.conversation_id,
              senderId: row.sender_id,
              senderName: row.sender_name || participant?.name || senderUser?.fullName || 'User',
              senderRole: (row.sender_role as any) || participant?.role || senderUser?.role || 'student',
              text: row.text || row.content || '',
              status: 'sent',
              createdAt: row.created_at,
              ...(row.attachment
                ? {
                    attachment: {
                      storagePath: row.attachment.storage_path || row.attachment_url || '',
                      fileName: row.attachment.file_name || row.attachment_name || 'attachment',
                      contentType: row.attachment.content_type || row.attachment_type || 'application/octet-stream',
                      fileSize: row.attachment.file_size || row.attachment_size || 0,
                      uploadedBy: row.sender_id,
                      uploadedAt: row.created_at,
                    },
                  }
                : {}),
            };
            const currentList = this.messages[row.conversation_id] || [];
            if (!currentList.some((m) => m.id === msg.id)) {
              this.messages[row.conversation_id] = [...currentList, msg];
              if (conv) {
                conv.lastMessageText = msg.text;
                conv.lastMessageAt = msg.createdAt;
                conv.lastMessageTimestamp = msg.createdAt;
                if (msg.senderId !== this.activeUserId) {
                  conv.unreadCount = (conv.unreadCount || 0) + 1;
                }
              }
              appEventBus.publish('messageReceived', msg);
              appEventBus.publish(`chat:${row.conversation_id}`, msg);
              appEventBus.publish('conversationsUpdated', this.conversations);
            }
          }
        )
        .subscribe();

      // 3. Hydrate authenticated user's conversations, messages & portfolio when a session exists
      const { data: authData } = await supabase.auth.getUser();
      if (authData?.user?.id) {
        this.activeUserId = authData.user.id;
        await Promise.all([
          this.hydrateUserConversationsAndMessages(authData.user.id),
          this.hydrateUserSessionContext(authData.user.id),
        ]);
      }
    } catch (err) {
      console.warn('[SupabaseRepository] Live initialization notice:', err);
    }
  }

  public resetToSeed(): void {
    if (IS_PROD) {
      throw new Error('resetToSeed is not permitted in production runtime.');
    }
    this.loadSeedProfiles();
    this.studentProfiles = [];
    this.landlordProfiles = [];
    this.properties = [];
    this.reservations = [];
    this.invoices = [];
    this.receipts = [];
    this.notifications = [];
    this.conversations = [];
    this.messages = {};
    this.auditLogs = [];
    appEventBus.publish('userChanged', '');
  }

  // Auth & User Management
  public getUsers(): User[] {
    return [...this.users];
  }

  public getUserById(id: string): User | undefined {
    return this.users.find((u) => u.id === id);
  }

  public getUserByEmail(email: string): User | undefined {
    const normalized = email.trim().toLowerCase();
    return this.users.find((u) => u.email.toLowerCase() === normalized);
  }

  public createUser(user: User): User {
    const existingIdx = this.users.findIndex((u) => u.id === user.id);
    if (existingIdx >= 0) {
      this.users[existingIdx] = user;
    } else {
      this.users.push(user);
    }

    // Profile role and account_status are authoritatively initialized by the database trigger (handle_new_user).
    // The client only synchronizes mutable personal details.
    supabase
      .from('profiles')
      .update({
        full_name: user.fullName || user.email.split('@')[0],
        avatar_url: user.avatarUrl || null,
        phone: user.phone || null,
      })
      .eq('id', user.id)
      .then(({ error }) => {
        if (error) console.warn('[SupabaseRepository] createUser sync warning:', error.message);
      });

    return user;
  }

  public updateUser(user: User): User {
    this.users = this.users.map((u) => (u.id === user.id ? user : u));

    supabase
      .from('profiles')
      .update({
        full_name: user.fullName,
        avatar_url: user.avatarUrl,
        phone: user.phone,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)
      .then(({ error }) => {
        if (error) console.warn('[SupabaseRepository] updateUser sync warning:', error.message);
      });

    return user;
  }

  public getActiveUserId(): string {
    return this.activeUserId;
  }

  public setActiveUserId(userId: string): void {
    const changed = this.activeUserId !== userId;
    this.activeUserId = userId;
    appEventBus.publish('userChanged', userId);
    if (changed && userId && typeof window !== 'undefined') {
      this.hydrateUserConversationsAndMessages(userId).catch((err) =>
        console.warn('[SupabaseRepository] Chat hydration notice:', err?.message || err)
      );
      this.hydrateUserSessionContext(userId).catch((err) =>
        console.warn('[SupabaseRepository] Session context hydration notice:', err?.message || err)
      );
    }
  }

  private async hydrateUserSessionContext(userId: string): Promise<void> {
    if (!userId) return;
    try {
      const [{ data: landlordProps }, { data: groupRows }, { data: studentProf }, { data: landlordProf }] =
        await Promise.all([
          supabase
            .from('properties')
            .select(`
              id, landlord_id, title, description, property_type, rental_fee_annual,
              caution_deposit, service_charge, total_spaces, available_spaces,
              approval_status, is_published, featured_image_url, images, amenities,
              created_at, updated_at,
              property_locations (id, property_id, submitted_by, latitude, longitude, public_latitude, public_longitude, precision, verification_status, formatted_address),
              units (id, property_id, name, unit_type, capacity, available_spaces, price_annual, is_active)
            `)
            .eq('landlord_id', userId),
          supabase
            .from('accommodation_groups')
            .select('*, group_members(user_id, role, joined_at, profiles(full_name))')
            .eq('is_active', true),
          supabase.from('student_profiles').select('*').eq('user_id', userId).maybeSingle(),
          supabase.from('landlord_profiles').select('*').eq('user_id', userId).maybeSingle(),
        ]);

      if (Array.isArray(landlordProps) && landlordProps.length > 0) {
        const mappedProps: Property[] = landlordProps.map((row: any) => {
          const loc = row.property_locations?.[0];
          const rooms: UnitOrRoom[] = (row.units || []).map((u: any) => ({
            id: u.id,
            propertyId: row.id,
            name: u.name,
            type: u.unit_type || 'self_contained',
            totalCapacity: u.capacity || 1,
            availableSpaces: u.available_spaces ?? u.capacity ?? 1,
            pricePerSession: Number(u.price_annual || row.rental_fee_annual || 250000),
          }));
          return {
            id: row.id,
            locationId: loc?.id || row.id,
            landlordId: row.landlord_id,
            landlordName: this.getUserById(row.landlord_id)?.fullName || 'Property Host',
            landlordVerified: landlordProf?.verification_status === 'approved',
            title: row.title,
            slug: row.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            description: row.description || '',
            propertyType: (row.property_type || 'self_contained') as any,
            accommodationType: 'off_campus' as any,
            genderPolicy: 'mixed' as any,
            address: loc?.formatted_address || 'Near BUK Gate 2, Dambare, Kano',
            city: 'Kano',
            neighbourhood: 'Dambare',
            campus: 'New Campus',
            university: 'Bayero University Kano',
            distanceKm: 0.8,
            pricePerSession: Number(row.rental_fee_annual || 250000),
            billingPeriod: 'Academic Session (1 Year)',
            depositAmount: Number(row.caution_deposit || 30000),
            utilitiesIncluded: true,
            amenities: Array.isArray(row.amenities) ? row.amenities : [],
            houseRules: ['No loud music after 10PM'],
            images: Array.isArray(row.images) && row.images.length > 0
              ? row.images
              : (row.featured_image_url ? [row.featured_image_url] : []),
            totalCapacity: row.total_spaces || 1,
            availableSpaces: row.available_spaces ?? row.total_spaces ?? 1,
            verificationStatus: (row.approval_status || 'pending') as any,
            isActive: row.is_published ?? false,
            rooms,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          };
        });
        const existingOther = this.properties.filter((p) => p.landlordId !== userId);
        this.properties = [...mappedProps, ...existingOther];
      }

      if (Array.isArray(groupRows) && groupRows.length > 0) {
        this.groups = groupRows.map((g: any) => {
          const members = (g.group_members || []).map((gm: any) => ({
            userId: gm.user_id,
            name: gm.profiles?.full_name || 'Student',
            role: gm.user_id === g.leader_id ? 'owner' : (gm.role === 'admin' ? 'admin' : 'member'),
            status: 'active' as const,
            joinedAt: gm.joined_at || g.created_at,
          }));
          const memberIds = members.length > 0 ? members.map((m: any) => m.userId) : [g.leader_id];
          const adminIds = members
            .filter((m: any) => m.role === 'owner' || m.role === 'admin')
            .map((m: any) => m.userId);
          return {
            id: g.id,
            name: g.name,
            description: g.description || '',
            ownerId: g.leader_id,
            ownerName: members.find((m: any) => m.userId === g.leader_id)?.name || 'Leader',
            leaderId: g.leader_id,
            leaderName: members.find((m: any) => m.userId === g.leader_id)?.name || 'Leader',
            adminIds: adminIds.length > 0 ? adminIds : [g.leader_id],
            memberIds,
            members,
            maxCapacity: g.max_members || 4,
            targetPropertyId: g.target_property_id || undefined,
            status: g.is_active === false ? 'closed' : 'active',
            visibility: 'discoverable',
            createdAt: g.created_at,
            updatedAt: g.updated_at || g.created_at,
          };
        });
      }

      if (studentProf) {
        const userRecord = this.getUserById(userId);
        const sp: StudentProfile = {
          userId: studentProf.user_id,
          fullName: userRecord?.fullName || 'Student',
          phone: userRecord?.phone || '',
          institutionName: studentProf.institution || 'Bayero University Kano',
          university: studentProf.institution || 'Bayero University Kano',
          campus: studentProf.campus || 'New Campus',
          studyLevel: studentProf.study_level || 'Undergraduate (Year 1)',
          programme: userRecord?.programme || '',
          registrationNumber: studentProf.registration_number || '',
          gender: (studentProf.gender === 'female' ? 'Female' : studentProf.gender === 'male' ? 'Male' : 'Other'),
          preferredLocation: userRecord?.preferences?.preferredLocation || 'Dambare',
          isProfileVerified: Boolean(studentProf.is_profile_verified),
        };
        this.studentProfiles = [sp, ...this.studentProfiles.filter((p) => p.userId !== userId)];
      }

      if (landlordProf) {
        const lp: LandlordProfile = {
          userId: landlordProf.user_id,
          legalName: this.getUserById(userId)?.fullName || landlordProf.company_name || 'Landlord',
          businessName: landlordProf.company_name || '',
          phone: landlordProf.phone || '',
          contactAddress: landlordProf.business_address || '',
          idType: 'National ID (NIN)',
          idReference: '',
          verificationStatus: (landlordProf.verification_status as any) || 'not_started',
          rejectionReason: landlordProf.rejection_reason || undefined,
          verifiedAt: landlordProf.verified_at || undefined,
        };
        this.landlordProfiles = [lp, ...this.landlordProfiles.filter((p) => p.userId !== userId)];
      }
    } catch (err) {
      console.warn('[SupabaseRepository] Session context hydration error:', err);
    }
  }

  public clearActiveUserId(): void {
    this.activeUserId = '';
    appEventBus.publish('userChanged', '');
  }

  public clearActiveSession(): void {
    this.clearActiveUserId();
    this.notifications = [];
    this.receipts = [];
    this.reservations = [];
    this.invoices = [];
    this.messages = {};
    this.conversations = [];
    this.studentDocs = [];
    this.roommateRequests = [];
    this.invitations = [];
    this.joinRequests = [];
  }

  // Public Profiles
  public async getPublicProfile(userId: string): Promise<PublicProfile | null> {
    const user = this.getUserById(userId);
    if (user) {
      return {
        id: user.id,
        role: user.role,
        fullName: user.fullName || user.name || user.email,
        displayName: user.displayName || user.fullName || user.name,
        avatarUrl: user.avatarUrl,
        avatarPresetId: user.avatarPresetId,
        isVerified: Boolean(user.studentProfile?.isProfileVerified || user.landlordProfile?.verificationStatus === 'approved'),
        createdAt: user.createdAt,
        bio: user.bio,
        faculty: user.faculty,
        department: user.department,
        programme: user.programme,
        studyLevel: user.studyLevel,
        institution: user.institution,
        campus: user.campus,
        phone: user.phone,
        email: user.email,
        businessName: user.businessName,
        preferences: user.preferences,
      };
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, role, avatar_url, created_at')
      .eq('id', userId)
      .single();

    if (error || !data) return null;

    return {
      id: data.id,
      role: data.role as any,
      fullName: data.full_name,
      displayName: data.full_name,
      avatarUrl: data.avatar_url,
      isVerified: false,
      createdAt: data.created_at,
    };
  }

  public async savePublicProfile(profile: PublicProfile): Promise<void> {
    await supabase
      .from('profiles')
      .update({
        full_name: profile.fullName,
        avatar_url: profile.avatarUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', profile.id);
  }

  // Student Profiles & Verification Documents
  public getStudentProfiles(): StudentProfile[] {
    return [...this.studentProfiles];
  }

  public getStudentProfile(userId: string): StudentProfile | undefined {
    return this.studentProfiles.find((p) => p.userId === userId);
  }

  public saveStudentProfile(profile: StudentProfile): StudentProfile {
    const idx = this.studentProfiles.findIndex((p) => p.userId === profile.userId);
    if (idx >= 0) {
      this.studentProfiles[idx] = profile;
    } else {
      this.studentProfiles.push(profile);
    }

    supabase
      .from('student_profiles')
      .upsert(
        {
          user_id: profile.userId,
          institution: profile.institutionName || profile.university,
          campus: profile.campus,
          study_level: profile.studyLevel,
          registration_number: profile.registrationNumber,
          gender: profile.gender?.toLowerCase() || 'other',
          is_profile_verified: profile.isProfileVerified ?? false,
        },
        { onConflict: 'user_id' }
      )
      .then(({ error }) => {
        if (error) console.warn('[SupabaseRepository] saveStudentProfile warning:', error.message);
      });

    return profile;
  }

  public searchStudentByRegistrationNumber(regNumber: string): StudentProfile | undefined {
    const norm = regNumber.trim().toUpperCase();
    return this.studentProfiles.find((p) => p.registrationNumber?.toUpperCase() === norm);
  }

  public searchStudents(queryStr: string): StudentProfile[] {
    const q = queryStr.toLowerCase().trim();
    if (!q) return [];
    return this.studentProfiles.filter(
      (p) =>
        p.fullName?.toLowerCase().includes(q) ||
        p.registrationNumber?.toLowerCase().includes(q) ||
        p.university?.toLowerCase().includes(q) ||
        p.programme?.toLowerCase().includes(q)
    );
  }

  public getAllStudentDocs(): StudentVerificationDocument[] {
    return [...this.studentDocs];
  }

  public getStudentDocs(studentId?: string): StudentVerificationDocument[] {
    if (!studentId) return [...this.studentDocs];
    return this.studentDocs.filter((d) => d.studentId === studentId);
  }

  private mapStudentDocType(documentType: StudentDocumentType): string {
    return documentType === 'student_id'
      ? 'student_id_card'
      : documentType === 'school_fees_receipt'
      ? 'course_registration'
      : documentType;
  }

  public addStudentDocument(docData: {
    studentId: string;
    studentName: string;
    documentType: StudentDocumentType;
    fileName: string;
    fileSize: number;
    documentUrl: string;
    contentType?: string;
  }): StudentVerificationDocument {
    const newDoc: StudentVerificationDocument = {
      id: crypto.randomUUID(),
      studentId: docData.studentId,
      studentName: docData.studentName,
      documentType: docData.documentType,
      documentUrl: docData.documentUrl,
      fileName: docData.fileName,
      fileSize: docData.fileSize,
      status: 'pending',
      uploadedAt: new Date().toISOString(),
    };

    this.studentDocs.unshift(newDoc);

    const dbDocType = this.mapStudentDocType(newDoc.documentType);

    supabase
      .from('student_verification_documents')
      .insert({
        id: newDoc.id,
        student_id: newDoc.studentId,
        document_type: dbDocType,
        storage_path: newDoc.documentUrl || `${newDoc.studentId}/${newDoc.id}/${newDoc.fileName}`,
        file_name: newDoc.fileName,
        file_size: newDoc.fileSize || 1024,
        content_type: docData.contentType || 'application/pdf',
        status: 'pending',
      })
      .then(({ error }) => {
        if (error) console.warn('[SupabaseRepository] addStudentDocument warning:', error.message);
      });

    return newDoc;
  }

  /**
   * Awaited metadata persistence for student verification documents.
   * Throws on database/RLS failure so the caller can clean up the uploaded Storage object.
   */
  public async addStudentDocumentPersisted(docData: {
    studentId: string;
    studentName: string;
    documentType: StudentDocumentType;
    fileName: string;
    fileSize: number;
    documentUrl: string;
    contentType?: string;
  }): Promise<StudentVerificationDocument> {
    const newDoc: StudentVerificationDocument = {
      id: crypto.randomUUID(),
      studentId: docData.studentId,
      studentName: docData.studentName,
      documentType: docData.documentType,
      documentUrl: docData.documentUrl,
      fileName: docData.fileName,
      fileSize: docData.fileSize,
      status: 'pending',
      uploadedAt: new Date().toISOString(),
    };

    const dbDocType = this.mapStudentDocType(newDoc.documentType);
    const { data, error } = await supabase
      .from('student_verification_documents')
      .insert({
        id: newDoc.id,
        student_id: newDoc.studentId,
        document_type: dbDocType,
        storage_path: newDoc.documentUrl,
        file_name: newDoc.fileName,
        file_size: Math.max(1, Number(newDoc.fileSize || 1024)),
        content_type: docData.contentType || 'application/pdf',
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Could not record student verification document in Supabase: ${error.message}`);
    }

    const persisted: StudentVerificationDocument = {
      ...newDoc,
      id: data?.id || newDoc.id,
      uploadedAt: data?.created_at || newDoc.uploadedAt,
    };
    this.studentDocs = [persisted, ...this.studentDocs.filter((d) => d.id !== persisted.id)];
    return persisted;
  }

  public async fetchStudentDocumentsFromSupabase(studentId: string): Promise<StudentVerificationDocument[]> {
    const { data, error } = await supabase
      .from('student_verification_documents')
      .select('*')
      .eq('student_id', studentId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Could not load student verification documents: ${error.message}`);
    }

    const mapped: StudentVerificationDocument[] = (data || []).map((row: any) => {
      const domainType: StudentDocumentType =
        row.document_type === 'student_id_card'
          ? 'student_id'
          : row.document_type === 'course_registration'
          ? 'school_fees_receipt'
          : (row.document_type as StudentDocumentType);

      return {
        id: row.id,
        studentId: row.student_id,
        studentName: this.getStudentProfile(row.student_id)?.fullName || this.getUserById(row.student_id)?.fullName || 'Student',
        documentType: domainType,
        documentUrl: row.storage_path || '',
        fileName: row.file_name || 'document',
        fileSize: Number(row.file_size || 0),
        status: (row.status as VerificationReviewStatus) || 'pending',
        reviewerId: row.reviewer_id || undefined,
        reviewedAt: row.reviewed_at || undefined,
        rejectionReason: row.rejection_reason || undefined,
        uploadedAt: row.created_at,
      };
    });

    this.studentDocs = [
      ...mapped,
      ...this.studentDocs.filter((d) => d.studentId !== studentId),
    ];
    return mapped;
  }

  public reviewStudentDocument(
    docId: string,
    status: VerificationReviewStatus,
    reviewerId: string,
    rejectionReason?: string
  ): StudentVerificationDocument | undefined {
    let doc = this.studentDocs.find((d) => d.id === docId);
    const nowIso = new Date().toISOString();
    if (doc) {
      doc.status = status;
      doc.reviewerId = reviewerId;
      doc.reviewedAt = nowIso;
      doc.rejectionReason = rejectionReason;
    }

    supabase
      .from('student_verification_documents')
      .update({
        status: status,
        reviewer_id: reviewerId,
        reviewed_at: nowIso,
        rejection_reason: rejectionReason || null,
      })
      .eq('id', docId)
      .then(({ error }) => {
        if (error) console.warn('[SupabaseRepository] reviewStudentDocument warning:', error.message);
      });

    return doc;
  }

  // Landlord Profiles & Verification
  public getLandlordProfiles(): LandlordProfile[] {
    return [...this.landlordProfiles];
  }

  public getLandlordProfile(userId: string): LandlordProfile | undefined {
    return this.landlordProfiles.find((p) => p.userId === userId);
  }

  public saveLandlordProfile(profile: LandlordProfile): LandlordProfile {
    const idx = this.landlordProfiles.findIndex((p) => p.userId === profile.userId);
    if (idx >= 0) {
      this.landlordProfiles[idx] = profile;
    } else {
      this.landlordProfiles.push(profile);
    }

    supabase
      .from('landlord_profiles')
      .upsert(
        {
          user_id: profile.userId,
          company_name: profile.businessName || profile.legalName,
          business_address: profile.contactAddress,
        },
        { onConflict: 'user_id' }
      )
      .then(({ error }) => {
        if (error) console.warn('[SupabaseRepository] saveLandlordProfile warning:', error.message);
      });

    return profile;
  }

  private mapLandlordDocType(rawTypeInput: string): string {
    const rawType = rawTypeInput.toLowerCase();
    if (rawType.includes('passport')) return 'passport';
    if (rawType.includes('voter')) return 'voters_card';
    if (rawType.includes('deed') || rawType.includes('occupancy') || rawType.includes('assignment') || rawType.includes('allocation')) {
      return 'property_deed';
    }
    if (rawType.includes('utility') || rawType.includes('bill') || rawType.includes('electricity') || rawType.includes('nepa')) {
      return 'utility_bill';
    }
    if (rawType.includes('cac') || rawType.includes('business') || rawType.includes('corporate')) {
      return 'cac_certificate';
    }
    return 'national_id';
  }

  /**
   * Awaited landlord verification submission through atomic RPC (or safe sequential table writes).
   * Throws on DB error so orphaned storage files are removed cleanly.
   */
  public async submitLandlordVerificationPersisted(params: {
    profile: LandlordProfile;
    storagePath: string;
    fileName: string;
    fileSize: number;
    contentType: string;
    ownershipDocType?: string;
  }): Promise<LandlordProfile> {
    const { profile, storagePath, fileName, fileSize, contentType, ownershipDocType } = params;
    const dbDocType = this.mapLandlordDocType(ownershipDocType || profile.idType || 'national_id');

    const { error: rpcError } = await supabase.rpc('submit_landlord_verification_submission', {
      p_company_name: profile.businessName || profile.legalName,
      p_business_address: profile.contactAddress,
      p_document_type: dbDocType,
      p_storage_path: storagePath,
      p_file_name: fileName,
      p_file_size: Math.max(1, fileSize || 1024),
      p_content_type: contentType || 'application/pdf',
    });

    if (rpcError) {
      // If migration 07 RPC is not deployed yet, attempt direct submission insert before updating editable fields
      const { error: subError } = await supabase
        .from('landlord_verification_submissions')
        .insert({
          landlord_id: profile.userId,
          document_type: dbDocType,
          storage_path: storagePath,
          file_name: fileName,
          file_size: Math.max(1, fileSize || 1024),
          content_type: contentType || 'application/pdf',
          status: 'pending',
        });

      if (subError) {
        throw new Error(`Could not record landlord verification submission: ${subError.message}`);
      }

      const { error: lpError } = await supabase
        .from('landlord_profiles')
        .upsert(
          {
            user_id: profile.userId,
            company_name: profile.businessName || profile.legalName,
            business_address: profile.contactAddress,
            verification_status: 'pending',
          },
          { onConflict: 'user_id' }
        );

      if (lpError) {
        // Fallback when trigger blocks non-admin status update prior to migration 07: update company/address at least
        const { error: lpFallbackError } = await supabase
          .from('landlord_profiles')
          .update({
            company_name: profile.businessName || profile.legalName,
            business_address: profile.contactAddress,
          })
          .eq('user_id', profile.userId);
        if (lpFallbackError) {
          throw new Error(`Could not update landlord profile details: ${lpFallbackError.message}`);
        }
      }
    }

    const idx = this.landlordProfiles.findIndex((p) => p.userId === profile.userId);
    const updated: LandlordProfile = {
      ...profile,
      documentUrl: storagePath,
      verificationStatus: 'pending',
      submittedAt: new Date().toISOString(),
      rejectionReason: undefined,
    };
    if (idx >= 0) this.landlordProfiles[idx] = updated;
    else this.landlordProfiles.push(updated);

    return updated;
  }

  public reviewLandlordVerification(
    userId: string,
    status: 'approved' | 'rejected',
    adminId: string,
    notes?: string
  ): LandlordProfile | undefined {
    const profile = this.getLandlordProfile(userId);
    const nowIso = new Date().toISOString();
    if (profile) {
      profile.verificationStatus = status;
      profile.verifiedAt = nowIso;
      profile.rejectionReason = notes;
    }

    // Update landlord_profiles with correct column names (verified_by, verified_at)
    supabase
      .from('landlord_profiles')
      .update({
        verification_status: status,
        verified_by: adminId,
        verified_at: nowIso,
        rejection_reason: notes || null,
      })
      .eq('user_id', userId)
      .then(({ error }) => {
        if (error) console.warn('[SupabaseRepository] reviewLandlordVerification warning:', error.message);
      });

    // Also update landlord_verification_submissions
    supabase
      .from('landlord_verification_submissions')
      .update({
        status: status,
        reviewer_id: adminId,
        reviewed_at: nowIso,
        rejection_reason: notes || null,
      })
      .eq('landlord_id', userId)
      .then(({ error }) => {
        if (error) console.warn('[SupabaseRepository] reviewLandlordVerification submissions warning:', error.message);
      });

    return profile;
  }

  // Property Locations
  public getPropertyLocations(): PropertyLocation[] {
    return [...this.propertyLocations];
  }

  public getPropertyLocationByPropertyId(propertyId: string): PropertyLocation | undefined {
    return this.propertyLocations.find((l) => l.propertyId === propertyId);
  }

  public savePropertyLocation(loc: PropertyLocation): PropertyLocation {
    const hasCoords = Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude);
    const index = this.propertyLocations.findIndex((l) => l.propertyId === loc.propertyId);
    const updatedLoc: PropertyLocation = {
      ...loc,
      geohash: loc.geohash || (hasCoords ? encodeGeohash(loc.latitude, loc.longitude) : ''),
      updatedAt: new Date().toISOString(),
    };
    if (index >= 0) {
      this.propertyLocations[index] = updatedLoc;
    } else {
      this.propertyLocations.push(updatedLoc);
    }

    // Only write property_locations when numeric coordinates and submitted_by UUID exist (NOT NULL schema constraints)
    const submittedBy = loc.submittedBy || this.activeUserId;
    if (hasCoords && submittedBy) {
      supabase
        .from('property_locations')
        .upsert(
          {
            property_id: loc.propertyId,
            submitted_by: submittedBy,
            latitude: loc.latitude,
            longitude: loc.longitude,
            public_latitude: loc.publicLatitude ?? null,
            public_longitude: loc.publicLongitude ?? null,
            precision: loc.precision || 'nearby_building',
            verification_status: loc.verificationStatus === 'verified' ? 'approved' : (loc.verificationStatus || 'pending'),
            formatted_address: loc.formattedAddress || 'Kano State',
          },
          { onConflict: 'property_id' }
        )
        .then(({ error }) => {
          if (error) console.warn('[SupabaseRepository] savePropertyLocation warning:', error.message);
        });
    }

    return updatedLoc;
  }

  // Properties
  public getProperties(): Property[] {
    return [...this.properties];
  }

  public getPropertyById(id: string): Property | undefined {
    return this.properties.find((p) => p.id === id);
  }

  public getPropertyBySlug(slug: string): Property | undefined {
    return this.properties.find((p) => p.slug === slug);
  }

  private normalizePropertyType(raw: unknown): 'self_contained' | 'single_room' | 'flat' | 'shared_apartment' | 'hostel' {
    const v = String(raw || '').toLowerCase().trim();
    if (v.includes('self')) return 'self_contained';
    if (v.includes('single')) return 'single_room';
    if (v.includes('flat')) return 'flat';
    if (v.includes('shared')) return 'shared_apartment';
    return 'hostel';
  }

  private normalizeArea(raw: unknown): 'Dambare' | 'Rimin Gata' | 'Kano' | 'Other' {
    const v = String(raw || '').trim();
    if (v === 'Dambare' || v === 'Rimin Gata' || v === 'Kano' || v === 'Other') return v;
    if (v.toLowerCase().includes('rimin')) return 'Rimin Gata';
    if (v.toLowerCase().includes('damb')) return 'Dambare';
    return 'Dambare';
  }

  private isUuid(value: unknown): boolean {
    return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  public createProperty(prop: Property): Property {
    const validId = this.isUuid(prop.id) ? prop.id : crypto.randomUUID();
    const normalizedProp: Property = { ...prop, id: validId };
    this.properties.unshift(normalizedProp);
    if (normalizedProp.location) {
      this.savePropertyLocation({ ...normalizedProp.location, propertyId: validId });
    }

    supabase
      .from('properties')
      .insert({
        id: validId,
        landlord_id: normalizedProp.landlordId,
        title: normalizedProp.title,
        description: normalizedProp.description,
        address: normalizedProp.address || normalizedProp.neighbourhood || 'Dambare Corridor, Kano',
        landmark: normalizedProp.nearestLandmark || null,
        area: this.normalizeArea(normalizedProp.area || normalizedProp.neighbourhood),
        city: normalizedProp.city || 'Kano',
        state: 'Kano',
        country: 'Nigeria',
        property_type: this.normalizePropertyType(normalizedProp.propertyType),
        rental_fee_annual: Math.max(1, Number(normalizedProp.pricePerSession || 250000)),
        caution_deposit: Math.max(0, Number(normalizedProp.depositAmount || 0)),
        total_spaces: Math.max(1, Number(normalizedProp.totalCapacity || 1)),
        available_spaces: Math.max(0, Math.min(Number(normalizedProp.availableSpaces ?? normalizedProp.totalCapacity ?? 1), Math.max(1, Number(normalizedProp.totalCapacity || 1)))),
        featured_image_url: normalizedProp.images?.[0] || null,
        images: normalizedProp.images || [],
        amenities: normalizedProp.amenities || [],
        approval_status: 'pending',
        is_published: false,
      })
      .then(async ({ error }) => {
        if (error) {
          console.warn('[SupabaseRepository] createProperty warning:', error.message);
          return;
        }
        if (normalizedProp.rooms && normalizedProp.rooms.length > 0) {
          const unitsToInsert = normalizedProp.rooms.map((u) => ({
            id: this.isUuid(u.id) ? u.id : crypto.randomUUID(),
            property_id: validId,
            name: u.name,
            unit_type: u.type || 'room',
            capacity: Math.max(1, u.totalCapacity || 1),
            available_spaces: Math.max(0, u.availableSpaces ?? (u.totalCapacity || 1)),
            price_annual: Math.max(1, u.pricePerSession || normalizedProp.pricePerSession || 250000),
            is_active: true,
          }));

          const { error: unitsErr } = await supabase.from('units').insert(unitsToInsert);
          if (unitsErr) {
            console.warn('[SupabaseRepository] createProperty units insert warning:', unitsErr.message);
          }
        }
      });

    return normalizedProp;
  }

  /**
   * Awaited property submission for Landlord NewPropertyPage so DB/RLS failures surface cleanly to UI.
   */
  public async createPropertyPersisted(prop: Property): Promise<Property> {
    const validId = this.isUuid(prop.id) ? prop.id : crypto.randomUUID();
    const normalizedProp: Property = { ...prop, id: validId };

    const { error: propErr } = await supabase
      .from('properties')
      .insert({
        id: validId,
        landlord_id: normalizedProp.landlordId,
        title: normalizedProp.title,
        description: normalizedProp.description,
        address: normalizedProp.address || normalizedProp.neighbourhood || 'Dambare Corridor, Kano',
        landmark: normalizedProp.nearestLandmark || null,
        area: this.normalizeArea(normalizedProp.area || normalizedProp.neighbourhood),
        city: normalizedProp.city || 'Kano',
        state: 'Kano',
        country: 'Nigeria',
        property_type: this.normalizePropertyType(normalizedProp.propertyType),
        rental_fee_annual: Math.max(1, Number(normalizedProp.pricePerSession || 250000)),
        caution_deposit: Math.max(0, Number(normalizedProp.depositAmount || 0)),
        total_spaces: Math.max(1, Number(normalizedProp.totalCapacity || 1)),
        available_spaces: Math.max(0, Math.min(Number(normalizedProp.availableSpaces ?? normalizedProp.totalCapacity ?? 1), Math.max(1, Number(normalizedProp.totalCapacity || 1)))),
        featured_image_url: normalizedProp.images?.[0] || null,
        images: normalizedProp.images || [],
        amenities: normalizedProp.amenities || [],
        approval_status: 'pending',
        is_published: false,
      });

    if (propErr) {
      throw new Error(`Could not save property listing to Supabase: ${propErr.message}`);
    }

    if (normalizedProp.rooms && normalizedProp.rooms.length > 0) {
      const unitsToInsert = normalizedProp.rooms.map((u) => ({
        id: this.isUuid(u.id) ? u.id : crypto.randomUUID(),
        property_id: validId,
        name: u.name,
        unit_type: u.type || 'room',
        capacity: Math.max(1, u.totalCapacity || 1),
        available_spaces: Math.max(0, u.availableSpaces ?? (u.totalCapacity || 1)),
        price_annual: Math.max(1, u.pricePerSession || normalizedProp.pricePerSession || 250000),
        is_active: true,
      }));
      const { error: unitsErr } = await supabase.from('units').insert(unitsToInsert);
      if (unitsErr) {
        throw new Error(`Property created, but room inventory insert failed: ${unitsErr.message}`);
      }
    }

    if (normalizedProp.location && Number.isFinite(normalizedProp.location.latitude) && Number.isFinite(normalizedProp.location.longitude)) {
      this.savePropertyLocation({ ...normalizedProp.location, propertyId: validId });
    }

    this.properties.unshift(normalizedProp);
    return normalizedProp;
  }

  public updateProperty(prop: Property): Property {
    this.properties = this.properties.map((p) => (p.id === prop.id ? prop : p));

    supabase
      .from('properties')
      .update({
        title: prop.title,
        description: prop.description,
        rental_fee_annual: prop.pricePerSession,
        caution_deposit: prop.depositAmount,
        featured_image_url: prop.images?.[0] || null,
        images: prop.images || [],
        amenities: prop.amenities || [],
        total_spaces: prop.totalCapacity || prop.rooms?.reduce((acc, r) => acc + (r.totalCapacity || 1), 0),
        available_spaces: prop.availableSpaces ?? prop.rooms?.reduce((acc, r) => acc + (r.availableSpaces ?? r.totalCapacity ?? 1), 0),
        updated_at: new Date().toISOString(),
      })
      .eq('id', prop.id)
      .then(({ error }) => {
        if (error) console.warn('[SupabaseRepository] updateProperty warning:', error.message);
      });

    // Synchronize units / rooms if provided
    if (prop.rooms && prop.rooms.length > 0) {
      prop.rooms.forEach((u) => {
        const isSyntheticId = u.id.startsWith('room-') || u.id.startsWith('unit-');
        if (!isSyntheticId) {
          supabase
            .from('units')
            .upsert({
              id: u.id,
              property_id: prop.id,
              name: u.name,
              unit_type: u.type || 'room',
              capacity: u.totalCapacity || 1,
              available_spaces: u.availableSpaces ?? (u.totalCapacity || 1),
              price_annual: u.pricePerSession || prop.pricePerSession || 250000,
              is_active: (u.availableSpaces ?? 1) > 0,
            })
            .then(({ error }) => {
              if (error) console.warn('[SupabaseRepository] updateProperty unit upsert warning:', error.message);
            });
        }
      });
    }

    return prop;
  }

  public updatePropertyAvailability(propertyId: string, unitId: string, availableSpaces: number): void {
    const prop = this.getPropertyById(propertyId);
    if (!prop) return;
    const unit = prop.rooms?.find((u) => u.id === unitId);
    if (unit) {
      unit.availableSpaces = Math.max(0, availableSpaces);
    }
    this.updateProperty(prop);

    supabase
      .from('units')
      .update({
        available_spaces: Math.max(0, availableSpaces),
        is_active: availableSpaces > 0,
      })
      .eq('id', unitId)
      .then(({ error }) => {
        if (error) console.warn('[SupabaseRepository] updatePropertyAvailability warning:', error.message);
      });
  }

  // Roommate Preferences & Matching
  public getRoommatePreferences(): RoommatePreference[] {
    return [...this.roommatePreferences];
  }

  public getRoommatePreference(studentId: string): RoommatePreference | undefined {
    return this.roommatePreferences.find((p) => p.studentId === studentId);
  }

  public saveRoommatePreference(pref: RoommatePreference): RoommatePreference {
    const idx = this.roommatePreferences.findIndex((p) => p.studentId === pref.studentId);
    if (idx >= 0) {
      this.roommatePreferences[idx] = pref;
    } else {
      this.roommatePreferences.push(pref);
    }

    supabase
      .from('roommate_preferences')
      .upsert({
        student_id: pref.studentId,
        budget_min: pref.minBudget,
        budget_max: pref.maxBudget,
        preferred_area: pref.preferredNeighbourhoods || [],
        cleanliness_rating: 5,
        sleep_habit: pref.sleepSchedule,
        study_habit: pref.studyHabits,
        smoking_preference: pref.smoking,
      })
      .then(({ error }) => {
        if (error) console.warn('[SupabaseRepository] saveRoommatePreference warning:', error.message);
      });

    return pref;
  }

  public getSuggestedRoommates(studentId: string): Array<{
    student: StudentProfile;
    compatibility: CompatibilityResult;
    user: User;
  }> {
    const myPref = this.getRoommatePreference(studentId);
    const myProfile = this.getStudentProfile(studentId);
    if (!myPref || !myProfile) return [];

    const otherProfiles = this.studentProfiles.filter((p) => p.userId !== studentId);
    const results: Array<{ student: StudentProfile; compatibility: CompatibilityResult; user: User }> = [];

    for (const other of otherProfiles) {
      const otherPref = this.getRoommatePreference(other.userId);
      if (!otherPref) continue;
      const user = this.getUserById(other.userId);
      if (!user) continue;

      const comp = calculateCompatibility(myPref, otherPref);
      if (comp.score >= 50) {
        results.push({ student: other, compatibility: comp, user });
      }
    }

    return results.sort((a, b) => b.compatibility.score - a.compatibility.score);
  }

  public getRoommateRequests(userId: string): {
    received: RoommateRequest[];
    sent: RoommateRequest[];
  } {
    return {
      received: this.roommateRequests.filter((r) => r.receiverId === userId),
      sent: this.roommateRequests.filter((r) => r.senderId === userId),
    };
  }

  public sendRoommateRequest(senderId: string, receiverId: string, message: string): { success: boolean; request?: RoommateRequest; error?: string } {
    const senderProfile = this.getStudentProfile(senderId);
    const receiverProfile = this.getStudentProfile(receiverId);

    const req: RoommateRequest = {
      id: crypto.randomUUID(),
      senderId,
      senderName: senderProfile?.fullName || 'Student',
      senderRegNumber: senderProfile?.registrationNumber || '',
      receiverId,
      receiverName: receiverProfile?.fullName || 'Student',
      compatibilityScore: 80,
      message,
      note: message,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.roommateRequests.unshift(req);

    supabase
      .from('roommate_requests')
      .insert({
        id: req.id,
        sender_id: senderId,
        receiver_id: receiverId,
        message: message || '',
        status: 'pending',
      })
      .then(({ error }) => {
        if (error) console.warn('[SupabaseRepository] sendRoommateRequest warning:', error.message);
      });

    return { success: true, request: req };
  }

  public respondToRoommateRequest(requestId: string, status: 'accept' | 'reject' | 'cancel'): RoommateRequest | undefined {
    const req = this.roommateRequests.find((r) => r.id === requestId);
    if (!req) return undefined;
    req.status = status === 'accept' ? 'accepted' : status === 'reject' ? 'rejected' : 'cancelled';
    req.updatedAt = new Date().toISOString();

    supabase
      .from('roommate_requests')
      .update({
        status: req.status,
        updated_at: req.updatedAt,
      })
      .eq('id', requestId)
      .then(({ error }) => {
        if (error) console.warn('[SupabaseRepository] respondToRoommateRequest warning:', error.message);
      });

    return req;
  }

  // Accommodation Groups
  public getAccommodationGroups(): AccommodationGroup[] {
    return [...this.groups];
  }

  public getGroupsForUser(userId: string): AccommodationGroup[] {
    return this.groups.filter((g) => g.memberIds.includes(userId));
  }

  public getGroupById(id: string): AccommodationGroup | undefined {
    return this.groups.find((g) => g.id === id);
  }

  public updateGroup(group: AccommodationGroup): AccommodationGroup {
    this.groups = this.groups.map((g) => (g.id === group.id ? group : g));
    return group;
  }

  public syncGroupConversation(group: AccommodationGroup): Conversation {
    let conv = this.conversations.find((c) => c.groupId === group.id);
    const now = new Date().toISOString();
    const participants: ConversationParticipant[] = group.members.map((m) => {
      const u = this.getUserById(m.userId);
      return {
        userId: m.userId,
        name: m.name || u?.fullName || 'Cohort Member',
        role: (u?.role as any) || 'student',
      };
    });

    if (conv) {
      conv.title = `${group.name} (Cohort)`;
      conv.name = `${group.name} (Cohort)`;
      conv.participantIds = [...group.memberIds];
      conv.participants = participants;
      conv.updatedAt = now;
    } else {
      conv = {
        id: crypto.randomUUID(),
        type: 'group',
        groupId: group.id,
        title: `${group.name} (Cohort)`,
        name: `${group.name} (Cohort)`,
        participantIds: [...group.memberIds],
        participants,
        createdBy: group.leaderId,
        unreadCount: 0,
        createdAt: group.createdAt || now,
        updatedAt: now,
      };
      this.conversations.unshift(conv);

      supabase
        .from('conversations')
        .insert({
          id: conv.id,
          type: 'group',
          title: conv.title,
          group_id: group.id,
        })
        .then(async ({ error }) => {
          if (!error && conv) {
            // Insert group leader (auth.uid()) first so RLS is_conversation_participant passes for peer rows
            const orderedIds = [
              group.leaderId,
              ...conv.participantIds.filter((uid) => uid !== group.leaderId),
            ].filter(Boolean);
            for (const uid of orderedIds) {
              await supabase
                .from('conversation_participants')
                .upsert({ conversation_id: conv.id, user_id: uid }, { onConflict: 'conversation_id,user_id' });
            }
          }
        });
    }

    appEventBus.publish('conversationsUpdated', this.conversations);
    return conv;
  }

  public createGroup(
    name: string,
    description: string,
    leaderId: string,
    maxCapacity: number = 4,
    targetPropertyId?: string,
    visibility: 'discoverable' | 'invite_only' | 'request_required' = 'discoverable'
  ): AccommodationGroup {
    const leaderProfile = this.getStudentProfile(leaderId);
    const leaderName = leaderProfile?.fullName || 'Group Leader';
    const now = new Date().toISOString();

    const group: AccommodationGroup = {
      id: crypto.randomUUID(),
      name,
      description,
      ownerId: leaderId,
      ownerName: leaderName,
      leaderId,
      leaderName,
      adminIds: [leaderId],
      memberIds: [leaderId],
      members: [
        {
          userId: leaderId,
          name: leaderName,
          role: 'owner',
          status: 'active',
          joinedAt: now,
        },
      ],
      maxCapacity,
      targetPropertyId,
      status: 'active',
      visibility,
      createdAt: now,
      updatedAt: now,
    };
    this.groups.unshift(group);

    supabase
      .from('accommodation_groups')
      .insert({
        id: group.id,
        name: group.name,
        description: group.description,
        leader_id: leaderId,
        budget_per_member: 250000,
        target_area: 'Dambare',
        target_property_id: targetPropertyId || null,
        max_members: group.maxCapacity,
      })
      .then(async ({ error }) => {
        if (error) {
          console.warn('[SupabaseRepository] createGroup warning:', error.message);
          return;
        }
        await supabase
          .from('group_members')
          .upsert({ group_id: group.id, user_id: leaderId, role: 'admin' }, { onConflict: 'group_id,user_id' });
        this.syncGroupConversation(group);
      });

    return group;
  }

  public renameGroup(
    groupId: string,
    actorId: string,
    newName: string
  ): { success: boolean; error?: string; group?: AccommodationGroup } {
    const group = this.getGroupById(groupId);
    if (!group) return { success: false, error: 'Group not found.' };
    const isAdmin = group.adminIds?.includes(actorId) || group.leaderId === actorId;
    if (!isAdmin) return { success: false, error: 'Only group admins can rename the group.' };

    const trimmed = newName.trim();
    if (!trimmed) return { success: false, error: 'Group name cannot be empty.' };

    group.name = trimmed;
    group.updatedAt = new Date().toISOString();
    this.updateGroup(group);
    this.syncGroupConversation(group);
    return { success: true, group };
  }

  public promoteMemberToAdmin(
    groupId: string,
    actorId: string,
    targetUserId: string
  ): { success: boolean; error?: string } {
    const group = this.getGroupById(groupId);
    if (!group) return { success: false, error: 'Group not found.' };
    const isAdmin = group.adminIds?.includes(actorId) || group.leaderId === actorId;
    if (!isAdmin) return { success: false, error: 'Only group admins can promote members.' };

    if (!group.memberIds.includes(targetUserId)) {
      return { success: false, error: 'User is not a member of this group.' };
    }

    if (!group.adminIds?.includes(targetUserId)) {
      group.adminIds = [...(group.adminIds || [group.leaderId]), targetUserId];
    }
    const member = group.members.find((m) => m.userId === targetUserId);
    if (member) member.role = 'admin';

    group.updatedAt = new Date().toISOString();
    this.updateGroup(group);
    return { success: true };
  }

  public demoteAdmin(
    groupId: string,
    actorId: string,
    targetUserId: string
  ): { success: boolean; error?: string } {
    const group = this.getGroupById(groupId);
    if (!group) return { success: false, error: 'Group not found.' };
    const isAdmin = group.adminIds?.includes(actorId) || group.leaderId === actorId;
    if (!isAdmin) return { success: false, error: 'Only group admins can demote admins.' };

    if (targetUserId === group.leaderId) {
      return { success: false, error: 'The group creator cannot be demoted.' };
    }

    group.adminIds = (group.adminIds || [group.leaderId]).filter((id) => id !== targetUserId);
    const member = group.members.find((m) => m.userId === targetUserId);
    if (member) member.role = 'member';

    group.updatedAt = new Date().toISOString();
    this.updateGroup(group);
    return { success: true };
  }

  public removeMember(
    groupId: string,
    actorId: string,
    targetUserId: string
  ): { success: boolean; error?: string } {
    const group = this.getGroupById(groupId);
    if (!group) return { success: false, error: 'Group not found.' };
    const isAdmin = group.adminIds?.includes(actorId) || group.leaderId === actorId;
    if (!isAdmin) return { success: false, error: 'Only group admins can remove members.' };

    if (targetUserId === group.leaderId) {
      return { success: false, error: 'The group leader cannot be removed.' };
    }

    group.members = group.members.filter((m) => m.userId !== targetUserId);
    group.memberIds = group.memberIds.filter((id) => id !== targetUserId);
    group.adminIds = (group.adminIds || []).filter((id) => id !== targetUserId);
    group.updatedAt = new Date().toISOString();
    this.updateGroup(group);
    this.syncGroupConversation(group);
    return { success: true };
  }

  public leaveGroup(groupId: string, userId: string): { success: boolean; error?: string } {
    const group = this.getGroupById(groupId);
    if (!group) return { success: false, error: 'Group not found.' };
    if (!group.memberIds.includes(userId)) {
      return { success: false, error: 'You are not a member of this group.' };
    }

    if (group.leaderId === userId && group.memberIds.length > 1) {
      const nextLeader = group.memberIds.find((id) => id !== userId)!;
      group.leaderId = nextLeader;
      if (!group.adminIds?.includes(nextLeader)) {
        group.adminIds = [...(group.adminIds || []), nextLeader];
      }
    }

    group.members = group.members.filter((m) => m.userId !== userId);
    group.memberIds = group.memberIds.filter((id) => id !== userId);
    group.adminIds = (group.adminIds || []).filter((id) => id !== userId);
    group.updatedAt = new Date().toISOString();
    this.updateGroup(group);
    this.syncGroupConversation(group);
    return { success: true };
  }

  public joinGroup(
    groupId: string,
    userId: string
  ): { success: boolean; error?: string; pendingApproval?: boolean } {
    const group = this.getGroupById(groupId);
    if (!group) return { success: false, error: 'Group not found.' };
    if (group.memberIds.includes(userId)) {
      return { success: false, error: 'You are already a member of this group.' };
    }
    if (group.memberIds.length >= group.maxCapacity) {
      return { success: false, error: 'This group has reached its maximum capacity.' };
    }
    if (group.visibility === 'request_required') {
      return this.requestToJoinGroup(groupId, userId);
    }
    const user = this.getUserById(userId);
    group.members.push({
      userId,
      name: user?.fullName || 'Member',
      role: 'member',
      status: 'active',
      joinedAt: new Date().toISOString(),
    });
    group.memberIds.push(userId);
    group.updatedAt = new Date().toISOString();
    this.updateGroup(group);
    this.syncGroupConversation(group);
    return { success: true };
  }

  public requestToJoinGroup(
    groupId: string,
    userId: string
  ): { success: boolean; error?: string; pendingApproval?: boolean } {
    const group = this.getGroupById(groupId);
    if (!group) return { success: false, error: 'Group not found.' };
    const user = this.getUserById(userId);
    const student = this.getStudentProfile(userId);
    const req: GroupJoinRequest = {
      id: crypto.randomUUID(),
      groupId,
      userId,
      userName: student?.fullName || user?.fullName || 'Student',
      regNumber: student?.registrationNumber || '',
      status: 'pending',
      requestedAt: new Date().toISOString(),
    };
    this.joinRequests.unshift(req);
    return { success: true, pendingApproval: true };
  }

  public getGroupJoinRequests(groupId: string): GroupJoinRequest[] {
    return this.joinRequests.filter((r) => r.groupId === groupId && r.status === 'pending');
  }

  public respondToJoinRequest(
    requestId: string,
    actorId: string,
    action: 'approve' | 'reject'
  ): { success: boolean; error?: string } {
    const req = this.joinRequests.find((r) => r.id === requestId);
    if (!req) return { success: false, error: 'Join request not found.' };
    const group = this.getGroupById(req.groupId);
    if (!group) return { success: false, error: 'Group not found.' };
    req.status = action === 'approve' ? 'approved' : 'rejected';
    req.reviewedAt = new Date().toISOString();
    req.reviewedBy = actorId;
    if (action === 'approve' && !group.memberIds.includes(req.userId)) {
      this.joinGroup(req.groupId, req.userId);
    }
    return { success: true };
  }

  public inviteStudentToGroup(
    groupId: string,
    senderId: string,
    receiverId: string
  ): { success: boolean; error?: string } {
    const group = this.getGroupById(groupId);
    if (!group) return { success: false, error: 'Group not found.' };
    if (group.memberIds.includes(receiverId)) {
      return { success: false, error: 'Student is already a member of this group.' };
    }
    if (group.memberIds.length >= group.maxCapacity) {
      return { success: false, error: 'Group has already reached its maximum member capacity.' };
    }
    const sender = this.getStudentProfile(senderId);
    const inv: GroupInvitation = {
      id: crypto.randomUUID(),
      groupId,
      groupName: group.name,
      senderId,
      senderName: sender?.fullName || 'Group Leader',
      receiverId,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.invitations.unshift(inv);
    return { success: true };
  }

  public getPendingGroupInvitations(userId: string): GroupInvitation[] {
    return this.invitations.filter((i) => i.receiverId === userId && i.status === 'pending');
  }

  public respondToGroupInvitation(inviteId: string, action: 'accept' | 'reject'): boolean {
    const inv = this.invitations.find((i) => i.id === inviteId);
    if (!inv) return false;
    inv.status = action === 'accept' ? 'accepted' : 'rejected';
    if (action === 'accept') {
      this.joinGroup(inv.groupId, inv.receiverId);
    }
    return true;
  }

  // Reservations, Invoices & Receipts
  public getReservations(): Reservation[] {
    return [...this.reservations];
  }

  public getReservationsForStudent(studentId: string): Reservation[] {
    return this.reservations.filter((r) => r.studentId === studentId);
  }

  public getReservationsForLandlord(landlordId: string): Reservation[] {
    return this.reservations.filter((r) => r.landlordId === landlordId);
  }

  public getReservationById(id: string): Reservation | undefined {
    return this.reservations.find((r) => r.id === id);
  }

  public getInvoices(): Invoice[] {
    return [...this.invoices];
  }

  public getInvoiceById(id: string): Invoice | undefined {
    return this.invoices.find((i) => i.id === id);
  }

  public getInvoiceByReservationId(reservationId: string): Invoice | undefined {
    return this.invoices.find((i) => i.reservationId === reservationId);
  }

  public getPaymentReceipts(): PaymentReceipt[] {
    return [...this.receipts];
  }

  public getReceiptByReservationId(reservationId: string): PaymentReceipt | undefined {
    return this.receipts.find((r) => r.reservationId === reservationId);
  }

  public getPaymentReceiptsForLandlord(landlordId: string): PaymentReceipt[] {
    return this.receipts.filter((r) => r.landlordId === landlordId);
  }

  /**
   * Create reservation with 7-day hold, atomic availability update, and invoice creation.
   */
  public createReservation(
    studentId: string,
    propertyId: string,
    unitId: string,
    groupId?: string
  ): { success: boolean; reservation?: Reservation; invoice?: Invoice; error?: string } {
    const prop = this.getPropertyById(propertyId);
    if (!prop) return { success: false, error: 'Property not found.' };
    const unit = prop.rooms?.find((u) => u.id === unitId);
    if (!unit || unit.availableSpaces <= 0) return { success: false, error: 'Selected accommodation unit has no available spaces.' };

    const studentUser = this.getUserById(studentId);
    const now = new Date();
    const holdExpires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const resId = crypto.randomUUID();
    const invId = crypto.randomUUID();
    const resNum = `RES-2026-${Math.floor(1000 + Math.random() * 9000)}`;
    const invNum = `INV-2026-${Math.floor(1000 + Math.random() * 9000)}`;

    const newRes: Reservation = {
      id: resId,
      reservationNumber: resNum,
      studentId,
      studentName: studentUser?.fullName || 'Student',
      studentEmail: studentUser?.email || '',
      studentPhone: studentUser?.phone || '',
      landlordId: prop.landlordId,
      propertyId,
      propertyName: prop.title,
      propertyAddress: prop.address,
      unitId,
      unitName: unit.name,
      groupId,
      status: 'pending_payment',
      holdExpiresAt: holdExpires.toISOString(),
      amount: unit.pricePerSession,
      currency: 'NGN',
      createdAt: now.toISOString(),
    };

    const newInv: Invoice = {
      id: invId,
      invoiceNumber: invNum,
      reservationId: resId,
      studentId,
      studentName: studentUser?.fullName || 'Student',
      registrationNumber: '',
      university: 'Bayero University Kano',
      landlordName: prop.landlordName,
      propertyId,
      propertyName: prop.title,
      propertyTitle: prop.title,
      unitName: unit.name,
      roomName: unit.name,
      amount: unit.pricePerSession,
      totalAmount: unit.pricePerSession,
      currency: 'NGN',
      bankDetails: {
        bankName: 'First Bank Nigeria',
        accountName: prop.landlordName,
        accountNumber: '3012948571',
        paymentInstructions: `Include reservation reference ${resNum} in your transfer narration.`,
      },
      createdAt: now.toISOString(),
      dueDate: holdExpires.toISOString(),
      status: 'unpaid',
    };

    this.updatePropertyAvailability(propertyId, unitId, unit.availableSpaces - 1);
    this.reservations.unshift(newRes);
    this.invoices.unshift(newInv);

    // Call Supabase Edge Function asynchronously
    invokeEdgeFunction('create-reservation', {
      propertyId,
      unitId,
      groupId,
    }).catch((err) => console.warn('[SupabaseRepository] create-reservation edge function notice:', err));

    return { success: true, reservation: newRes, invoice: newInv };
  }

  public cancelReservation(reservationId: string, reason?: string): { success: boolean; message?: string } {
    const res = this.getReservationById(reservationId);
    if (!res) return { success: false, message: 'Reservation not found.' };
    if (res.status === 'confirmed') return { success: false, message: 'Cannot cancel confirmed reservation.' };

    res.status = 'cancelled';
    res.cancellationReason = reason;

    const prop = this.getPropertyById(res.propertyId);
    const unit = prop?.rooms?.find((u) => u.id === res.unitId);
    if (prop && unit) {
      this.updatePropertyAvailability(res.propertyId, res.unitId, unit.availableSpaces + 1);
    }

    const inv = this.getInvoiceByReservationId(reservationId);
    if (inv) inv.status = 'expired';

    supabase
      .from('reservations')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', reservationId)
      .then(({ error }) => {
        if (error) console.warn('[SupabaseRepository] cancelReservation warning:', error.message);
      });

    return { success: true, message: 'Reservation cancelled.' };
  }

  public uploadPaymentReceipt(data: {
    reservationId: string;
    studentId: string;
    fileUrl?: string;
    storagePath?: string;
    fileName?: string;
    fileSize?: number;
    paymentReference: string;
    payerBankName: string;
    paymentDate?: string;
    amountPaid: number;
    invoiceId?: string;
    landlordId?: string;
  }): { success: boolean; receipt?: PaymentReceipt; error?: string } {
    const res = this.getReservationById(data.reservationId);
    const prop = res ? this.getPropertyById(res.propertyId) : undefined;
    const resolvedLandlordId = data.landlordId || res?.landlordId || prop?.landlordId || '';

    const newReceipt: PaymentReceipt = {
      id: crypto.randomUUID(),
      reservationId: data.reservationId,
      invoiceId: data.invoiceId || res?.invoiceId || '',
      studentId: data.studentId,
      studentName: res?.studentName || 'Student',
      landlordId: resolvedLandlordId,
      propertyId: res?.propertyId || '',
      propertyName: res?.propertyName || prop?.title || 'Accommodation',
      amountPaid: data.amountPaid,
      paymentReference: data.paymentReference,
      payerBankName: data.payerBankName,
      paymentDate: data.paymentDate || new Date().toISOString(),
      fileUrl: data.fileUrl || '',
      storagePath: data.storagePath,
      fileName: data.fileName || 'receipt.pdf',
      fileSize: data.fileSize || 1024 * 100,
      status: 'pending_review',
      uploadedAt: new Date().toISOString(),
    };

    this.receipts.unshift(newReceipt);

    if (res) {
      res.status = 'receipt_submitted';
    }

    const inv = this.getInvoiceByReservationId(data.reservationId);
    if (inv) {
      inv.status = 'payment_submitted';
    }

    // Call Supabase Edge Function to record and finalize payment receipt
    invokeEdgeFunction('finalize-receipt-upload', {
      reservationId: data.reservationId,
      receiptId: newReceipt.id,
      storagePath: newReceipt.storagePath || `payment-receipts/${resolvedLandlordId}/${data.studentId}/${data.reservationId}/${newReceipt.fileName}`,
      fileName: newReceipt.fileName,
      contentType: 'application/pdf',
      fileSize: newReceipt.fileSize,
      amountPaid: newReceipt.amountPaid,
      paymentReference: newReceipt.paymentReference,
      payerBankName: newReceipt.payerBankName,
      paymentDate: newReceipt.paymentDate,
    }).catch((err) => console.warn('[SupabaseRepository] finalize-receipt-upload notice:', err));

    return { success: true, receipt: newReceipt };
  }

  public reviewPaymentReceipt(
    receiptId: string,
    decision: 'approved' | 'rejected',
    landlordId: string,
    rejectionReason?: string
  ): PaymentReceipt | undefined {
    const rc = this.receipts.find((r) => r.id === receiptId);
    if (!rc) return undefined;

    rc.status = decision;
    rc.reviewedBy = landlordId;
    rc.reviewedAt = new Date().toISOString();
    rc.rejectionReason = rejectionReason;

    const res = this.getReservationById(rc.reservationId);
    const inv = this.getInvoiceByReservationId(rc.reservationId);

    if (decision === 'approved') {
      if (res) res.status = 'confirmed';
      if (inv) inv.status = 'paid';
    } else {
      if (res) res.status = 'pending_payment';
      if (inv) inv.status = 'unpaid';
    }

    // Invoke Supabase Edge Function 'review-payment-receipt'
    invokeEdgeFunction('review-payment-receipt', {
      receiptId,
      decision,
      rejectionReason,
    }).catch((err) => console.warn('[SupabaseRepository] review-payment-receipt notice:', err));

    return rc;
  }

  public checkAndExpireReservations(): number {
    const now = new Date();
    let localExpired = 0;

    for (const r of this.reservations) {
      if (r.status === 'pending_payment' && r.holdExpiresAt && new Date(r.holdExpiresAt) < now) {
        r.status = 'expired';
        localExpired++;

        const prop = this.getPropertyById(r.propertyId);
        const unit = prop?.rooms?.find((u) => u.id === r.unitId);
        if (prop && unit) {
          this.updatePropertyAvailability(r.propertyId, r.unitId, unit.availableSpaces + 1);
        }

        const inv = this.getInvoiceByReservationId(r.id);
        if (inv) inv.status = 'expired';
      }
    }

    // Invoke Supabase Edge Function 'expire-reservations'
    invokeEdgeFunction('expire-reservations', {}).catch((err) =>
      console.warn('[SupabaseRepository] expire-reservations notice:', err)
    );

    return localExpired;
  }

  // Notifications
  public getNotifications(userId: string): AppNotification[] {
    return this.notifications.filter((n) => n.userId === userId);
  }

  public createNotification(data: Omit<AppNotification, 'id' | 'isRead' | 'createdAt'>): AppNotification {
    const notif: AppNotification = {
      ...data,
      id: crypto.randomUUID(),
      isRead: false,
      createdAt: new Date().toISOString(),
    };
    this.notifications.unshift(notif);

    supabase
      .from('notifications')
      .insert({
        id: notif.id,
        user_id: notif.userId,
        title: notif.title,
        message: notif.message,
        type: notif.type || 'info',
        is_read: false,
      })
      .then(({ error }) => {
        if (error) console.warn('[SupabaseRepository] createNotification warning:', error.message);
      });

    return notif;
  }

  public markNotificationAsRead(id: string): void {
    const notif = this.notifications.find((n) => n.id === id);
    if (notif) notif.isRead = true;

    supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)
      .then(({ error }) => {
        if (error) console.warn('[SupabaseRepository] markNotificationAsRead warning:', error.message);
      });
  }

  public markAllNotificationsAsRead(userId: string): void {
    this.notifications.forEach((n) => {
      if (n.userId === userId) n.isRead = true;
    });

    supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .then(({ error }) => {
        if (error) console.warn('[SupabaseRepository] markAllNotificationsAsRead warning:', error.message);
      });
  }

  // Messaging & Realtime Conversations
  public async hydrateUserConversationsAndMessages(userId: string): Promise<Conversation[]> {
    if (!userId) return [];

    const { data: partRows, error: partErr } = await supabase
      .from('conversation_participants')
      .select('conversation_id, last_read_at')
      .eq('user_id', userId);

    if (partErr) {
      throw new Error(`Unable to load conversations: ${partErr.message}`);
    }

    const conversationIds = Array.from(new Set((partRows || []).map((r: any) => r.conversation_id).filter(Boolean)));
    if (conversationIds.length === 0) {
      this.conversations = [];
      appEventBus.publish('conversationsUpdated', this.conversations);
      return [];
    }

    const lastReadByConv = new Map<string, string | null>(
      (partRows || []).map((r: any) => [r.conversation_id, r.last_read_at || null])
    );

    const [{ data: convRows, error: convErr }, { data: allPartRows, error: allPartErr }, { data: msgRows, error: msgErr }] =
      await Promise.all([
        supabase
          .from('conversations')
          .select('*')
          .in('id', conversationIds)
          .order('updated_at', { ascending: false }),
        supabase
          .from('conversation_participants')
          .select('conversation_id, user_id, last_read_at, profiles(id, full_name, email, role, avatar_url)')
          .in('conversation_id', conversationIds),
        supabase
          .from('messages')
          .select('*, profiles(id, full_name, email, role, avatar_url)')
          .in('conversation_id', conversationIds)
          .order('created_at', { ascending: true }),
      ]);

    if (convErr) throw new Error(`Unable to load conversation threads: ${convErr.message}`);
    if (allPartErr) throw new Error(`Unable to load conversation participants: ${allPartErr.message}`);
    if (msgErr) throw new Error(`Unable to load messages: ${msgErr.message}`);

    const participantsByConv = new Map<string, ConversationParticipant[]>();
    for (const p of allPartRows || []) {
      const prof: any = p.profiles;
      const participant: ConversationParticipant = {
        userId: p.user_id,
        name: prof?.full_name || prof?.email || 'User',
        avatarUrl: prof?.avatar_url || undefined,
        role: (prof?.role as any) || 'student',
        lastReadAt: p.last_read_at || undefined,
      };
      const existing = participantsByConv.get(p.conversation_id) || [];
      existing.push(participant);
      participantsByConv.set(p.conversation_id, existing);
    }

    const messagesByConv: Record<string, ChatMessage[]> = {};
    for (const row of msgRows || []) {
      const senderProf: any = row.profiles;
      const mapped: ChatMessage = {
        id: row.id,
        conversationId: row.conversation_id,
        senderId: row.sender_id,
        senderName: senderProf?.full_name || senderProf?.email || this.getUserById(row.sender_id)?.fullName || 'User',
        senderRole: (senderProf?.role as any) || this.getUserById(row.sender_id)?.role || 'student',
        text: row.text || '',
        status: 'sent',
        isEdited: Boolean(row.is_edited),
        editedAt: row.edited_at || undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at || row.created_at,
        ...(row.attachment
          ? {
              attachment: {
                storagePath: row.attachment.storage_path || row.attachment.storagePath || '',
                fileName: row.attachment.file_name || row.attachment.fileName || 'attachment',
                contentType: row.attachment.content_type || row.attachment.contentType || 'application/octet-stream',
                fileSize: Number(row.attachment.file_size || row.attachment.fileSize || 0),
                uploadedBy: row.sender_id,
                uploadedAt: row.created_at,
              },
            }
          : {}),
      };
      if (!messagesByConv[row.conversation_id]) {
        messagesByConv[row.conversation_id] = [];
      }
      messagesByConv[row.conversation_id].push(mapped);
    }

    const hydratedConversations: Conversation[] = (convRows || []).map((c: any) => {
      const participants = participantsByConv.get(c.id) || [];
      const peer = participants.find((p) => p.userId !== userId);
      const msgs = messagesByConv[c.id] || [];
      const lastMsg = msgs[msgs.length - 1];
      const lastReadAt = lastReadByConv.get(c.id);
      const unreadCount = msgs.filter(
        (m) => m.senderId !== userId && (!lastReadAt || new Date(m.createdAt).getTime() > new Date(lastReadAt).getTime())
      ).length;

      const resolvedTitle =
        c.type === 'group'
          ? c.title || 'Accommodation Cohort'
          : peer?.name || c.title || 'Direct Conversation';

      return {
        id: c.id,
        type: c.type || 'direct',
        title: resolvedTitle,
        name: resolvedTitle,
        groupId: c.group_id || undefined,
        participantIds: participants.map((p) => p.userId),
        participants,
        createdBy: userId,
        lastMessageText: c.last_message_text || lastMsg?.text || undefined,
        lastMessageAt: c.last_message_at || lastMsg?.createdAt || undefined,
        lastMessageTimestamp: c.last_message_at || lastMsg?.createdAt || undefined,
        unreadCount,
        createdAt: c.created_at,
        updatedAt: c.updated_at || c.created_at,
      };
    });

    this.conversations = hydratedConversations;
    for (const [cid, list] of Object.entries(messagesByConv)) {
      this.messages[cid] = list;
    }

    appEventBus.publish('conversationsUpdated', this.conversations);
    return [...this.conversations];
  }

  public async fetchConversationMessagesFromSupabase(conversationId: string): Promise<ChatMessage[]> {
    if (!conversationId) return [];
    const { data, error } = await supabase
      .from('messages')
      .select('*, profiles(id, full_name, email, role, avatar_url)')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Unable to load conversation messages: ${error.message}`);
    }

    const mapped: ChatMessage[] = (data || []).map((row: any) => {
      const senderProf: any = row.profiles;
      return {
        id: row.id,
        conversationId: row.conversation_id,
        senderId: row.sender_id,
        senderName: senderProf?.full_name || senderProf?.email || this.getUserById(row.sender_id)?.fullName || 'User',
        senderRole: (senderProf?.role as any) || this.getUserById(row.sender_id)?.role || 'student',
        text: row.text || '',
        status: 'sent',
        isEdited: Boolean(row.is_edited),
        editedAt: row.edited_at || undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at || row.created_at,
        ...(row.attachment
          ? {
              attachment: {
                storagePath: row.attachment.storage_path || row.attachment.storagePath || '',
                fileName: row.attachment.file_name || row.attachment.fileName || 'attachment',
                contentType: row.attachment.content_type || row.attachment.contentType || 'application/octet-stream',
                fileSize: Number(row.attachment.file_size || row.attachment.fileSize || 0),
                uploadedBy: row.sender_id,
                uploadedAt: row.created_at,
              },
            }
          : {}),
      };
    });

    this.messages[conversationId] = mapped;
    return mapped;
  }

  public async searchProfilesForChat(
    queryStr: string,
    excludeUserId: string
  ): Promise<Array<{ id: string; fullName: string; email: string; role: string }>> {
    const clean = queryStr.trim();
    if (!clean) return [];

    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, role, account_status')
      .neq('id', excludeUserId)
      .neq('account_status', 'suspended')
      .or(`full_name.ilike.%${clean.replace(/[,%()]/g, '')}%,email.ilike.%${clean.replace(/[,%()]/g, '')}%`)
      .limit(20);

    if (error) {
      throw new Error(`Unable to search platform users: ${error.message}`);
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      fullName: row.full_name || row.email || 'User',
      email: row.email || '',
      role: row.role || 'student',
    }));
  }

  public getConversations(userId: string): Conversation[] {
    return this.conversations.filter((c) => c.participantIds.includes(userId));
  }

  public getConversationById(id: string): Conversation | undefined {
    return this.conversations.find((c) => c.id === id);
  }

  public getMessages(conversationId: string): ChatMessage[] {
    return this.messages[conversationId] || [];
  }

  public sendMessage(
    conversationId: string,
    senderId: string,
    text: string,
    options?: {
      replyTo?: MessageReplyReference;
      mentions?: MessageMention[];
      attachment?: {
        storagePath: string;
        fileName: string;
        contentType: string;
        fileSize: number;
        uploadedBy: string;
        uploadedAt: string;
      };
    }
  ): ChatMessage {
    const sender = this.getUserById(senderId);
    const conv = this.getConversationById(conversationId);
    const participant = conv?.participants?.find((p) => p.userId === senderId);
    const nowIso = new Date().toISOString();

    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      conversationId,
      senderId,
      senderName: sender?.fullName || participant?.name || 'User',
      senderRole: sender?.role || participant?.role || 'student',
      text,
      status: 'sent',
      createdAt: nowIso,
      replyTo: options?.replyTo,
      mentions: options?.mentions,
      attachment: options?.attachment,
    };

    if (!this.messages[conversationId]) {
      this.messages[conversationId] = [];
    }
    this.messages[conversationId].push(msg);

    const previewText = text || (options?.attachment ? `[Attachment: ${options.attachment.fileName}]` : '');
    if (conv) {
      conv.lastMessageText = previewText;
      conv.lastMessageAt = msg.createdAt;
      conv.lastMessageTimestamp = msg.createdAt;
      conv.updatedAt = msg.createdAt;
    }

    appEventBus.publish('messageReceived', msg);
    appEventBus.publish(`chat:${conversationId}`, msg);
    appEventBus.publish('conversationsUpdated', this.conversations);

    const dbAttachment = options?.attachment
      ? {
          storage_path: options.attachment.storagePath,
          file_name: options.attachment.fileName,
          content_type: options.attachment.contentType,
          file_size: options.attachment.fileSize,
          uploaded_by: options.attachment.uploadedBy,
          uploaded_at: options.attachment.uploadedAt,
        }
      : null;

    supabase
      .from('messages')
      .insert({
        id: msg.id,
        conversation_id: conversationId,
        sender_id: senderId,
        text: text,
        attachment: dbAttachment,
      })
      .then(async ({ error }) => {
        if (error) {
          msg.status = 'failed';
          msg.deliveryError = error.message;
          appEventBus.publish(`chat:${conversationId}`, { ...msg });
          console.warn('[SupabaseRepository] sendMessage warning:', error.message);
        } else {
          await supabase
            .from('conversations')
            .update({
              last_message_text: previewText,
              last_message_at: nowIso,
              updated_at: nowIso,
            })
            .eq('id', conversationId);
        }
      });

    return msg;
  }

  public recordAttachmentMessage(
    conversationId: string,
    senderId: string,
    messageId: string,
    text: string,
    attachment: {
      storagePath: string;
      fileName: string;
      contentType: string;
      fileSize: number;
      uploadedBy: string;
      uploadedAt: string;
    },
    createdAt?: string
  ): ChatMessage {
    const sender = this.getUserById(senderId);
    const conv = this.getConversationById(conversationId);
    const participant = conv?.participants?.find((p) => p.userId === senderId);
    const nowIso = createdAt || new Date().toISOString();

    const msg: ChatMessage = {
      id: messageId,
      conversationId,
      senderId,
      senderName: sender?.fullName || participant?.name || 'User',
      senderRole: sender?.role || participant?.role || 'student',
      text,
      status: 'sent',
      createdAt: nowIso,
      attachment,
    };

    const currentList = this.messages[conversationId] || [];
    if (!currentList.some((m) => m.id === msg.id)) {
      this.messages[conversationId] = [...currentList, msg];
    }

    if (conv) {
      conv.lastMessageText = text;
      conv.lastMessageAt = msg.createdAt;
      conv.lastMessageTimestamp = msg.createdAt;
      conv.updatedAt = msg.createdAt;
    }

    appEventBus.publish('messageReceived', msg);
    appEventBus.publish(`chat:${conversationId}`, msg);
    appEventBus.publish('conversationsUpdated', this.conversations);
    return msg;
  }

  public editMessage(
    messageId: string,
    userId: string,
    newText: string
  ): { success: boolean; error?: string; message?: ChatMessage } {
    let foundMsg: ChatMessage | undefined;
    for (const list of Object.values(this.messages)) {
      const target = list.find((m) => m.id === messageId);
      if (target) {
        foundMsg = target;
        break;
      }
    }

    if (!foundMsg) return { success: false, error: 'Message not found.' };
    if (foundMsg.senderId !== userId) return { success: false, error: 'You can only edit your own messages.' };

    const diffMinutes = (Date.now() - new Date(foundMsg.createdAt).getTime()) / (1000 * 60);
    if (diffMinutes > 15) return { success: false, error: 'Editing window of 15 minutes has expired.' };

    const trimmed = newText.trim();
    if (!trimmed) return { success: false, error: 'Edited message cannot be empty.' };

    foundMsg.text = trimmed;
    foundMsg.isEdited = true;
    foundMsg.editedAt = new Date().toISOString();
    appEventBus.publish(`chat:${foundMsg.conversationId}`, { ...foundMsg });

    supabase
      .from('messages')
      .update({
        text: trimmed,
        is_edited: true,
        edited_at: foundMsg.editedAt,
        updated_at: foundMsg.editedAt,
      })
      .eq('id', messageId)
      .then(({ error }) => {
        if (error) console.warn('[SupabaseRepository] editMessage warning:', error.message);
      });

    return { success: true, message: foundMsg };
  }

  public retryFailedMessage(
    messageId: string,
    userId: string
  ): { success: boolean; error?: string; message?: ChatMessage } {
    let foundMsg: ChatMessage | undefined;
    for (const list of Object.values(this.messages)) {
      const target = list.find((m) => m.id === messageId && m.senderId === userId);
      if (target) {
        foundMsg = target;
        break;
      }
    }

    if (!foundMsg) return { success: false, error: 'Message not found.' };
    foundMsg.status = 'sent';
    foundMsg.deliveryError = undefined;

    supabase
      .from('messages')
      .insert({
        id: foundMsg.id,
        conversation_id: foundMsg.conversationId,
        sender_id: foundMsg.senderId,
        text: foundMsg.text,
        attachment: foundMsg.attachment
          ? {
              storage_path: foundMsg.attachment.storagePath,
              file_name: foundMsg.attachment.fileName,
              content_type: foundMsg.attachment.contentType,
              file_size: foundMsg.attachment.fileSize,
            }
          : null,
      })
      .then(({ error }) => {
        if (error && foundMsg) {
          foundMsg.status = 'failed';
          foundMsg.deliveryError = error.message;
          appEventBus.publish(`chat:${foundMsg.conversationId}`, { ...foundMsg });
        }
      });

    return { success: true, message: foundMsg };
  }

  public markMessagesAsRead(conversationId: string, userId: string): void {
    const conv = this.getConversationById(conversationId);
    if (conv && conv.unreadCount !== 0) {
      conv.unreadCount = 0;
      appEventBus.publish('conversationsUpdated', this.conversations);
    }

    if (userId) {
      const nowIso = new Date().toISOString();
      supabase
        .from('conversation_participants')
        .update({ last_read_at: nowIso })
        .eq('conversation_id', conversationId)
        .eq('user_id', userId)
        .then(({ error }) => {
          if (error) console.warn('[SupabaseRepository] markMessagesAsRead warning:', error.message);
        });
    }
  }

  public searchMessages(conversationId: string, queryStr: string): ChatMessage[] {
    const q = queryStr.toLowerCase().trim();
    if (!q) return [];
    return (this.messages[conversationId] || []).filter((m) => m.text.toLowerCase().includes(q));
  }

  public toggleMuteConversation(conversationId: string, _userId: string): boolean {
    const conv = this.getConversationById(conversationId);
    if (!conv) return false;
    conv.isMuted = !conv.isMuted;
    return conv.isMuted;
  }

  public archiveConversation(conversationId: string, _userId: string): boolean {
    const conv = this.getConversationById(conversationId);
    if (!conv) return false;
    conv.archivedAt = conv.archivedAt ? undefined : new Date().toISOString();
    return Boolean(conv.archivedAt);
  }

  public async startDirectConversationPersisted(
    userIdA: string,
    userIdB: string,
    peerProfile?: { fullName?: string; role?: string }
  ): Promise<Conversation> {
    const existing = this.conversations.find(
      (c) => c.type === 'direct' && c.participantIds.includes(userIdA) && c.participantIds.includes(userIdB)
    );
    if (existing) return existing;

    const userA = this.getUserById(userIdA);
    const userB = this.getUserById(userIdB);
    const title = peerProfile?.fullName || userB?.fullName || 'Direct Chat';
    const peerRole = (peerProfile?.role || userB?.role || 'student') as any;
    const myRole = (userA?.role || 'student') as any;
    const now = new Date().toISOString();

    const conv: Conversation = {
      id: crypto.randomUUID(),
      type: 'direct',
      title,
      name: title,
      participantIds: [userIdA, userIdB],
      participants: [
        { userId: userIdA, name: userA?.fullName || 'You', role: myRole },
        { userId: userIdB, name: title, role: peerRole },
      ],
      createdBy: userIdA,
      unreadCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    const { error: convErr } = await supabase.from('conversations').insert({
      id: conv.id,
      type: 'direct',
      title: conv.title,
    });

    if (convErr) {
      throw new Error(`Could not create conversation: ${convErr.message}`);
    }

    // Insert self (auth.uid()) FIRST so RLS is_conversation_participant passes when adding peer
    const { error: selfErr } = await supabase
      .from('conversation_participants')
      .upsert({ conversation_id: conv.id, user_id: userIdA }, { onConflict: 'conversation_id,user_id' });

    if (selfErr) {
      throw new Error(`Could not join conversation: ${selfErr.message}`);
    }

    const { error: peerErr } = await supabase
      .from('conversation_participants')
      .upsert({ conversation_id: conv.id, user_id: userIdB }, { onConflict: 'conversation_id,user_id' });

    if (peerErr) {
      throw new Error(`Could not add participant to conversation: ${peerErr.message}`);
    }

    this.conversations.unshift(conv);
    appEventBus.publish('conversationsUpdated', this.conversations);
    return conv;
  }

  public startDirectConversation(userIdA: string, userIdB: string): Conversation {
    const existing = this.conversations.find(
      (c) => c.type === 'direct' && c.participantIds.includes(userIdA) && c.participantIds.includes(userIdB)
    );
    if (existing) return existing;

    const userA = this.getUserById(userIdA);
    const userB = this.getUserById(userIdB);
    const title = userB?.fullName || 'Direct Chat';
    const now = new Date().toISOString();

    const conv: Conversation = {
      id: crypto.randomUUID(),
      type: 'direct',
      title,
      name: title,
      participantIds: [userIdA, userIdB],
      participants: [
        { userId: userIdA, name: userA?.fullName || 'You', role: (userA?.role as any) || 'student' },
        { userId: userIdB, name: title, role: (userB?.role as any) || 'student' },
      ],
      createdBy: userIdA,
      unreadCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.conversations.unshift(conv);
    appEventBus.publish('conversationsUpdated', this.conversations);

    supabase
      .from('conversations')
      .insert({
        id: conv.id,
        type: 'direct',
        title: conv.title,
      })
      .then(async ({ error }) => {
        if (!error) {
          await supabase
            .from('conversation_participants')
            .upsert({ conversation_id: conv.id, user_id: userIdA }, { onConflict: 'conversation_id,user_id' });
          await supabase
            .from('conversation_participants')
            .upsert({ conversation_id: conv.id, user_id: userIdB }, { onConflict: 'conversation_id,user_id' });
        }
      });

    return conv;
  }

  public subscribeToMessages(conversationId: string, callback: (messages: ChatMessage[]) => void): () => void {
    callback(this.getMessages(conversationId));
    const listener = (msg: ChatMessage) => {
      if (msg.conversationId === conversationId) {
        callback(this.getMessages(conversationId));
      }
    };
    return appEventBus.subscribe('messageReceived', listener);
  }

  // Audit Logs
  public getAuditLogs(): AuditLog[] {
    return [...this.auditLogs];
  }

  public logAudit(entry: {
    actorId: string;
    action: string;
    resource?: string;
    resourceId?: string;
    details?: any;
  }): void {
    const audit: AuditLog = {
      id: crypto.randomUUID(),
      action: entry.action,
      actorId: entry.actorId,
      actorName: this.getUserById(entry.actorId)?.fullName || 'User',
      actorRole: this.getUserById(entry.actorId)?.role || 'student',
      targetEntity: entry.resource || 'system',
      targetId: entry.resourceId || '',
      details: typeof entry.details === 'string' ? entry.details : JSON.stringify(entry.details || {}),
      timestamp: new Date().toISOString(),
    };
    this.auditLogs.unshift(audit);

    supabase
      .from('audit_logs')
      .insert({
        id: audit.id,
        actor_id: audit.actorId || null,
        action: audit.action,
        entity_type: audit.targetEntity,
        entity_id: audit.targetId || audit.id,
        details: entry.details || {},
      })
      .then(({ error }) => {
        if (error) console.warn('[SupabaseRepository] logAudit warning:', error.message);
      });
  }
}
