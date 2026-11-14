import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import {
  Users,
  Shield,
  MessageSquare,
  Settings,
  UserPlus,
  ArrowLeft,
  UserMinus,
  Crown,
  CheckCircle,
  AlertCircle,
  Clock,
  DoorOpen,
  Edit2,
  Lock,
  Globe,
  UserCheck,
  Send,
  Building,
  Check,
  X,
  ShieldCheck,
  GraduationCap
} from 'lucide-react';
import { authService } from '../../application/services/authService';
import { useAuth } from '../../application/context/AuthContext';
import { groupChatService } from '../../application/services/groupChatService';
import { chatService } from '../../application/services/chatService';
import { AccommodationGroup, GroupMemberRecord, GroupJoinRequest, StudentProfile } from '../../domain/types';
import { Badge, VerificationBadge, VerificationTick } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';

export const GroupDetailPage: React.FC = () => {
  const { groupId, userId } = useParams<{ groupId: string; userId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser } = useAuth();
  const fallbackSession = authService.getSession();
  const activeUserId =
    currentUser?.id || (fallbackSession.user.id !== 'anonymous' ? fallbackSession.user.id : '');

  const [group, setGroup] = useState<AccommodationGroup | null>(() =>
    groupId ? groupChatService.getGroupById(groupId) || null : null
  );

  // Determine active sub-view based on path
  const isSettingsView = location.pathname.endsWith('/settings');
  const isMembersView = location.pathname.includes('/members');
  const isChatView = location.pathname.endsWith('/chat');

  // Selected profile for privacy-preserving modal
  const [selectedProfileUser, setSelectedProfileUser] = useState<StudentProfile | null>(null);

  // Group Admin Rename state
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);

  // Invite member state
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  // Leave / Succession Modal
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const [successionTargetId, setSuccessionTargetId] = useState('');
  const [leaveError, setLeaveError] = useState<string | null>(null);

  // Join requests & inline remove confirmation
  const [joinRequests, setJoinRequests] = useState<GroupJoinRequest[]>([]);
  const [confirmRemoveUserId, setConfirmRemoveUserId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const refreshGroup = () => {
    if (!groupId) return;
    const g = groupChatService.getGroupById(groupId);
    setGroup(g || null);
    if (g) {
      setJoinRequests(groupChatService.getGroupJoinRequests(g.id));
    }
  };

  useEffect(() => {
    refreshGroup();
  }, [groupId, location.pathname, activeUserId]);

  // Handle direct chat redirect if /chat accessed
  useEffect(() => {
    if (!isChatView || !group || !activeUserId) return;
    let cancelled = false;
    (async () => {
      let convos = chatService.getUserConversations(activeUserId);
      let groupConv = convos.find((c) => c.groupId === group.id);
      if (!groupConv) {
        try {
          convos = await chatService.loadUserConversations(activeUserId);
          groupConv = convos.find((c) => c.groupId === group.id);
        } catch {
          // Ignore and navigate to general chat list
        }
      }
      if (cancelled) return;
      if (groupConv) {
        navigate(`/student/chat/${groupConv.id}`);
      } else {
        navigate('/student/chat');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isChatView, group, activeUserId]);

  // Deep-linked member profile view (/members/:userId)
  useEffect(() => {
    if (userId) {
      const profile = groupChatService.getStudentProfile(userId);
      if (profile) {
        setSelectedProfileUser(profile);
      }
    }
  }, [userId]);

  if (!group) {
    return (
      <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 space-y-4">
        <Users className="w-10 h-10 text-slate-400 mx-auto" />
        <h2 className="text-base font-bold text-slate-900 dark:text-white">Accommodation Cohort Not Found</h2>
        <p className="text-xs text-slate-500 max-w-sm mx-auto">
          The requested group does not exist or has been discontinued.
        </p>
        <Link
          to="/student/groups"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Return to Cohorts</span>
        </Link>
      </div>
    );
  }

  const isMember = group.memberIds.includes(activeUserId);
  const isGroupAdmin =
    group.adminIds?.includes(activeUserId) ||
    group.leaderId === activeUserId ||
    group.ownerId === activeUserId;
  const isFull = group.memberIds.length >= group.maxCapacity;

  // Handler: Rename Group (Admin Only)
  const handleRename = (e: React.FormEvent) => {
    e.preventDefault();
    setRenameError(null);
    const res = groupChatService.renameGroup(group.id, activeUserId, newGroupName);
    if (res.success && res.group) {
      setGroup(res.group);
      setRenameModalOpen(false);
      setActionNotice({ type: 'success', text: `Cohort renamed to "${res.group.name}".` });
      refreshGroup();
    } else {
      setRenameError(res.error || 'Failed to rename group.');
    }
  };

  // Handler: Promote to Admin
  const handlePromoteAdmin = (targetUserId: string) => {
    const res = groupChatService.promoteMemberToAdmin(group.id, activeUserId, targetUserId);
    if (res.success) {
      setActionNotice({ type: 'success', text: 'Member promoted to group administrator.' });
      refreshGroup();
    } else {
      setActionNotice({ type: 'error', text: res.error || 'Failed to promote member.' });
    }
  };

  // Handler: Demote Admin
  const handleDemoteAdmin = (targetUserId: string) => {
    const res = groupChatService.demoteAdmin(group.id, activeUserId, targetUserId);
    if (res.success) {
      setActionNotice({ type: 'success', text: 'Administrator privileges adjusted.' });
      refreshGroup();
    } else {
      setActionNotice({ type: 'error', text: res.error || 'Failed to adjust role.' });
    }
  };

  // Handler: Remove Member (confirmed via inline button state, no browser confirm dialog)
  const handleRemoveMember = (targetUserId: string) => {
    const res = groupChatService.removeMember(group.id, activeUserId, targetUserId);
    setConfirmRemoveUserId(null);
    if (res.success) {
      setActionNotice({ type: 'success', text: 'Member removed from cohort and chat.' });
      refreshGroup();
    } else {
      setActionNotice({ type: 'error', text: res.error || 'Failed to remove member.' });
    }
  };

  // Handler: Leave Group
  const handleLeaveGroup = () => {
    setLeaveError(null);
    const adminCount = group.adminIds?.length || 1;
    const isSoleAdmin = isGroupAdmin && adminCount <= 1 && group.memberIds.length > 1;

    if (isSoleAdmin && !successionTargetId) {
      setLeaveError('You are the sole administrator. Please select a successor before leaving.');
      return;
    }

    if (isSoleAdmin && successionTargetId) {
      // Promote successor first
      groupChatService.promoteMemberToAdmin(group.id, activeUserId, successionTargetId);
    }

    const res = groupChatService.leaveGroup(group.id, activeUserId);
    if (res.success) {
      navigate('/student/groups');
    } else {
      setLeaveError(res.error || 'Unable to leave cohort.');
    }
  };

  // Handler: Join / Request Join
  const handleJoinOrRequest = () => {
    const res = groupChatService.joinGroup(group.id, activeUserId);
    if (res.success) {
      if (res.pendingApproval) {
        setActionNotice({ type: 'success', text: 'Join request submitted for admin review.' });
      } else {
        setActionNotice({ type: 'success', text: 'You have joined the cohort!' });
        refreshGroup();
      }
    } else {
      setActionNotice({ type: 'error', text: res.error || 'Failed to join cohort.' });
    }
  };

  // Handler: Start Direct Chat with member (persisted to Supabase)
  const handleStartDirectChat = async (targetUserId: string, peerName?: string) => {
    if (!activeUserId || targetUserId === activeUserId) return;
    try {
      const conv = await chatService.startDirectConversationPersisted(activeUserId, targetUserId, {
        fullName: peerName,
        role: 'student',
      });
      navigate(`/student/chat/${conv.id}`);
    } catch (err: any) {
      setActionNotice({ type: 'error', text: err?.message || 'Failed to open chat.' });
    }
  };

  // Handler: Open Group Chat
  const handleOpenGroupChat = async () => {
    if (!activeUserId) {
      navigate('/student/chat');
      return;
    }
    let convos = chatService.getUserConversations(activeUserId);
    let groupConv = convos.find((c) => c.groupId === group.id);
    if (!groupConv) {
      try {
        convos = await chatService.loadUserConversations(activeUserId);
        groupConv = convos.find((c) => c.groupId === group.id);
      } catch {
        // Fallback to general chat view
      }
    }
    if (groupConv) {
      navigate(`/student/chat/${groupConv.id}`);
    } else {
      navigate('/student/chat');
    }
  };

  // Invite candidate students
  const searchedStudents = searchQuery.trim()
    ? groupChatService.searchStudents(searchQuery).filter((s) => !group.memberIds.includes(s.userId))
    : [];

  const handleSendInvite = (targetUserId: string) => {
    setInviteError(null);
    setInviteSuccess(null);
    const res = groupChatService.inviteMember(group.id, activeUserId, targetUserId);
    if (res.success) {
      setInviteSuccess('Invitation sent successfully!');
    } else {
      setInviteError(res.error || 'Failed to send invite.');
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            to="/student/groups"
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition"
            aria-label="Back to Groups"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                {group.name}
              </h1>
              {isGroupAdmin && (
                <button
                  onClick={() => {
                    setNewGroupName(group.name);
                    setRenameModalOpen(true);
                  }}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition"
                  title="Rename Cohort (Admin)"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {group.university || 'General'} Accommodation Cohort • Established by {group.ownerName}
            </p>
          </div>
        </div>

        {/* Top actions */}
        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          {isMember ? (
            <>
              <button
                onClick={handleOpenGroupChat}
                className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-xs"
              >
                <MessageSquare className="w-4 h-4" />
                <span>Cohort Chat</span>
              </button>

              {isGroupAdmin && (
                <button
                  onClick={() => setInviteModalOpen(true)}
                  className="px-3.5 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs font-semibold transition flex items-center gap-1.5"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Invite Peer</span>
                </button>
              )}

              <button
                onClick={() => setLeaveModalOpen(true)}
                className="px-3 py-2 rounded-xl border border-rose-200 dark:border-rose-900 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-600 text-xs font-semibold transition flex items-center gap-1"
                title="Leave Cohort"
              >
                <DoorOpen className="w-4 h-4" />
                <span>Leave</span>
              </button>
            </>
          ) : (
            <button
              onClick={handleJoinOrRequest}
              disabled={isFull}
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-xs"
            >
              <UserPlus className="w-4 h-4" />
              <span>
                {isFull
                  ? 'Cohort Full'
                  : group.visibility === 'request_required'
                  ? 'Request to Join'
                  : 'Join Cohort'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Action Notice banner */}
      {actionNotice && (
        <div
          className={`p-3.5 rounded-2xl text-xs flex items-center justify-between gap-3 ${
            actionNotice.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800'
              : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 border border-rose-200 dark:border-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionNotice.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            <span>{actionNotice.text}</span>
          </div>
          <button onClick={() => setActionNotice(null)} className="p-1 hover:opacity-70">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Sub-Navigation Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-6 text-xs font-bold">
        <Link
          to={`/student/groups/${group.id}`}
          className={`pb-3 transition border-b-2 ${
            !isMembersView && !isSettingsView
              ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Overview & Target
        </Link>
        <Link
          to={`/student/groups/${group.id}/members`}
          className={`pb-3 transition border-b-2 flex items-center gap-1.5 ${
            isMembersView
              ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <span>Member Directory</span>
          <span className="px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[10px]">
            {group.memberIds.length}
          </span>
        </Link>
        {isGroupAdmin && (
          <Link
            to={`/student/groups/${group.id}/settings`}
            className={`pb-3 transition border-b-2 flex items-center gap-1.5 ${
              isSettingsView
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Settings & Requests</span>
            {joinRequests.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-white text-[10px]">
                {joinRequests.length}
              </span>
            )}
          </Link>
        )}
      </div>

      {/* MAIN VIEW: OVERVIEW */}
      {!isMembersView && !isSettingsView && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Left / Main column */}
          <div className="md:col-span-2 space-y-6">
            {/* Description & Purpose Card */}
            <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3">
              <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                Cohort Purpose & Guidelines
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {group.description || 'No detailed description set for this accommodation cohort.'}
              </p>
            </div>

            {/* Target Property Card */}
            <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3">
              <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
                <Building className="w-4 h-4 text-emerald-600" />
                <span>Target Accommodation</span>
              </h3>

              {group.targetPropertyName || group.targetPropertyTitle ? (
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                      {group.targetPropertyName || group.targetPropertyTitle}
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Cohorts reserve together to secure adjacent spaces.
                    </p>
                  </div>
                  {group.targetPropertyId && (
                    <Link
                      to={`/student/properties/${group.targetPropertyId}`}
                      className="px-3 py-1.5 rounded-xl bg-slate-900 text-white dark:bg-slate-700 text-xs font-semibold"
                    >
                      View Property
                    </Link>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-500 italic">
                  No property linked yet. Explore verified listings and synchronize with your squad.
                </p>
              )}
            </div>

            {/* Quick Members Preview */}
            <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                  Active Cohort Roster ({group.memberIds.length}/{group.maxCapacity})
                </h3>
                <Link
                  to={`/student/groups/${group.id}/members`}
                  className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline"
                >
                  View Full Directory →
                </Link>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {group.members.map((m) => {
                  const isUserAdmin = group.adminIds?.includes(m.userId) || m.role === 'admin' || m.role === 'leader' || m.role === 'owner';
                  return (
                    <div
                      key={m.userId}
                      onClick={() => navigate(`/student/groups/${group.id}/members/${m.userId}`)}
                      className="p-3 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between cursor-pointer hover:border-slate-300 dark:hover:border-slate-700 transition"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200 font-bold text-xs flex items-center justify-center">
                          {m.name?.[0] || 'U'}
                        </div>
                        <div>
                          <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1">
                            <Link
                              to={`/profiles/student/${m.userId}`}
                              onClick={(e) => e.stopPropagation()}
                              className="hover:text-emerald-600 dark:hover:text-emerald-400 hover:underline"
                            >
                              {m.name}
                            </Link>
                            {isUserAdmin && <Crown className="w-3 h-3 text-amber-500" />}
                          </div>
                          <span className="text-[10px] text-slate-400">
                            {isUserAdmin ? 'Group Admin' : 'Cohort Member'}
                          </span>
                        </div>
                      </div>
                      <span className="text-[10px] text-emerald-600 font-semibold">View</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right sidebar: Cohort Details */}
          <div className="space-y-6">
            <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
              <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                Cohort Details
              </h3>

              <div className="space-y-3 text-xs">
                <div className="flex justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">Visibility</span>
                  <span className="font-semibold text-slate-900 dark:text-white capitalize flex items-center gap-1">
                    {group.visibility === 'invite_only' ? <Lock className="w-3.5 h-3.5" /> : <Globe className="w-3.5 h-3.5" />}
                    {group.visibility || 'Discoverable'}
                  </span>
                </div>

                <div className="flex justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">Total Capacity</span>
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {group.maxCapacity} Members Max
                  </span>
                </div>

                <div className="flex justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">Available Spaces</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    {Math.max(0, group.maxCapacity - group.memberIds.length)} Spaces Left
                  </span>
                </div>

                <div className="flex justify-between py-2 border-b border-slate-100 dark:border-slate-800">
                  <span className="text-slate-500">Created On</span>
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {new Date(group.createdAt).toLocaleDateString()}
                  </span>
                </div>

                <div className="flex justify-between py-2">
                  <span className="text-slate-500">Linked Chat</span>
                  <span className="font-semibold text-emerald-600 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" /> Active
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW: MEMBER DIRECTORY (/members) */}
      {isMembersView && (
        <div className="space-y-6">
          <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Cohort Member Directory
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Privacy-preserving verified directory for cohort teammates.
                </p>
              </div>

              {isGroupAdmin && (
                <button
                  onClick={() => setInviteModalOpen(true)}
                  className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition flex items-center gap-1.5"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Invite Peer</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {group.members.map((m) => {
                const isTargetAdmin =
                  group.adminIds?.includes(m.userId) ||
                  m.role === 'admin' ||
                  m.role === 'leader' ||
                  m.role === 'owner';
                const isMe = m.userId === activeUserId;

                return (
                  <div
                    key={m.userId}
                    className="p-4 rounded-2xl border border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs space-y-3"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200 font-bold text-sm flex items-center justify-center">
                          {m.name?.[0] || 'U'}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <Link
                              to={`/profiles/student/${m.userId}`}
                              className="text-xs font-bold text-slate-900 dark:text-white hover:text-emerald-600 dark:hover:text-emerald-400 hover:underline"
                            >
                              {m.name}
                            </Link>
                            {isMe && (
                              <span className="text-[10px] text-slate-400 font-medium">(You)</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {isTargetAdmin ? (
                              <Badge variant="warning" size="sm">
                                <Crown className="w-2.5 h-2.5 mr-0.5" /> Admin
                              </Badge>
                            ) : (
                              <Badge variant="neutral" size="sm">
                                Member
                              </Badge>
                            )}
                            <span className="text-[10px] text-slate-400">
                              Joined {new Date(m.joinedAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => navigate(`/student/groups/${group.id}/members/${m.userId}`)}
                        className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
                      >
                        Profile
                      </button>
                    </div>

                    {/* Member actions */}
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                      {!isMe ? (
                        <button
                          onClick={() => void handleStartDirectChat(m.userId, m.name)}
                          className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 transition flex items-center gap-1 cursor-pointer"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>Direct Message</span>
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-400 italic">Your active account</span>
                      )}

                      {isGroupAdmin && !isMe && (
                        <div className="flex items-center gap-1.5">
                          {isTargetAdmin ? (
                            <button
                              onClick={() => handleDemoteAdmin(m.userId)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition"
                              title="Demote from Admin"
                            >
                              Demote
                            </button>
                          ) : (
                            <button
                              onClick={() => handlePromoteAdmin(m.userId)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition flex items-center gap-1"
                              title="Promote to Admin"
                            >
                              <Crown className="w-3 h-3 text-amber-500" />
                              <span>Make Admin</span>
                            </button>
                          )}

                          {confirmRemoveUserId === m.userId ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleRemoveMember(m.userId)}
                                className="px-2 py-1 rounded-lg bg-rose-600 text-white text-[10px] font-bold hover:bg-rose-500 cursor-pointer"
                              >
                                Confirm
                              </button>
                              <button
                                onClick={() => setConfirmRemoveUserId(null)}
                                className="px-2 py-1 rounded-lg bg-slate-100 text-slate-600 text-[10px] font-semibold hover:bg-slate-200 cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmRemoveUserId(m.userId)}
                              className="p-1 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition cursor-pointer"
                              title="Remove Member"
                            >
                              <UserMinus className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* VIEW: SETTINGS & JOIN REQUESTS (/settings) */}
      {isSettingsView && isGroupAdmin && (
        <div className="space-y-6">
          {/* Join Requests Queue */}
          <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-emerald-600" />
              <span>Pending Join Requests ({joinRequests.length})</span>
            </h3>

            {joinRequests.length === 0 ? (
              <p className="text-xs text-slate-400 py-3">No pending join requests at this time.</p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {joinRequests.map((req) => (
                  <div key={req.id} className="py-3 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-bold text-xs">
                        {req.userName[0]}
                      </div>
                      <div>
                        <Link
                          to={`/profiles/student/${req.userId}`}
                          className="text-xs font-bold text-slate-900 dark:text-white hover:text-emerald-600 dark:hover:text-emerald-400 hover:underline"
                        >
                          {req.userName}
                        </Link>
                        <span className="text-[10px] text-slate-400 block">
                          Requested on {new Date(req.requestedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          const res = groupChatService.respondToJoinRequest(req.id, activeUserId, 'approve');
                          if (res.success) {
                            setActionNotice({ type: 'success', text: `Approved ${req.userName}.` });
                            refreshGroup();
                          }
                        }}
                        className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 transition flex items-center gap-1"
                      >
                        <Check className="w-3.5 h-3.5" /> Approve
                      </button>
                      <button
                        onClick={() => {
                          const res = groupChatService.respondToJoinRequest(req.id, activeUserId, 'reject');
                          if (res.success) {
                            setActionNotice({ type: 'error', text: `Declined ${req.userName}.` });
                            refreshGroup();
                          }
                        }}
                        className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Group Rename & Configuration Card */}
          <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Cohort Administration</h3>
            <p className="text-xs text-slate-500">
              Only verified group administrators have authority to edit cohort title and join rules.
            </p>

            <button
              onClick={() => {
                setNewGroupName(group.name);
                setRenameModalOpen(true);
              }}
              className="px-4 py-2 rounded-xl bg-slate-900 text-white dark:bg-slate-800 text-xs font-semibold hover:bg-slate-800 transition flex items-center gap-1.5"
            >
              <Edit2 className="w-4 h-4" />
              <span>Rename Cohort</span>
            </button>
          </div>
        </div>
      )}

      {/* PRIVACY-PRESERVING MEMBER PROFILE MODAL */}
      {selectedProfileUser && (
        <Modal
          isOpen={!!selectedProfileUser}
          onClose={() => {
            setSelectedProfileUser(null);
            if (userId) navigate(`/student/groups/${group.id}/members`);
          }}
          title="Verified Student Profile"
          maxWidth="md"
        >
          <div className="space-y-5 p-2">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200 font-black text-xl flex items-center justify-center">
                {selectedProfileUser.fullName[0]}
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <Link
                    to={`/profiles/student/${selectedProfileUser.userId}`}
                    onClick={() => setSelectedProfileUser(null)}
                    className="text-base font-bold text-slate-900 dark:text-white hover:text-emerald-600 dark:hover:text-emerald-400 hover:underline"
                  >
                    {selectedProfileUser.fullName}
                  </Link>
                  <VerificationTick type="student" isVerified={Boolean(selectedProfileUser.isProfileVerified)} />
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {selectedProfileUser.university || 'Higher Institution'} • {selectedProfileUser.programme || 'Undergraduate'}
                </p>
                <div className="mt-1 flex items-center gap-2 flex-wrap">
                  <VerificationBadge type="student" status={Boolean(selectedProfileUser.isProfileVerified)} />
                  {selectedProfileUser.registrationNumber && (
                    <span className="font-mono text-[11px] text-slate-500 dark:text-slate-300">
                      {selectedProfileUser.registrationNumber}
                    </span>
                  )}
                  <span className="text-[11px] text-slate-400">{selectedProfileUser.studyLevel || 'Undergraduate'}</span>
                </div>
              </div>
            </div>

            {/* Privacy Shield Notice */}
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-800 flex items-center gap-2 text-[11px] text-slate-500">
              <Shield className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>
                Personal phone numbers, private emails, and official identity documents are protected by Outpost Privacy Rules.
              </span>
            </div>

            {/* Academic & Cohort Details */}
            <div className="space-y-2 text-xs">
              <h4 className="font-bold text-slate-900 dark:text-white uppercase tracking-wider text-[10px]">
                Student Information
              </h4>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-800">
                  <span className="text-slate-400 block text-[10px]">Preferred Area</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {selectedProfileUser.preferredLocation || 'Campus Vicinity'}
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-800">
                  <span className="text-slate-400 block text-[10px]">Study Level</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    {selectedProfileUser.studyLevel || 'Undergraduate'}
                  </span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2">
              <Link
                to={`/profiles/student/${selectedProfileUser.userId}`}
                onClick={() => setSelectedProfileUser(null)}
                className="mr-auto text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline"
              >
                View Full Public Profile →
              </Link>
              <button
                type="button"
                onClick={() => {
                  setSelectedProfileUser(null);
                  if (userId) navigate(`/student/groups/${group.id}/members`);
                }}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold"
              >
                Close
              </button>
              {selectedProfileUser.userId !== activeUserId && (
                <button
                  type="button"
                  onClick={() => {
                    void handleStartDirectChat(selectedProfileUser.userId, selectedProfileUser.fullName);
                    setSelectedProfileUser(null);
                  }}
                  className="px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Message 1-on-1</span>
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* RENAME MODAL (ADMIN ONLY) */}
      <Modal
        isOpen={renameModalOpen}
        onClose={() => setRenameModalOpen(false)}
        title="Rename Accommodation Cohort"
        maxWidth="sm"
      >
        <form onSubmit={handleRename} className="space-y-4 p-1">
          {renameError && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{renameError}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              New Cohort Name
            </label>
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              maxLength={60}
              required
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <p className="text-[10px] text-slate-400 mt-1">2 to 60 characters. Linked chat title will automatically update.</p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setRenameModalOpen(false)}
              className="px-3.5 py-1.5 rounded-xl border text-xs font-semibold text-slate-600 dark:text-slate-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-xs"
            >
              Save New Name
            </button>
          </div>
        </form>
      </Modal>

      {/* INVITE PEER MODAL */}
      <Modal
        isOpen={inviteModalOpen}
        onClose={() => {
          setInviteModalOpen(false);
          setSearchQuery('');
          setInviteError(null);
          setInviteSuccess(null);
        }}
        title="Invite Peer to Cohort"
        maxWidth="md"
      >
        <div className="space-y-4 p-1">
          {inviteError && (
            <div className="p-3 rounded-xl bg-rose-50 text-rose-700 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{inviteError}</span>
            </div>
          )}
          {inviteSuccess && (
            <div className="p-3 rounded-xl bg-emerald-50 text-emerald-700 text-xs flex items-center gap-2">
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              <span>{inviteSuccess}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Search by Student Name or Reg Number
            </label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="e.g. Adebayo, Chioma, 1804..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {searchedStudents.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">
                {searchQuery.trim() ? 'No matching peers found.' : 'Type a name or registration number to search.'}
              </p>
            ) : (
              searchedStudents.map((s) => (
                <div key={s.userId} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 font-bold text-xs flex items-center justify-center">
                      {s.fullName[0]}
                    </div>
                    <div>
                      <h5 className="text-xs font-bold text-slate-900 dark:text-white">{s.fullName}</h5>
                      <span className="text-[10px] text-slate-400">{s.university} • {s.registrationNumber || 'Verified'}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => handleSendInvite(s.userId)}
                    className="px-3 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition flex items-center gap-1 shadow-xs"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Invite</span>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </Modal>

      {/* LEAVE GROUP MODAL (WITH SUCCESSION REQUIREMENT) */}
      <Modal
        isOpen={leaveModalOpen}
        onClose={() => setLeaveModalOpen(false)}
        title="Leave Accommodation Cohort"
        maxWidth="sm"
      >
        <div className="space-y-4 p-1">
          {leaveError && (
            <div className="p-3 rounded-xl bg-rose-50 text-rose-700 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{leaveError}</span>
            </div>
          )}

          <p className="text-xs text-slate-600 dark:text-slate-300">
            Are you sure you want to leave <span className="font-bold text-slate-900 dark:text-white">"{group.name}"</span>? You will also be removed from the linked cohort chat.
          </p>

          {/* Check if sole admin */}
          {isGroupAdmin && (group.adminIds?.length || 1) <= 1 && group.memberIds.length > 1 && (
            <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 space-y-2 text-xs">
              <div className="flex items-center gap-1.5 font-bold text-amber-900 dark:text-amber-200">
                <Crown className="w-4 h-4 text-amber-500" />
                <span>Successor Required</span>
              </div>
              <p className="text-[11px] text-amber-800 dark:text-amber-300">
                You are currently the only administrator. Before leaving, you must transfer administration to an active member:
              </p>
              <select
                value={successionTargetId}
                onChange={(e) => setSuccessionTargetId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 text-xs"
              >
                <option value="">-- Choose new Group Administrator --</option>
                {group.members
                  .filter((m) => m.userId !== activeUserId)
                  .map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                    </option>
                  ))}
              </select>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setLeaveModalOpen(false)}
              className="px-3.5 py-1.5 rounded-xl border text-xs font-semibold text-slate-600 dark:text-slate-300"
            >
              Cancel
            </button>
            <button
              onClick={handleLeaveGroup}
              className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-xs"
            >
              Confirm & Leave
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
