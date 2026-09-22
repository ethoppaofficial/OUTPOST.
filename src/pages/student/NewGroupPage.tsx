import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Users, ArrowLeft, Shield, Globe, Lock, UserCheck, AlertCircle } from 'lucide-react';
import { authService } from '../../application/services/authService';
import { groupChatService } from '../../application/services/groupChatService';
import { repository } from '../../infrastructure/repositories/localStorageRepository';

export const NewGroupPage: React.FC = () => {
  const navigate = useNavigate();
  const session = authService.getSession();
  const properties = repository.getProperties();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [maxCapacity, setMaxCapacity] = useState(4);
  const [visibility, setVisibility] = useState<'discoverable' | 'invite_only' | 'request_required'>('discoverable');
  const [targetPropertyId, setTargetPropertyId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length < 2) {
      setError('Cohort name must be at least 2 characters.');
      return;
    }

    if (trimmedName.length > 60) {
      setError('Cohort name cannot exceed 60 characters.');
      return;
    }

    try {
      setIsSubmitting(true);
      const newGroup = groupChatService.createGroup(
        trimmedName,
        description,
        session.user.id,
        maxCapacity,
        targetPropertyId || undefined,
        visibility
      );

      // Navigate to the newly created group hub
      navigate(`/student/groups/${newGroup.id}`);
    } catch (err: any) {
      setError(err?.message || 'Failed to create accommodation cohort.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link
          to="/student/groups"
          className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition"
          aria-label="Back to Groups"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Create Accommodation Cohort
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Form an apartment team, automatically start a linked cohort chat, and invite verified peers.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="p-6 sm:p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-6">
        <div>
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
            Cohort Name <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. UNILAG Law Scholars Cohort"
            maxLength={60}
            required
            className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium"
          />
          <p className="text-[11px] text-slate-400 mt-1">2 to 60 characters. A descriptive title for your housing squad.</p>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
            Description & Purpose
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Introduce your study habits, target location, and expectations (e.g. quiet studying, non-smokers, looking around Akoka)."
            className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
              Maximum Cohort Capacity
            </label>
            <select
              value={maxCapacity}
              onChange={(e) => setMaxCapacity(Number(e.target.value))}
              className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value={2}>2 Members (Dual Bed)</option>
              <option value={3}>3 Members (Triple Bed)</option>
              <option value={4}>4 Members (Quad Suite)</option>
              <option value={6}>6 Members (Full Apartment)</option>
              <option value={8}>8 Members (Large Villa)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
              Target Property (Optional)
            </label>
            <select
              value={targetPropertyId}
              onChange={(e) => setTargetPropertyId(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">-- No specific property yet --</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} ({p.city || p.neighbourhood || 'Vicinity'})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Visibility Setting */}
        <div>
          <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">
            Cohort Visibility & Join Policy
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => setVisibility('discoverable')}
              className={`p-4 rounded-2xl border text-left flex flex-col justify-between transition ${
                visibility === 'discoverable'
                  ? 'border-emerald-600 bg-emerald-50/40 dark:bg-emerald-950/20 text-emerald-950 dark:text-emerald-100 ring-2 ring-emerald-500/20'
                  : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <Globe className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mb-2" />
              <div>
                <div className="text-xs font-bold">Discoverable</div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Anyone can discover and join directly up to capacity.
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setVisibility('request_required')}
              className={`p-4 rounded-2xl border text-left flex flex-col justify-between transition ${
                visibility === 'request_required'
                  ? 'border-emerald-600 bg-emerald-50/40 dark:bg-emerald-950/20 text-emerald-950 dark:text-emerald-100 ring-2 ring-emerald-500/20'
                  : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <UserCheck className="w-5 h-5 text-amber-500 mb-2" />
              <div>
                <div className="text-xs font-bold">Request to Join</div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Students can request to join; requires admin approval.
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setVisibility('invite_only')}
              className={`p-4 rounded-2xl border text-left flex flex-col justify-between transition ${
                visibility === 'invite_only'
                  ? 'border-emerald-600 bg-emerald-50/40 dark:bg-emerald-950/20 text-emerald-950 dark:text-emerald-100 ring-2 ring-emerald-500/20'
                  : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <Lock className="w-5 h-5 text-slate-500 mb-2" />
              <div>
                <div className="text-xs font-bold">Invite Only</div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Private cohort. Members join exclusively via direct invite.
                </p>
              </div>
            </button>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-800 flex items-center gap-3">
          <Shield className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            As creator, you will automatically be assigned the <span className="font-semibold text-slate-900 dark:text-white">Group Administrator</span> role and linked to a dedicated real-time Cohort Chat.
          </p>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <Link
            to="/student/groups"
            className="px-5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold shadow-xs transition flex items-center gap-2"
          >
            <Users className="w-4 h-4" />
            <span>{isSubmitting ? 'Establishing Cohort...' : 'Establish Cohort'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
