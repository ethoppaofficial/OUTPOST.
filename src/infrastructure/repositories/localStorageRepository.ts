import {
  User,
  StudentProfile,
  StudentVerificationDocument,
  LandlordProfile,
  Property,
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
  MessageDeliveryStatus,
  AuditLog,
  VerificationReviewStatus,
  ReservationStatus,
  ReceiptStatus,
  UserRole,
} from '../../domain/types';
import {
  SEED_USERS,
  SEED_STUDENT_PROFILES,
  SEED_STUDENT_DOCS,
  SEED_LANDLORD_PROFILES,
  SEED_PROPERTIES,
  SEED_ROOMMATE_PREFERENCES,
  SEED_ROOMMATE_REQUESTS,
  SEED_GROUPS,
  SEED_RESERVATIONS,
  SEED_INVOICES,
  SEED_PAYMENT_RECEIPTS,
  SEED_NOTIFICATIONS,
  SEED_CONVERSATIONS,
  SEED_MESSAGES,
  SEED_AUDIT_LOGS,
} from '../mock/seedData';
import { calculateCompatibility } from '../../domain/matching';
import { appEventBus } from '../events/eventBus';

const STORAGE_KEYS = {
  USERS: 'outpost_users_v2',
  STUDENT_PROFILES: 'outpost_student_profiles_v2',
  STUDENT_DOCS: 'outpost_student_docs_v2',
  LANDLORD_PROFILES: 'outpost_landlord_profiles_v2',
  PROPERTIES: 'outpost_properties_v2',
  ROOMMATE_PREFERENCES: 'outpost_roommate_prefs_v2',
  ROOMMATE_REQUESTS: 'outpost_roommate_reqs_v2',
  GROUPS: 'outpost_groups_v2',
  GROUP_INVITATIONS: 'outpost_group_invitations_v2',
  GROUP_JOIN_REQUESTS: 'outpost_group_join_requests_v2',
  RESERVATIONS: 'outpost_reservations_v2',
  INVOICES: 'outpost_invoices_v2',
  PAYMENT_RECEIPTS: 'outpost_payment_receipts_v2',
  NOTIFICATIONS: 'outpost_notifications_v2',
  CONVERSATIONS: 'outpost_conversations_v2',
  MESSAGES: 'outpost_messages_v2',
  AUDIT_LOGS: 'outpost_audit_logs_v2',
  CURRENT_USER_ID: 'outpost_active_user_id_v2',
};

function load<T>(key: string, seed: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      localStorage.setItem(key, JSON.stringify(seed));
      return seed;
    }
    return JSON.parse(raw) as T;
  } catch (err) {
    console.error(`Error loading key ${key} from storage:`, err);
    return seed;
  }
}

function save<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.error(`Error saving key ${key} to storage:`, err);
  }
}

export class LocalStorageRepository {
  public async init(): Promise<void> {
    return Promise.resolve();
  }

  // Reset or reseed state
  public resetToSeed(): void {
    localStorage.clear();
    save(STORAGE_KEYS.USERS, SEED_USERS);
    save(STORAGE_KEYS.STUDENT_PROFILES, SEED_STUDENT_PROFILES);
    save(STORAGE_KEYS.STUDENT_DOCS, SEED_STUDENT_DOCS);
    save(STORAGE_KEYS.LANDLORD_PROFILES, SEED_LANDLORD_PROFILES);
    save(STORAGE_KEYS.PROPERTIES, SEED_PROPERTIES);
    save(STORAGE_KEYS.ROOMMATE_PREFERENCES, SEED_ROOMMATE_PREFERENCES);
    save(STORAGE_KEYS.ROOMMATE_REQUESTS, SEED_ROOMMATE_REQUESTS);
    save(STORAGE_KEYS.GROUPS, SEED_GROUPS);
    save(STORAGE_KEYS.GROUP_INVITATIONS, []);
    save(STORAGE_KEYS.RESERVATIONS, SEED_RESERVATIONS);
    save(STORAGE_KEYS.INVOICES, SEED_INVOICES);
    save(STORAGE_KEYS.PAYMENT_RECEIPTS, SEED_PAYMENT_RECEIPTS);
    save(STORAGE_KEYS.NOTIFICATIONS, SEED_NOTIFICATIONS);
    save(STORAGE_KEYS.CONVERSATIONS, SEED_CONVERSATIONS);
    save(STORAGE_KEYS.MESSAGES, SEED_MESSAGES);
    save(STORAGE_KEYS.AUDIT_LOGS, SEED_AUDIT_LOGS);
    save(STORAGE_KEYS.CURRENT_USER_ID, 'user-student-1'); // default to verified student
  }

  // Auth & User Management
  public getUsers(): User[] {
    return load(STORAGE_KEYS.USERS, SEED_USERS);
  }

  public getUserById(id: string): User | undefined {
    return this.getUsers().find((u) => u.id === id);
  }

  public getUserByEmail(email: string): User | undefined {
    const normalized = email.trim().toLowerCase();
    return this.getUsers().find((u) => u.email.toLowerCase() === normalized);
  }

  public createUser(user: User): User {
    const users = this.getUsers();
    users.push(user);
    save(STORAGE_KEYS.USERS, users);
    return user;
  }

  public updateUser(user: User): User {
    const users = this.getUsers().map((u) => (u.id === user.id ? user : u));
    save(STORAGE_KEYS.USERS, users);
    return user;
  }

  public getActiveUserId(): string {
    const stored = localStorage.getItem(STORAGE_KEYS.CURRENT_USER_ID);
    return stored ? JSON.parse(stored) : 'user-student-1';
  }

  public setActiveUserId(userId: string): void {
    localStorage.setItem(STORAGE_KEYS.CURRENT_USER_ID, JSON.stringify(userId));
    appEventBus.publish('userChanged', userId);
  }

  // Student Profiles
  public getStudentProfiles(): StudentProfile[] {
    return load(STORAGE_KEYS.STUDENT_PROFILES, SEED_STUDENT_PROFILES);
  }

  public getStudentProfile(userId: string): StudentProfile | undefined {
    return this.getStudentProfiles().find((p) => p.userId === userId);
  }

  public searchStudents(query: string): StudentProfile[] {
    const trimmed = query.trim().toLowerCase();
    const profiles = this.getStudentProfiles();
    if (!trimmed) return profiles;
    return profiles.filter(
      (p) =>
        p.fullName.toLowerCase().includes(trimmed) ||
        p.registrationNumber.toLowerCase().includes(trimmed) ||
        (p.university && p.university.toLowerCase().includes(trimmed))
    );
  }

  public saveStudentProfile(profile: StudentProfile): StudentProfile {
    const profiles = this.getStudentProfiles();
    const idx = profiles.findIndex((p) => p.userId === profile.userId);
    if (idx >= 0) {
      profiles[idx] = profile;
    } else {
      profiles.push(profile);
    }
    save(STORAGE_KEYS.STUDENT_PROFILES, profiles);
    return profile;
  }

  public searchStudentByRegistrationNumber(regQuery: string): {
    found: boolean;
    student?: {
      userId: string;
      displayName: string;
      institution: string;
      programme: string;
      studyLevel: string;
      avatarUrl?: string;
      isVerified: boolean;
      registrationNumber: string;
    };
    error?: string;
  } {
    const normalized = regQuery.trim().toUpperCase();
    if (!normalized || normalized.length < 3) {
      return { found: false, error: 'Registration number query is too short.' };
    }
    const profile = this.getStudentProfiles().find(
      (p) => p.registrationNumber.toUpperCase() === normalized || p.registrationNumber.toUpperCase().includes(normalized)
    );
    if (!profile) {
      return { found: false, error: 'No student found with registration number: ' + regQuery };
    }
    const user = this.getUserById(profile.userId);
    if (!user || user.accountStatus === 'suspended') {
      return { found: false, error: 'Account is inactive or not found.' };
    }
    return {
      found: true,
      student: {
        userId: profile.userId,
        displayName: profile.fullName,
        institution: profile.university || profile.institutionName || 'Higher Institution',
        programme: profile.programme,
        studyLevel: profile.studyLevel,
        avatarUrl: user.avatarUrl,
        isVerified: profile.isProfileVerified,
        registrationNumber: profile.registrationNumber,
      },
    };
  }

  // Student Verification Documents
  public getStudentDocs(studentId?: string): StudentVerificationDocument[] {
    const docs = load<StudentVerificationDocument[]>(STORAGE_KEYS.STUDENT_DOCS, SEED_STUDENT_DOCS);
    if (studentId) {
      return docs.filter((d) => d.studentId === studentId);
    }
    return docs;
  }

  public addStudentDocument(doc: Omit<StudentVerificationDocument, 'id' | 'uploadedAt' | 'status'>): StudentVerificationDocument {
    const docs = this.getStudentDocs();
    const newDoc: StudentVerificationDocument = {
      ...doc,
      id: `sdoc-${Date.now()}`,
      uploadedAt: new Date().toISOString(),
      status: 'pending',
    };
    docs.push(newDoc);
    save(STORAGE_KEYS.STUDENT_DOCS, docs);

    // Update student profile status to profile_pending
    const user = this.getUserById(doc.studentId);
    if (user && user.accountStatus !== 'profile_verified') {
      user.accountStatus = 'profile_pending';
      this.updateUser(user);
    }

    // Add notification for admins
    this.createNotification({
      userId: 'user-admin-1',
      title: 'New Student Verification Document',
      message: `${doc.studentName} uploaded a ${doc.documentType.replace('_', ' ')} for review.`,
      type: 'info',
      link: '/admin/users',
    });

    return newDoc;
  }

