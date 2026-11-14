// Domain Models & Enums for OUTPOST Student Accommodation Platform

export type UserRole = 'student' | 'landlord' | 'admin';

export type AccountStatus =
  | 'active'
  | 'email_unverified'
  | 'profile_pending'
  | 'profile_verified'
  | 'rejected'
  | 'suspended';

export type PropertyVerificationStatus =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'suspended';

export type LandlordVerificationStatus =
  | 'not_started'
  | 'pending'
  | 'approved'
  | 'rejected';

export type StudentDocumentType =
  | 'student_id'
  | 'admission_letter'
  | 'school_fees_receipt';

export type VerificationReviewStatus = 'pending' | 'approved' | 'rejected' | 'resubmission_required';

export type HousingArea = 'Dambare' | 'Rimin Gata';

export type LocationSource =
  | 'manual_pin'
  | 'device_gps'
  | 'address_search'
  | 'admin_adjusted'
  | 'landlord_pin'
  | 'geocoded_address';

export type LocationVerificationStatus =
  | 'pending'
  | 'verified'
  | 'rejected'
  | 'not_submitted';

export type LocationPrecision =
  | 'exact_building'
  | 'nearby_building'
  | 'street'
  | 'neighbourhood';

export interface GeocodingSuggestion {
  id: string;
  placeName: string;
  center: [number, number]; // [longitude, latitude]
  longitude: number;
  latitude: number;
  relevance?: number;
  placeType?: string[];
  text?: string;
  address?: string;
}

export interface PropertyLocationDetails {
  area: HousingArea;
  city: 'Kano' | string;
  state: 'Kano State' | string;
  country: 'Nigeria' | string;
  fullAddress: string;
  streetOrRoad: string;
  nearestLandmark: string;
  directions: string;
  locationNote?: string;

  // Coordinates use the standard geographic convention:
  // latitude = north/south, longitude = east/west.
  latitude?: number;
  longitude?: number;
  publicLatitude?: number;
  publicLongitude?: number;
  locationSource?: LocationSource;
  locationPrecision?: LocationPrecision;

  locationVerificationStatus: LocationVerificationStatus;
  locationSubmittedAt?: string;
  locationReviewedAt?: string;
  locationReviewedBy?: string;
  locationReviewReason?: string;
}

export interface LocationSubmissionInput {
  area: HousingArea;
  fullAddress: string;
  streetOrRoad: string;
  nearestLandmark: string;
  directions: string;
  locationNote?: string;
  latitude: number;
  longitude: number;
  locationSource: LocationSource;
  locationPrecision: LocationPrecision;
}

