import { AppNotification } from '../../domain/types';
import { repository } from '../../infrastructure/repositories';
import { appEventBus } from '../../infrastructure/events/eventBus';

class NotificationService {
  public getNotifications(userId: string): AppNotification[] {
    return repository.getNotifications(userId);
  }

  public async refreshNotifications(userId: string): Promise<AppNotification[]> {
    return repository.fetchNotificationsFromSupabase(userId);
  }

  public getUnreadCount(userId: string): number {
    return repository.getNotifications(userId).filter((n) => !n.isRead).length;
  }

  public markAsRead(id: string): void {
    repository.markNotificationAsRead(id);
  }

  public markAllAsRead(userId: string): void {
    repository.markAllNotificationsAsRead(userId);
  }

  public deleteNotification(id: string): void {
    repository.deleteNotification(id);
  }

  public subscribeToNotifications(userId: string, onNotif: (n: AppNotification) => void): () => void {
    return appEventBus.subscribe<AppNotification>(`notifications:${userId}`, onNotif);
  }

  public subscribeToListUpdates(onUpdate: () => void): () => void {
    return appEventBus.subscribe('notificationsUpdated', onUpdate);
  }
}

export const notificationService = new NotificationService();
