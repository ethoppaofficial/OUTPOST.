/**
 * @file chatService.ts
 * @module application/services/chatService
 * @description Application service powering real-time chat, conversation threads, message replies, and secure attachment exchanges.
 *
 * Rules & Trust Boundaries:
 * - Conversation Scoping: Messages belong to a `conversationId` and are restricted to explicit participants via database RLS.
 * - 15-Minute Edit Restriction: Messages may only be edited within 15 minutes of sending; enforced both in UI and by PostgreSQL database trigger `enforce_message_edit_window`.
 * - Attachments: File uploads delegate to `supabaseStorageService` into the private `chat-attachments` bucket; non-participants are blocked from downloading attachments.
 * - Realtime Dispatch: Updates dispatch through `appEventBus` and Supabase Realtime channels for instant UI reflection.
 */

import {
  Conversation,
  ChatMessage,
  MessageReplyReference,
  MessageMention,
  TypingState,
} from '../../domain/types';
import { repository } from '../../infrastructure/repositories';
import { appEventBus } from '../../infrastructure/events/eventBus';
import { storageService } from './storageService';

class ChatService {
  public getConversations(userId: string): Conversation[] {
    return repository.getConversations(userId);
  }

  public getUserConversations(userId: string): Conversation[] {
    return repository.getConversations(userId);
  }

  public async loadUserConversations(userId: string): Promise<Conversation[]> {
    return repository.hydrateUserConversationsAndMessages(userId);
  }

  public async loadConversationMessages(conversationId: string): Promise<ChatMessage[]> {
    return repository.fetchConversationMessagesFromSupabase(conversationId);
  }

  public async searchChatUsers(
    query: string,
    excludeUserId: string
  ): Promise<Array<{ id: string; fullName: string; email: string; role: string }>> {
    return repository.searchProfilesForChat(query, excludeUserId);
  }

  public getUnreadMessageCount(userId: string): number {
    const list = this.getConversations(userId);
    return list.reduce((acc, c) => acc + (c.unreadCount || 0), 0);
  }

  public getConversationById(id: string): Conversation | undefined {
    return repository.getConversationById(id);
  }

  public getMessages(conversationId: string): ChatMessage[] {
    return repository.getMessages(conversationId);
  }

  public getConversationMessages(conversationId: string): ChatMessage[] {
    return repository.getMessages(conversationId);
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
    return repository.sendMessage(conversationId, senderId, text, options);
  }

  public async sendAttachmentMessage(
    conversationId: string,
    senderId: string,
    file: File | Blob,
    fileName: string,
    text?: string
  ): Promise<{ success: boolean; message?: ChatMessage; error?: string }> {
    try {
      const conv = this.getConversationById(conversationId);
      if (!conv) {
        return { success: false, error: 'Target conversation not found.' };
      }
      if (!conv.participantIds.includes(senderId)) {
        return { success: false, error: 'You are not an active participant in this conversation.' };
      }

      const res = await storageService.uploadChatAttachmentWithSession({
        conversationId,
        file,
        originalFileName: fileName,
        text,
      });

      const message = repository.recordAttachmentMessage(
        conversationId,
        senderId,
        res.messageId,
        res.text || text || `Sent an attachment: ${res.fileName}`,
        {
          storagePath: res.storagePath,
          fileName: res.fileName,
          contentType: res.contentType,
          fileSize: res.fileSize,
          uploadedBy: senderId,
          uploadedAt: res.createdAt || new Date().toISOString(),
        },
        res.createdAt
      );

      return { success: true, message };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to send attachment.' };
    }
  }

  public async getAttachmentSignedUrl(messageId: string): Promise<string> {
    return storageService.getPrivateAssetDownloadUrl('chat-attachment', messageId);
  }

  public editMessage(
    messageId: string,
    userId: string,
    newText: string
  ): { success: boolean; error?: string; message?: ChatMessage } {
    return repository.editMessage(messageId, userId, newText);
  }

  public retryFailedMessage(
    messageId: string,
    userId: string
  ): { success: boolean; error?: string; message?: ChatMessage } {
    return repository.retryFailedMessage(messageId, userId);
  }

  public markMessagesAsRead(conversationId: string, userId: string): void {
    repository.markMessagesAsRead(conversationId, userId);
  }

  public searchMessages(conversationId: string, query: string): ChatMessage[] {
    return repository.searchMessages(conversationId, query);
  }

  public toggleMuteConversation(conversationId: string, userId: string): boolean {
    return repository.toggleMuteConversation(conversationId, userId);
  }

  public archiveConversation(conversationId: string, userId: string): boolean {
    return repository.archiveConversation(conversationId, userId);
  }

  public startDirectConversation(userIdA: string, userIdB: string): Conversation {
    return repository.startDirectConversation(userIdA, userIdB);
  }

  public async startDirectConversationPersisted(
    userIdA: string,
    userIdB: string,
    peerProfile?: { fullName?: string; role?: string }
  ): Promise<Conversation> {
    return repository.startDirectConversationPersisted(userIdA, userIdB, peerProfile);
  }

  public setTypingState(
    conversationId: string,
    userId: string,
    userName: string,
    isTyping: boolean
  ): void {
    appEventBus.publish(`chat:typing:${conversationId}`, {
      conversationId,
      userId,
      userName,
      isTyping,
      timestamp: Date.now(),
    });
  }

  public subscribeToTyping(
    conversationId: string,
    callback: (state: { conversationId: string; userId: string; userName: string; isTyping: boolean }) => void
  ): () => void {
    return appEventBus.subscribe(`chat:typing:${conversationId}`, callback);
  }

  public subscribeToReadReceipts(
    conversationId: string,
    callback: (data: { userId: string; readAt: string }) => void
  ): () => void {
    return appEventBus.subscribe(`chat:read:${conversationId}`, callback);
  }

  public subscribeToMessages(conversationId: string, onMessage: (msg: ChatMessage) => void): () => void {
    return appEventBus.subscribe<ChatMessage>(`chat:${conversationId}`, onMessage);
  }

  public subscribeToConversation(conversationId: string, onMessage: (msg: ChatMessage) => void): () => void {
    return appEventBus.subscribe<ChatMessage>(`chat:${conversationId}`, onMessage);
  }

  public subscribeToConversations(onUpdate: (convos: Conversation[]) => void): () => void {
    return appEventBus.subscribe<Conversation[]>('conversationsUpdated', onUpdate);
  }
}

export const chatService = new ChatService();