export interface PropertyLocation extends Partial<PropertyLocationDetails> {
  id: string;
  propertyId: string;
  locationId: string;
  area: HousingArea;
  city: 'Kano';
  state: 'Kano State';
  country: 'Nigeria';
  latitude: number;
  longitude: number;
  geohash: string;
  source: LocationSource;
  verificationStatus: LocationVerificationStatus;
  precision: LocationPrecision;
  publicLatitude?: number;
  publicLongitude?: number;
  formattedAddress?: string;
  publicLocationLabel: string;
  submittedBy?: string;
  reviewedBy?: string;
  submittedAt?: string;
  reviewedAt?: string;
  reviewReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface HousingLocation {
  id: string;
  name: 'Dambare' | 'Rimin Gata';
  city: 'Kano';
  state: 'Kano State';
  country: 'Nigeria';
  isOffCampus: true;
  institutionContext?: 'Bayero University Kano';
  description: string;
  aliases: string[];
  distanceEstimate?: string;
  latitude?: number;
  longitude?: number;
  isActive: boolean;
}

export type ReservationStatus =
  | 'pending_payment'
  | 'receipt_submitted'
  | 'confirmed'
  | 'rejected'
  | 'cancelled'
  | 'expired';

export type ReceiptStatus =
  | 'not_submitted'
  | 'pending_review'
  | 'approved'
  | 'rejected';

export type RoommateRequestStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'cancelled';

export type PropertyType = 'Hostel' | 'Apartment' | 'Studio' | 'Shared House';
export type AccommodationType = 'Single Room' | 'Shared Room (2-person)' | 'Shared Room (3-4 person)' | 'Self-Contained Flat';
export type GenderPolicy = 'Mixed' | 'Male-Only' | 'Female-Only';

export interface ProfileVisibility {
  bio: boolean;
  faculty: boolean;
  department: boolean;
  programme: boolean;
  studyLevel: boolean;
  institution: boolean;
  preferences: boolean;
  phone: boolean;
  email: boolean;
}

export const DEFAULT_PROFILE_VISIBILITY: ProfileVisibility = {
  bio: true,
  faculty: true,
  department: true,
  programme: true,
  studyLevel: true,
  institution: true,
  preferences: true,
  phone: false,
  email: false,
};

export interface UserPreferences {
  sleepSchedule?: 'early_bird' | 'night_owl' | 'flexible' | string;
  cleanliness?: 'clean' | 'moderate' | 'relaxed' | string;
  smoking?: 'no' | 'yes' | 'outdoor_only' | string;
  guests?: 'never' | 'occasionally' | 'frequently' | string;
  budgetMin?: number;
  budgetMax?: number;
  budgetRange?: string;
  preferredLocation?: string;
  hobbies?: string[];
}

export interface User {
  id: string;
  email: string;
  role: UserRole;
  accountStatus: AccountStatus;
  status?: AccountStatus;
  name?: string;
  fullName?: string;
  displayName?: string;
  emailVerified: boolean;
  isVerified?: boolean;
  createdAt: string;
  lastLoginAt?: string;
  avatarUrl?: string;
  avatarPresetId?: string;
  bio?: string;
  faculty?: string;
  department?: string;
  programme?: string;
  studyLevel?: string;
  institution?: string;
  campus?: string;
  phone?: string;
  // Landlord specific fields
  businessName?: string;
  contactPreference?: 'phone' | 'email' | 'chat';
  // Lifestyle / roommate preferences
  preferences?: UserPreferences;
  // Field visibility toggles
  visibility?: ProfileVisibility;
  studentProfile?: StudentProfile;
  landlordProfile?: LandlordProfile;
}

export interface PublicProfile {
  id: string;
  role: UserRole;
  fullName: string;
  displayName?: string;
  avatarUrl?: string;
  avatarPresetId?: string;
  isVerified: boolean;
  createdAt: string;
  bio?: string;
  faculty?: string;
  department?: string;
  programme?: string;
  studyLevel?: string;
  institution?: string;
  campus?: string;
  phone?: string;
  email?: string;
  businessName?: string;
  preferences?: UserPreferences;
}

export interface StudentProfile {
  userId: string;
  fullName: string;
  phone: string;
  registrationNumber: string; // generic user-provided identifier, e.g. STU-2026-4821
  institutionName?: string; // optional user-provided learning institution
  university?: string; // backwards compatibility alias for institutionName
  campus?: string; // optional user-provided district or campus location
  studyLevel: 'Undergraduate (Year 1)' | 'Undergraduate (Year 2)' | 'Undergraduate (Year 3)' | 'Undergraduate (Year 4)' | 'Undergraduate (Year 5+)' | 'Postgraduate' | string;
  programme: string;
  faculty?: string;
  department?: string;
  gender: 'Male' | 'Female' | 'Other';
  preferredLocation: string;
  bio?: string;
  isProfileVerified: boolean;
}

export interface StudentVerificationDocument {
  id: string;
  studentId: string;
  studentName: string;
  documentType: StudentDocumentType;
  documentUrl: string;
  fileName: string;
  fileSize: number; // in bytes
  uploadedAt: string;
  status: VerificationReviewStatus;
  rejectionReason?: string;
  reviewedAt?: string;
  reviewerId?: string;
}

export interface StudentVerificationSubmission {
  id: string;
  studentId: string;
  fullName: string;
  registrationNumber: string;
  university: string;
  campus: string;
  programme: string;
  studyLevel: string;
  studentEmail: string;
  submittedAt: string;
  documentType: StudentDocumentType;
  documentUrl: string;
  fileName: string;
  fileSize: number;
  status: VerificationReviewStatus;
}

export interface LandlordVerificationSubmission {
  id: string;
  userId: string;
  legalName: string;
  businessName: string;
  phone: string;
  email: string;
  idType: string;
  idReference: string;
  idNumber?: string;
  ownershipDocType?: string;
  contactAddress: string;
  documentUrl: string;
  submittedAt: string;
  verificationStatus: LandlordVerificationStatus;
}

export interface LandlordProfile {
  userId: string;
  legalName: string;
  phone: string;
  contactAddress: string;
  idType: 'National ID (NIN)' | "Driver's License" | 'International Passport' | 'Voter Card';
  idReference: string;
  documentUrl?: string;
  verificationStatus: LandlordVerificationStatus;
  rejectionReason?: string;
  businessName?: string;
  submittedAt?: string;
  verifiedAt?: string;
}

export interface UnitOrRoom {
  id: string;
  propertyId: string;
  name: string; // e.g., "Room A101 (Deluxe Single)"
  type: string;
  totalCapacity: number;
  availableSpaces: number;
  pricePerSession: number; // NGN
}

export interface Property extends Partial<PropertyLocationDetails> {
  id: string;
  locationId: string;
  location?: PropertyLocation;
  landlordId: string;
  landlordName: string;
  landlordVerified: boolean;
  title: string;
  slug: string;
  description: string;
  propertyType: PropertyType;
  accommodationType: AccommodationType;
  genderPolicy: GenderPolicy;
  address: string;
  city: string;
  neighbourhood: string;
  campus: string;
  university: string;
  distanceKm: number; // e.g. 0.4 km from campus gate
  pricePerSession: number; // NGN
  billingPeriod: 'Academic Session (1 Year)' | 'Semester (6 Months)' | string;
  depositAmount: number;
  utilitiesIncluded: boolean;
  amenities: string[];
  houseRules: string[];
  images: string[];
  totalCapacity: number;
  availableSpaces: number;
  verificationStatus: PropertyVerificationStatus;
  isActive?: boolean;
  adminFeedback?: string;
  rooms: UnitOrRoom[];
  createdAt: string;
  updatedAt: string;
}

export interface RoommatePreference {
  studentId: string;
  preferredNeighbourhoods: string[];
  minBudget: number;
  maxBudget: number;
  moveInPeriod: 'Immediate' | 'Next Semester' | 'Next Session';
  studyHabits: 'Night Owl' | 'Early Bird' | 'Library Focused' | 'Flexible';
  sleepSchedule: 'Sleeps Before 11pm' | 'Sleeps Midnight - 2am' | 'Irregular / Night Shift';
  cleanliness: 'Extremely Neat / Daily' | 'Moderate / Weekly' | 'Relaxed';
  smoking: 'Non-Smoker Only' | 'Outdoor Only' | 'Doesn\'t Mind';
  guestPreference: 'No Overnight Guests' | 'Weekends Only' | 'Frequent Visitors OK';
  noiseTolerance: 'Quiet Environment Essential' | 'Moderate Music/Conversation' | 'High Tolerance';
  roomSharing: 'Own Room Only' | 'Open to 2-Person Shared' | 'Open to 3-4 Person Shared';
  genderPreference: 'Same Gender Only' | 'No Preference';
}

export interface RoommateRequest {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  senderRegNumber: string;
  receiverId: string;
  receiverName?: string;
  status: RoommateRequestStatus;
  compatibilityScore: number;
  message: string;
  note?: string; // alias for message
  createdAt: string;
  updatedAt: string;
}

export type GroupStatus = 'active' | 'full' | 'closed';

export type GroupMemberRole = 'admin' | 'member';
export type GroupMemberStatus = 'active' | 'invited' | 'pending' | 'removed' | 'left';

export interface GroupMember {
  id: string;
  groupId: string;
  userId: string;
  role: GroupMemberRole;
  status: GroupMemberStatus;
  addedBy: string;
  joinedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GroupMemberRecord {
  userId: string;
  name: string;
  registrationNumber?: string;
  avatarUrl?: string;
  role: 'owner' | 'leader' | 'admin' | 'member';
  status?: GroupMemberStatus;
  joinedAt: string;
}

export interface GroupJoinRequest {
  id: string;
  groupId: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  regNumber?: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

export interface AccommodationGroup {
  id: string;
  name: string;
  description: string;
  avatarUrl?: string;
  purpose?: string;
  visibility?: 'discoverable' | 'invite_only' | 'request_required';
  status: GroupStatus;
  ownerId: string;
  ownerName: string;
  leaderId: string; // alias for primary admin/owner
  leaderName: string;
  adminIds?: string[]; // all group administrators
  memberIds: string[];
  members: GroupMemberRecord[];
  targetPropertyId?: string;
  targetPropertyName?: string;
  targetPropertyTitle?: string;
  institutionName?: string;
  university?: string; // backwards compatibility
  maxCapacity: number;
  activeReservationId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GroupInvitation {
  id: string;
  groupId: string;
  groupName: string;
  senderId: string;
  senderName: string;
  receiverId: string;
  receiverName?: string;
  receiverRegNumber?: string;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'expired';
  expiresAt?: string;
  createdAt: string;
  updatedAt?: string;
}

export type CompatibilityScore = {
  score: number;
  breakdown: {
    budget: number;
    studyHabits: number;
    sleepSchedule: number;
    cleanliness: number;
    lifestyle: number;
  };
  summary: string;
};

export type ReservationMode = 'hold' | 'pay_now';

export interface Reservation {
  id: string;
  reservationNumber: string; // e.g. "OUT-2026-8941"
  studentId: string;
  studentName: string;
  studentEmail: string;
  studentPhone: string;
  groupId?: string;
  groupName?: string;
  propertyId: string;
  propertyName: string;
  propertyTitle?: string; // alias for propertyName
  propertyAddress: string;
  landlordId: string;
  landlordName?: string;
  landlordVerified?: boolean;
  unitId: string;
  unitName: string;
  roomName?: string; // alias for unitName
  invoiceId?: string;
  status: ReservationStatus;
  reservationMode?: ReservationMode;
  amount: number;
  currency: string; // "NGN"
  holdExpiresAt: string; // 7 days from creation
  createdAt: string;
  confirmedAt?: string;
  cancellationReason?: string;
}

export interface PublicLandlordProfile {
  found: boolean;
  unavailable: boolean;
  reason?: string;
  id: string;
  role: 'landlord';
  displayName: string;
  companyName?: string | null;
  avatarUrl?: string | null;
  isVerified: boolean;
  verificationStatus?: string;
  createdAt?: string;
  approvedListingsCount?: number;
}

export interface PublicStudentProfile {
  found: boolean;
  unavailable: boolean;
  reason?: string;
  id: string;
  role: 'student';
  displayName: string;
  avatarUrl?: string | null;
  isVerified: boolean;
  registrationNumber?: string | null;
  university?: string | null;
  campus?: string | null;
  faculty?: string | null;
  department?: string | null;
  studyLevel?: string | null;
  bio?: string | null;
  createdAt?: string;
}

export interface InvoiceItem {
  description: string;
  amount: number;
}

export type BankAccountType = 'savings' | 'current' | 'corporate';

export interface LandlordPaymentAccount {
  id: string;
  landlordId: string;
  accountHolderName: string;
  bankName: string;
  accountNumber: string;
  accountType?: BankAccountType | null;
  paymentInstructions?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LandlordPaymentAccountInput {
  accountHolderName: string;
  bankName: string;
  accountNumber: string;
  accountType?: BankAccountType | '';
  paymentInstructions?: string;
}

export interface ReservationPaymentDetails {
  configured: boolean;
  source: 'snapshot' | 'active_account' | 'none';
  invoiceId?: string;
  invoiceNumber?: string;
  accountHolderName?: string;
  bankName?: string;
  accountNumber?: string;
  accountType?: BankAccountType | null;
  paymentInstructions?: string | null;
  capturedAt?: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string; // "INV-2026-4819"
  reservationId: string;
  studentId: string;
  studentName: string;
  registrationNumber?: string;
  university?: string;
  propertyId: string;
  propertyName: string;
  propertyTitle?: string;
  unitName: string;
  roomName?: string;
  landlordName?: string;
  amount: number;
  totalAmount?: number;
  currency: string;
  dueDate: string;
  status: 'unpaid' | 'payment_submitted' | 'paid' | 'expired';
  items?: InvoiceItem[];
  bankDetails: {
    bankName: string;
    accountNumber: string;
    accountName: string;
    accountType?: BankAccountType | null;
    routingOrSortCode?: string;
    paymentInstructions: string;
    configured?: boolean;
    source?: 'snapshot' | 'active_account' | 'none';
    snapshotCapturedAt?: string;
  };
  createdAt: string;
}

export interface PaymentReceipt {
  id: string;
  reservationId: string;
  invoiceId: string;
  studentId: string;
  studentName: string;
  registrationNumber?: string;
  propertyId: string;
  propertyName: string;
  propertyTitle?: string;
  roomName?: string;
  landlordId: string;
  fileUrl?: string;
  storagePath?: string;
  fileName: string;
  fileSize: number;
  paymentReference: string;
  payerBankName: string;
  paymentDate: string;
  amountPaid: number;
  status: ReceiptStatus;
  rejectionReason?: string;
  uploadedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

export interface AppNotification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'alert';
  link?: string;
  isRead: boolean;
  createdAt: string;
}

export type ConversationType = 'direct' | 'group';

export type MessageDeliveryStatus =
  | 'pending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed';

export interface MessageMention {
  userId: string;
  displayNameSnapshot?: string;
  userName?: string;
  startIndex?: number;
  endIndex?: number;
  indices?: [number, number];
}

export interface MessageReplyReference {
  messageId: string;
  senderId: string;
  senderName?: string;
  textPreview: string;
}

export interface ConversationParticipant {
  userId: string;
  name: string;
  avatarUrl?: string;
  role: UserRole;
  isOnline?: boolean;
  lastReadMessageId?: string;
  lastReadAt?: string;
}

export interface Conversation {
  id: string;
  type: ConversationType;
  title: string;
  name: string; // alias for title
  groupId?: string;
  participantIds: string[];
  participants: ConversationParticipant[];
  createdBy: string;
  lastMessageId?: string;
  lastMessageText?: string;
  lastMessageTimestamp?: string;
  lastMessageAt?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  unreadCount?: number;
  isMuted?: boolean;
  isPinned?: boolean;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  senderRole: UserRole;
  text: string;
  status: MessageDeliveryStatus;
  deliveryStatus?: MessageDeliveryStatus;
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
  failedAt?: string;
  deliveryError?: string;
  isEdited?: boolean;
  editedAt?: string;
  isDeleted?: boolean;
  mentions?: MessageMention[];
  replyTo?: MessageReplyReference;
  attachment?: {
    storagePath: string;
    fileName: string;
    contentType: string;
    fileSize: number;
    uploadedBy: string;
    uploadedAt: string;
  };
  createdAt: string;
  updatedAt?: string;
}

export interface TypingState {
  conversationId: string;
  userId: string;
  userName: string;
  timestamp: number;
}

export interface PresenceState {
  userId: string;
  isOnline: boolean;
  lastSeenAt: string;
}

export interface AuditLog {
  id: string;
  action: string;
  actorId: string;
  actorName: string;
  actorRole: UserRole;
  targetEntity: string;
  targetId: string;
  details: string;
  timestamp: string;
}

export interface ListingReport {
  id: string;
  propertyId: string;
  propertyName: string;
  reporterId: string;
  reporterName: string;
  reason: 'Misleading photos' | 'Price discrepancy' | 'Safety concern' | 'Fraud / Impersonation' | 'Other';
  details: string;
  status: 'open' | 'investigating' | 'resolved' | 'dismissed';
  createdAt: string;
}
