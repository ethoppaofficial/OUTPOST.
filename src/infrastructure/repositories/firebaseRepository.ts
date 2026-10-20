import {
  collection,
  doc,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '../firebase/firebaseConfig';
import { handleFirestoreError, OperationType } from '../firebase/errorHandler';
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

const STORAGE_KEYS = {
  CURRENT_USER_ID: 'outpost_active_user_id',
  USERS: 'outpost_users_v3',
  STUDENT_PROFILES: 'outpost_student_profiles_v3',
  STUDENT_DOCS: 'outpost_student_docs_v3',
  LANDLORD_PROFILES: 'outpost_landlord_profiles_v3',
  PROPERTIES: 'outpost_properties_v3',
  PROPERTY_LOCATIONS: 'outpost_property_locations_v3',
  PREFERENCES: 'outpost_preferences_v3',
  ROOMMATE_REQUESTS: 'outpost_roommate_requests_v3',
  GROUPS: 'outpost_groups_v3',
  INVITATIONS: 'outpost_invitations_v3',
  GROUP_JOIN_REQUESTS: 'outpost_group_join_requests_v3',
  RESERVATIONS: 'outpost_reservations_v3',
  INVOICES: 'outpost_invoices_v3',
  RECEIPTS: 'outpost_receipts_v3',
  NOTIFICATIONS: 'outpost_notifications_v3',
  CONVERSATIONS: 'outpost_conversations_v3',
  MESSAGES: 'outpost_messages_v3',
  AUDIT_LOGS: 'outpost_audit_logs_v3',
};

function load<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function save<T>(key: string, data: T): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // Ignore storage quota errors
  }
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      const cleaned: Record<string, any> = {};
      for (const [k, v] of Object.entries(value as Record<string, any>)) {
        if (v !== undefined) {
          cleaned[k] = stripUndefined(v);
        }
      }
      return cleaned as T;
    }
  }
  return value;
}

export class FirebaseRepository {
  private isLiveInitialized = false;

  constructor() {
    if (typeof window !== 'undefined') {
      this.init().catch((err) => console.warn('Firebase sync initialization notice:', err));
    }
  }

  private canSyncToFirestore(targetOwnerId?: string): boolean {
    if (!auth.currentUser) return false;
    if (!targetOwnerId) return true;
    return auth.currentUser.uid === targetOwnerId;
  }

  public async init(): Promise<void> {
    if (this.isLiveInitialized) return;
    this.isLiveInitialized = true;

    try {
      const publicPropsQuery = query(
        collection(db, 'properties'),
        where('verificationStatus', '==', 'approved'),
        where('locationVerificationStatus', '==', 'verified'),
        where('area', 'in', ['Dambare', 'Rimin Gata']),
        where('state', '==', 'Kano State'),
        where('isActive', '==', true)
      );

      onSnapshot(
        publicPropsQuery,
        (snapshot) => {
          const props = this.getProperties();
          let changed = false;
          snapshot.docChanges().forEach((change) => {
            const prop = { ...(change.doc.data() as Property), id: change.doc.id };
            if (change.type === 'added' || change.type === 'modified') {
              const idx = props.findIndex((p) => p.id === prop.id);
              if (idx === -1) {
                props.push(prop);
              } else {
                props[idx] = prop;
              }
              changed = true;
            }
          });
          if (changed) {
            save(STORAGE_KEYS.PROPERTIES, props);
          }
        },
        (err) => {
          console.info('Firestore properties listener notice:', err.message);
        }
      );
    } catch (e) {
      console.warn('Firebase init snapshot listeners notice:', e);
    }
  }

  public resetToSeed(): void {
    if (typeof window !== 'undefined') {
      Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
    }
    appEventBus.publish('userChanged', '');
  }

  // Auth & User Management
  public getUsers(): User[] {
    return load<User[]>(STORAGE_KEYS.USERS, []);
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
    const existingIdx = users.findIndex((u) => u.id === user.id);
    if (existingIdx >= 0) {
      users[existingIdx] = user;
    } else {
      users.push(user);
    }
    save(STORAGE_KEYS.USERS, users);

    if (this.canSyncToFirestore(user.id)) {
      setDoc(
        doc(db, 'users', user.id),
        stripUndefined({
          ...user,
          serverCreatedAt: serverTimestamp(),
        }),
        { merge: true }
      ).catch((err) => handleFirestoreError(err, OperationType.WRITE, `users/${user.id}`));
    }
    return user;
  }

  public updateUser(user: User): User {
    const users = this.getUsers().map((u) => (u.id === user.id ? user : u));
    save(STORAGE_KEYS.USERS, users);

    if (this.canSyncToFirestore(user.id)) {
      updateDoc(
        doc(db, 'users', user.id),
        stripUndefined({
          ...user,
          updatedAt: serverTimestamp(),
        })
      ).catch((err) => handleFirestoreError(err, OperationType.WRITE, `users/${user.id}`));
    }
    return user;
  }

  public getActiveUserId(): string {
    if (typeof window === 'undefined') return '';
    const stored = localStorage.getItem(STORAGE_KEYS.CURRENT_USER_ID);
    if (!stored) return '';
    try {
      return JSON.parse(stored) || '';
    } catch {
      return '';
    }
  }

  public setActiveUserId(userId: string): void {
    if (typeof window !== 'undefined') {
      if (!userId) {
        localStorage.removeItem(STORAGE_KEYS.CURRENT_USER_ID);
      } else {
        localStorage.setItem(STORAGE_KEYS.CURRENT_USER_ID, JSON.stringify(userId));
      }
    }
    appEventBus.publish('userChanged', userId);
  }