  public reviewStudentDocument(
    docId: string,
    status: VerificationReviewStatus,
    reviewerId: string,
    rejectionReason?: string
  ): StudentVerificationDocument | undefined {
    const docs = this.getStudentDocs();
    const doc = docs.find((d) => d.id === docId);
    if (!doc) return undefined;

    doc.status = status;
    doc.reviewedAt = new Date().toISOString();
    doc.reviewerId = reviewerId;
    if (rejectionReason) doc.rejectionReason = rejectionReason;

    save(STORAGE_KEYS.STUDENT_DOCS, docs);

    const user = this.getUserById(doc.studentId);
    const profile = this.getStudentProfile(doc.studentId);

    if (status === 'approved') {
      if (user) {
        user.accountStatus = 'profile_verified';
        this.updateUser(user);
      }
      if (profile) {
        profile.isProfileVerified = true;
        this.saveStudentProfile(profile);
      }
      this.createNotification({
        userId: doc.studentId,
        title: 'Document Verification Approved',
        message: `Your ${doc.documentType.replace('_', ' ')} has been approved. Your profile is now verified!`,
        type: 'success',
        link: '/student/profile',
      });
    } else {
      if (user) {
        user.accountStatus = 'rejected';
        this.updateUser(user);
      }
      this.createNotification({
        userId: doc.studentId,
        title: 'Document Verification Requires Correction',
        message: `Your uploaded document was rejected: ${rejectionReason || 'Please upload a clear copy with matching student details.'}`,
        type: 'warning',
        link: '/student/profile/verification',
      });
    }

    this.logAudit({
      action: status === 'approved' ? 'APPROVE_STUDENT_DOCUMENT' : 'REJECT_STUDENT_DOCUMENT',
      actorId: reviewerId,
      actorName: 'Administrator',
      actorRole: 'admin',
      targetEntity: 'StudentVerificationDocument',
      targetId: docId,
      details: `Review decision: ${status}. Reason: ${rejectionReason || 'Document authenticated successfully.'}`,
    });

    return doc;
  }

  // Landlord Profiles & Verifications
  public getLandlordProfiles(): LandlordProfile[] {
    return load(STORAGE_KEYS.LANDLORD_PROFILES, SEED_LANDLORD_PROFILES);
  }

  public getLandlordProfile(userId: string): LandlordProfile | undefined {
    return this.getLandlordProfiles().find((p) => p.userId === userId);
  }

  public saveLandlordProfile(profile: LandlordProfile): LandlordProfile {
    const profiles = this.getLandlordProfiles();
    const idx = profiles.findIndex((p) => p.userId === profile.userId);
    if (idx >= 0) {
      profiles[idx] = profile;
    } else {
      profiles.push(profile);
    }
    save(STORAGE_KEYS.LANDLORD_PROFILES, profiles);
    return profile;
  }

  public reviewLandlordVerification(
    userId: string,
    decision: 'approved' | 'rejected',
    reviewerId: string,
    reason?: string
  ): LandlordProfile | undefined {
    const profile = this.getLandlordProfile(userId);
    if (!profile) return undefined;

    profile.verificationStatus = decision;
    if (decision === 'approved') {
      profile.verifiedAt = new Date().toISOString();
      profile.rejectionReason = undefined;
    } else {
      profile.rejectionReason = reason;
    }
    this.saveLandlordProfile(profile);

    // Update landlord user
    const user = this.getUserById(userId);
    if (user) {
      user.accountStatus = decision === 'approved' ? 'profile_verified' : 'rejected';
      this.updateUser(user);
    }

    // Also update landlord verification status in their properties
    const properties = this.getProperties().map((prop) => {
      if (prop.landlordId === userId) {
        return { ...prop, landlordVerified: decision === 'approved' };
      }
      return prop;
    });
    save(STORAGE_KEYS.PROPERTIES, properties);

    this.createNotification({
      userId,
      title: decision === 'approved' ? 'Landlord Verification Approved' : 'Landlord Verification Decision',
      message:
        decision === 'approved'
          ? 'Congratulations! Your landlord identity has been verified by the Outpost safety team.'
          : `Your landlord verification submission was rejected: ${reason || 'Details do not match official records.'}`,
      type: decision === 'approved' ? 'success' : 'warning',
      link: '/landlord/verification',
    });

    this.logAudit({
      action: decision === 'approved' ? 'APPROVE_LANDLORD' : 'REJECT_LANDLORD',
      actorId: reviewerId,
      actorName: 'Administrator',
      actorRole: 'admin',
      targetEntity: 'LandlordProfile',
      targetId: userId,
      details: `Landlord ${profile.legalName} verification status updated to ${decision}. Reason: ${reason || 'NIN verified'}`,
    });

    return profile;
  }

  // Properties
  public getProperties(): Property[] {
    return load(STORAGE_KEYS.PROPERTIES, SEED_PROPERTIES);
  }

  public getPropertyById(id: string): Property | undefined {
    return this.getProperties().find((p) => p.id === id);
  }

  public getPropertyBySlug(slug: string): Property | undefined {
    return this.getProperties().find((p) => p.slug === slug);
  }

  public createProperty(property: Property): Property {
    const props = this.getProperties();
    props.push(property);
    save(STORAGE_KEYS.PROPERTIES, props);

    this.createNotification({
      userId: 'user-admin-1',
      title: 'New Property Submitted for Verification',
      message: `${property.title} in ${property.neighbourhood} submitted by ${property.landlordName}.`,
      type: 'info',
      link: '/admin/property-verifications',
    });

    return property;
  }

  public updateProperty(property: Property): Property {
    const props = this.getProperties().map((p) => (p.id === property.id ? property : p));
    save(STORAGE_KEYS.PROPERTIES, props);
    return property;
  }

  public reviewProperty(
    propertyId: string,
    decision: 'approved' | 'rejected' | 'suspended',
    reviewerId: string,
    adminFeedback?: string
  ): Property | undefined {
    const property = this.getPropertyById(propertyId);
    if (!property) return undefined;

    property.verificationStatus = decision;
    property.adminFeedback = adminFeedback;
    property.updatedAt = new Date().toISOString();
    this.updateProperty(property);

    this.createNotification({
      userId: property.landlordId,
      title: `Property Listing ${decision.toUpperCase()}`,
      message: `Your property "${property.title}" status is now ${decision}. ${adminFeedback ? 'Note: ' + adminFeedback : ''}`,
      type: decision === 'approved' ? 'success' : 'warning',
      link: `/landlord/properties`,
    });

    this.logAudit({
      action: `PROPERTY_${decision.toUpperCase()}`,
      actorId: reviewerId,
      actorName: 'Administrator',
      actorRole: 'admin',
      targetEntity: 'Property',
      targetId: propertyId,
      details: `Admin decision: ${decision}. Feedback: ${adminFeedback || 'Listing passed student housing quality guidelines'}`,
    });

    return property;
  }

  public updatePropertyAvailability(propertyId: string, unitId: string, availableSpaces: number): { success: boolean; message?: string } {
    const property = this.getPropertyById(propertyId);
    if (!property) return { success: false, message: 'Property not found' };

    const room = property.rooms.find((r) => r.id === unitId);
    if (!room) return { success: false, message: 'Unit or room not found' };

    // Invariant: Count active reservations for this room
    const activeReservations = this.getReservations().filter(
      (res) =>
        res.propertyId === propertyId &&
        res.unitId === unitId &&
        (res.status === 'confirmed' || res.status === 'pending_payment' || res.status === 'receipt_submitted')
    );

    if (availableSpaces < 0) {
      return { success: false, message: 'Available spaces cannot be negative.' };
    }

    if (availableSpaces + activeReservations.length > room.totalCapacity) {
      return {
        success: false,
        message: `Cannot increase capacity beyond unit max (${room.totalCapacity}). There are already ${activeReservations.length} active reservations/holds.`,
      };
    }

    room.availableSpaces = availableSpaces;
    // Update overall property availableSpaces
    property.availableSpaces = property.rooms.reduce((acc, r) => acc + r.availableSpaces, 0);
    this.updateProperty(property);

    return { success: true };
  }

  // Roommate Preferences & Matching
  public getRoommatePreferences(): RoommatePreference[] {
    return load(STORAGE_KEYS.ROOMMATE_PREFERENCES, SEED_ROOMMATE_PREFERENCES);
  }

  public getRoommatePreference(studentId: string): RoommatePreference | undefined {
    return this.getRoommatePreferences().find((p) => p.studentId === studentId);
  }

  public saveRoommatePreference(pref: RoommatePreference): RoommatePreference {
    const prefs = this.getRoommatePreferences();
    const idx = prefs.findIndex((p) => p.studentId === pref.studentId);
    if (idx >= 0) {
      prefs[idx] = pref;
    } else {
      prefs.push(pref);
    }
    save(STORAGE_KEYS.ROOMMATE_PREFERENCES, prefs);
    return pref;
  }

