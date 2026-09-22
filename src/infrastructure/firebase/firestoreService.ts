import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  onSnapshot,
} from 'firebase/firestore';
import { db } from './firebaseConfig';
import { handleFirestoreError, OperationType } from './errorHandler';
import { Property, Reservation, ChatMessage, Conversation, User } from '../../domain/types';

export class FirestoreService {
  /**
   * Save or sync user profile
   */
  async saveUser(user: User): Promise<void> {
    const path = `users/${user.id}`;
    try {
      await setDoc(
        doc(db, 'users', user.id),
        {
          id: user.id,
          email: user.email,
          role: user.role,
          accountStatus: user.accountStatus,
          emailVerified: user.emailVerified,
          avatarUrl: user.avatarUrl || '',
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  /**
   * Save or update property in Firestore
   */
  async saveProperty(property: Property): Promise<void> {
    const path = `properties/${property.id}`;
    try {
      await setDoc(doc(db, 'properties', property.id), property, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  /**
   * Fetch approved properties from Firestore
   */
  async getProperties(): Promise<Property[]> {
    const path = 'properties';
    try {
      const q = query(collection(db, 'properties'), where('verificationStatus', '==', 'approved'));
      const snapshot = await getDocs(q);
      const list: Property[] = [];
      snapshot.forEach((d) => {
        list.push(d.data() as Property);
      });
      return list;
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  }

  /**
   * Save reservation in Firestore
   */
  async saveReservation(reservation: Reservation): Promise<void> {
    const path = `reservations/${reservation.id}`;
    try {
      await setDoc(doc(db, 'reservations', reservation.id), reservation, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  /**
   * Send chat message to Firestore
   */
  async sendChatMessage(conversationId: string, message: ChatMessage): Promise<void> {
    const path = `messages/${message.id}`;
    try {
      await setDoc(doc(db, 'messages', message.id), message);
      // update conversation snippet
      await updateDoc(doc(db, 'conversations', conversationId), {
        lastMessageText: message.text,
        lastMessageTimestamp: message.createdAt,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  }

  /**
   * Realtime message subscription
   */
  subscribeToConversationMessages(
    conversationId: string,
    callback: (messages: ChatMessage[]) => void
  ): () => void {
    const path = 'messages';
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
        callback(msgs);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, path);
      }
    );
  }
}

export const firestoreService = new FirestoreService();
