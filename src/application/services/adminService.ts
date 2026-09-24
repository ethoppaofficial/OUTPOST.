import { User, AuditLog } from '../../domain/types';
import { repository } from '../../infrastructure/repositories/localStorageRepository';

export interface PlatformMetrics {
  totalUsers: number;
  totalStudents: number;
  totalLandlords: number;
  totalProperties: number;
  approvedProperties: number;
  pendingProperties: number;
  pendingLandlordVerifications: number;
  pendingStudentVerifications: number;
  pendingVerifications: number;
  totalReservations: number;
  activeReservations: number;
  confirmedReservations: number;
  expiredReservations: number;
  pendingReceipts: number;
}

class AdminService {
  public getAdminMetrics(): PlatformMetrics {
    return this.getPlatformMetrics();
  }

  public getPlatformMetrics(): PlatformMetrics {
    const users = repository.getUsers();
    const props = repository.getProperties();
    const res = repository.getReservations();
    const sdocs = repository.getStudentDocs();
    const lprofiles = repository.getLandlordProfiles();
    const receipts = repository.getPaymentReceipts();

    return {
      totalUsers: users.length,
      totalStudents: users.filter((u) => u.role === 'student').length,
      totalLandlords: users.filter((u) => u.role === 'landlord').length,
      totalProperties: props.length,
      approvedProperties: props.filter((p) => p.verificationStatus === 'approved').length,
      pendingProperties: props.filter((p) => p.verificationStatus === 'pending').length,
      pendingLandlordVerifications: lprofiles.filter((lp) => lp.verificationStatus === 'pending').length,
      pendingStudentVerifications: sdocs.filter((d) => d.status === 'pending').length,
      pendingVerifications:
        lprofiles.filter((lp) => lp.verificationStatus === 'pending').length +
        sdocs.filter((d) => d.status === 'pending').length,
      totalReservations: res.length,
      activeReservations: res.filter((r) => r.status === 'pending_payment' || r.status === 'receipt_submitted').length,
      confirmedReservations: res.filter((r) => r.status === 'confirmed').length,
      expiredReservations: res.filter((r) => r.status === 'expired').length,
      pendingReceipts: receipts.filter((rc) => rc.status === 'pending_review').length,
    };
  }

  public getUsers(filter?: { role?: string; status?: string; query?: string }): User[] {
    let list = repository.getUsers().map((u) => {
      const studentProfile = repository.getStudentProfile(u.id);
      const landlordProfile = repository.getLandlordProfile(u.id);
      const name = studentProfile?.fullName || landlordProfile?.legalName || (u.role === 'admin' ? 'Platform Administrator' : u.email.split('@')[0]);
      return {
        ...u,
        name,
        fullName: name,
        status: u.accountStatus,
        studentProfile,
        landlordProfile,
      };
    });

    if (filter?.role && filter.role !== 'All') {
      list = list.filter((u) => u.role === filter.role);
    }
    if (filter?.status && filter.status !== 'All') {
      list = list.filter((u) => u.accountStatus === filter.status);
    }
    if (filter?.query) {
      const q = filter.query.toLowerCase().trim();
      list = list.filter((u) => u.email.toLowerCase().includes(q) || u.id.toLowerCase().includes(q) || (u.name && u.name.toLowerCase().includes(q)));
    }
    return list;
  }

  public getAllUsers(): User[] {
    return this.getUsers();
  }

  public setUserSuspension(userId: string, suspend: boolean, adminId: string = 'usr-admin-1'): User | undefined {
    return this.toggleUserStatus(userId, suspend ? 'suspended' : 'active', adminId);
  }

  public toggleUserStatus(userId: string, newStatus: 'active' | 'suspended', adminId: string): User | undefined {
    const user = repository.getUserById(userId);
    if (!user) return undefined;

    const oldStatus = user.accountStatus;
    user.accountStatus = newStatus;
    repository.updateUser(user);

    repository.logAudit({
      action: newStatus === 'suspended' ? 'SUSPEND_USER' : 'ACTIVATE_USER',
      actorId: adminId,
      actorName: 'Platform Administrator',
      actorRole: 'admin',
      targetEntity: 'User',
      targetId: userId,
      details: `User status changed from ${oldStatus} to ${newStatus}.`,
    });

    return user;
  }

  public getAuditLogs(): AuditLog[] {
    return repository.getAuditLogs();
  }

  public resetDatabase(): void {
    repository.resetToSeed();
  }
}

export const adminService = new AdminService();