  public getSuggestedRoommates(currentStudentId: string): {
    student: StudentProfile;
    user: User;
    compatibility: ReturnType<typeof calculateCompatibility>;
  }[] {
    const currentPref = this.getRoommatePreference(currentStudentId);
    if (!currentPref) return [];

    const allPrefs = this.getRoommatePreferences().filter((p) => p.studentId !== currentStudentId);
    const profiles = this.getStudentProfiles();
    const users = this.getUsers();

    const results = allPrefs.map((otherPref) => {
      const student = profiles.find((p) => p.userId === otherPref.studentId);
      const user = users.find((u) => u.id === otherPref.studentId);
      const compatibility = calculateCompatibility(currentPref, otherPref);
      return { student: student!, user: user!, compatibility };
    }).filter((r) => r.student && r.user && r.user.accountStatus !== 'suspended');

    // Sort by compatibility score descending
    return results.sort((a, b) => b.compatibility.score - a.compatibility.score);
  }

  // Roommate Requests
  public getRoommateRequests(userId: string): { sent: RoommateRequest[]; received: RoommateRequest[] } {
    const all = load<RoommateRequest[]>(STORAGE_KEYS.ROOMMATE_REQUESTS, SEED_ROOMMATE_REQUESTS);
    return {
      sent: all.filter((r) => r.senderId === userId),
      received: all.filter((r) => r.receiverId === userId),
    };
  }

  public sendRoommateRequest(senderId: string, receiverId: string, message: string): { success: boolean; error?: string } {
    const all = load<RoommateRequest[]>(STORAGE_KEYS.ROOMMATE_REQUESTS, SEED_ROOMMATE_REQUESTS);
    const sender = this.getStudentProfile(senderId);
    const senderUser = this.getUserById(senderId);
    if (!sender || !senderUser) return { success: false, error: 'Student sender not found.' };

    // Invariant: Prevent duplicate active requests
    const duplicate = all.find(
      (r) => r.senderId === senderId && r.receiverId === receiverId && r.status === 'pending'
    );
    if (duplicate) {
      return { success: false, error: 'You already have a pending roommate request with this student.' };
    }

    const prefA = this.getRoommatePreference(senderId);
    const prefB = this.getRoommatePreference(receiverId);
    const score = prefA && prefB ? calculateCompatibility(prefA, prefB).score : 70;

    const newRequest: RoommateRequest = {
      id: `req-${Date.now()}`,
      senderId,
      senderName: sender.fullName,
      senderAvatar: senderUser.avatarUrl,
      senderRegNumber: sender.registrationNumber,
      receiverId,
      status: 'pending',
      compatibilityScore: score,
      message,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    all.push(newRequest);
    save(STORAGE_KEYS.ROOMMATE_REQUESTS, all);

    this.createNotification({
      userId: receiverId,
      title: 'New Roommate Request',
      message: `${sender.fullName} (${sender.registrationNumber}) sent you a roommate request (${score}% compatibility).`,
      type: 'info',
      link: '/student/roommate-requests',
    });

    return { success: true };
  }

  public respondToRoommateRequest(requestId: string, action: 'accept' | 'reject' | 'cancel'): boolean {
    const all = load<RoommateRequest[]>(STORAGE_KEYS.ROOMMATE_REQUESTS, SEED_ROOMMATE_REQUESTS);
    const req = all.find((r) => r.id === requestId);
    if (!req) return false;

    if (action === 'accept') {
      req.status = 'accepted';
      this.createNotification({
        userId: req.senderId,
        title: 'Roommate Request Accepted',
        message: `Your roommate request to ${req.receiverId} was accepted! You can now start a direct chat or form a group.`,
        type: 'success',
        link: '/student/chat',
      });
    } else if (action === 'reject') {
      req.status = 'rejected';
    } else if (action === 'cancel') {
      req.status = 'cancelled';
    }

    req.updatedAt = new Date().toISOString();
    save(STORAGE_KEYS.ROOMMATE_REQUESTS, all);
    return true;
  }

  // Accommodation Groups
  public getGroups(): AccommodationGroup[] {
    return load<AccommodationGroup[]>(STORAGE_KEYS.GROUPS, SEED_GROUPS);
  }

  public getAccommodationGroups(): AccommodationGroup[] {
    return this.getGroups();
  }

  public getGroupsForUser(userId: string): AccommodationGroup[] {
    const groups = this.getGroups();
    return groups.filter((g) => g.memberIds.includes(userId));
  }

  public getGroupById(groupId: string): AccommodationGroup | undefined {
    const groups = this.getGroups();
    return groups.find((g) => g.id === groupId);
  }

  public createGroup(
    name: string,
    description: string,
    leaderId: string,
    maxCapacity: number,
    targetPropertyId?: string,
    visibility: 'discoverable' | 'invite_only' | 'request_required' = 'discoverable'
  ): AccommodationGroup {
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length > 60) {
      throw new Error('Group name must be between 1 and 60 characters.');
    }

    const groups = load<AccommodationGroup[]>(STORAGE_KEYS.GROUPS, SEED_GROUPS);
    const leader = this.getStudentProfile(leaderId);
    const leaderUser = this.getUserById(leaderId);
    const targetProp = targetPropertyId ? this.getPropertyById(targetPropertyId) : undefined;

    const now = new Date().toISOString();
    const newGroup: AccommodationGroup = {
      id: `group-${Date.now()}`,
      name: trimmedName,
      description: description.trim(),
      status: 'active',
      visibility,
      ownerId: leaderId,
      ownerName: leader ? leader.fullName : 'Leader',
      leaderId,
      leaderName: leader ? leader.fullName : 'Leader',
      adminIds: [leaderId],
      memberIds: [leaderId],
      members: [
        {
          userId: leaderId,
          name: leader ? leader.fullName : 'Leader',
          avatarUrl: leaderUser?.avatarUrl,
          role: 'admin',
          status: 'active',
          joinedAt: now,
        },
      ],
      targetPropertyId,
      targetPropertyName: targetProp?.title,
      maxCapacity: Math.max(2, Math.min(12, maxCapacity || 4)),
      createdAt: now,
      updatedAt: now,
    };

    groups.push(newGroup);
    save(STORAGE_KEYS.GROUPS, groups);

    // Audit log
    this.createAuditLog({
      action: 'GROUP_CREATED',
      actorId: leaderId,
      actorName: newGroup.ownerName,
      actorRole: 'student',
      details: `Created accommodation group "${newGroup.name}" (${visibility}).`,
    });

    // Also automatically create a group chat conversation for this accommodation group
    const convos = load<Conversation[]>(STORAGE_KEYS.CONVERSATIONS, SEED_CONVERSATIONS);
    const groupConv: Conversation = {
      id: `conv-group-${newGroup.id}`,
      type: 'group',
      title: newGroup.name,
      name: newGroup.name,
      groupId: newGroup.id,
      createdBy: leaderId,
      participantIds: [leaderId],
      participants: [
        {
          userId: leaderId,
          name: leader ? leader.fullName : 'Leader',
          avatarUrl: leaderUser?.avatarUrl,
          role: 'student',
          isOnline: true,
        },
      ],
      lastMessageText: `Group "${trimmedName}" established.`,
      lastMessageTimestamp: now,
      createdAt: now,
      updatedAt: now,
      unreadCount: 0,
    };
    convos.push(groupConv);
    save(STORAGE_KEYS.CONVERSATIONS, convos);
    appEventBus.publish('conversationsUpdated', convos);

    return newGroup;
  }

  public renameGroup(groupId: string, actorId: string, newName: string): { success: boolean; error?: string; group?: AccommodationGroup } {
    const group = this.getGroupById(groupId);
    if (!group) return { success: false, error: 'Group not found.' };

    const isAdmin = group.adminIds?.includes(actorId) || group.leaderId === actorId || group.ownerId === actorId;
    if (!isAdmin) {
      return { success: false, error: 'Only group administrators can rename the group.' };
    }

    const trimmed = newName.trim();
    if (!trimmed || trimmed.length < 2 || trimmed.length > 60) {
      return { success: false, error: 'Group name must be between 2 and 60 characters.' };
    }

    const oldName = group.name;
    group.name = trimmed;
    group.updatedAt = new Date().toISOString();
    this.updateGroup(group);

    // Update conversation name
    const convos = load<Conversation[]>(STORAGE_KEYS.CONVERSATIONS, SEED_CONVERSATIONS);
    const conv = convos.find((c) => c.groupId === groupId);
    if (conv) {
      conv.title = trimmed;
      conv.name = trimmed;
      conv.updatedAt = group.updatedAt;
      save(STORAGE_KEYS.CONVERSATIONS, convos);
      appEventBus.publish('conversationsUpdated', convos);
    }

    // Audit log
    this.createAuditLog({
      action: 'GROUP_RENAMED',
      actorId,
      actorName: this.getUserDisplayName(actorId),
      actorRole: 'student',
      details: `Renamed group from "${oldName}" to "${trimmed}".`,
    });

    // Notify members
    group.memberIds.forEach((mId) => {
      if (mId !== actorId) {
        this.createNotification({
          userId: mId,
          title: 'Group Renamed',
          message: `Your group was renamed from "${oldName}" to "${trimmed}".`,
          type: 'info',
          link: `/student/groups/${groupId}`,
        });
      }
    });

    return { success: true, group };
  }

