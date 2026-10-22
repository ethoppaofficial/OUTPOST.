/**
 * @file GroupsPage.tsx
 * @description Shared accommodation groups and cohort coordination page for BUK students.
 * 
 * Manages collaborative rental arrangements:
 * - Three tabs: "My Groups" (enrolled cohorts), "Explore Groups" (public or request-to-join clusters in Danbare/Rimin Gata), and "Invitations".
 * - Group properties: target capacity (e.g. 2-4 students), budget targets, gender cohorting, linked target properties.
 * - Group messaging linkage: each group has an associated group conversation in `chatService`.
 * - Access control: Open, Request-to-Join, or Invite-Only visibility settings.
 */

import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Users,
  Plus,
  MessageSquare,
  ShieldCheck,
  UserPlus,
  Globe,
  Lock,
  UserCheck,
  CheckCircle,
  AlertCircle,
  Building,
  Crown,
  Inbox,
  ArrowRight
} from 'lucide-react';
import { authService } from '../../application/services/authService';
import { groupChatService } from '../../application/services/groupChatService';
import { chatService } from '../../application/services/chatService';
import { AccommodationGroup, GroupInvitation } from '../../domain/types';
import { Badge } from '../../components/ui/Badge';

/**
 * GroupsPage Component
 * 
 * Displays enrolled student cohorts, allows discovery of new roommate groups,
 * handles invitation acceptance/rejection, and launches group chat threads.
 */
