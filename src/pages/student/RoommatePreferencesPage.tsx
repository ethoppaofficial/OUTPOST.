import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Save, ArrowLeft } from 'lucide-react';
import { authService } from '../../application/services/authService';
import { roommateService } from '../../application/services/roommateService';
import { RoommatePreference } from '../../domain/types';

export const RoommatePreferencesPage: React.FC = () => {
  const session = authService.getSession();
  const navigate = useNavigate();
  const initial = roommateService.getStudentPreferences(session.user.id);

  const [minBudget, setMinBudget] = useState(initial?.minBudget || 300000);
  const [maxBudget, setMaxBudget] = useState(initial?.maxBudget || 650000);
  const [preferredNeighbourhoodsStr, setPreferredNeighbourhoodsStr] = useState(
    initial?.preferredNeighbourhoods?.join(', ') || 'Dambare, Rimin Gata'
  );
  const [moveInPeriod, setMoveInPeriod] = useState<RoommatePreference['moveInPeriod']>(
    initial?.moveInPeriod || 'Immediate'
  );
  const [studyHabits, setStudyHabits] = useState<RoommatePreference['studyHabits']>(
    initial?.studyHabits || 'Early Bird'
  );
  const [sleepSchedule, setSleepSchedule] = useState<RoommatePreference['sleepSchedule']>(
    initial?.sleepSchedule || 'Sleeps Before 11pm'
  );
  const [cleanliness, setCleanliness] = useState<RoommatePreference['cleanliness']>(
    initial?.cleanliness || 'Extremely Neat / Daily'
  );
  const [smoking, setSmoking] = useState<RoommatePreference['smoking']>(
    initial?.smoking || 'Non-Smoker Only'
  );
  const [guestPreference, setGuestPreference] = useState<RoommatePreference['guestPreference']>(
    initial?.guestPreference || 'Weekends Only'
  );
  const [noiseTolerance, setNoiseTolerance] = useState<RoommatePreference['noiseTolerance']>(
    initial?.noiseTolerance || 'Quiet Environment Essential'
  );
  const [roomSharing, setRoomSharing] = useState<RoommatePreference['roomSharing']>(
    initial?.roomSharing || 'Open to 2-Person Shared'
  );
  const [genderPreference, setGenderPreference] = useState<RoommatePreference['genderPreference']>(
    initial?.genderPreference || 'Same Gender Only'
  );

  const [saved, setSaved] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const neighbourhoods = preferredNeighbourhoodsStr
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    roommateService.saveStudentPreferences({
      studentId: session.user.id,
      minBudget: Number(minBudget),
      maxBudget: Number(maxBudget),
      preferredNeighbourhoods: neighbourhoods.length > 0 ? neighbourhoods : ['Dambare', 'Rimin Gata'],
      moveInPeriod,
      studyHabits,
      sleepSchedule,
      cleanliness,
      smoking,
      guestPreference,
      noiseTolerance,
      roomSharing,
      genderPreference,
    });

    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      navigate('/student/roommates');
    }, 1200);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Roommate Lifestyle & Compatibility Settings
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Our explainable rule-based matching engine weights your budget (25%), location (20%), move-in (15%), cleanliness (15%), and sleep schedule (15%).
          </p>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
        {saved ? (
          <div className="text-center py-8 space-y-3">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Preferences Saved!</h3>
            <p className="text-xs text-slate-500">Recalculating compatibility scores across all students...</p>
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-5 text-xs">
            {/* Budget Range */}
            <div className="space-y-2">
              <label className="font-semibold text-slate-700 dark:text-slate-300">
                Annual Accommodation Budget (₦ NGN)
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-[11px] text-slate-400 block mb-1">Minimum Budget</span>
                  <input
                    type="number"
                    value={minBudget}
                    onChange={(e) => setMinBudget(Number(e.target.value))}
                    step="25000"
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                  />
                </div>
                <div>
                  <span className="text-[11px] text-slate-400 block mb-1">Maximum Budget</span>
                  <input
                    type="number"
                    value={maxBudget}
                    onChange={(e) => setMaxBudget(Number(e.target.value))}
                    step="25000"
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                  />
                </div>
              </div>
            </div>

            {/* Preferred Neighbourhoods and Move-in */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  Target Neighbourhoods (comma separated)
                </label>
                <input
                  type="text"
                  value={preferredNeighbourhoodsStr}
                  onChange={(e) => setPreferredNeighbourhoodsStr(e.target.value)}
                  placeholder="e.g. Dambare, Rimin Gata"
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-slate-700 dark:text-slate-300">Move-in Period</label>
                <select
                  value={moveInPeriod}
                  onChange={(e) => setMoveInPeriod(e.target.value as any)}
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                >
                  <option value="Immediate">Immediate</option>
                  <option value="Next Semester">Next Semester</option>
                  <option value="Next Session">Next Session</option>
                </select>
              </div>
            </div>

            {/* Cleanliness & Habits */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="font-semibold text-slate-700 dark:text-slate-300">Cleanliness Standard</label>
                <select
                  value={cleanliness}
                  onChange={(e) => setCleanliness(e.target.value as any)}
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                >
                  <option value="Extremely Neat / Daily">Extremely Neat / Daily (Clean kitchen immediately)</option>
                  <option value="Moderate / Weekly">Moderate / Weekly (Weekly scheduled deep clean)</option>
                  <option value="Relaxed">Relaxed</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-slate-700 dark:text-slate-300">Sleep Schedule</label>
                <select
                  value={sleepSchedule}
                  onChange={(e) => setSleepSchedule(e.target.value as any)}
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                >
                  <option value="Sleeps Before 11pm">Sleeps Before 11pm (Early to bed, early to rise)</option>
                  <option value="Sleeps Midnight - 2am">Sleeps Midnight - 2am</option>
                  <option value="Irregular / Night Shift">Irregular / Night Shift (Night owl study)</option>
                </select>
              </div>
            </div>

            {/* Study Habits & Room Sharing */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="font-semibold text-slate-700 dark:text-slate-300">Study Habits</label>
                <select
                  value={studyHabits}
                  onChange={(e) => setStudyHabits(e.target.value as any)}
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                >
                  <option value="Early Bird">Early Bird</option>
                  <option value="Night Owl">Night Owl</option>
                  <option value="Library Focused">Library Focused</option>
                  <option value="Flexible">Flexible</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-slate-700 dark:text-slate-300">Room Sharing Preference</label>
                <select
                  value={roomSharing}
                  onChange={(e) => setRoomSharing(e.target.value as any)}
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                >
                  <option value="Own Room Only">Own Room Only</option>
                  <option value="Open to 2-Person Shared">Open to 2-Person Shared</option>
                  <option value="Open to 3-4 Person Shared">Open to 3-4 Person Shared</option>
                </select>
              </div>
            </div>

            {/* Smoking & Guest Preferences */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="font-semibold text-slate-700 dark:text-slate-300">Smoking Policy</label>
                <select
                  value={smoking}
                  onChange={(e) => setSmoking(e.target.value as any)}
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                >
                  <option value="Non-Smoker Only">Non-Smoker Only (No smoking/vaping)</option>
                  <option value="Outdoor Only">Outdoor Only</option>
                  <option value="Doesn't Mind">Doesn't Mind</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-slate-700 dark:text-slate-300">Guest Preference</label>
                <select
                  value={guestPreference}
                  onChange={(e) => setGuestPreference(e.target.value as any)}
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                >
                  <option value="No Overnight Guests">No Overnight Guests</option>
                  <option value="Weekends Only">Weekends Only</option>
                  <option value="Frequent Visitors OK">Frequent Visitors OK</option>
                </select>
              </div>
            </div>

            {/* Noise and Gender Preference */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="font-semibold text-slate-700 dark:text-slate-300">Noise Tolerance</label>
                <select
                  value={noiseTolerance}
                  onChange={(e) => setNoiseTolerance(e.target.value as any)}
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                >
                  <option value="Quiet Environment Essential">Quiet Environment Essential</option>
                  <option value="Moderate Music/Conversation">Moderate Music/Conversation</option>
                  <option value="High Tolerance">High Tolerance</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-slate-700 dark:text-slate-300">Gender Preference</label>
                <select
                  value={genderPreference}
                  onChange={(e) => setGenderPreference(e.target.value as any)}
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                >
                  <option value="Same Gender Only">Same Gender Only</option>
                  <option value="No Preference">No Preference</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-md transition flex items-center justify-center gap-2"
            >
              <Save className="w-4 h-4" />
              <span>Save & Update Compatibility Matches</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