  public promoteMemberToAdmin(groupId: string, actorId: string, targetUserId: string): { success: boolean; error?: string } {
    const group = this.getGroupById(groupId);
    if (!group) return { success: false, error: 'Group not found.' };

    const isAdmin = group.adminIds?.includes(actorId) || group.leaderId === actorId || group.ownerId === actorId;
    if (!isAdmin) {
      return { success: false, error: 'Only group administrators can promote members.' };
    }

    if (!group.memberIds.includes(targetUserId)) {
      return { success: false, error: 'User is not an active member of this group.' };
    }

    if (!group.adminIds) group.adminIds = [group.leaderId];
    if (!group.adminIds.includes(targetUserId)) {
      group.adminIds.push(targetUserId);
    }

    const mem = group.members.find((m) => m.userId === targetUserId);
    if (mem) {
      mem.role = 'admin';
    }

    group.updatedAt = new Date().toISOString();
    this.updateGroup(group);

    this.createAuditLog({
      action: 'GROUP_ADMIN_PROMOTED',
      actorId,
      actorName: this.getUserDisplayName(actorId),
      actorRole: 'student',
      details: `Promoted ${this.getUserDisplayName(targetUserId)} to group administrator.`,
    });

    this.createNotification({
      userId: targetUserId,
      title: 'Promoted to Group Admin',
      message: `You are now an administrator of "${group.name}".`,
      type: 'success',
      link: `/student/groups/${groupId}`,
    });

    return { success: true };
  }

  public demoteAdmin(groupId: string, actorId: string, targetUserId: string): { success: boolean; error?: string } {
    const group = this.getGroupById(groupId);
    if (!group) return { success: false, error: 'Group not found.' };

    const isActorAdmin = group.adminIds?.includes(actorId) || group.leaderId === actorId || group.ownerId === actorId;
    if (!isActorAdmin) {
      return { success: false, error: 'Only group administrators can demote administrators.' };
    }

    if (!group.adminIds) group.adminIds = [group.leaderId];
    const remainingAdmins = group.adminIds.filter((id) => id !== targetUserId);
    if (remainingAdmins.length === 0) {
      return { success: false, error: 'Cannot demote the final group administrator. Promote another member first.' };
    }

    group.adminIds = remainingAdmins;
    if (group.leaderId === targetUserId) {
      group.leaderId = remainingAdmins[0];
      group.ownerId = remainingAdmins[0];
      group.ownerName = this.getUserDisplayName(remainingAdmins[0]);
      group.leaderName = group.ownerName;
    }

    const mem = group.members.find((m) => m.userId === targetUserId);
    if (mem) {
      mem.role = 'member';
    }

    group.updatedAt = new Date().toISOString();
    this.updateGroup(group);

    this.createAuditLog({
      action: 'GROUP_ADMIN_DEMOTED',
      actorId,
      actorName: this.getUserDisplayName(actorId),
      actorRole: 'student',
      details: `Demoted ${this.getUserDisplayName(targetUserId)} to regular member.`,
    });

    this.createNotification({
      userId: targetUserId,
      title: 'Admin Role Changed',
      message: `Your administrator privileges for "${group.name}" have been modified.`,
      type: 'info',
      link: `/student/groups/${groupId}`,
    });

    return { success: true };
  }

  public removeMember(groupId: string, actorId: string, targetUserId: string): { success: boolean; error?: string } {
    const group = this.getGroupById(groupId);
    if (!group) return { success: false, error: 'Group not found.' };

    const isActorAdmin = group.adminIds?.includes(actorId) || group.leaderId === actorId || group.ownerId === actorId;
    const isSelf = actorId === targetUserId;

    if (!isActorAdmin && !isSelf) {
      return { success: false, error: 'Only group administrators can remove members.' };
    }

    if (!group.memberIds.includes(targetUserId)) {
      return { success: false, error: 'User is not a member of this group.' };
    }

    // Check if target is the final admin
    if (!group.adminIds) group.adminIds = [group.leaderId];
    const isTargetAdmin = group.adminIds.includes(targetUserId);
    if (isTargetAdmin && group.adminIds.length <= 1 && group.memberIds.length > 1) {
      return {
        success: false,
        error: 'Cannot leave or remove the final administrator while other members remain. Promote another member first.',
      };
    }

    // Remove from group
    group.memberIds = group.memberIds.filter((id) => id !== targetUserId);
    group.adminIds = group.adminIds.filter((id) => id !== targetUserId);
    group.members = group.members.filter((m) => m.userId !== targetUserId);

    if (group.memberIds.length === 0) {
      group.status = 'closed';
    } else if (group.leaderId === targetUserId) {
      group.leaderId = group.adminIds[0] || group.memberIds[0];
      group.ownerId = group.leaderId;
      group.ownerName = this.getUserDisplayName(group.leaderId);
      group.leaderName = group.ownerName;
      if (!group.adminIds.includes(group.leaderId)) {
        group.adminIds.push(group.leaderId);
      }
    }

    group.updatedAt = new Date().toISOString();
    this.updateGroup(group);

    // Remove from linked conversation participantIds so they lose chat access
    const convos = load<Conversation[]>(STORAGE_KEYS.CONVERSATIONS, SEED_CONVERSATIONS);
    const conv = convos.find((c) => c.groupId === groupId);
    if (conv) {
      conv.participantIds = conv.participantIds.filter((id) => id !== targetUserId);
      conv.participants = conv.participants.filter((p) => p.userId !== targetUserId);
      conv.updatedAt = group.updatedAt;
      save(STORAGE_KEYS.CONVERSATIONS, convos);
      appEventBus.publish('conversationsUpdated', convos);
    }

    this.createAuditLog({
      action: isSelf ? 'GROUP_MEMBER_LEFT' : 'GROUP_MEMBER_REMOVED',
      actorId,
      actorName: this.getUserDisplayName(actorId),
      actorRole: 'student',
      details: `${isSelf ? 'Left' : 'Removed ' + this.getUserDisplayName(targetUserId) + ' from'} group "${group.name}".`,
    });

    if (!isSelf) {
      this.createNotification({
        userId: targetUserId,
        title: 'Removed from Group',
        message: `You have been removed from "${group.name}".`,
        type: 'warning',
        link: '/student/groups',
      });
    }

    return { success: true };
  }

  public leaveGroup(groupId: string, userId: string): { success: boolean; error?: string } {
    return this.removeMember(groupId, userId, userId);
  }

  public joinGroup(groupId: string, userId: string): { success: boolean; error?: string; pendingApproval?: boolean } {
    const group = this.getGroupById(groupId);
    if (!group) return { success: false, error: 'Group not found.' };

    if (group.status !== 'active') {
      return { success: false, error: 'Group is no longer active.' };
    }

    if (group.memberIds.includes(userId)) {
      return { success: false, error: 'You are already a member of this group.' };
    }

    if (group.memberIds.length >= group.maxCapacity) {
      return { success: false, error: 'Group has reached maximum capacity.' };
    }

    if (group.visibility === 'invite_only') {
      return { success: false, error: 'This group is invite-only. Request an invitation from a member.' };
    }

    if (group.visibility === 'request_required') {
      return this.requestToJoinGroup(groupId, userId);
    }

    // Direct join for discoverable groups
    const student = this.getStudentProfile(userId);
    const user = this.getUserById(userId);
    group.memberIds.push(userId);
    group.members.push({
      userId,
      name: student?.fullName || 'Student',
      avatarUrl: user?.avatarUrl,
      role: 'member',
      status: 'active',
      joinedAt: new Date().toISOString(),
    });
    group.updatedAt = new Date().toISOString();
    this.updateGroup(group);

    // Add to group conversation
    const convos = load<Conversation[]>(STORAGE_KEYS.CONVERSATIONS, SEED_CONVERSATIONS);
    const conv = convos.find((c) => c.groupId === groupId);
    if (conv && !conv.participantIds.includes(userId)) {
      conv.participantIds.push(userId);
      conv.participants.push({
        userId,
        name: student?.fullName || 'Student',
        avatarUrl: user?.avatarUrl,
        role: 'student',
        isOnline: true,
      });
      conv.updatedAt = group.updatedAt;
      save(STORAGE_KEYS.CONVERSATIONS, convos);
      appEventBus.publish('conversationsUpdated', convos);
    }

    this.createAuditLog({
      action: 'GROUP_MEMBER_JOINED',
      actorId: userId,
      actorName: student?.fullName || 'Student',
      actorRole: 'student',
      details: `Joined accommodation group "${group.name}".`,
    });

    return { success: true };
  }

