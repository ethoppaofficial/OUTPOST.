import React, { useState } from 'react';
import { Search, ShieldCheck, UserCheck, Ban, CheckCircle2 } from 'lucide-react';
import { adminService } from '../../application/services/adminService';
import { User, UserRole } from '../../domain/types';
import { Badge, VerificationBadge } from '../../components/ui/Badge';

export const UsersPage: React.FC = () => {
  const [users, setUsers] = useState<User[]>(() => adminService.getAllUsers());
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const filtered = users.filter((u) => {
    const userName = u.name || u.fullName || u.email;
    const matchesSearch =
      userName.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.studentProfile?.registrationNumber &&
        u.studentProfile.registrationNumber.toLowerCase().includes(search.toLowerCase()));

    const matchesRole = roleFilter === 'all' || u.role === roleFilter;

    return matchesSearch && matchesRole;
  });

  const handleToggleSuspend = (userId: string, currentStatus: boolean) => {
    adminService.setUserSuspension(userId, !currentStatus);
    setUsers(adminService.getAllUsers());
    setActionSuccess(`User status updated.`);
    setTimeout(() => setActionSuccess(null), 3000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
          Platform User Management
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Inspect student credentials, landlord partnerships, registration identifiers, and account status.
        </p>
      </div>

      {actionSuccess && (
        <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 text-emerald-700 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs">
          <Search className="w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, or registration number..."
            className="w-full bg-transparent text-xs text-slate-900 dark:text-white focus:outline-none"
          />
        </div>

        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as any)}
          className="px-4 py-2.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300"
        >
          <option value="all">All Roles</option>
          <option value="student">Students</option>
          <option value="landlord">Landlords</option>
          <option value="admin">Administrators</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-400 uppercase text-[10px] font-bold border-b border-slate-100 dark:border-slate-800">
              <tr>
                <th className="py-3 px-5">User</th>
                <th className="py-3 px-5">Role</th>
                <th className="py-3 px-5">Reg / Business ID</th>
                <th className="py-3 px-5">Verification</th>
                <th className="py-3 px-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((user) => {
                const isStudent = user.role === 'student';
                const isLandlord = user.role === 'landlord';
                const isSuspended = user.status === 'suspended';

                return (
                  <tr key={user.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                    <td className="py-3.5 px-5">
                      <div className="font-bold text-slate-900 dark:text-white">{user.name}</div>
                      <div className="text-[11px] text-slate-400">{user.email}</div>
                    </td>
                    <td className="py-3.5 px-5 capitalize font-medium text-slate-700 dark:text-slate-300">
                      <Badge variant={user.role === 'admin' ? 'danger' : user.role === 'landlord' ? 'warning' : 'info'}>
                        {user.role}
                      </Badge>
                    </td>
                    <td className="py-3.5 px-5 font-mono text-slate-600 dark:text-slate-400">
                      {isStudent
                        ? user.studentProfile?.registrationNumber || 'None'
                        : isLandlord
                        ? user.landlordProfile?.businessName || 'Individual'
                        : 'Staff'}
                    </td>
                    <td className="py-3.5 px-5">
                      {isStudent && (
                        <VerificationBadge
                          type="student"
                          status={Boolean(user.studentProfile?.isProfileVerified)}
                        />
                      )}
                      {isLandlord && (
                        <VerificationBadge
                          type="landlord"
                          status={user.landlordProfile?.verificationStatus || 'pending'}
                        />
                      )}
                      {user.role === 'admin' && (
                        <Badge variant="danger">System Admin</Badge>
                      )}
                    </td>
                    <td className="py-3.5 px-5 text-right">
                      {user.role !== 'admin' && (
                        <button
                          onClick={() => handleToggleSuspend(user.id, isSuspended)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                            isSuspended
                              ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                              : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                          }`}
                        >
                          {isSuspended ? 'Reactivate' : 'Suspend'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
