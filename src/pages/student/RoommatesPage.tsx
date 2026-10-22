/**
 * @file RoommatesPage.tsx
 * @description Roommate discovery and pairing page for Bayero University Kano (BUK) students.
 * 
 * Features:
 * - Computes multi-factor compatibility scores via `roommateService.getCompatibilityMatches()`.
 * - Factors: Budget overlap, study noise preferences, cleanliness, sleep schedule, religious observances, guest policies.
 * - Allows students to filter candidates by gender and minimum compatibility percentage.
 * - Displays breakdowns of matching strengths and potential points of friction.
 * - Facilitates sending formal roommate requests with personalized introduction notes.
 */

import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Users, Sparkles, CheckCircle2, Send, ShieldCheck, XCircle } from 'lucide-react';
import { authService } from '../../application/services/authService';
import { roommateService } from '../../application/services/roommateService';
import { VerificationBadge, Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { StudentProfile, User } from '../../domain/types';
import { CompatibilityResult } from '../../domain/matching';

/** Represents a candidate roommate with user record and compatibility score calculation */
interface MatchItem {
  student: StudentProfile;
  user: User;
  compatibility: CompatibilityResult;
}

/**
 * RoommatesPage Component
 * 
 * Renders the roommate candidate list, detailed breakdown modal,
 * and handles dispatch of connection/pairing invitations.
 */
export const RoommatesPage: React.FC = () => {
  const session = authService.getSession();
  const [selectedMatch, setSelectedMatch] = useState<MatchItem | null>(null);
  const [requestSentStudentId, setRequestSentStudentId] = useState<string | null>(null);
  const [requestNote, setRequestNote] = useState(
    'Hi! I noticed our study habits, budget, and campus lifestyle align well. Would love to team up for accommodation!'
  );

  // Filter state
  const [genderFilter, setGenderFilter] = useState('all');
  const [minScore, setMinScore] = useState(50);

  const matches: MatchItem[] = useMemo(() => {
    return roommateService.getCompatibilityMatches(session.user.id);
  }, [session.user.id, requestSentStudentId]);

  const filteredMatches = matches.filter((m) => {
    if (m.compatibility.score < minScore) return false;
    if (genderFilter !== 'all' && m.student.gender !== genderFilter) return false;
    return true;
  });

  const handleSendRequest = (targetStudentId: string) => {
    const res = roommateService.sendRoommateRequest(session.user.id, targetStudentId, requestNote);
    if (res.success) {
      setRequestSentStudentId(targetStudentId);
      setSelectedMatch(null);
    }
  };

  return (
    <div className="space-y-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              Compatible Roommates
            </h1>
            <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-xs font-bold">
              Rule-Based Scoring
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Explainable rule-based compatibility rankings grounded on budget, sleep habits, neatness, and campus proximity
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/student/roommates/preferences"
            className="px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition"
          >
            Edit My Preferences
          </Link>
          <Link
            to="/student/roommates/requests"
            className="px-3.5 py-2 rounded-xl bg-slate-900 dark:bg-emerald-600 text-white text-xs font-medium shadow-xs"
          >
            Manage Requests
          </Link>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center gap-4 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-600 dark:text-slate-400">Gender Policy:</span>
          <select
            value={genderFilter}
            onChange={(e) => setGenderFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200"
          >
            <option value="all">Any Gender</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-600 dark:text-slate-400">Min Score:</span>
          <input
            type="range"
            min={40}
            max={90}
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="accent-emerald-600 w-28"
          />
          <span className="font-bold text-emerald-600 dark:text-emerald-400">{minScore}%+</span>
        </div>

        <div className="ml-auto text-slate-400">
          Showing <strong>{filteredMatches.length}</strong> compatible candidates
        </div>
      </div>

      {/* Matches Grid */}
      {filteredMatches.length === 0 ? (
        <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-slate-200 dark:border-slate-800 space-y-2">
          <Users className="w-8 h-8 text-slate-400 mx-auto" />
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">No Matching Students Found</h3>
          <p className="text-xs text-slate-400">
            Try adjusting your compatibility threshold or broadening your budget in your preferences.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredMatches.map((match) => {
            const st = match.student;
            const usr = match.user;
            const comp = match.compatibility;
            return (
              <div
                key={st.userId}
                className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 p-6 flex flex-col justify-between space-y-5 shadow-xs hover:shadow-md transition"
              >
                {/* Header: Photo, Name, Score Badge */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <img
                      src={usr.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100'}
                      alt={st.fullName}
                      className="w-12 h-12 rounded-2xl object-cover ring-1 ring-slate-200 dark:ring-slate-700"
                    />
                    <div>
                      <h3 className="font-bold text-sm text-slate-900 dark:text-white line-clamp-1">
                        {st.fullName}
                      </h3>
                      <div className="text-[11px] text-slate-400">{st.programme} • {st.studyLevel}</div>
                    </div>
                  </div>

                  {/* Compatibility Score Circle / Pill */}
                  <div className="flex flex-col items-end">
                    <span className="text-lg font-black text-emerald-600 dark:text-emerald-400">
                      {comp.score}%
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium">{comp.matchBand}</span>
                  </div>
                </div>

                {/* Badges */}
                <div className="flex flex-wrap gap-1.5">
                  <VerificationBadge type="student" status={st.isProfileVerified ? 'approved' : 'pending'} />
                  <Badge variant="neutral" size="sm">{st.university}</Badge>
                  <Badge variant="info" size="sm">{st.gender}</Badge>
                </div>

                {/* Key match factors bullets */}
                <div className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300 pt-1 border-t border-slate-100 dark:border-slate-800">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    Compatibility Highlights:
                  </div>
                  {comp.matchingFactors.slice(0, 3).map((r, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[11px]">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                      <span className="truncate">{r}</span>
                    </div>
                  ))}
                </div>

                {/* Action Buttons */}
                <div className="pt-2 flex items-center gap-2">
                  <button
                    onClick={() => setSelectedMatch(match)}
                    className="flex-1 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 transition"
                  >
                    Explain Score
                  </button>

                  <button
                    onClick={() => setSelectedMatch(match)}
                    className="py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 transition"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Connect</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Explainable Score & Request Modal */}
      {selectedMatch && (
        <Modal
          isOpen={!!selectedMatch}
          onClose={() => setSelectedMatch(null)}
          title={`Compatibility with ${selectedMatch.student.fullName}`}
          maxWidth="lg"
        >
          <div className="space-y-5 text-xs">
            {/* Top Match Score */}
            <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-center justify-between">
              <div>
                <span className="text-xl font-black text-emerald-700 dark:text-emerald-300">
                  {selectedMatch.compatibility.score}% Overall Compatibility
                </span>
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-0.5">
                  Band: <strong>{selectedMatch.compatibility.matchBand}</strong> based on lifestyle & budget parity
                </p>
              </div>
              <Sparkles className="w-8 h-8 text-emerald-500" />
            </div>

            {/* Factors List */}
            <div className="space-y-3">
              <h4 className="font-bold text-slate-900 dark:text-white">Mutual Synergies</h4>
              <div className="space-y-2">
                {selectedMatch.compatibility.matchingFactors.map((factor, idx) => (
                  <div key={idx} className="flex items-start gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                    <span className="text-slate-700 dark:text-slate-300">{factor}</span>
                  </div>
                ))}
              </div>

              {selectedMatch.compatibility.divergingFactors.length > 0 && (
                <>
                  <h4 className="font-bold text-slate-900 dark:text-white pt-2">Considerations & Divergences</h4>
                  <div className="space-y-2">
                    {selectedMatch.compatibility.divergingFactors.map((factor, idx) => (
                      <div key={idx} className="flex items-start gap-2 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30">
                        <XCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                        <span className="text-slate-700 dark:text-slate-300">{factor}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Custom note to send */}
            <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
              <label className="font-semibold text-slate-700 dark:text-slate-300">
                Introduction Note to {selectedMatch.student.fullName}
              </label>
              <textarea
                value={requestNote}
                onChange={(e) => setRequestNote(e.target.value)}
                rows={2}
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setSelectedMatch(null)}
                className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Close
              </button>
              <button
                onClick={() => handleSendRequest(selectedMatch.student.userId)}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send Roommate Request</span>
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
