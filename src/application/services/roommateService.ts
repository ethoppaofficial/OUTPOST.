import { RoommatePreference, RoommateRequest, AccommodationGroup } from '../../domain/types';
import { repository } from '../../infrastructure/repositories';

class RoommateService {
  public searchByRegistrationNumber(regQuery: string) {
    return repository.searchStudentByRegistrationNumber(regQuery);
  }

  public getPreferences(studentId: string): RoommatePreference | undefined {
    return repository.getRoommatePreference(studentId);
  }

  public getStudentPreferences(studentId: string): RoommatePreference | undefined {
    return repository.getRoommatePreference(studentId);
  }

  public savePreferences(pref: RoommatePreference): RoommatePreference {
    return repository.saveRoommatePreference(pref);
  }

  public saveStudentPreferences(pref: RoommatePreference): RoommatePreference {
    return repository.saveRoommatePreference(pref);
  }

  public getSuggestedMatches(studentId: string) {
    return repository.getSuggestedRoommates(studentId);
  }

  public getCompatibilityMatches(studentId: string) {
    return repository.getSuggestedRoommates(studentId);
  }

  public getRequests(userId: string) {
    return repository.getRoommateRequests(userId);
  }

  public getReceivedRequests(userId?: string): RoommateRequest[] {
    const id = userId || repository.getActiveUserId();
    return repository.getRoommateRequests(id).received;
  }

  public getSentRequests(userId?: string): RoommateRequest[] {
    const id = userId || repository.getActiveUserId();
    return repository.getRoommateRequests(id).sent;
  }

  public sendRequest(senderId: string, receiverId: string, message: string) {
    return repository.sendRoommateRequest(senderId, receiverId, message);
  }

  public sendRoommateRequest(senderId: string, receiverId: string, message: string) {
    return repository.sendRoommateRequest(senderId, receiverId, message);
  }

  public respondToRequest(requestId: string, action: 'accept' | 'reject' | 'cancel') {
    return repository.respondToRoommateRequest(requestId, action);
  }

  public acceptRoommateRequest(requestId: string) {
    return repository.respondToRoommateRequest(requestId, 'accept');
  }

  public declineRoommateRequest(requestId: string) {
    return repository.respondToRoommateRequest(requestId, 'reject');
  }

  public cancelRoommateRequest(requestId: string) {
    return repository.respondToRoommateRequest(requestId, 'cancel');
  }

  public getGroupsForUser(userId: string): AccommodationGroup[] {
    return repository.getGroupsForUser(userId);
  }

  public getStudentGroups(userId?: string): AccommodationGroup[] {
    const id = userId || repository.getActiveUserId();
    return repository.getGroupsForUser(id);
  }

  public getGroupById(id: string): AccommodationGroup | undefined {
    return repository.getGroupById(id);
  }

  public createGroup(
    name: string,
    description: string,
    leaderId: string,
    maxCapacity: number,
    targetPropertyId?: string
  ) {
    return repository.createGroup(name, description, leaderId, maxCapacity, targetPropertyId);
  }

  public createAccommodationGroup(
    leaderIdOrData: any,
    name?: string,
    universityOrDesc?: string,
    maxCapacity?: number,
    targetPropertyTitle?: string
  ): { success: boolean; group?: AccommodationGroup; error?: string } {
    if (typeof leaderIdOrData === 'object') {
      const g = repository.createGroup(
        leaderIdOrData.name,
        leaderIdOrData.description || `Accommodation group for ${leaderIdOrData.name}`,
        leaderIdOrData.leaderId,
        leaderIdOrData.maxCapacity || 4,
        leaderIdOrData.targetPropertyId
      );
      return { success: true, group: g };
    }

    const leaderId = leaderIdOrData;
    const g = repository.createGroup(
      name || 'Study Group',
      `Accommodation group for ${name || 'Hostel'} at ${universityOrDesc || 'Campus'}`,
      leaderId,
      maxCapacity || 4,
      targetPropertyTitle
    );
    if (universityOrDesc) g.university = universityOrDesc;
    if (targetPropertyTitle) g.targetPropertyTitle = targetPropertyTitle;
    repository.updateGroup(g);
    return { success: true, group: g };
  }

  public inviteStudentToGroup(groupId: string, senderId: string, receiverId: string) {
    return repository.inviteStudentToGroup(groupId, senderId, receiverId);
  }

  public inviteToGroup(groupId: string, senderOrReceiverId: string, receiverId?: string): { success: boolean; error?: string } {
    const senderId = receiverId ? senderOrReceiverId : repository.getActiveUserId();
    const targetReceiverId = receiverId || senderOrReceiverId;
    return repository.inviteStudentToGroup(groupId, senderId, targetReceiverId);
  }

  public getPendingInvitations(userId: string) {
    return repository.getPendingGroupInvitations(userId);
  }

  public respondToGroupInvitation(inviteId: string, action: 'accept' | 'reject') {
    return repository.respondToGroupInvitation(inviteId, action);
  }
}

export const roommateService = new RoommateService();
