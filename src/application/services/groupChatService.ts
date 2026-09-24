import { AccommodationGroup, GroupInvitation, GroupJoinRequest, StudentProfile, User } from '../../domain/types';
import { repository } from '../../infrastructure/repositories';
import { appEventBus } from '../../infrastructure/events/eventBus';

export class GroupChatService {
  public getGroups(): AccommodationGroup[] {
    return repository.getAccommodationGroups();
  }

  public getGroupById(groupId: string): AccommodationGroup | undefined {
    return repository.getGroupById(groupId);
  }

  public getGroupsForUser(userId: string): AccommodationGroup[] {
    return repository.getAccommodationGroups().filter((g) => g.memberIds.includes(userId));
  }

  public createGroup(
    name: string,
    description: string,
    leaderId: string,
    maxCapacity: number,
    targetPropertyId?: string,
    visibility: 'discoverable' | 'invite_only' | 'request_required' = 'discoverable'
  ): AccommodationGroup {
    return repository.createGroup(name, description, leaderId, maxCapacity, targetPropertyId, visibility);
  }

  public renameGroup(
    groupId: string,
    actorId: string,
    newName: string
  ): { success: boolean; error?: string; group?: AccommodationGroup } {
    return repository.renameGroup(groupId, actorId, newName);
  }

  public promoteMemberToAdmin(
    groupId: string,
    actorId: string,
    targetUserId: string
  ): { success: boolean; error?: string } {
    return repository.promoteMemberToAdmin(groupId, actorId, targetUserId);
  }

  public demoteAdmin(
    groupId: string,
    actorId: string,
    targetUserId: string
  ): { success: boolean; error?: string } {
    return repository.demoteAdmin(groupId, actorId, targetUserId);
  }

  public removeMember(
    groupId: string,
    actorId: string,
    targetUserId: string
  ): { success: boolean; error?: string } {
    return repository.removeMember(groupId, actorId, targetUserId);
  }

  public leaveGroup(groupId: string, userId: string): { success: boolean; error?: string } {
    return repository.leaveGroup(groupId, userId);
  }

  public joinGroup(
    groupId: string,
    userId: string
  ): { success: boolean; error?: string; pendingApproval?: boolean } {
    return repository.joinGroup(groupId, userId);
  }

  public requestToJoinGroup(
    groupId: string,
    userId: string
  ): { success: boolean; error?: string; pendingApproval?: boolean } {
    return repository.requestToJoinGroup(groupId, userId);
  }

  public getGroupJoinRequests(groupId: string): GroupJoinRequest[] {
    return repository.getGroupJoinRequests(groupId);
  }

  public respondToJoinRequest(
    requestId: string,
    actorId: string,
    action: 'approve' | 'reject'
  ): { success: boolean; error?: string } {
    return repository.respondToJoinRequest(requestId, actorId, action);
  }

  public inviteMember(
    groupId: string,
    senderId: string,
    receiverId: string
  ): { success: boolean; error?: string } {
    return repository.inviteStudentToGroup(groupId, senderId, receiverId);
  }

  public getPendingInvitations(userId: string): GroupInvitation[] {
    return repository.getPendingGroupInvitations(userId);
  }

  public respondToInvitation(inviteId: string, action: 'accept' | 'reject'): boolean {
    return repository.respondToGroupInvitation(inviteId, action);
  }

  public getStudentProfile(userId: string): StudentProfile | undefined {
    return repository.getStudentProfile(userId);
  }

  public getUserById(userId: string): User | undefined {
    return repository.getUserById(userId);
  }

  public searchStudents(query: string): StudentProfile[] {
    return repository.searchStudents(query);
  }
}

export const groupChatService = new GroupChatService();