  public requestToJoinGroup(groupId: string, userId: string): { success: boolean; error?: string; pendingApproval?: boolean } {
    const group = this.getGroupById(groupId);
    if (!group) return { success: false, error: 'Group not found.' };

    const requests = load<GroupJoinRequest[]>(STORAGE_KEYS.GROUP_JOIN_REQUESTS, []);
    const existing = requests.find((r) => r.groupId === groupId && r.userId === userId && r.status === 'pending');
    if (existing) {
      return { success: false, error: 'A join request is already pending review.' };
    }

    const student = this.getStudentProfile(userId);
    const user = this.getUserById(userId);

    const newReq: GroupJoinRequest = {
      id: `gjr-${Date.now()}`,
      groupId,
      userId,
      userName: student?.fullName || 'Student',
      userAvatar: user?.avatarUrl,
      regNumber: student?.registrationNumber,
      status: 'pending',
      requestedAt: new Date().toISOString(),
    };

    requests.push(newReq);
    save(STORAGE_KEYS.GROUP_JOIN_REQUESTS, requests);

    // Notify admins
    const adminIds = group.adminIds || [group.leaderId];
    adminIds.forEach((aId) => {
      this.createNotification({
        userId: aId,
        title: 'New Group Join Request',
        message: `${newReq.userName} requested to join "${group.name}".`,
        type: 'info',
        link: `/student/groups/${groupId}/settings`,
      });
    });

    return { success: true, pendingApproval: true };
  }

  public getGroupJoinRequests(groupId: string): GroupJoinRequest[] {
    const requests = load<GroupJoinRequest[]>(STORAGE_KEYS.GROUP_JOIN_REQUESTS, []);
    return requests.filter((r) => r.groupId === groupId && r.status === 'pending');
  }

  public respondToJoinRequest(requestId: string, actorId: string, action: 'approve' | 'reject'): { success: boolean; error?: string } {
    const requests = load<GroupJoinRequest[]>(STORAGE_KEYS.GROUP_JOIN_REQUESTS, []);
    const req = requests.find((r) => r.id === requestId);
    if (!req) return { success: false, error: 'Request not found.' };

    const group = this.getGroupById(req.groupId);
    if (!group) return { success: false, error: 'Group not found.' };

    const isAdmin = group.adminIds?.includes(actorId) || group.leaderId === actorId || group.ownerId === actorId;
    if (!isAdmin) return { success: false, error: 'Only group administrators can review join requests.' };

    req.status = action === 'approve' ? 'approved' : 'rejected';
    req.reviewedAt = new Date().toISOString();
    req.reviewedBy = actorId;
    save(STORAGE_KEYS.GROUP_JOIN_REQUESTS, requests);

    if (action === 'approve') {
      if (group.memberIds.length >= group.maxCapacity) {
        return { success: false, error: 'Group is already at maximum capacity.' };
      }

      if (!group.memberIds.includes(req.userId)) {
        group.memberIds.push(req.userId);
        group.members.push({
          userId: req.userId,
          name: req.userName,
          avatarUrl: req.userAvatar,
          role: 'member',
          status: 'active',
          joinedAt: req.reviewedAt,
        });
        group.updatedAt = req.reviewedAt;
        this.updateGroup(group);

        // Add to conversation
        const convos = load<Conversation[]>(STORAGE_KEYS.CONVERSATIONS, SEED_CONVERSATIONS);
        const conv = convos.find((c) => c.groupId === group.id);
        if (conv && !conv.participantIds.includes(req.userId)) {
          conv.participantIds.push(req.userId);
          conv.participants.push({
            userId: req.userId,
            name: req.userName,
            avatarUrl: req.userAvatar,
            role: 'student',
            isOnline: true,
          });
          conv.updatedAt = req.reviewedAt;
          save(STORAGE_KEYS.CONVERSATIONS, convos);
          appEventBus.publish('conversationsUpdated', convos);
        }
      }

      this.createNotification({
        userId: req.userId,
        title: 'Group Join Request Approved',
        message: `Your request to join "${group.name}" was approved!`,
        type: 'success',
        link: `/student/groups/${group.id}`,
      });
    } else {
      this.createNotification({
        userId: req.userId,
        title: 'Group Join Request Declined',
        message: `Your request to join "${group.name}" was not approved.`,
        type: 'info',
        link: '/student/groups',
      });
    }

    return { success: true };
  }

  public updateGroup(group: AccommodationGroup): AccommodationGroup {
    const groups = this.getAccommodationGroups();
    const idx = groups.findIndex((g: AccommodationGroup) => g.id === group.id);
    if (idx >= 0) {
      groups[idx] = group;
    } else {
      groups.push(group);
    }
    save(STORAGE_KEYS.GROUPS, groups);
    return group;
  }

