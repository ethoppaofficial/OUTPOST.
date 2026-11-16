/**
 * @file RoommatePreferencesPage.tsx
 * @description Roommate preference profiling questionnaire for BUK students.
 *
 * Allows students to configure their living style parameters:
 * - Financial: Minimum and maximum rental budget (NGN) or Nil / no limit.
 * - Locations: Dambare, Rimin Gata, custom neighbourhoods, or None / Nil.
 * - Lifestyle & Habits: Preset options, "None" / "Nil", and Custom option entry across all categories.
 * - Other Preferences Table: Free-text preference table for Tribe, Language, Religion, and custom rows.
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Save, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../../application/context/AuthContext';
import { authService } from '../../application/services/authService';
import { roommateService } from '../../application/services/roommateService';
import { CustomRoommatePreferenceItem, RoommatePreference } from '../../domain/types';

interface OptionDef {
  value: string;
  label: string;
}

const DEFAULT_CUSTOM_PREFERENCE_ROWS: CustomRoommatePreferenceItem[] = [
  { category: 'Tribe', value: '' },
  { category: 'Language', value: '' },
  { category: 'Religion', value: '' },
];

const MOVE_IN_OPTIONS: OptionDef[] = [
  { value: 'Immediate', label: 'Immediate' },
  { value: 'Next Semester', label: 'Next Semester' },
  { value: 'Next Session', label: 'Next Session' },
  { value: 'None', label: 'None / Nil (No strict move-in preference)' },
  { value: 'Nil', label: 'Nil' },
];

const CLEANLINESS_OPTIONS: OptionDef[] = [
  { value: 'Extremely Neat / Daily', label: 'Extremely Neat / Daily (Clean kitchen immediately)' },
  { value: 'Moderate / Weekly', label: 'Moderate / Weekly (Weekly scheduled deep clean)' },
  { value: 'Relaxed', label: 'Relaxed' },
  { value: 'None', label: 'None / Nil (No preference)' },
  { value: 'Nil', label: 'Nil' },
];

const SLEEP_OPTIONS: OptionDef[] = [
  { value: 'Sleeps Before 11pm', label: 'Sleeps Before 11pm (Early to bed, early to rise)' },
  { value: 'Sleeps Midnight - 2am', label: 'Sleeps Midnight - 2am' },
  { value: 'Irregular / Night Shift', label: 'Irregular / Night Shift (Night owl study)' },
  { value: 'None', label: 'None / Nil (No preference)' },
  { value: 'Nil', label: 'Nil' },
];

const STUDY_OPTIONS: OptionDef[] = [
  { value: 'Early Bird', label: 'Early Bird' },
  { value: 'Night Owl', label: 'Night Owl' },
  { value: 'Library Focused', label: 'Library Focused' },
  { value: 'Flexible', label: 'Flexible' },
  { value: 'None', label: 'None / Nil (No preference)' },
  { value: 'Nil', label: 'Nil' },
];

const ROOM_SHARING_OPTIONS: OptionDef[] = [
  { value: 'Own Room Only', label: 'Own Room Only' },
  { value: 'Open to 2-Person Shared', label: 'Open to 2-Person Shared' },
  { value: 'Open to 3-4 Person Shared', label: 'Open to 3-4 Person Shared' },
  { value: 'None', label: 'None / Nil (No preference)' },
  { value: 'Nil', label: 'Nil' },
];

const SMOKING_OPTIONS: OptionDef[] = [
  { value: 'Non-Smoker Only', label: 'Non-Smoker Only (No smoking/vaping)' },
  { value: 'Outdoor Only', label: 'Outdoor Only' },
  { value: "Doesn't Mind", label: "Doesn't Mind" },
  { value: 'None', label: 'None / Nil (No preference)' },
  { value: 'Nil', label: 'Nil' },
];

const GUEST_OPTIONS: OptionDef[] = [
  { value: 'No Overnight Guests', label: 'No Overnight Guests' },
  { value: 'Weekends Only', label: 'Weekends Only' },
  { value: 'Frequent Visitors OK', label: 'Frequent Visitors OK' },
  { value: 'None', label: 'None / Nil (No preference)' },
  { value: 'Nil', label: 'Nil' },
];

const NOISE_OPTIONS: OptionDef[] = [
  { value: 'Quiet Environment Essential', label: 'Quiet Environment Essential' },
  { value: 'Moderate Music/Conversation', label: 'Moderate Music/Conversation' },
  { value: 'High Tolerance', label: 'High Tolerance' },
  { value: 'None', label: 'None / Nil (No preference)' },
  { value: 'Nil', label: 'Nil' },
];

const GENDER_OPTIONS: OptionDef[] = [
  { value: 'Same Gender Only', label: 'Same Gender Only' },
  { value: 'No Preference', label: 'No Preference' },
  { value: 'None', label: 'None / Nil' },
  { value: 'Nil', label: 'Nil' },
];

interface CustomSelectableFieldProps {
  label: string;
  value: string;
  options: OptionDef[];
  customPlaceholder: string;
  onChange: (next: string) => void;
}

const CustomSelectableField: React.FC<CustomSelectableFieldProps> = ({
  label,
  value,
  options,
  customPlaceholder,
  onChange,
}) => {
  const isPreset = options.some((opt) => opt.value === value);
  const [customMode, setCustomMode] = useState(!isPreset);

  const selectValue = customMode || !isPreset ? '__custom__' : value;

  return (
    <div className="space-y-1.5">
      <label className="font-semibold text-slate-700 dark:text-slate-300">{label}</label>
      <select
        value={selectValue}
        onChange={(e) => {
          const next = e.target.value;
          if (next === '__custom__') {
            setCustomMode(true);
            if (isPreset) {
              onChange('');
            }
          } else {
            setCustomMode(false);
            onChange(next);
          }
        }}
        className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
        <option value="__custom__">Custom (Specify your own preference…)</option>
      </select>

      {(customMode || !isPreset) && (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={customPlaceholder}
          className="w-full p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
      )}
    </div>
  );
};

/**
 * RoommatePreferencesPage Component
 *
 * Form interface for editing lifestyle and cohabitation preferences.
 */