export const GroupsPage: React.FC = () => {
  const navigate = useNavigate();
  const session = authService.getSession();

  const [allGroups, setAllGroups] = useState<AccommodationGroup[]>(() => groupChatService.getGroups());
  const [invitations, setInvitations] = useState<GroupInvitation[]>(() =>
    groupChatService.getPendingInvitations(session.user.id)
  );
  const [activeTab, setActiveTab] = useState<'my' | 'explore' | 'invites'>('my');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const refreshData = () => {
    setAllGroups(groupChatService.getGroups());
    setInvitations(groupChatService.getPendingInvitations(session.user.id));
  };

  useEffect(() => {
    refreshData();
  }, []);

  const myGroups = allGroups.filter((g) => g.memberIds.includes(session.user.id));
  const discoverableGroups = allGroups.filter(
    (g) => !g.memberIds.includes(session.user.id) && g.visibility !== 'invite_only'
  );

  const handleJoin = (groupId: string) => {
    const res = groupChatService.joinGroup(groupId, session.user.id);
    if (res.success) {
      if (res.pendingApproval) {
        setNotice({ type: 'success', text: 'Join request sent to cohort administrators.' });
      } else {
        setNotice({ type: 'success', text: 'You have joined the cohort!' });
      }
      refreshData();
    } else {
      setNotice({ type: 'error', text: res.error || 'Failed to join group.' });
    }
  };

  const handleRespondInvite = (inviteId: string, action: 'accept' | 'reject') => {
    const success = groupChatService.respondToInvitation(inviteId, action);
    if (success) {
      setNotice({
        type: 'success',
        text: action === 'accept' ? 'Invitation accepted! You are now a cohort member.' : 'Invitation declined.',
      });
      refreshData();
    }
  };

  const handleOpenChat = (group: AccommodationGroup) => {
    const convos = chatService.getUserConversations(session.user.id);
    const conv = convos.find((c) => c.groupId === group.id);
    if (conv) {
      navigate(`/student/chat/${conv.id}`);
    } else {
      navigate('/student/chat');
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Accommodation Cohorts & Squads
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Form trusted house-hunting teams, lock multi-room flats together, and collaborate via linked real-time chats.
          </p>
        </div>

        <Link
          to="/student/groups/new"
          className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-xs flex items-center gap-1.5 self-start sm:self-auto transition"
        >
          <Plus className="w-4 h-4" />
          <span>Establish New Cohort</span>
        </Link>
      </div>

      {/* Notice Banner */}
      {notice && (
        <div
          className={`p-3.5 rounded-2xl text-xs flex items-center justify-between gap-3 ${
            notice.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800'
              : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 border border-rose-200 dark:border-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {notice.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            <span>{notice.text}</span>
          </div>
          <button onClick={() => setNotice(null)} className="text-xs underline hover:opacity-80">
            Dismiss
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-6 text-xs font-bold">
        <button
          onClick={() => setActiveTab('my')}
          className={`pb-3 transition border-b-2 flex items-center gap-1.5 ${
            activeTab === 'my'
              ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <span>My Cohorts</span>
          <span className="px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[10px]">
            {myGroups.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('explore')}
          className={`pb-3 transition border-b-2 flex items-center gap-1.5 ${
            activeTab === 'explore'
              ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Globe className="w-3.5 h-3.5" />
          <span>Explore Open Cohorts</span>
          <span className="px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[10px]">
            {discoverableGroups.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('invites')}
          className={`pb-3 transition border-b-2 flex items-center gap-1.5 ${
            activeTab === 'invites'
              ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Inbox className="w-3.5 h-3.5" />
          <span>Invitations</span>
          {invitations.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-emerald-600 text-white text-[10px]">
              {invitations.length}
            </span>
          )}
        </button>
      </div>

      {/* TAB 1: MY COHORTS */}
      {activeTab === 'my' && (
        <>
          {myGroups.length === 0 ? (
            <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-slate-200 dark:border-slate-800 space-y-4">
              <Users className="w-10 h-10 text-slate-400 mx-auto" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">You Have Not Joined Any Cohorts</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Form an accommodation team with campus peers or explore open cohorts looking for flatmates.
              </p>
              <div className="flex items-center justify-center gap-3">
                <Link
                  to="/student/groups/new"
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-xs transition"
                >
                  Create Cohort
                </Link>
                <button
                  onClick={() => setActiveTab('explore')}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  Explore Open Cohorts
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {myGroups.map((g) => {
                const isAdmin =
                  g.adminIds?.includes(session.user.id) ||
                  g.leaderId === session.user.id ||
                  g.ownerId === session.user.id;

                return (
                  <div
                    key={g.id}
                    className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4 flex flex-col justify-between hover:border-slate-300 dark:hover:border-slate-700 transition"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                              {g.university || 'General'} Cohort
                            </span>
                            {isAdmin && (
                              <span className="px-1.5 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-[9px] font-bold flex items-center gap-0.5">
                                <Crown className="w-2.5 h-2.5" /> Admin
                              </span>
                            )}
                          </div>
                          <h3 className="text-base font-bold text-slate-900 dark:text-white">
                            {g.name}
                          </h3>
                        </div>

                        <Badge variant="neutral" size="sm">
                          {g.memberIds.length} / {g.maxCapacity} Members
                        </Badge>
                      </div>

                      {g.description && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                          {g.description}
                        </p>
                      )}

                      {(g.targetPropertyName || g.targetPropertyTitle) && (
                        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 text-[11px] text-slate-600 dark:text-slate-300 flex items-center gap-2">
                          <Building className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                          <span className="truncate">
                            Target: <span className="font-semibold text-slate-900 dark:text-white">{g.targetPropertyName || g.targetPropertyTitle}</span>
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                      <button
                        onClick={() => handleOpenChat(g)}
                        className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white text-xs font-semibold transition flex items-center gap-1.5"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>Chat</span>
                      </button>

                      <Link
                        to={`/student/groups/${g.id}`}
                        className="px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 transition flex items-center gap-1"
                      >
                        <span>Cohort Hub</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* TAB 2: EXPLORE OPEN COHORTS */}
      {activeTab === 'explore' && (
        <div className="space-y-4">
          {discoverableGroups.length === 0 ? (
            <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 text-xs text-slate-400">
              No open public cohorts discovered at this time. Be the first to establish one!
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {discoverableGroups.map((g) => {
                const isFull = g.memberIds.length >= g.maxCapacity;
                const requiresRequest = g.visibility === 'request_required';

                return (
                  <div
                    key={g.id}
                    className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4 flex flex-col justify-between"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block">
                            {g.university || 'Campus'} Cohort
                          </span>
                          <h3 className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                            {g.name}
                          </h3>
                        </div>
                        <Badge variant={isFull ? 'danger' : 'success'} size="sm">
                          {isFull ? 'Full' : `${g.maxCapacity - g.memberIds.length} Spots Open`}
                        </Badge>
                      </div>

                      <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                        {g.description || 'Verified accommodation group coordinating mutual housing lease.'}
                      </p>
                    </div>

                    <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                      <Link
                        to={`/student/groups/${g.id}`}
                        className="text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                      >
                        View Details →
                      </Link>

                      <button
                        onClick={() => handleJoin(g.id)}
                        disabled={isFull}
                        className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-xs"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        <span>{requiresRequest ? 'Request to Join' : 'Join Cohort'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: INVITATIONS */}
      {activeTab === 'invites' && (
        <div className="space-y-4">
          {invitations.length === 0 ? (
            <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 text-xs text-slate-400">
              You have no pending cohort invitations.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-4">
              {invitations.map((inv) => (
                <div key={inv.id} className="py-4 flex items-center justify-between gap-4">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                      Invitation to join "{inv.groupName}"
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Sent by {inv.senderName} • {new Date(inv.createdAt).toLocaleDateString()}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleRespondInvite(inv.id, 'accept')}
                      className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-xs"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => handleRespondInvite(inv.id, 'reject')}
                      className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