  public inviteStudentToGroup(groupId: string, senderId: string, receiverId: string): { success: boolean; error?: string } {
    const group = this.getGroupById(groupId);
    if (!group) return { success: false, error: 'Group not found.' };

    if (group.memberIds.length >= group.maxCapacity) {
      return { success: false, error: 'Group has reached maximum capacity.' };
    }

    if (group.memberIds.includes(receiverId)) {
      return { success: false, error: 'Student is already a member of this group.' };
    }

    const invites = load<GroupInvitation[]>(STORAGE_KEYS.GROUP_INVITATIONS, []);
    const existing = invites.find(
      (i) => i.groupId === groupId && i.receiverId === receiverId && i.status === 'pending'
    );
    if (existing) {
      return { success: false, error: 'An invitation is already pending for this student.' };
    }

    const sender = this.getStudentProfile(senderId);
    const newInvite: GroupInvitation = {
      id: `ginv-${Date.now()}`,
      groupId,
      groupName: group.name,
      senderId,
      senderName: sender?.fullName || 'Student',
      receiverId,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    invites.push(newInvite);
    save(STORAGE_KEYS.GROUP_INVITATIONS, invites);

    this.createNotification({
      userId: receiverId,
      title: 'Group Accommodation Invitation',
      message: `${newInvite.senderName} invited you to join "${group.name}".`,
      type: 'info',
      link: '/student/groups',
    });

    return { success: true };
  }

  public getPendingGroupInvitations(userId: string): GroupInvitation[] {
    const invites = load<GroupInvitation[]>(STORAGE_KEYS.GROUP_INVITATIONS, []);
    return invites.filter((i) => i.receiverId === userId && i.status === 'pending');
  }

  public respondToGroupInvitation(inviteId: string, action: 'accept' | 'reject'): boolean {
    const invites = load<GroupInvitation[]>(STORAGE_KEYS.GROUP_INVITATIONS, []);
    const invite = invites.find((i) => i.id === inviteId);
    if (!invite) return false;

    invite.status = action === 'accept' ? 'accepted' : 'rejected';
    save(STORAGE_KEYS.GROUP_INVITATIONS, invites);

    if (action === 'accept') {
      const groups = load<AccommodationGroup[]>(STORAGE_KEYS.GROUPS, SEED_GROUPS);
      const group = groups.find((g) => g.id === invite.groupId);
      if (group && !group.memberIds.includes(invite.receiverId)) {
        const student = this.getStudentProfile(invite.receiverId);
        const user = this.getUserById(invite.receiverId);
        group.memberIds.push(invite.receiverId);
        group.members.push({
          userId: invite.receiverId,
          name: student ? student.fullName : 'Member',
          avatarUrl: user?.avatarUrl,
          role: 'member',
          joinedAt: new Date().toISOString(),
        });
        save(STORAGE_KEYS.GROUPS, groups);

        // Add to group conversation
        const convos = load<Conversation[]>(STORAGE_KEYS.CONVERSATIONS, SEED_CONVERSATIONS);
        const conv = convos.find((c) => c.groupId === group.id);
        if (conv && !conv.participantIds.includes(invite.receiverId)) {
          conv.participantIds.push(invite.receiverId);
          conv.participants.push({
            userId: invite.receiverId,
            name: student ? student.fullName : 'Member',
            avatarUrl: user?.avatarUrl,
            role: 'student',
            isOnline: true,
          });
          save(STORAGE_KEYS.CONVERSATIONS, convos);
        }
      }
    }

    return true;
  }

  // Reservations & Seven-Day Expiration
  public getReservations(): Reservation[] {
    return load(STORAGE_KEYS.RESERVATIONS, SEED_RESERVATIONS);
  }

  public getReservationById(id: string): Reservation | undefined {
    return this.getReservations().find((r) => r.id === id);
  }

  public getReservationsForStudent(studentId: string): Reservation[] {
    return this.getReservations().filter((r) => r.studentId === studentId);
  }

  public getReservationsForLandlord(landlordId: string): Reservation[] {
    return this.getReservations().filter((r) => r.landlordId === landlordId);
  }

  public createReservation(
    studentId: string,
    propertyId: string,
    unitId: string,
    groupId?: string
  ): { success: boolean; reservation?: Reservation; invoice?: Invoice; error?: string } {
    const property = this.getPropertyById(propertyId);
    if (!property) return { success: false, error: 'Property not found.' };

    const room = property.rooms.find((r) => r.id === unitId);
    if (!room) return { success: false, error: 'Room or unit not found.' };

    if (room.availableSpaces <= 0) {
      return { success: false, error: 'Sorry! No available spaces left in this room.' };
    }

    const student = this.getStudentProfile(studentId);
    const user = this.getUserById(studentId);
    if (!student || !user) return { success: false, error: 'Student details missing.' };

    // Decrement inventory hold atomically
    room.availableSpaces -= 1;
    property.availableSpaces = property.rooms.reduce((acc, r) => acc + r.availableSpaces, 0);
    this.updateProperty(property);

    const now = new Date();
    // 7 days hold expiration
    const holdExpiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const reservationNumber = `OUT-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const newReservation: Reservation = {
      id: `res-${Date.now()}`,
      reservationNumber,
      studentId,
      studentName: student.fullName,
      studentEmail: user.email,
      studentPhone: student.phone,
      groupId,
      propertyId,
      propertyName: property.title,
      propertyAddress: property.address,
      landlordId: property.landlordId,
      unitId: room.id,
      unitName: room.name,
      status: 'pending_payment',
      amount: room.pricePerSession,
      currency: 'NGN',
      holdExpiresAt,
      createdAt: now.toISOString(),
    };

    const reservations = this.getReservations();
    reservations.push(newReservation);
    save(STORAGE_KEYS.RESERVATIONS, reservations);

    // Generate Invoice
    const invoiceNumber = `INV-${now.getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const newInvoice: Invoice = {
      id: `inv-${Date.now()}`,
      invoiceNumber,
      reservationId: newReservation.id,
      studentId,
      studentName: student.fullName,
      propertyId,
      propertyName: property.title,
      unitName: room.name,
      amount: room.pricePerSession,
      currency: 'NGN',
      dueDate: holdExpiresAt.split('T')[0],
      status: 'unpaid',
      bankDetails: {
        bankName: 'Guaranty Trust Bank (GTBank)',
        accountNumber: '0129849201',
        accountName: 'Okafor Student Properties Limited',
        paymentInstructions: `Make an external transfer or USSD deposit. Quote your reservation reference ${reservationNumber} as the transfer narration. Then upload your receipt before ${holdExpiresAt.split('T')[0]}.`,
      },
      createdAt: now.toISOString(),
    };

    const invoices = this.getInvoices();
    invoices.push(newInvoice);
    save(STORAGE_KEYS.INVOICES, invoices);

    // Notify student & landlord
    this.createNotification({
      userId: studentId,
      title: 'Reservation Hold Created',
      message: `Your 7-day temporary hold on ${room.name} at ${property.title} has been established. Ref: ${reservationNumber}`,
      type: 'success',
      link: `/student/reservations/${newReservation.id}`,
    });

    this.createNotification({
      userId: property.landlordId,
      title: 'New Reservation Hold Placed',
      message: `${student.fullName} placed a hold on ${room.name} at ${property.title}. Pending external payment receipt.`,
      type: 'info',
      link: `/landlord/receipts`,
    });

    this.logAudit({
      action: 'CREATE_RESERVATION_HOLD',
      actorId: studentId,
      actorName: student.fullName,
      actorRole: 'student',
      targetEntity: 'Reservation',
      targetId: newReservation.id,
      details: `Held 1 space in ${room.name} for ₦${room.pricePerSession.toLocaleString()}. Holds expire in 7 days (${holdExpiresAt}).`,
    });

    return { success: true, reservation: newReservation, invoice: newInvoice };
  }

  // Idempotent 7-Day Expiration Engine
  public checkAndExpireReservations(): { expiredCount: number; details: string[] } {
    const reservations = this.getReservations();
    const now = new Date().getTime();
    let expiredCount = 0;
    const details: string[] = [];

    reservations.forEach((res) => {
      // Must only expire unverified reservations (pending_payment or receipt_submitted where hold has elapsed)
      if (res.status === 'pending_payment') {
        const holdTime = new Date(res.holdExpiresAt).getTime();
        if (now > holdTime) {
          res.status = 'expired';
          res.cancellationReason = 'Automatic 7-day payment window expired.';
          expiredCount++;
          details.push(`Reservation ${res.reservationNumber} expired`);

          // Release inventory held
          const property = this.getPropertyById(res.propertyId);
          if (property) {
            const room = property.rooms.find((r) => r.id === res.unitId);
            if (room) {
              room.availableSpaces = Math.min(room.totalCapacity, room.availableSpaces + 1);
              property.availableSpaces = property.rooms.reduce((acc, r) => acc + r.availableSpaces, 0);
              this.updateProperty(property);
            }
          }

          // Update invoice
          const invoices = this.getInvoices();
          const inv = invoices.find((i) => i.reservationId === res.id);
          if (inv && inv.status === 'unpaid') {
            inv.status = 'expired';
            save(STORAGE_KEYS.INVOICES, invoices);
          }

          // Notifications & audit
          this.createNotification({
            userId: res.studentId,
            title: 'Reservation Hold Expired',
            message: `Your reservation ${res.reservationNumber} for ${res.propertyName} has expired after 7 days without payment verification.`,
            type: 'warning',
            link: `/student/reservations/${res.id}`,
          });

          this.logAudit({
            action: 'EXPIRE_SEVEN_DAY_RESERVATION',
            actorId: 'system-scheduler',
            actorName: 'Automated Expiration Daemon',
            actorRole: 'admin',
            targetEntity: 'Reservation',
            targetId: res.id,
            details: `Auto-released 1 space for ${res.propertyName} (${res.unitName}) due to expired 7-day hold window.`,
          });
        }
      }
    });

    if (expiredCount > 0) {
      save(STORAGE_KEYS.RESERVATIONS, reservations);
    }

    return { expiredCount, details };
  }

  public cancelReservation(reservationId: string, reason?: string): { success: boolean; message?: string } {
    const reservations = this.getReservations();
    const res = reservations.find((r) => r.id === reservationId);
    if (!res) return { success: false, message: 'Reservation not found.' };

    res.status = 'cancelled';
    res.cancellationReason = reason || 'Cancelled by student';

    const property = this.getPropertyById(res.propertyId);
    if (property) {
      const unit = property.rooms.find((u) => u.id === res.unitId);
      if (unit) {
        unit.availableSpaces = Math.min(unit.totalCapacity, unit.availableSpaces + 1);
        property.availableSpaces = property.rooms.reduce((acc, u) => acc + u.availableSpaces, 0);
        this.updateProperty(property);
      }
    }

    save(STORAGE_KEYS.RESERVATIONS, reservations);
    return { success: true, message: 'Reservation cancelled successfully.' };
  }

  // Invoices
  public getInvoices(): Invoice[] {
    return load(STORAGE_KEYS.INVOICES, SEED_INVOICES);
  }

  public getInvoiceById(id: string): Invoice | undefined {
    return this.getInvoices().find((i) => i.id === id);
  }

  public getInvoiceByReservationId(resId: string): Invoice | undefined {
    return this.getInvoices().find((i) => i.reservationId === resId);
  }

  // Payment Receipts
  public getPaymentReceipts(): PaymentReceipt[] {
    return load(STORAGE_KEYS.PAYMENT_RECEIPTS, SEED_PAYMENT_RECEIPTS);
  }

  public getPaymentReceiptsForLandlord(landlordId: string): PaymentReceipt[] {
    return this.getPaymentReceipts().filter((r) => r.landlordId === landlordId);
  }

  public getReceiptByReservationId(resId: string): PaymentReceipt | undefined {
    return this.getPaymentReceipts().find((r) => r.reservationId === resId);
  }

  public uploadPaymentReceipt(data: {
    reservationId: string;
    studentId: string;
    fileUrl: string;
    fileName: string;
    fileSize: number;
    paymentReference: string;
    payerBankName: string;
    paymentDate: string;
    amountPaid: number;
  }): { success: boolean; receipt?: PaymentReceipt; error?: string } {
    const reservation = this.getReservationById(data.reservationId);
    if (!reservation) return { success: false, error: 'Reservation not found.' };

    const receipts = this.getPaymentReceipts();
    const existingIdx = receipts.findIndex((r) => r.reservationId === data.reservationId);

    const invoice = this.getInvoiceByReservationId(data.reservationId);

    const receipt: PaymentReceipt = {
      id: existingIdx >= 0 ? receipts[existingIdx].id : `rcpt-${Date.now()}`,
      reservationId: data.reservationId,
      invoiceId: invoice?.id || 'inv-unknown',
      studentId: data.studentId,
      studentName: reservation.studentName,
      propertyId: reservation.propertyId,
      propertyName: reservation.propertyName,
      landlordId: reservation.landlordId,
      fileUrl: data.fileUrl,
      fileName: data.fileName,
      fileSize: data.fileSize,
      paymentReference: data.paymentReference,
      payerBankName: data.payerBankName,
      paymentDate: data.paymentDate,
      amountPaid: data.amountPaid,
      status: 'pending_review',
      uploadedAt: new Date().toISOString(),
    };

    if (existingIdx >= 0) {
      receipts[existingIdx] = receipt;
    } else {
      receipts.push(receipt);
    }
    save(STORAGE_KEYS.PAYMENT_RECEIPTS, receipts);

    // Update reservation status to receipt_submitted
    reservation.status = 'receipt_submitted';
    const reservations = this.getReservations().map((r) => (r.id === reservation.id ? reservation : r));
    save(STORAGE_KEYS.RESERVATIONS, reservations);

    // Update invoice status
    if (invoice) {
      invoice.status = 'payment_submitted';
      const invoices = this.getInvoices().map((i) => (i.id === invoice.id ? invoice : i));
      save(STORAGE_KEYS.INVOICES, invoices);
    }

    // Notifications
    this.createNotification({
      userId: reservation.landlordId,
      title: 'Payment Receipt Uploaded',
      message: `${reservation.studentName} uploaded payment receipt for ${reservation.reservationNumber} (₦${data.amountPaid.toLocaleString()}). Please review.`,
      type: 'info',
      link: '/landlord/receipts',
    });

    this.createNotification({
      userId: data.studentId,
      title: 'Receipt Submitted for Verification',
      message: `Your payment receipt for ${reservation.propertyName} has been submitted to the landlord for confirmation.`,
      type: 'success',
      link: `/student/reservations/${reservation.id}`,
    });

    this.logAudit({
      action: 'UPLOAD_PAYMENT_RECEIPT',
      actorId: data.studentId,
      actorName: reservation.studentName,
      actorRole: 'student',
      targetEntity: 'PaymentReceipt',
      targetId: receipt.id,
      details: `Uploaded receipt ref ${data.paymentReference} (₦${data.amountPaid.toLocaleString()} from ${data.payerBankName}).`,
    });

    return { success: true, receipt };
  }

  public reviewPaymentReceipt(
    receiptId: string,
    decision: 'approved' | 'rejected',
    landlordId: string,
    rejectionReason?: string
  ): { success: boolean; error?: string } {
    const receipts = this.getPaymentReceipts();
    const receipt = receipts.find((r) => r.id === receiptId);
    if (!receipt) return { success: false, error: 'Receipt not found.' };

    if (receipt.landlordId !== landlordId) {
      return { success: false, error: 'Unauthorized: Landlords can only review receipts for their own properties.' };
    }

    const reservation = this.getReservationById(receipt.reservationId);
    if (!reservation) return { success: false, error: 'Associated reservation not found.' };

    receipt.status = decision;
    receipt.reviewedAt = new Date().toISOString();
    receipt.reviewedBy = landlordId;
    receipt.rejectionReason = decision === 'rejected' ? rejectionReason : undefined;
    save(STORAGE_KEYS.PAYMENT_RECEIPTS, receipts);

    const invoices = this.getInvoices();
    const invoice = invoices.find((i) => i.reservationId === reservation.id);

    if (decision === 'approved') {
      reservation.status = 'confirmed';
      reservation.confirmedAt = new Date().toISOString();

      if (invoice) {
        invoice.status = 'paid';
        save(STORAGE_KEYS.INVOICES, invoices);
      }

      this.createNotification({
        userId: reservation.studentId,
        title: 'Reservation Payment Confirmed!',
        message: `Congratulations! Your payment for ${reservation.propertyName} (${reservation.unitName}) has been approved by the landlord. Your reservation is confirmed!`,
        type: 'success',
        link: `/student/reservations/${reservation.id}`,
      });
    } else {
      reservation.status = 'rejected';
      reservation.cancellationReason = rejectionReason || 'Payment receipt rejected by landlord.';

      // Release inventory hold
      const property = this.getPropertyById(reservation.propertyId);
      if (property) {
        const room = property.rooms.find((r) => r.id === reservation.unitId);
        if (room) {
          room.availableSpaces = Math.min(room.totalCapacity, room.availableSpaces + 1);
          property.availableSpaces = property.rooms.reduce((acc, r) => acc + r.availableSpaces, 0);
          this.updateProperty(property);
        }
      }

      this.createNotification({
        userId: reservation.studentId,
        title: 'Payment Receipt Rejected',
        message: `Your payment receipt for ${reservation.propertyName} was rejected: ${rejectionReason || 'Unable to confirm bank credit.'}`,
        type: 'warning',
        link: `/student/reservations/${reservation.id}`,
      });
    }

    const reservations = this.getReservations().map((r) => (r.id === reservation.id ? reservation : r));
    save(STORAGE_KEYS.RESERVATIONS, reservations);

    this.logAudit({
      action: decision === 'approved' ? 'APPROVE_PAYMENT_RECEIPT' : 'REJECT_PAYMENT_RECEIPT',
      actorId: landlordId,
      actorName: 'Landlord',
      actorRole: 'landlord',
      targetEntity: 'PaymentReceipt',
      targetId: receiptId,
      details: `Receipt decision: ${decision}. Reservation ${reservation.reservationNumber} now ${reservation.status}. Note: ${rejectionReason || 'Bank credit confirmed'}`,
    });

    return { success: true };
  }

  // Real-Time Chat Engine
  public getConversations(userId: string): Conversation[] {
    const convos = load<Conversation[]>(STORAGE_KEYS.CONVERSATIONS, SEED_CONVERSATIONS);
    return convos.filter((c) => c.participantIds.includes(userId));
  }

  public getConversationById(id: string): Conversation | undefined {
    const convos = load<Conversation[]>(STORAGE_KEYS.CONVERSATIONS, SEED_CONVERSATIONS);
    return convos.find((c) => c.id === id);
  }

  public getMessages(conversationId: string): ChatMessage[] {
    const messages = load<ChatMessage[]>(STORAGE_KEYS.MESSAGES, SEED_MESSAGES);
    return messages
      .filter((m) => m.conversationId === conversationId && !m.isDeleted)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  public sendMessage(
    conversationId: string,
    senderId: string,
    text: string,
    options?: { replyTo?: MessageReplyReference; mentions?: MessageMention[] }
  ): ChatMessage {
    const conv = this.getConversationById(conversationId);
    if (!conv) {
      throw new Error('Conversation not found.');
    }

    if (!conv.participantIds.includes(senderId)) {
      throw new Error('You are not an active participant in this conversation.');
    }

    const trimmedText = text.trim();
    if (!trimmedText) {
      throw new Error('Message text cannot be empty.');
    }

    const user = this.getUserById(senderId);
    const student = this.getStudentProfile(senderId);
    const landlord = this.getLandlordProfile(senderId);
    const senderName = student?.fullName || landlord?.legalName || (user?.role === 'admin' ? 'Outpost Admin' : 'User');
    const now = new Date().toISOString();

    const newMessage: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      conversationId,
      senderId,
      senderName,
      senderAvatar: user?.avatarUrl,
      senderRole: user?.role || 'student',
      text: trimmedText,
      status: 'delivered',
      deliveryStatus: 'delivered',
      sentAt: now,
      deliveredAt: now,
      replyTo: options?.replyTo,
      mentions: options?.mentions,
      createdAt: now,
      updatedAt: now,
    };

    const messages = load<ChatMessage[]>(STORAGE_KEYS.MESSAGES, SEED_MESSAGES);
    messages.push(newMessage);
    save(STORAGE_KEYS.MESSAGES, messages);

    // Update conversation snippet
    const convos = load<Conversation[]>(STORAGE_KEYS.CONVERSATIONS, SEED_CONVERSATIONS);
    const c = convos.find((item) => item.id === conversationId);
    if (c) {
      c.lastMessageId = newMessage.id;
      c.lastMessageText = trimmedText;
      c.lastMessageTimestamp = now;
      c.lastMessageAt = now;
      c.updatedAt = now;
      c.unreadCount = (c.unreadCount || 0) + 1;
      save(STORAGE_KEYS.CONVERSATIONS, convos);
    }

    // Handle mentions notifications
    if (options?.mentions && options.mentions.length > 0) {
      options.mentions.forEach((mention) => {
        if (mention.userId !== senderId && conv.participantIds.includes(mention.userId)) {
          this.createNotification({
            userId: mention.userId,
            title: 'Mentioned in Chat',
            message: `${senderName} mentioned you: "${trimmedText.length > 40 ? trimmedText.substring(0, 37) + '...' : trimmedText}"`,
            type: 'info',
            link: `/student/chat/${conversationId}`,
          });
        }
      });
    }

    // Publish to event bus for live reactive updates
    appEventBus.publish(`chat:${conversationId}`, newMessage);
    appEventBus.publish('conversationsUpdated', convos);

    return newMessage;
  }

  public editMessage(
    messageId: string,
    userId: string,
    newText: string
  ): { success: boolean; error?: string; message?: ChatMessage } {
    const messages = load<ChatMessage[]>(STORAGE_KEYS.MESSAGES, SEED_MESSAGES);
    const message = messages.find((m) => m.id === messageId);
    if (!message) {
      return { success: false, error: 'Message not found.' };
    }

    // Strict ownership validation: Only sender can edit their own message
    if (message.senderId !== userId) {
      return { success: false, error: 'You can only edit messages sent by you.' };
    }

    // Authoritative 15-minute time window check
    const messageTime = new Date(message.createdAt).getTime();
    const currentTime = Date.now();
    const fifteenMinutesMs = 15 * 60 * 1000;

    if (currentTime - messageTime > fifteenMinutesMs) {
      return {
        success: false,
        error: 'Message editing window has expired (15 minutes limit).',
      };
    }

    const trimmed = newText.trim();
    if (!trimmed) {
      return { success: false, error: 'Message text cannot be empty.' };
    }

    // Update message while strictly preserving senderId, conversationId, and createdAt
    message.text = trimmed;
    message.isEdited = true;
    message.editedAt = new Date().toISOString();
    message.updatedAt = message.editedAt;

    save(STORAGE_KEYS.MESSAGES, messages);

    // Update conversation if this was the last message
    const convos = load<Conversation[]>(STORAGE_KEYS.CONVERSATIONS, SEED_CONVERSATIONS);
    const c = convos.find((conv) => conv.id === message.conversationId);
    if (c && c.lastMessageId === message.id) {
      c.lastMessageText = trimmed;
      c.updatedAt = message.editedAt;
      save(STORAGE_KEYS.CONVERSATIONS, convos);
      appEventBus.publish('conversationsUpdated', convos);
    }

    appEventBus.publish(`chat:${message.conversationId}`, message);
    return { success: true, message };
  }

  public retryFailedMessage(messageId: string, userId: string): { success: boolean; error?: string; message?: ChatMessage } {
    const messages = load<ChatMessage[]>(STORAGE_KEYS.MESSAGES, SEED_MESSAGES);
    const message = messages.find((m) => m.id === messageId);
    if (!message) return { success: false, error: 'Message not found.' };
    if (message.senderId !== userId) return { success: false, error: 'Unauthorized.' };

    const now = new Date().toISOString();
    message.status = 'delivered';
    message.deliveryStatus = 'delivered';
    message.sentAt = now;
    message.deliveredAt = now;
    message.failedAt = undefined;
    message.deliveryError = undefined;
    message.updatedAt = now;

    save(STORAGE_KEYS.MESSAGES, messages);
    appEventBus.publish(`chat:${message.conversationId}`, message);

    const convos = load<Conversation[]>(STORAGE_KEYS.CONVERSATIONS, SEED_CONVERSATIONS);
    appEventBus.publish('conversationsUpdated', convos);

    return { success: true, message };
  }

  public markMessagesAsRead(conversationId: string, userId: string): void {
    const messages = load<ChatMessage[]>(STORAGE_KEYS.MESSAGES, SEED_MESSAGES);
    const now = new Date().toISOString();
    let updatedCount = 0;

    messages.forEach((m) => {
      if (m.conversationId === conversationId && m.senderId !== userId && m.status !== 'read') {
        m.status = 'read';
        m.deliveryStatus = 'read';
        m.readAt = now;
        m.updatedAt = now;
        updatedCount++;
      }
    });

    if (updatedCount > 0) {
      save(STORAGE_KEYS.MESSAGES, messages);
    }

    const convos = load<Conversation[]>(STORAGE_KEYS.CONVERSATIONS, SEED_CONVERSATIONS);
    const conv = convos.find((c) => c.id === conversationId);
    if (conv) {
      conv.unreadCount = 0;
      const participant = conv.participants.find((p) => p.userId === userId);
      if (participant) {
        participant.lastReadAt = now;
      }
      save(STORAGE_KEYS.CONVERSATIONS, convos);
      appEventBus.publish('conversationsUpdated', convos);
    }

    appEventBus.publish(`chat:read:${conversationId}`, { userId, readAt: now });
  }

  public searchMessages(conversationId: string, query: string): ChatMessage[] {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return [];
    const messages = this.getMessages(conversationId);
    return messages.filter((m) => m.text.toLowerCase().includes(trimmed));
  }

  public toggleMuteConversation(conversationId: string, userId: string): boolean {
    const convos = load<Conversation[]>(STORAGE_KEYS.CONVERSATIONS, SEED_CONVERSATIONS);
    const conv = convos.find((c) => c.id === conversationId);
    if (!conv) return false;
    conv.isMuted = !conv.isMuted;
    save(STORAGE_KEYS.CONVERSATIONS, convos);
    appEventBus.publish('conversationsUpdated', convos);
    return conv.isMuted;
  }

  public archiveConversation(conversationId: string, userId: string): boolean {
    const convos = load<Conversation[]>(STORAGE_KEYS.CONVERSATIONS, SEED_CONVERSATIONS);
    const conv = convos.find((c) => c.id === conversationId);
    if (!conv) return false;
    conv.archivedAt = conv.archivedAt ? undefined : new Date().toISOString();
    save(STORAGE_KEYS.CONVERSATIONS, convos);
    appEventBus.publish('conversationsUpdated', convos);
    return !!conv.archivedAt;
  }

  public startDirectConversation(userIdA: string, userIdB: string): Conversation {
    if (userIdA === userIdB) {
      throw new Error('Cannot start a direct conversation with yourself.');
    }

    const convos = load<Conversation[]>(STORAGE_KEYS.CONVERSATIONS, SEED_CONVERSATIONS);
    // Explicit direct check with exactly two participants preventing duplicate direct threads
    const existing = convos.find(
      (c) =>
        c.type === 'direct' &&
        c.participantIds.length === 2 &&
        c.participantIds.includes(userIdA) &&
        c.participantIds.includes(userIdB)
    );
    if (existing) return existing;

    const userA = this.getUserById(userIdA);
    const userB = this.getUserById(userIdB);
    const studentB = this.getStudentProfile(userIdB);
    const landlordB = this.getLandlordProfile(userIdB);
    const nameB = studentB?.fullName || landlordB?.legalName || userB?.email || 'User';

    const now = new Date().toISOString();
    const newConv: Conversation = {
      id: `conv-${Date.now()}`,
      type: 'direct',
      title: nameB,
      name: nameB,
      createdBy: userIdA,
      participantIds: [userIdA, userIdB],
      participants: [
        {
          userId: userIdA,
          name: this.getUserDisplayName(userIdA),
          avatarUrl: userA?.avatarUrl,
          role: userA?.role || 'student',
          isOnline: true,
        },
        {
          userId: userIdB,
          name: nameB,
          avatarUrl: userB?.avatarUrl,
          role: userB?.role || 'student',
          isOnline: true,
        },
      ],
      lastMessageText: 'Conversation started',
      lastMessageTimestamp: now,
      createdAt: now,
      updatedAt: now,
      unreadCount: 0,
    };

    convos.push(newConv);
    save(STORAGE_KEYS.CONVERSATIONS, convos);
    appEventBus.publish('conversationsUpdated', convos);
    return newConv;
  }

  private getUserDisplayName(userId: string): string {
    const student = this.getStudentProfile(userId);
    if (student) return student.fullName;
    const landlord = this.getLandlordProfile(userId);
    if (landlord) return landlord.legalName;
    const user = this.getUserById(userId);
    return user?.email || 'User';
  }

  // Notifications
  public getNotifications(userId: string): AppNotification[] {
    const notifs = load<AppNotification[]>(STORAGE_KEYS.NOTIFICATIONS, SEED_NOTIFICATIONS);
    return notifs
      .filter((n) => n.userId === userId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public createNotification(data: Omit<AppNotification, 'id' | 'createdAt' | 'isRead'>): AppNotification {
    const notifs = load<AppNotification[]>(STORAGE_KEYS.NOTIFICATIONS, SEED_NOTIFICATIONS);
    const newNotif: AppNotification = {
      ...data,
      id: `notif-${Date.now()}`,
      isRead: false,
      createdAt: new Date().toISOString(),
    };
    notifs.unshift(newNotif);
    save(STORAGE_KEYS.NOTIFICATIONS, notifs);
    appEventBus.publish(`notifications:${data.userId}`, newNotif);
    return newNotif;
  }

  public markNotificationAsRead(id: string): void {
    const notifs = load<AppNotification[]>(STORAGE_KEYS.NOTIFICATIONS, SEED_NOTIFICATIONS);
    const n = notifs.find((item) => item.id === id);
    if (n) {
      n.isRead = true;
      save(STORAGE_KEYS.NOTIFICATIONS, notifs);
    }
  }

  public markAllNotificationsAsRead(userId: string): void {
    const notifs = load<AppNotification[]>(STORAGE_KEYS.NOTIFICATIONS, SEED_NOTIFICATIONS);
    notifs.forEach((n) => {
      if (n.userId === userId) n.isRead = true;
    });
    save(STORAGE_KEYS.NOTIFICATIONS, notifs);
  }

  // Audit Logs
  public getAuditLogs(): AuditLog[] {
    const logs = load<AuditLog[]>(STORAGE_KEYS.AUDIT_LOGS, SEED_AUDIT_LOGS);
    return logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  public logAudit(log: Omit<AuditLog, 'id' | 'timestamp'>): void {
    const logs = load<AuditLog[]>(STORAGE_KEYS.AUDIT_LOGS, SEED_AUDIT_LOGS);
    logs.unshift({
      ...log,
      id: `audit-${Date.now()}`,
      timestamp: new Date().toISOString(),
    });
    save(STORAGE_KEYS.AUDIT_LOGS, logs);
  }

  public createAuditLog(data: {
    action: string;
    actorId: string;
    actorName: string;
    actorRole: UserRole;
    targetEntity?: string;
    targetId?: string;
    details: string;
  }): void {
    this.logAudit({
      action: data.action,
      actorId: data.actorId,
      actorName: data.actorName,
      actorRole: data.actorRole,
      targetEntity: data.targetEntity || 'SYSTEM',
      targetId: data.targetId || '',
      details: data.details,
    });
  }
}

export const repository = new LocalStorageRepository();
