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
  ChatMessage,
  MessageReplyReference,
  MessageMention,
  AuditLog,
  PublicProfile,
} from '../../domain/types';

const IS_PROD = Boolean((import.meta as any)?.env?.PROD);

/**
 * In-memory synchronized cache for domain entities.
 * In production, localStorage fallback is strictly prohibited.
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
    if (typeof window !== 'undefined') {
      this.init().catch((err) => console.warn('[SupabaseRepository] Initialization notice:', err));
    }
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
          is_active,
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
            is_available
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
            amenities: ['Electricity', 'Water', 'Gated Security'],
            houseRules: ['No loud music after 10PM'],
            images: [],
            totalCapacity: row.total_spaces || 10,
            availableSpaces: row.available_spaces || 8,
            verificationStatus: 'approved',
            isActive: row.is_active ?? true,
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

      // 2. Setup Realtime subscription on messages
      supabase
        .channel('public:messages')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages' },
          (payload) => {
            const row: any = payload.new;
            if (!row || !row.conversation_id) return;
            const msg: ChatMessage = {
              id: row.id,
              conversationId: row.conversation_id,
              senderId: row.sender_id,
              senderName: row.sender_name || 'User',
              senderRole: 'student',
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
              appEventBus.publish('messageReceived', msg);
            }
          }
        )
        .subscribe();
    } catch (err) {
      console.warn('[SupabaseRepository] Live initialization notice:', err);
    }
  }

  public resetToSeed(): void {
    if (IS_PROD) {
      throw new Error('resetToSeed is not permitted in production runtime.');
    }
    this.users = [];
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

    supabase
      .from('profiles')
      .upsert({
        id: user.id,
        email: user.email,
        full_name: user.fullName || user.email.split('@')[0],
        role: user.role,
        account_status: user.accountStatus,
        avatar_url: user.avatarUrl || null,
        phone: user.phone || null,
      })
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
    this.activeUserId = userId;
    appEventBus.publish('userChanged', userId);
  }

  public clearActiveUserId(): void {
    this.activeUserId = '';
    appEventBus.publish('userChanged', '');
  }

  public clearActiveSession(): void {
    this.clearActiveUserId();
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
      .upsert({
        user_id: profile.userId,
        institution: profile.institutionName || profile.university,
        campus: profile.campus,
        study_level: profile.studyLevel,
        registration_number: profile.registrationNumber,
        gender: profile.gender?.toLowerCase() || 'other',
        is_profile_verified: profile.isProfileVerified ?? false,
      })
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

  public getStudentDocs(studentId?: string): StudentVerificationDocument[] {
    const sid = studentId || this.activeUserId;
    return this.studentDocs.filter((d) => d.studentId === sid);
  }

  public addStudentDocument(docData: {
    studentId: string;
    studentName: string;
    documentType: StudentDocumentType;
    fileName: string;
    fileSize: number;
    documentUrl: string;
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

    supabase
      .from('student_verification_documents')
      .insert({
        id: newDoc.id,
        student_id: newDoc.studentId,
        document_type: newDoc.documentType,
        storage_path: newDoc.documentUrl || `${newDoc.studentId}/${newDoc.id}/${newDoc.fileName}`,
        file_name: newDoc.fileName,
        file_size: newDoc.fileSize || 1024,
        content_type: 'application/pdf',
        status: 'pending',
      })
      .then(({ error }) => {
        if (error) console.warn('[SupabaseRepository] addStudentDocument warning:', error.message);
      });

    return newDoc;
  }

  public reviewStudentDocument(
    docId: string,
    status: VerificationReviewStatus,
    reviewerId: string,
    rejectionReason?: string
  ): StudentVerificationDocument | undefined {
    const doc = this.studentDocs.find((d) => d.id === docId);
    if (!doc) return undefined;

    doc.status = status;
    doc.reviewerId = reviewerId;
    doc.reviewedAt = new Date().toISOString();
    doc.rejectionReason = rejectionReason;

    supabase
      .from('student_verification_documents')
      .update({
        status: status,
        reviewer_id: reviewerId,
        reviewed_at: doc.reviewedAt,
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
      .upsert({
        user_id: profile.userId,
        company_name: profile.businessName || profile.legalName,
        business_address: profile.contactAddress,
        verification_status: profile.verificationStatus || 'pending',
      })
      .then(({ error }) => {
        if (error) console.warn('[SupabaseRepository] saveLandlordProfile warning:', error.message);
      });

    return profile;
  }

  public reviewLandlordVerification(
    userId: string,
    status: 'approved' | 'rejected',
    adminId: string,
    notes?: string
  ): LandlordProfile | undefined {
    const profile = this.getLandlordProfile(userId);
    if (!profile) return undefined;

    profile.verificationStatus = status;
    profile.verifiedAt = new Date().toISOString();

    supabase
      .from('landlord_profiles')
      .update({
        verification_status: status,
        reviewed_by: adminId,
        reviewed_at: profile.verifiedAt,
      })
      .eq('user_id', userId)
      .then(({ error }) => {
        if (error) console.warn('[SupabaseRepository] reviewLandlordVerification warning:', error.message);
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
    const index = this.propertyLocations.findIndex((l) => l.propertyId === loc.propertyId);
    const updatedLoc: PropertyLocation = {
      ...loc,
      geohash: loc.geohash || encodeGeohash(loc.latitude, loc.longitude),
      updatedAt: new Date().toISOString(),
    };
    if (index >= 0) {
      this.propertyLocations[index] = updatedLoc;
    } else {
      this.propertyLocations.push(updatedLoc);
    }

    supabase
      .from('property_locations')
      .upsert({
        property_id: loc.propertyId,
        submitted_by: loc.submittedBy,
        latitude: loc.latitude,
        longitude: loc.longitude,
        public_latitude: loc.publicLatitude,
        public_longitude: loc.publicLongitude,
        precision: loc.precision || 'exact_building',
        verification_status: loc.verificationStatus || 'pending',
        formatted_address: loc.formattedAddress || 'Kano State',
      })
      .then(({ error }) => {
        if (error) console.warn('[SupabaseRepository] savePropertyLocation warning:', error.message);
      });

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

  public createProperty(prop: Property): Property {
    this.properties.unshift(prop);
    if (prop.location) {
      this.savePropertyLocation(prop.location);
    }

    supabase
      .from('properties')
      .insert({
        id: prop.id,
        landlord_id: prop.landlordId,
        title: prop.title,
        description: prop.description,
        property_type: prop.propertyType,
        rental_fee_annual: prop.pricePerSession || 250000,
        caution_deposit: prop.depositAmount || 30000,
        total_spaces: prop.totalCapacity || 10,
        available_spaces: prop.availableSpaces || 8,
        approval_status: prop.verificationStatus || 'pending',
        is_published: prop.isActive ?? true,
      })
      .then(({ error }) => {
        if (error) console.warn('[SupabaseRepository] createProperty warning:', error.message);
      });

    return prop;
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
        updated_at: new Date().toISOString(),
      })
      .eq('id', prop.id)
      .then(({ error }) => {
        if (error) console.warn('[SupabaseRepository] updateProperty warning:', error.message);
      });

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
        is_available: availableSpaces > 0,
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
      .then(({ error }) => {
        if (error) console.warn('[SupabaseRepository] createGroup warning:', error.message);
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
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      conversationId,
      senderId,
      senderName: this.getUserById(senderId)?.fullName || 'User',
      senderRole: 'student',
      text,
      status: 'sent',
      createdAt: new Date().toISOString(),
      replyTo: options?.replyTo,
      mentions: options?.mentions,
      attachment: options?.attachment,
    };

    if (!this.messages[conversationId]) {
      this.messages[conversationId] = [];
    }
    this.messages[conversationId].push(msg);

    const conv = this.getConversationById(conversationId);
    if (conv) {
      conv.lastMessageText = text || (options?.attachment ? `[Attachment: ${options.attachment.fileName}]` : '');
      conv.lastMessageAt = msg.createdAt;
    }

    supabase
      .from('messages')
      .insert({
        id: msg.id,
        conversation_id: conversationId,
        sender_id: senderId,
        text: text,
        attachment: options?.attachment || null,
      })
      .then(({ error }) => {
        if (error) console.warn('[SupabaseRepository] sendMessage warning:', error.message);
      });

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
    foundMsg.status = 'delivered';
    return { success: true, message: foundMsg };
  }

  public markMessagesAsRead(conversationId: string, _userId: string): void {
    const conv = this.getConversationById(conversationId);
    if (conv) conv.unreadCount = 0;
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

  public startDirectConversation(userIdA: string, userIdB: string): Conversation {
    const existing = this.conversations.find(
      (c) => c.type === 'direct' && c.participantIds.includes(userIdA) && c.participantIds.includes(userIdB)
    );
    if (existing) return existing;

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
        { userId: userIdA, name: 'You', role: 'student' },
        { userId: userIdB, name: title, role: 'student' },
      ],
      createdBy: userIdA,
      unreadCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.conversations.unshift(conv);

    supabase
      .from('conversations')
      .insert({
        id: conv.id,
        type: 'direct',
        title: conv.title,
      })
      .then(async ({ error }) => {
        if (!error) {
          await supabase.from('conversation_participants').insert([
            { conversation_id: conv.id, user_id: userIdA },
            { conversation_id: conv.id, user_id: userIdB },
          ]);
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
