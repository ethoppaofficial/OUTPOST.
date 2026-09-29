import {
  User,
  StudentProfile,
  StudentVerificationDocument,
  LandlordProfile,
  Property,
  PropertyVerificationStatus,
  LocationVerificationStatus,
  RoommatePreference,
  RoommateRequest,
  AccommodationGroup,
  GroupInvitation,
  Reservation,
  Invoice,
  PaymentReceipt,
  ReceiptStatus,
  AppNotification,
  Conversation,
  ChatMessage,
  MessageReplyReference,
  MessageMention,
  AuditLog,
  VerificationReviewStatus,
  PublicProfile,
} from './types';

export interface IRepository {
  init(): Promise<void>;

  // User & Profile
  getUsers(): Promise<User[]> | User[];
  getUserById(id: string): User | undefined;
  createUser(user: User): Promise<void>;
  updateUser(id: string, updates: Partial<User>): Promise<void>;
  getActiveUserId(): string;
  setActiveUserId(id: string): void;
  clearActiveSession(): void;

  getStudentProfiles(): StudentProfile[];
  getStudentProfile(userId: string): StudentProfile | undefined;
  saveStudentProfile(profile: StudentProfile): Promise<void>;

  getLandlordProfiles(): LandlordProfile[];
  getLandlordProfile(userId: string): LandlordProfile | undefined;
  saveLandlordProfile(profile: LandlordProfile): Promise<void>;

  getPublicProfile(userId: string): Promise<PublicProfile | null>;
  savePublicProfile(profile: PublicProfile): Promise<void>;

  // Documents
  getStudentDocuments(): StudentVerificationDocument[];
  getStudentDocumentById(id: string): StudentVerificationDocument | undefined;
  getStudentDocumentsByStudentId(studentId: string): StudentVerificationDocument[];
  saveStudentDocument(doc: StudentVerificationDocument): Promise<void>;
  updateStudentDocumentStatus(
    id: string,
    status: VerificationReviewStatus,
    reason?: string,
    reviewerId?: string
  ): Promise<void>;
  deleteStudentDocument(id: string): Promise<void>;

  // Properties
  getProperties(): Property[];
  getPropertyById(id: string): Property | undefined;
  getPropertiesByLandlord(landlordId: string): Property[];
  saveProperty(property: Property): Promise<void>;
  updateProperty(id: string, updates: Partial<Property>): Promise<void>;
  deleteProperty(id: string): Promise<void>;
  updatePropertyVerificationStatus(
    id: string,
    status: PropertyVerificationStatus,
    reviewedBy?: string
  ): Promise<void>;
  updateLocationVerificationStatus(
    propertyId: string,
    status: LocationVerificationStatus,
    reviewedBy?: string,
    reason?: string
  ): Promise<void>;

  // Roommates & Preferences
  getRoommatePreferences(): RoommatePreference[];
  getRoommatePreference(userId: string): RoommatePreference | undefined;
  saveRoommatePreference(pref: RoommatePreference): Promise<void>;
  getRoommateRequests(userId: string): RoommateRequest[];
  sendRoommateRequest(
    request: Omit<RoommateRequest, 'id' | 'createdAt' | 'status'>
  ): Promise<RoommateRequest>;
  respondToRoommateRequest(
    requestId: string,
    status: 'accepted' | 'rejected'
  ): Promise<void>;

  // Groups
  getGroups(): AccommodationGroup[];
  getGroupById(id: string): AccommodationGroup | undefined;
  getGroupsByUser(userId: string): AccommodationGroup[];
  createGroup(
    name: string,
    leaderId: string,
    maxCapacity?: number
  ): Promise<AccommodationGroup>;
  joinGroup(groupId: string, userId: string): Promise<void>;
  leaveGroup(groupId: string, userId: string): Promise<void>;
  getGroupInvitations(userId: string): GroupInvitation[];
  inviteToGroup(
    groupId: string,
    invitedUserId: string,
    invitedByUserId: string
  ): Promise<GroupInvitation>;
  respondToGroupInvitation(
    invitationId: string,
    accept: boolean
  ): Promise<void>;

  // Reservations & Invoices
  getReservations(): Reservation[];
  getReservationById(id: string): Reservation | undefined;
  getReservationsByStudent(studentId: string): Reservation[];
  getReservationsByProperty(propertyId: string): Reservation[];
  createReservation(
    studentId: string,
    propertyId: string,
    unitId?: string,
    holdDays?: number
  ): Promise<Reservation>;
  cancelReservation(
    reservationId: string,
    cancelledByUserId: string,
    reason?: string
  ): Promise<void>;
  expireReservations(): Promise<number>;

  getInvoices(): Invoice[];
  getInvoiceById(id: string): Invoice | undefined;
  getInvoiceByReservationId(reservationId: string): Invoice | undefined;
  createInvoice(
    reservationId: string,
    amount: number,
    studentId: string
  ): Promise<Invoice>;

  // Payment Receipts
  getPaymentReceipts(): PaymentReceipt[];
  getPaymentReceiptById(id: string): PaymentReceipt | undefined;
  getPaymentReceiptsByReservation(reservationId: string): PaymentReceipt[];
  submitPaymentReceipt(
    receipt: Omit<PaymentReceipt, 'id' | 'submittedAt' | 'status'>
  ): Promise<PaymentReceipt>;
  verifyPaymentReceipt(
    receiptId: string,
    status: ReceiptStatus,
    reviewedBy: string,
    rejectionReason?: string
  ): Promise<void>;

  // Notifications
  getNotifications(userId: string): AppNotification[];
  markNotificationAsRead(id: string): Promise<void>;
  markAllNotificationsAsRead(userId: string): Promise<void>;
  createNotification(
    notification: Omit<AppNotification, 'id' | 'createdAt' | 'read'>
  ): Promise<AppNotification>;
  subscribeToNotifications(
    userId: string,
    callback: (notifications: AppNotification[]) => void
  ): () => void;

  // Chat
  getConversations(userId: string): Conversation[];
  getConversationById(id: string): Conversation | undefined;
  getOrCreateConversation(participantIds: string[]): Promise<Conversation>;
  getMessages(conversationId: string): ChatMessage[];
  sendMessage(
    conversationId: string,
    senderId: string,
    text: string,
    replyTo?: MessageReplyReference,
    mentions?: MessageMention[]
  ): Promise<ChatMessage>;
  editMessage(
    messageId: string,
    newText: string,
    editorUserId: string
  ): Promise<ChatMessage>;
  markMessagesAsRead(conversationId: string, userId: string): Promise<void>;
  subscribeToMessages(
    conversationId: string,
    callback: (messages: ChatMessage[]) => void
  ): () => void;
  subscribeToConversations(
    userId: string,
    callback: (conversations: Conversation[]) => void
  ): () => void;

  // Audit Logs
  getAuditLogs(): AuditLog[];
  logAudit(
    action: string,
    actorId: string,
    targetId?: string,
    details?: Record<string, any>
  ): Promise<void>;
}
