import { Conversation, ChatMessage } from '../../domain/types';
import { repository } from '../../infrastructure/repositories/localStorageRepository';
import { appEventBus } from '../../infrastructure/events/eventBus';

class ChatService {
  public getConversations(userId: string): Conversation[] {
    return repository.getConversations(userId);
  }

  public getUserConversations(userId: string): Conversation[] {
    return repository.getConversations(userId);
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

  public sendMessage(conversationId: string, senderId: string, textOrName: string, possibleText?: string): ChatMessage {
    const content = possibleText !== undefined ? possibleText : textOrName;
    return repository.sendMessage(conversationId, senderId, content);
  }

  public startDirectConversation(userIdA: string, userIdB: string): Conversation {
    return repository.startDirectConversation(userIdA, userIdB);
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
