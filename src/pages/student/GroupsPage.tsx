import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, Plus, MessageSquare, ShieldCheck, UserPlus, Trash2 } from 'lucide-react';
import { authService } from '../../application/services/authService';
import { roommateService } from '../../application/services/roommateService';
import { Modal } from '../../components/ui/Modal';
import { Badge } from '../../components/ui/Badge';

export const GroupsPage: React.FC = () => {
  const session = authService.getSession();
  const [groups, setGroups] = useState(() => roommateService.getStudentGroups(session.user.id));
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  const [groupName, setGroupName] = useState('');
  const [targetUniversity, setTargetUniversity] = useState('UNILAG');
  const [targetPropertyTitle, setTargetPropertyTitle] = useState('');
  const [maxCapacity, setMaxCapacity] = useState(4);
  const [inviteStudentId, setInviteStudentId] = useState('user-student-2');
  const [error, setError] = useState<string | null>(null);

  const handleCreateGroup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim()) return;

    const res = roommateService.createAccommodationGroup(
      session.user.id,
      groupName.trim(),
      targetUniversity,
      maxCapacity,
      targetPropertyTitle || undefined
    );

    if (res.success) {
      setGroups(roommateService.getStudentGroups(session.user.id));
      setCreateModalOpen(false);
      setGroupName('');
    }
  };

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroupId) return;

    const res = roommateService.inviteToGroup(selectedGroupId, inviteStudentId);
    if (res.success) {
      setGroups(roommateService.getStudentGroups(session.user.id));
      setInviteModalOpen(false);
      setError(null);
    } else {
      setError(res.error || 'Failed to add student to group.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Accommodation Groups & Cohorts
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Team up with trusted peers to jointly reserve whole multi-room apartments and split session costs
          </p>
        </div>

        <button
          onClick={() => setCreateModalOpen(true)}
          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Create New Cohort</span>
        </button>
      </div>

      {/* Groups List */}
      {groups.length === 0 ? (
        <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-slate-200 dark:border-slate-800 space-y-3">
          <Users className="w-8 h-8 text-slate-400 mx-auto" />
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">No Groups Yet</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            Form an accommodation group to coordinate house-hunting, chat together, and lock spaces in the same property.
          </p>
          <button
            onClick={() => setCreateModalOpen(true)}
            className="px-4 py-2 rounded-xl bg-slate-900 dark:bg-emerald-600 text-white text-xs font-semibold"
          >
            Create Your First Group
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {groups.map((g) => {
            const isLeader = g.leaderId === session.user.id;
            return (
              <div
                key={g.id}
                className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4 flex flex-col justify-between"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block">
                        {g.university} Cohort
                      </span>
                      <h3 className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                        {g.name}
                      </h3>
                    </div>
                    <Badge variant="neutral" size="sm">
                      {g.memberIds.length} / {g.maxCapacity} Members
                    </Badge>
                  </div>

                  {g.targetPropertyTitle && (
                    <p className="text-xs text-slate-500">
                      Target Accommodation: <span className="font-semibold text-slate-700 dark:text-slate-300">{g.targetPropertyTitle}</span>
                    </p>
                  )}

                  {/* Members list */}
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                    <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                      Group Cohort Members:
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {g.memberIds.map((mId, idx) => (
                        <span
                          key={mId}
                          className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-medium"
                        >
                          {mId === g.leaderId ? '👑 Leader' : `Member ${idx + 1}`}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                  <Link
                    to="/student/chat"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline"
                  >
                    <MessageSquare className="w-4 h-4" />
                    <span>Open Group Thread</span>
                  </Link>

                  {isLeader && (
                    <button
                      onClick={() => {
                        setSelectedGroupId(g.id);
                        setInviteModalOpen(true);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>Invite Member</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
      <Modal isOpen={createModalOpen} onClose={() => setCreateModalOpen(false)} title="Create Student Accommodation Cohort">
        <form onSubmit={handleCreateGroup} className="space-y-4 text-xs">
          <div className="space-y-1.5">
            <label className="font-semibold text-slate-700 dark:text-slate-300">Group Name</label>
            <input
              type="text"
              required
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="e.g. UNILAG 400L Engineering Crew"
              className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700 dark:text-slate-300">University</label>
              <select
                value={targetUniversity}
                onChange={(e) => setTargetUniversity(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              >
                <option value="UNILAG">UNILAG</option>
                <option value="UI">UI</option>
                <option value="OAU">OAU</option>
                <option value="Covenant">Covenant</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700 dark:text-slate-300">Target Capacity</label>
              <input
                type="number"
                min="2"
                max="8"
                value={maxCapacity}
                onChange={(e) => setMaxCapacity(Number(e.target.value))}
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="font-semibold text-slate-700 dark:text-slate-300">Target Property (Optional)</label>
            <input
              type="text"
              value={targetPropertyTitle}
              onChange={(e) => setTargetPropertyTitle(e.target.value)}
              placeholder="e.g. Silver Crest Luxury Student Flats"
              className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setCreateModalOpen(false)}
              className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
            >
              Create Cohort
            </button>
          </div>
        </form>
      </Modal>

      {/* Invite Modal */}
      <Modal isOpen={inviteModalOpen} onClose={() => setInviteModalOpen(false)} title="Invite Student to Cohort">
        <form onSubmit={handleInvite} className="space-y-4 text-xs">
          <div className="space-y-1.5">
            <label className="font-semibold text-slate-700 dark:text-slate-300">Select Student</label>
            <select
              value={inviteStudentId}
              onChange={(e) => setInviteStudentId(e.target.value)}
              className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
            >
              <option value="user-student-2">Chioma Adebayo (UI - Verified)</option>
              <option value="user-student-3">Ibrahim Musa (OAU - Pending)</option>
              <option value="user-student-4">Zainab Kalu (Covenant - Enrolled)</option>
            </select>
          </div>

          {error && (
            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setInviteModalOpen(false)}
              className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
            >
              Add to Group
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