  public clearActiveUserId(): void {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEYS.CURRENT_USER_ID);
    }
    appEventBus.publish('userChanged', '');
  }

  public clearActiveSession(): void {
    this.clearActiveUserId();
  }

  // Public Profiles
  public async getPublicProfile(userId: string): Promise<PublicProfile | null> {
    const user = this.getUserById(userId);
    if (!user) return null;
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

  public async savePublicProfile(profile: PublicProfile): Promise<void> {
    if (!this.canSyncToFirestore(profile.id)) return;
    await setDoc(
      doc(db, 'publicProfiles', profile.id),
      stripUndefined({
        ...profile,
        updatedAt: serverTimestamp(),
      }),
      { merge: true }
    ).catch((err) => handleFirestoreError(err, OperationType.WRITE, `publicProfiles/${profile.id}`));
  }

  // Student Profiles & Verification Documents
  public getStudentProfiles(): StudentProfile[] {
    return load<StudentProfile[]>(STORAGE_KEYS.STUDENT_PROFILES, []);
  }

  public getStudentProfile(userId: string): StudentProfile | undefined {
    return this.getStudentProfiles().find((p) => p.userId === userId);
  }

  public saveStudentProfile(profile: StudentProfile): StudentProfile {
    const list = this.getStudentProfiles();
    const index = list.findIndex((p) => p.userId === profile.userId);
    if (index >= 0) {
      list[index] = profile;
    } else {
      list.push(profile);
    }
    save(STORAGE_KEYS.STUDENT_PROFILES, list);

    if (this.canSyncToFirestore(profile.userId)) {
      setDoc(
        doc(db, 'studentProfiles', profile.userId),
        stripUndefined({
          ...profile,
          updatedAt: serverTimestamp(),
        }),
        { merge: true }
      ).catch((err) => handleFirestoreError(err, OperationType.WRITE, `studentProfiles/${profile.userId}`));
    }
    return profile;
  }

  public searchStudentByRegistrationNumber(regNumber: string): StudentProfile | undefined {
    const normalized = regNumber.trim().toUpperCase();
    return this.getStudentProfiles().find(
      (p) => p.registrationNumber.trim().toUpperCase() === normalized
    );
  }

  public searchStudents(queryStr: string): StudentProfile[] {
    const q = queryStr.trim().toLowerCase();
    const profiles = this.getStudentProfiles();
    if (!q) return profiles;
    return profiles.filter(
      (p) =>
        p.fullName.toLowerCase().includes(q) ||
        p.registrationNumber.toLowerCase().includes(q) ||
        p.programme.toLowerCase().includes(q)
    );
  }

  public getStudentDocs(studentId?: string): StudentVerificationDocument[] {
    const docs = load<StudentVerificationDocument[]>(STORAGE_KEYS.STUDENT_DOCS, []);
    if (studentId) {
      return docs.filter((d) => d.studentId === studentId);
    }
    return docs;
  }

  public addStudentDocument(docData: {
    studentId: string;
    studentName: string;
    documentType: StudentDocumentType;
    fileName: string;
    fileSize: number;
    documentUrl: string;
  }): StudentVerificationDocument {
    const docs = this.getStudentDocs();
    const newDoc: StudentVerificationDocument = {
      id: `doc-${Date.now()}`,
      ...docData,
      uploadedAt: new Date().toISOString(),
      status: 'pending',
    };
    docs.unshift(newDoc);
    save(STORAGE_KEYS.STUDENT_DOCS, docs);

    const user = this.getUserById(docData.studentId);
    if (user && user.accountStatus !== 'profile_verified') {
      user.accountStatus = 'profile_pending';
      this.updateUser(user);
    }

    if (this.canSyncToFirestore(docData.studentId)) {
      setDoc(
        doc(db, 'studentVerificationDocuments', newDoc.id),
        stripUndefined({
          ...newDoc,
          serverUploadedAt: serverTimestamp(),
        })
      ).catch((err) =>
        handleFirestoreError(err, OperationType.WRITE, `studentVerificationDocuments/${newDoc.id}`)
      );
    }
    return newDoc;
  }

  public reviewStudentDocument(
    docId: string,
    status: VerificationReviewStatus,
    reviewerId: string,
    rejectionReason?: string
  ): StudentVerificationDocument | undefined {
    const docs = this.getStudentDocs();
    const target = docs.find((d) => d.id === docId);
    if (!target) return undefined;

    target.status = status;
    target.reviewedAt = new Date().toISOString();
    target.reviewerId = reviewerId;
    target.rejectionReason = rejectionReason;
    save(STORAGE_KEYS.STUDENT_DOCS, docs);

    const profile = this.getStudentProfile(target.studentId);
    const user = this.getUserById(target.studentId);

    if (status === 'approved') {
      if (profile) {
        profile.isProfileVerified = true;
        this.saveStudentProfile(profile);
      }
      if (user) {
        user.accountStatus = 'profile_verified';
        this.updateUser(user);
      }
    } else if (status === 'rejected') {
      if (user) {
        user.accountStatus = 'rejected';
        this.updateUser(user);
      }
    }

    if (this.canSyncToFirestore()) {
      updateDoc(doc(db, 'studentVerificationDocuments', docId), {
        status,
        reviewerId: auth.currentUser?.uid || reviewerId,
        reviewedAt: serverTimestamp(),
        rejectionReason: rejectionReason || null,
      }).catch((err) =>
        handleFirestoreError(err, OperationType.WRITE, `studentVerificationDocuments/${docId}`)
      );
    }

    return target;
  }

  // Landlord Profiles & Verification
  public getLandlordProfiles(): LandlordProfile[] {
    return load<LandlordProfile[]>(STORAGE_KEYS.LANDLORD_PROFILES, []);
  }

  public getLandlordProfile(userId: string): LandlordProfile | undefined {
    return this.getLandlordProfiles().find((p) => p.userId === userId);
  }

  public saveLandlordProfile(profile: LandlordProfile): LandlordProfile {
    const list = this.getLandlordProfiles();
    const index = list.findIndex((p) => p.userId === profile.userId);
    if (index >= 0) {
      list[index] = profile;
    } else {
      list.push(profile);
    }
    save(STORAGE_KEYS.LANDLORD_PROFILES, list);

    if (this.canSyncToFirestore(profile.userId)) {
      setDoc(
        doc(db, 'landlordProfiles', profile.userId),
        stripUndefined({
          ...profile,
          updatedAt: serverTimestamp(),
        }),
        { merge: true }
      ).catch((err) => handleFirestoreError(err, OperationType.WRITE, `landlordProfiles/${profile.userId}`));
    }
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
      profile.rejectionReason = reason || 'Incomplete verification documents.';
    }
    this.saveLandlordProfile(profile);

    if (this.canSyncToFirestore()) {
      updateDoc(doc(db, 'landlordProfiles', userId), {
        verificationStatus: decision,
        verifiedAt: decision === 'approved' ? serverTimestamp() : null,
        rejectionReason: reason || null,
        reviewedBy: auth.currentUser?.uid || reviewerId,
      }).catch((err) => handleFirestoreError(err, OperationType.WRITE, `landlordProfiles/${userId}`));
    }

    return profile;
  }

  // PropertyLocations & Properties
  public getPropertyLocations(): PropertyLocation[] {
    return load<PropertyLocation[]>(STORAGE_KEYS.PROPERTY_LOCATIONS, []);
  }

  public getPropertyLocationByPropertyId(propertyId: string): PropertyLocation | undefined {
    return this.getPropertyLocations().find((loc) => loc.propertyId === propertyId);
  }

  public savePropertyLocation(loc: PropertyLocation): PropertyLocation {
    const list = this.getPropertyLocations();
    const index = list.findIndex((item) => item.id === loc.id || item.propertyId === loc.propertyId);
    const updatedLoc: PropertyLocation = {
      ...loc,
      geohash: loc.geohash || encodeGeohash(loc.latitude, loc.longitude),
      updatedAt: new Date().toISOString(),
    };
    if (index >= 0) {
      list[index] = updatedLoc;
    } else {
      list.push(updatedLoc);
    }
    save(STORAGE_KEYS.PROPERTY_LOCATIONS, list);
    return updatedLoc;
  }

  public getProperties(): Property[] {
    return load<Property[]>(STORAGE_KEYS.PROPERTIES, []);
  }

  public getPropertyById(id: string): Property | undefined {
    return this.getProperties().find((p) => p.id === id);
  }

  public getPropertyBySlug(slug: string): Property | undefined {
    return this.getProperties().find((p) => p.slug === slug);
  }

  public createProperty(prop: Property): Property {
    const list = this.getProperties();
    let savedLocation: PropertyLocation | undefined = undefined;
    if (prop.location) {
      savedLocation = this.savePropertyLocation(prop.location);
      prop.location = savedLocation;
    }
    list.unshift(prop);
    save(STORAGE_KEYS.PROPERTIES, list);

    if (this.canSyncToFirestore(prop.landlordId)) {
      // 1. Sync private property location separately into propertyLocations/{id}
      if (savedLocation) {
        setDoc(
          doc(db, 'propertyLocations', prop.id),
          stripUndefined({
            ...savedLocation,
            propertyId: prop.id,
            submittedBy: prop.landlordId,
            verificationStatus: 'pending',
            submittedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }),
          { merge: true }
        ).catch((err) => handleFirestoreError(err, OperationType.WRITE, `propertyLocations/${prop.id}`));
      }

      // 2. Public property document must NEVER contain raw exact latitude/longitude or full private location
      const {
        latitude: _rawLat,
        longitude: _rawLng,
        location: _rawLocation,
        ...safePublicDoc
      } = prop;

      setDoc(
        doc(db, 'properties', prop.id),
        stripUndefined({
          ...safePublicDoc,
          serverCreatedAt: serverTimestamp(),
        })
      ).catch((err) => handleFirestoreError(err, OperationType.WRITE, `properties/${prop.id}`));
    }
    return prop;
  }

  public updateProperty(prop: Property): Property {
    let savedLocation: PropertyLocation | undefined = undefined;
    if (prop.location) {
      savedLocation = this.savePropertyLocation(prop.location);
      prop.location = savedLocation;
    }
    const list = this.getProperties().map((p) => (p.id === prop.id ? prop : p));
    save(STORAGE_KEYS.PROPERTIES, list);

    if (this.canSyncToFirestore(prop.landlordId)) {
      if (savedLocation) {
        setDoc(
          doc(db, 'propertyLocations', prop.id),
          stripUndefined({
            ...savedLocation,
            propertyId: prop.id,
            submittedBy: prop.landlordId,
            updatedAt: serverTimestamp(),
          }),
          { merge: true }
        ).catch((err) => handleFirestoreError(err, OperationType.WRITE, `propertyLocations/${prop.id}`));
      }

      const {
        latitude: _rawLat,
        longitude: _rawLng,
        location: _rawLocation,
        ...safePublicDoc
      } = prop;

      setDoc(
        doc(db, 'properties', prop.id),
        stripUndefined({
          ...safePublicDoc,
          serverUpdatedAt: serverTimestamp(),
        }),
        { merge: true }
      ).catch((err) => handleFirestoreError(err, OperationType.WRITE, `properties/${prop.id}`));
    }
    return prop;
  }

  public updatePropertyAvailability(
    propertyId: string,
    unitId: string,
    newAvailableSpaces: number
  ): Property | undefined {
    const prop = this.getPropertyById(propertyId);
    if (!prop) return undefined;

    const unit = prop.rooms.find((u) => u.id === unitId);
    if (!unit) return undefined;

    const clamped = Math.max(0, Math.min(unit.totalCapacity, newAvailableSpaces));
    unit.availableSpaces = clamped;

    prop.availableSpaces = prop.rooms.reduce((acc, u) => acc + u.availableSpaces, 0);
    prop.updatedAt = new Date().toISOString();
    return this.updateProperty(prop);
  }

  // Roommate Preferences & Matching
  public getRoommatePreferences(): RoommatePreference[] {
    return load<RoommatePreference[]>(STORAGE_KEYS.PREFERENCES, []);
  }

  public getRoommatePreference(studentId: string): RoommatePreference | undefined {
    return this.getRoommatePreferences().find((p) => p.studentId === studentId);
  }

  public saveRoommatePreference(pref: RoommatePreference): RoommatePreference {
    const list = this.getRoommatePreferences();
    const index = list.findIndex((p) => p.studentId === pref.studentId);
    if (index >= 0) {
      list[index] = pref;
    } else {
      list.push(pref);
    }
    save(STORAGE_KEYS.PREFERENCES, list);

    if (this.canSyncToFirestore(pref.studentId)) {
      setDoc(
        doc(db, 'roommatePreferences', pref.studentId),
        stripUndefined({
          ...pref,
          updatedAt: serverTimestamp(),
        }),
        { merge: true }
      ).catch(() => {});
    }
    return pref;
  }

  public getSuggestedRoommates(studentId: string): Array<{
    student: StudentProfile;
    profile: StudentProfile;
    user: User;
    preference: RoommatePreference;
    compatibility: CompatibilityResult;
  }> {
    const myProfile = this.getStudentProfile(studentId);
    const myPref = this.getRoommatePreference(studentId);
    if (!myProfile || !myPref) return [];

    const allPrefs = this.getRoommatePreferences().filter((p) => p.studentId !== studentId);
    const results: Array<{
      student: StudentProfile;
      profile: StudentProfile;
      user: User;
      preference: RoommatePreference;
      compatibility: CompatibilityResult;
    }> = [];

    for (const otherPref of allPrefs) {
      const otherProfile = this.getStudentProfile(otherPref.studentId);
      const otherUser = this.getUserById(otherPref.studentId);
      if (!otherProfile || !otherUser) continue;

      const score = calculateCompatibility(myPref, otherPref);
      results.push({
        student: otherProfile,
        profile: otherProfile,
        user: otherUser,
        preference: otherPref,
        compatibility: score,
      });
    }

    return results.sort((a, b) => b.compatibility.score - a.compatibility.score);
  }

  // Roommate Requests
  public getRoommateRequests(userId: string): {
    incoming: RoommateRequest[];
    outgoing: RoommateRequest[];
    received: RoommateRequest[];
    sent: RoommateRequest[];
  } {
    const all = load<RoommateRequest[]>(STORAGE_KEYS.ROOMMATE_REQUESTS, []);
    const incoming = all.filter((r) => r.receiverId === userId);
    const outgoing = all.filter((r) => r.senderId === userId);
    return {
      incoming,
      outgoing,
      received: incoming,
      sent: outgoing,
    };
  }

  public sendRoommateRequest(
    senderId: string,
    receiverId: string,
    message: string
  ): { success: boolean; request?: RoommateRequest; error?: string } {
    if (senderId === receiverId) {
      return { success: false, error: 'You cannot send a roommate request to yourself.' };
    }

    const all = load<RoommateRequest[]>(STORAGE_KEYS.ROOMMATE_REQUESTS, []);
    const existing = all.find(
      (r) =>
        ((r.senderId === senderId && r.receiverId === receiverId) ||
          (r.senderId === receiverId && r.receiverId === senderId)) &&
        r.status === 'pending'
    );

    if (existing) {
      return { success: false, error: 'A pending roommate request already exists between you and this student.' };
    }

    const senderProfile = this.getStudentProfile(senderId);
    const receiverProfile = this.getStudentProfile(receiverId);
    if (!senderProfile || !receiverProfile) {
      return { success: false, error: 'Student profile not found.' };
    }

    const myPref = this.getRoommatePreference(senderId);
    const targetPref = this.getRoommatePreference(receiverId);
    const compatibilityScore =
      myPref && targetPref ? calculateCompatibility(myPref, targetPref).score : 75;
    const now = new Date().toISOString();

    const req: RoommateRequest = {
      id: `req-${Date.now()}`,
      senderId,
      senderName: senderProfile.fullName,
      senderRegNumber: senderProfile.registrationNumber,
      receiverId,
      receiverName: receiverProfile.fullName,
      compatibilityScore,
      message,
      note: message,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    all.unshift(req);
    save(STORAGE_KEYS.ROOMMATE_REQUESTS, all);

    if (this.canSyncToFirestore(senderId)) {
      setDoc(doc(db, 'roommateRequests', req.id), stripUndefined(req)).catch(() => {});
    }

    return { success: true, request: req };
  }

  public respondToRoommateRequest(
    requestId: string,
    action: 'accept' | 'reject' | 'cancel'
  ): RoommateRequest | undefined {
    const all = load<RoommateRequest[]>(STORAGE_KEYS.ROOMMATE_REQUESTS, []);
    const req = all.find((r) => r.id === requestId);
    if (!req) return undefined;

    req.status =
      action === 'accept' ? 'accepted' : action === 'reject' ? 'rejected' : 'cancelled';
    req.updatedAt = new Date().toISOString();
    save(STORAGE_KEYS.ROOMMATE_REQUESTS, all);

    if (this.canSyncToFirestore()) {
      updateDoc(doc(db, 'roommateRequests', requestId), {
        status: req.status,
        updatedAt: req.updatedAt,
      }).catch(() => {});
    }

    if (action === 'accept') {
      this.startDirectConversation(req.senderId, req.receiverId);
    }

    return req;
  }

  // Accommodation Groups
  public getAccommodationGroups(): AccommodationGroup[] {
    return load<AccommodationGroup[]>(STORAGE_KEYS.GROUPS, []);
  }

  public getGroupsForUser(userId: string): AccommodationGroup[] {
    return this.getAccommodationGroups().filter((g) => g.memberIds.includes(userId));
  }

  public getGroupById(id: string): AccommodationGroup | undefined {
    return this.getAccommodationGroups().find((g) => g.id === id);
  }

  public updateGroup(group: AccommodationGroup): AccommodationGroup {
    const list = this.getAccommodationGroups().map((g) => (g.id === group.id ? group : g));
    save(STORAGE_KEYS.GROUPS, list);
    if (this.canSyncToFirestore()) {
      setDoc(doc(db, 'accommodationGroups', group.id), stripUndefined(group), { merge: true }).catch(() => {});
    }
    return group;
  }

  public createGroup(
    name: string,
    description: string,
    leaderId: string,
    maxCapacity: number,
    targetPropertyId?: string,
    visibility: 'discoverable' | 'invite_only' | 'request_required' = 'discoverable'
  ): AccommodationGroup {
    const groups = this.getAccommodationGroups();
    const convos = load<Conversation[]>(STORAGE_KEYS.CONVERSATIONS, []);

    const convoId = `conv-group-${Date.now()}`;
    const groupId = `group-${Date.now()}`;
    const now = new Date().toISOString();
    const leaderProfile = this.getStudentProfile(leaderId);
    const leaderUser = this.getUserById(leaderId);
    const leaderName = leaderProfile?.fullName || leaderUser?.fullName || 'Group Leader';

    const newConvo: Conversation = {
      id: convoId,
      type: 'group',
      title: `${name} Chat`,
      name: `${name} Chat`,
      participantIds: [leaderId],
      participants: [
        {
          userId: leaderId,
          name: leaderName,
          role: 'student',
        },
      ],
      groupId,
      createdBy: leaderId,
      lastMessageText: 'Group created.',
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    };
    convos.unshift(newConvo);
    save(STORAGE_KEYS.CONVERSATIONS, convos);

    const newGroup: AccommodationGroup = {
      id: groupId,
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
          registrationNumber: leaderProfile?.registrationNumber,
          role: 'owner',
          status: 'active',
          joinedAt: now,
        },
      ],
      maxCapacity: Math.max(2, Math.min(8, maxCapacity)),
      targetPropertyId,
      status: 'active',
      visibility,
      createdAt: now,
      updatedAt: now,
    };

    groups.unshift(newGroup);
    save(STORAGE_KEYS.GROUPS, groups);

    if (this.canSyncToFirestore(leaderId)) {
      setDoc(doc(db, 'accommodationGroups', groupId), stripUndefined(newGroup)).catch(() => {});
      setDoc(doc(db, 'conversations', convoId), stripUndefined(newConvo)).catch(() => {});
    }

    return newGroup;
  }

  public renameGroup(
    groupId: string,
    actorId: string,
    newName: string
  ): { success: boolean; error?: string; group?: AccommodationGroup } {
    const group = this.getGroupById(groupId);
    if (!group) return { success: false, error: 'Group not found.' };

    const isAdmin = group.adminIds?.includes(actorId) || group.leaderId === actorId;
    if (!isAdmin) {
      return { success: false, error: 'Only group admins can rename the group.' };
    }

    const trimmed = newName.trim();
    if (!trimmed) return { success: false, error: 'Group name cannot be empty.' };

    group.name = trimmed;
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
    if (!group.adminIds) group.adminIds = [group.leaderId];
    if (!group.adminIds.includes(targetUserId)) {
      group.adminIds.push(targetUserId);
      this.updateGroup(group);
    }
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
    group.memberIds = group.memberIds.filter((id) => id !== targetUserId);
    group.adminIds = (group.adminIds || []).filter((id) => id !== targetUserId);
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
    group.memberIds = group.memberIds.filter((id) => id !== userId);
    group.adminIds = (group.adminIds || []).filter((id) => id !== userId);
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
    group.memberIds.push(userId);
    this.updateGroup(group);
    return { success: true };
  }

  public requestToJoinGroup(
    groupId: string,
    userId: string
  ): { success: boolean; error?: string; pendingApproval?: boolean } {
    const group = this.getGroupById(groupId);
    if (!group) return { success: false, error: 'Group not found.' };
    const requests = load<GroupJoinRequest[]>(STORAGE_KEYS.GROUP_JOIN_REQUESTS, []);
    const student = this.getStudentProfile(userId);
    const newReq: GroupJoinRequest = {
      id: `gjr-${Date.now()}`,
      groupId,
      userId,
      userName: student?.fullName || 'Student',
      regNumber: student?.registrationNumber || '',
      status: 'pending',
      requestedAt: new Date().toISOString(),
    };
    requests.unshift(newReq);
    save(STORAGE_KEYS.GROUP_JOIN_REQUESTS, requests);
    return { success: true, pendingApproval: true };
  }

  public getGroupJoinRequests(groupId: string): GroupJoinRequest[] {
    const requests = load<GroupJoinRequest[]>(STORAGE_KEYS.GROUP_JOIN_REQUESTS, []);
    return requests.filter((r) => r.groupId === groupId && r.status === 'pending');
  }

  public respondToJoinRequest(
    requestId: string,
    actorId: string,
    action: 'approve' | 'reject'
  ): { success: boolean; error?: string } {
    const requests = load<GroupJoinRequest[]>(STORAGE_KEYS.GROUP_JOIN_REQUESTS, []);
    const req = requests.find((r) => r.id === requestId);
    if (!req) return { success: false, error: 'Join request not found.' };
    const group = this.getGroupById(req.groupId);
    if (!group) return { success: false, error: 'Group not found.' };
    req.status = action === 'approve' ? 'approved' : 'rejected';
    req.reviewedAt = new Date().toISOString();
    req.reviewedBy = actorId;
    save(STORAGE_KEYS.GROUP_JOIN_REQUESTS, requests);
    if (action === 'approve' && !group.memberIds.includes(req.userId)) {
      group.memberIds.push(req.userId);
      this.updateGroup(group);
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
    const invites = load<GroupInvitation[]>(STORAGE_KEYS.INVITATIONS, []);
    const sender = this.getStudentProfile(senderId);
    const newInvite: GroupInvitation = {
      id: `inv-${Date.now()}`,
      groupId,
      groupName: group.name,
      senderId,
      senderName: sender?.fullName || 'Group Leader',
      receiverId,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    invites.unshift(newInvite);
    save(STORAGE_KEYS.INVITATIONS, invites);
    return { success: true };
  }

  public getPendingGroupInvitations(userId: string): GroupInvitation[] {
    return load<GroupInvitation[]>(STORAGE_KEYS.INVITATIONS, []).filter(
      (i) => i.receiverId === userId && i.status === 'pending'
    );
  }

  public respondToGroupInvitation(inviteId: string, action: 'accept' | 'reject'): boolean {
    const invites = load<GroupInvitation[]>(STORAGE_KEYS.INVITATIONS, []);
    const inv = invites.find((i) => i.id === inviteId);
    if (!inv || inv.status !== 'pending') return false;
    const group = this.getGroupById(inv.groupId);
    if (!group) return false;

    if (action === 'accept') {
      if (group.memberIds.length >= group.maxCapacity) return false;
      inv.status = 'accepted';
      if (!group.memberIds.includes(inv.receiverId)) {
        group.memberIds.push(inv.receiverId);
      }
      this.updateGroup(group);
    } else {
      inv.status = 'rejected';
    }
    save(STORAGE_KEYS.INVITATIONS, invites);
    return true;
  }

  // Reservations, Invoices & Receipts
  public getReservations(): Reservation[] {
    return load<Reservation[]>(STORAGE_KEYS.RESERVATIONS, []);
  }

  public getReservationsForStudent(studentId: string): Reservation[] {
    return this.getReservations().filter((r) => r.studentId === studentId);
  }

  public getReservationsForLandlord(landlordId: string): Reservation[] {
    return this.getReservations().filter((r) => r.landlordId === landlordId);
  }

  public getReservationById(id: string): Reservation | undefined {
    return this.getReservations().find((r) => r.id === id);
  }

  public getInvoices(): Invoice[] {
    return load<Invoice[]>(STORAGE_KEYS.INVOICES, []);
  }

  public getInvoiceById(id: string): Invoice | undefined {
    return this.getInvoices().find((i) => i.id === id);
  }

  public getInvoiceByReservationId(reservationId: string): Invoice | undefined {
    return this.getInvoices().find((i) => i.reservationId === reservationId);
  }

  public getPaymentReceipts(): PaymentReceipt[] {
    return load<PaymentReceipt[]>(STORAGE_KEYS.RECEIPTS, []);
  }

  public getReceiptByReservationId(reservationId: string): PaymentReceipt | undefined {
    return this.getPaymentReceipts().find((rc) => rc.reservationId === reservationId);
  }

  public getPaymentReceiptsForLandlord(landlordId: string): PaymentReceipt[] {
    return this.getPaymentReceipts().filter((rc) => rc.landlordId === landlordId);
  }

  public createReservation(
    studentId: string,
    propertyId: string,
    unitId: string,
    groupId?: string
  ): { success: boolean; reservation?: Reservation; invoice?: Invoice; error?: string } {
    const prop = this.getPropertyById(propertyId);
    if (!prop) return { success: false, error: 'Property not found.' };

    const unit = prop.rooms.find((u) => u.id === unitId);
    if (!unit) return { success: false, error: 'Selected unit not found.' };
    if (unit.availableSpaces <= 0) {
      return { success: false, error: 'No available spaces remaining in this unit.' };
    }

    const student = this.getStudentProfile(studentId);
    const studentUser = this.getUserById(studentId);
    const now = new Date();
    const holdExpires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const resId = `res-${Date.now()}`;
    const invId = `inv-${Date.now()}`;
    const resNum = `OUT-RES-${Math.floor(1000 + Math.random() * 9000)}`;
    const invNum = `INV-OUT-${Math.floor(1000 + Math.random() * 9000)}`;

    const newRes: Reservation = {
      id: resId,
      reservationNumber: resNum,
      studentId,
      studentName: student?.fullName || studentUser?.fullName || 'Student',
      studentEmail: studentUser?.email || '',
      studentPhone: student?.phone || studentUser?.phone || '',
      propertyId,
      propertyName: prop.title,
      propertyTitle: prop.title,
      propertyAddress: `${prop.address}, ${prop.neighbourhood}`,
      unitId,
      unitName: unit.name,
      roomName: unit.name,
      landlordId: prop.landlordId,
      landlordName: prop.landlordName,
      groupId,
      amount: unit.pricePerSession,
      currency: 'NGN',
      status: 'pending_payment',
      createdAt: now.toISOString(),
      holdExpiresAt: holdExpires.toISOString(),
      invoiceId: invId,
    };

    const newInv: Invoice = {
      id: invId,
      invoiceNumber: invNum,
      reservationId: resId,
      studentId,
      studentName: student?.fullName || studentUser?.fullName || 'Student',
      registrationNumber: student?.registrationNumber || '',
      university: student?.university || 'Bayero University Kano (BUK)',
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
        bankName: 'Access Bank Nigeria',
        accountName: prop.landlordName,
        accountNumber: '0000000000',
        paymentInstructions: `Include reservation reference ${resNum} in your transfer narration.`,
      },
      createdAt: now.toISOString(),
      dueDate: holdExpires.toISOString(),
      status: 'unpaid',
    };

    this.updatePropertyAvailability(propertyId, unitId, unit.availableSpaces - 1);

    const resList = this.getReservations();
    resList.unshift(newRes);
    save(STORAGE_KEYS.RESERVATIONS, resList);

    const invList = this.getInvoices();
    invList.unshift(newInv);
    save(STORAGE_KEYS.INVOICES, invList);

    if (this.canSyncToFirestore(studentId)) {
      setDoc(
        doc(db, 'reservations', newRes.id),
        stripUndefined({
          ...newRes,
          serverCreatedAt: serverTimestamp(),
        })
      ).catch(() => {});

      setDoc(
        doc(db, 'invoices', newInv.id),
        stripUndefined({
          ...newInv,
          serverCreatedAt: serverTimestamp(),
        })
      ).catch(() => {});
    }

    return { success: true, reservation: newRes, invoice: newInv };
  }

  public cancelReservation(reservationId: string, reason?: string): { success: boolean; message?: string } {
    const resList = this.getReservations();
    const res = resList.find((r) => r.id === reservationId);
    if (!res) return { success: false, message: 'Reservation not found.' };
    if (res.status === 'confirmed' || res.status === 'cancelled' || res.status === 'expired') {
      return { success: false, message: `Cannot cancel reservation in ${res.status} status.` };
    }

    res.status = 'cancelled';
    res.cancellationReason = reason || 'Cancelled by student.';
    save(STORAGE_KEYS.RESERVATIONS, resList);

    const prop = this.getPropertyById(res.propertyId);
    const unit = prop?.rooms.find((u) => u.id === res.unitId);
    if (prop && unit) {
      this.updatePropertyAvailability(prop.id, unit.id, unit.availableSpaces + 1);
    }

    if (this.canSyncToFirestore()) {
      updateDoc(doc(db, 'reservations', reservationId), {
        status: 'cancelled',
        cancellationReason: res.cancellationReason,
        serverCancelledAt: serverTimestamp(),
      }).catch(() => {});
    }

    return { success: true };
  }

  public uploadPaymentReceipt(data: {
    reservationId: string;
    studentId: string;
    fileName: string;
    fileSize: number;
    fileUrl?: string;
    storagePath?: string;
    paymentReference: string;
    payerBankName: string;
    paymentDate: string;
    amountPaid: number;
  }): { success: boolean; receipt?: PaymentReceipt; error?: string } {
    const resList = this.getReservations();
    const res = resList.find((r) => r.id === data.reservationId);
    if (!res) return { success: false, error: 'Reservation not found.' };

    const receipts = this.getPaymentReceipts();
    const newReceipt: PaymentReceipt = {
      id: `rcpt-${Date.now()}`,
      reservationId: res.id,
      invoiceId: res.invoiceId || '',
      studentId: data.studentId,
      studentName: res.studentName,
      landlordId: res.landlordId,
      propertyId: res.propertyId,
      propertyName: res.propertyName,
      propertyTitle: res.propertyTitle || res.propertyName,
      roomName: res.roomName || res.unitName,
      fileName: data.fileName,
      fileSize: data.fileSize,
      fileUrl: data.fileUrl,
      storagePath: data.storagePath,
      paymentReference: data.paymentReference,
      payerBankName: data.payerBankName,
      paymentDate: data.paymentDate,
      amountPaid: data.amountPaid,
      uploadedAt: new Date().toISOString(),
      status: 'pending_review',
    };

    receipts.unshift(newReceipt);
    save(STORAGE_KEYS.RECEIPTS, receipts);

    res.status = 'receipt_submitted';
    save(STORAGE_KEYS.RESERVATIONS, resList);

    if (this.canSyncToFirestore(newReceipt.studentId)) {
      setDoc(
        doc(db, 'paymentReceipts', newReceipt.id),
        stripUndefined({
          ...newReceipt,
          serverUploadedAt: serverTimestamp(),
        })
      ).catch(() => {});

      updateDoc(doc(db, 'reservations', newReceipt.reservationId), {
        status: 'receipt_submitted',
        serverReceiptSubmittedAt: serverTimestamp(),
      }).catch(() => {});
    }

    return { success: true, receipt: newReceipt };
  }

  public reviewPaymentReceipt(
    receiptId: string,
    decision: 'approved' | 'rejected',
    reviewerId: string,
    rejectionReason?: string
  ): PaymentReceipt | undefined {
    const receipts = this.getPaymentReceipts();
    const receipt = receipts.find((r) => r.id === receiptId);
    if (!receipt) return undefined;

    const resList = this.getReservations();
    const res = resList.find((r) => r.id === receipt.reservationId);
    if (!res) return undefined;

    receipt.status = decision;
    receipt.reviewedAt = new Date().toISOString();
    receipt.reviewedBy = reviewerId;
    receipt.rejectionReason = rejectionReason;
    save(STORAGE_KEYS.RECEIPTS, receipts);

    if (decision === 'approved') {
      res.status = 'confirmed';
      res.confirmedAt = new Date().toISOString();
    } else {
      res.status = 'rejected';
      res.cancellationReason = rejectionReason || 'Receipt rejected by landlord.';
    }
    save(STORAGE_KEYS.RESERVATIONS, resList);

    if (this.canSyncToFirestore(reviewerId)) {
      updateDoc(doc(db, 'paymentReceipts', receiptId), {
        status: decision,
        reviewedAt: serverTimestamp(),
        reviewedBy: auth.currentUser?.uid || reviewerId,
        rejectionReason: rejectionReason || null,
      }).catch(() => {});

      updateDoc(doc(db, 'reservations', receipt.reservationId), {
        status: decision === 'approved' ? 'confirmed' : 'rejected',
        confirmedAt: decision === 'approved' ? serverTimestamp() : null,
        cancellationReason: decision === 'rejected' ? rejectionReason || null : null,
      }).catch(() => {});
    }

    return receipt;
  }

  public checkAndExpireReservations(): number {
    const resList = this.getReservations();
    const now = Date.now();
    let expiredCount = 0;

    for (const res of resList) {
      if (
        (res.status === 'pending_payment' || res.status === 'receipt_submitted') &&
        new Date(res.holdExpiresAt).getTime() <= now
      ) {
        res.status = 'expired';
        expiredCount++;
      }
    }

    if (expiredCount > 0) {
      save(STORAGE_KEYS.RESERVATIONS, resList);
    }
    return expiredCount;
  }

  // Notifications
  public getNotifications(userId: string): AppNotification[] {
    return load<AppNotification[]>(STORAGE_KEYS.NOTIFICATIONS, []).filter(
      (n) => n.userId === userId
    );
  }

  public createNotification(data: Omit<AppNotification, 'id' | 'isRead' | 'createdAt'>): AppNotification {
    const list = load<AppNotification[]>(STORAGE_KEYS.NOTIFICATIONS, []);
    const notif: AppNotification = {
      id: `notif-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      ...data,
      isRead: false,
      createdAt: new Date().toISOString(),
    };
    list.unshift(notif);
    save(STORAGE_KEYS.NOTIFICATIONS, list);

    if (this.canSyncToFirestore(notif.userId)) {
      setDoc(
        doc(db, 'notifications', notif.id),
        stripUndefined({
          ...notif,
          serverCreatedAt: serverTimestamp(),
        })
      ).catch(() => {});
    }

    appEventBus.publish(`notifications:${data.userId}`, notif);
    return notif;
  }

  public markNotificationAsRead(id: string): void {
    const list = load<AppNotification[]>(STORAGE_KEYS.NOTIFICATIONS, []);
    const n = list.find((item) => item.id === id);
    if (n) {
      n.isRead = true;
      save(STORAGE_KEYS.NOTIFICATIONS, list);
    }
  }

  public markAllNotificationsAsRead(userId: string): void {
    const list = load<AppNotification[]>(STORAGE_KEYS.NOTIFICATIONS, []);
    list.forEach((n) => {
      if (n.userId === userId) n.isRead = true;
    });
    save(STORAGE_KEYS.NOTIFICATIONS, list);
  }

  // Chat & Messages
  public getConversations(userId: string): Conversation[] {
    return load<Conversation[]>(STORAGE_KEYS.CONVERSATIONS, []).filter((c) =>
      c.participantIds.includes(userId)
    );
  }

  public getConversationById(id: string): Conversation | undefined {
    return load<Conversation[]>(STORAGE_KEYS.CONVERSATIONS, []).find((c) => c.id === id);
  }

  public getMessages(conversationId: string): ChatMessage[] {
    return load<ChatMessage[]>(STORAGE_KEYS.MESSAGES, [])
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
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
    const msgs = load<ChatMessage[]>(STORAGE_KEYS.MESSAGES, []);
    const convos = load<Conversation[]>(STORAGE_KEYS.CONVERSATIONS, []);
    const convo = convos.find((c) => c.id === conversationId);

    const user = this.getUserById(senderId);
    const student = this.getStudentProfile(senderId);
    const landlord = this.getLandlordProfile(senderId);

    const senderName =
      student?.fullName || landlord?.legalName || user?.fullName || user?.email || 'User';

    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      conversationId,
      senderId,
      senderName,
      senderRole: user?.role || 'student',
      text: text.trim(),
      createdAt: new Date().toISOString(),
      status: 'delivered',
      deliveryStatus: 'delivered',
      isEdited: false,
      replyTo: options?.replyTo,
      mentions: options?.mentions,
      attachment: options?.attachment,
    };

    msgs.push(newMsg);
    save(STORAGE_KEYS.MESSAGES, msgs);

    if (convo) {
      convo.lastMessageId = newMsg.id;
      convo.lastMessageText = newMsg.text;
      convo.lastMessageAt = newMsg.createdAt;
      save(STORAGE_KEYS.CONVERSATIONS, convos);
    }

    if (this.canSyncToFirestore(senderId)) {
      setDoc(
        doc(db, 'messages', newMsg.id),
        stripUndefined({
          ...newMsg,
          serverCreatedAt: serverTimestamp(),
        })
      ).catch(() => {});

      updateDoc(doc(db, 'conversations', conversationId), {
        lastMessageText: newMsg.text,
        lastMessageTimestamp: serverTimestamp(),
      }).catch(() => {});
    }

    appEventBus.publish(`chat:${conversationId}`, newMsg);
    appEventBus.publish('conversationsUpdated', convos);
    return newMsg;
  }

  public editMessage(
    messageId: string,
    userId: string,
    newText: string
  ): { success: boolean; error?: string; message?: ChatMessage } {
    const msgs = load<ChatMessage[]>(STORAGE_KEYS.MESSAGES, []);
    const msg = msgs.find((m) => m.id === messageId);
    if (!msg) return { success: false, error: 'Message not found.' };
    if (msg.senderId !== userId) {
      return { success: false, error: 'You can only edit your own messages.' };
    }
    const trimmed = newText.trim();
    if (!trimmed) return { success: false, error: 'Edited message cannot be empty.' };

    msg.text = trimmed;
    msg.isEdited = true;
    msg.editedAt = new Date().toISOString();
    save(STORAGE_KEYS.MESSAGES, msgs);
    return { success: true, message: msg };
  }

  public retryFailedMessage(
    messageId: string,
    userId: string
  ): { success: boolean; error?: string; message?: ChatMessage } {
    const msgs = load<ChatMessage[]>(STORAGE_KEYS.MESSAGES, []);
    const msg = msgs.find((m) => m.id === messageId && m.senderId === userId);
    if (!msg) return { success: false, error: 'Message not found.' };
    msg.status = 'delivered';
    msg.deliveryStatus = 'delivered';
    save(STORAGE_KEYS.MESSAGES, msgs);
    return { success: true, message: msg };
  }

  public markMessagesAsRead(conversationId: string, userId: string): void {
    const msgs = load<ChatMessage[]>(STORAGE_KEYS.MESSAGES, []);
    let changed = false;
    const now = new Date().toISOString();
    for (const m of msgs) {
      if (m.conversationId === conversationId && m.senderId !== userId && m.status !== 'read') {
        m.status = 'read';
        m.deliveryStatus = 'read';
        m.readAt = now;
        changed = true;
      }
    }
    if (changed) {
      save(STORAGE_KEYS.MESSAGES, msgs);
    }
  }

  public searchMessages(conversationId: string, queryStr: string): ChatMessage[] {
    const q = queryStr.trim().toLowerCase();
    if (!q) return [];
    return this.getMessages(conversationId).filter(
      (m) => m.text.toLowerCase().includes(q) || m.senderName.toLowerCase().includes(q)
    );
  }

  public toggleMuteConversation(conversationId: string, _userId: string): boolean {
    const convos = load<Conversation[]>(STORAGE_KEYS.CONVERSATIONS, []);
    const convo = convos.find((c) => c.id === conversationId);
    if (!convo) return false;
    convo.isMuted = !convo.isMuted;
    save(STORAGE_KEYS.CONVERSATIONS, convos);
    return Boolean(convo.isMuted);
  }

  public archiveConversation(conversationId: string, _userId: string): boolean {
    const convos = load<Conversation[]>(STORAGE_KEYS.CONVERSATIONS, []);
    const convo = convos.find((c) => c.id === conversationId);
    if (!convo) return false;
    convo.archivedAt = convo.archivedAt ? undefined : new Date().toISOString();
    save(STORAGE_KEYS.CONVERSATIONS, convos);
    return Boolean(convo.archivedAt);
  }

  public startDirectConversation(userIdA: string, userIdB: string): Conversation {
    const convos = load<Conversation[]>(STORAGE_KEYS.CONVERSATIONS, []);
    const existing = convos.find(
      (c) =>
        c.type === 'direct' &&
        c.participantIds.includes(userIdA) &&
        c.participantIds.includes(userIdB)
    );
    if (existing) return existing;

    const studentB = this.getStudentProfile(userIdB);
    const landlordB = this.getLandlordProfile(userIdB);
    const title = studentB?.fullName || landlordB?.legalName || 'Direct Message';

    const now = new Date().toISOString();
    const newConvo: Conversation = {
      id: `conv-dir-${Date.now()}`,
      type: 'direct',
      title,
      name: title,
      participantIds: [userIdA, userIdB],
      participants: [
        {
          userId: userIdA,
          name: this.getUserById(userIdA)?.fullName || 'User',
          role: this.getUserById(userIdA)?.role || 'student',
        },
        {
          userId: userIdB,
          name: title,
          role: this.getUserById(userIdB)?.role || 'student',
        },
      ],
      createdBy: userIdA,
      lastMessageText: 'Conversation started.',
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    };
    convos.unshift(newConvo);
    save(STORAGE_KEYS.CONVERSATIONS, convos);

    if (this.canSyncToFirestore(userIdA)) {
      setDoc(doc(db, 'conversations', newConvo.id), stripUndefined(newConvo)).catch(() => {});
    }

    return newConvo;
  }

  public subscribeToMessages(conversationId: string, callback: (messages: ChatMessage[]) => void): () => void {
    if (!auth.currentUser) {
      callback(this.getMessages(conversationId));
      return () => {};
    }

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
      () => {
        callback(this.getMessages(conversationId));
      }
    );
  }

  // Audit Logs
  public getAuditLogs(): AuditLog[] {
    return load<AuditLog[]>(STORAGE_KEYS.AUDIT_LOGS, []);
  }

  public logAudit(entry: Omit<AuditLog, 'id' | 'timestamp'>): void {
    const logs = this.getAuditLogs();
    logs.unshift({
      id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      ...entry,
      timestamp: new Date().toISOString(),
    });
    save(STORAGE_KEYS.AUDIT_LOGS, logs);
  }
}