export const RoommatePreferencesPage: React.FC = () => {
  const { currentUser } = useAuth();
  const session = authService.getSession();
  const activeUserId = currentUser?.id || session.user.id;
  const navigate = useNavigate();
  const initial = roommateService.getStudentPreferences(activeUserId);

  const [minBudget, setMinBudget] = useState(initial?.minBudget ?? 300000);
  const [maxBudget, setMaxBudget] = useState(initial?.maxBudget ?? 650000);
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

  const [customPreferences, setCustomPreferences] = useState<CustomRoommatePreferenceItem[]>(() => {
    if (Array.isArray(initial?.customPreferences) && initial.customPreferences.length > 0) {
      return initial.customPreferences.map((item) => ({
        category: item.category || '',
        value: item.value || '',
      }));
    }
    return DEFAULT_CUSTOM_PREFERENCE_ROWS.map((row) => ({ ...row }));
  });

  const [saved, setSaved] = useState(false);

  const handleCustomRowChange = (index: number, field: 'category' | 'value', nextValue: string) => {
    setCustomPreferences((prev) =>
      prev.map((row, idx) => (idx === index ? { ...row, [field]: nextValue } : row))
    );
  };

  const handleAddCustomRow = () => {
    setCustomPreferences((prev) => [...prev, { category: '', value: '' }]);
  };

  const handleRemoveCustomRow = (index: number) => {
    setCustomPreferences((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const neighbourhoods = preferredNeighbourhoodsStr
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const sanitizedCustomRows = customPreferences
      .map((row) => ({
        category: row.category.trim(),
        value: row.value.trim() || (row.category.trim() ? 'Nil' : ''),
      }))
      .filter((row) => row.category.length > 0 || row.value.length > 0);

    roommateService.saveStudentPreferences({
      studentId: activeUserId,
      minBudget: Number(minBudget) || 0,
      maxBudget: Number(maxBudget) || 0,
      preferredNeighbourhoods: neighbourhoods.length > 0 ? neighbourhoods : ['None'],
      moveInPeriod: moveInPeriod.trim() || 'None',
      studyHabits: studyHabits.trim() || 'None',
      sleepSchedule: sleepSchedule.trim() || 'None',
      cleanliness: cleanliness.trim() || 'None',
      smoking: smoking.trim() || 'None',
      guestPreference: guestPreference.trim() || 'None',
      noiseTolerance: noiseTolerance.trim() || 'None',
      roomSharing: roomSharing.trim() || 'None',
      genderPreference: genderPreference.trim() || 'None',
      customPreferences: sanitizedCustomRows,
    });

    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      navigate('/student/roommates');
    }, 1200);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            Roommate Lifestyle & Compatibility Settings
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Customize presets, choose "None / Nil" for options where you have no preference, or specify additional preferences such as tribe, language, or religion.
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
          <form onSubmit={handleSave} className="space-y-6 text-xs">
            {/* Budget Range */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  Annual Accommodation Budget (₦ NGN)
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setMinBudget(0);
                    setMaxBudget(0);
                  }}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Set Budget to Nil / Flexible
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-[11px] text-slate-400 block mb-1">Minimum Budget (0 = Nil)</span>
                  <input
                    type="number"
                    min={0}
                    value={minBudget}
                    onChange={(e) => setMinBudget(Number(e.target.value))}
                    step="25000"
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <span className="text-[11px] text-slate-400 block mb-1">Maximum Budget (0 = Nil)</span>
                  <input
                    type="number"
                    min={0}
                    value={maxBudget}
                    onChange={(e) => setMaxBudget(Number(e.target.value))}
                    step="25000"
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            </div>

            {/* Preferred Neighbourhoods and Move-in */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Target Neighbourhoods (comma separated)
                  </label>
                  <button
                    type="button"
                    onClick={() => setPreferredNeighbourhoodsStr('None')}
                    className="text-[11px] font-medium text-emerald-600 hover:underline"
                  >
                    Set None / Nil
                  </button>
                </div>
                <input
                  type="text"
                  value={preferredNeighbourhoodsStr}
                  onChange={(e) => setPreferredNeighbourhoodsStr(e.target.value)}
                  placeholder="e.g. Dambare, Rimin Gata, Kabuga, or None"
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </div>

              <CustomSelectableField
                label="Move-in Period"
                value={moveInPeriod}
                options={MOVE_IN_OPTIONS}
                customPlaceholder="e.g. Mid-semester, August, Any month..."
                onChange={setMoveInPeriod}
              />
            </div>

            {/* Cleanliness & Sleep */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <CustomSelectableField
                label="Cleanliness Standard"
                value={cleanliness}
                options={CLEANLINESS_OPTIONS}
                customPlaceholder="Describe your custom cleanliness expectation..."
                onChange={setCleanliness}
              />

              <CustomSelectableField
                label="Sleep Schedule"
                value={sleepSchedule}
                options={SLEEP_OPTIONS}
                customPlaceholder="e.g. 10pm - 5am daily, prayer schedule, etc."
                onChange={setSleepSchedule}
              />
            </div>

            {/* Study Habits & Room Sharing */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <CustomSelectableField
                label="Study Habits"
                value={studyHabits}
                options={STUDY_OPTIONS}
                customPlaceholder="e.g. Group revision at home, quiet audio, etc."
                onChange={setStudyHabits}
              />

              <CustomSelectableField
                label="Room Sharing Preference"
                value={roomSharing}
                options={ROOM_SHARING_OPTIONS}
                customPlaceholder="e.g. Self-con split, 2 bedrooms flatshare..."
                onChange={setRoomSharing}
              />
            </div>

            {/* Smoking & Guest Preferences */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <CustomSelectableField
                label="Smoking Policy"
                value={smoking}
                options={SMOKING_OPTIONS}
                customPlaceholder="Specify smoking/vaping preference..."
                onChange={setSmoking}
              />

              <CustomSelectableField
                label="Guest Preference"
                value={guestPreference}
                options={GUEST_OPTIONS}
                customPlaceholder="e.g. Daytime family visitors only, etc."
                onChange={setGuestPreference}
              />
            </div>

            {/* Noise and Gender Preference */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <CustomSelectableField
                label="Noise Tolerance"
                value={noiseTolerance}
                options={NOISE_OPTIONS}
                customPlaceholder="Specify noise/audio tolerance..."
                onChange={setNoiseTolerance}
              />

              <CustomSelectableField
                label="Gender Preference"
                value={genderPreference}
                options={GENDER_OPTIONS}
                customPlaceholder="Specify custom gender preference..."
                onChange={setGenderPreference}
              />
            </div>

            {/* Other Custom Preferences Table (Tribe, Language, Religion, etc.) */}
            <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                    Other Preferences Table
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Write any additional roommate preferences (e.g., Tribe, Language, Religion, Cooking, Hobbies) or enter "None" / "Nil".
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddCustomRow}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-[11px] transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Preference Row</span>
                </button>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-50 dark:bg-slate-800/70 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="px-3.5 py-2.5 font-semibold w-2/5">Preference / Feature</th>
                      <th className="px-3.5 py-2.5 font-semibold w-1/2">Your Preference / Details</th>
                      <th className="px-3.5 py-2.5 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {customPreferences.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-3.5 py-4 text-center text-slate-400">
                          No custom preferences added. Click "Add Preference Row" above to add Tribe, Language, Religion, or other preferences.
                        </td>
                      </tr>
                    ) : (
                      customPreferences.map((row, index) => (
                        <tr key={index} className="bg-white dark:bg-slate-900">
                          <td className="px-3 py-2 align-middle">
                            <input
                              type="text"
                              aria-label={`Preference category row ${index + 1}`}
                              value={row.category}
                              onChange={(e) => handleCustomRowChange(index, 'category', e.target.value)}
                              placeholder="e.g. Tribe, Language, Religion"
                              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs"
                            />
                          </td>
                          <td className="px-3 py-2 align-middle">
                            <input
                              type="text"
                              aria-label={`Preference detail row ${index + 1}`}
                              value={row.value}
                              onChange={(e) => handleCustomRowChange(index, 'value', e.target.value)}
                              placeholder="Write preference or None / Nil"
                              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs"
                            />
                          </td>
                          <td className="px-3 py-2 align-middle text-right whitespace-nowrap space-x-1.5">
                            <button
                              type="button"
                              onClick={() => handleCustomRowChange(index, 'value', 'Nil')}
                              className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                            >
                              Nil
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveCustomRow(index)}
                              aria-label={`Remove row ${index + 1}`}
                              className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 align-middle"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
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

