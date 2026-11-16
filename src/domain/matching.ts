/**
 * @file matching.ts
 * @module domain/matching
 * @description Explainable, deterministic, rule-based roommate compatibility scoring engine.
 *
 * Architecture Role:
 * - Domain layer utility. Pure function with zero side-effects and zero external I/O.
 * - Compares two student `RoommatePreference` records and computes a normalized 0-100 score,
 *   a qualitative compatibility band, and plain-language lists of matching vs diverging factors.
 * - Designed to be fully explainable and auditable: students can understand why two profiles matched.
 * - Note: This is an explicit, rule-based multi-attribute weighting algorithm, not an AI/ML black-box.
 *
 * Weight Distribution (Total: 100 points):
 * 1. Budget Range Overlap: 25% (financial viability is critical to avoid shared default)
 * 2. Preferred Corridor Overlap: 20% (Danbare vs Rimin Gata around BUK New Site)
 * 3. Move-in Timing Alignment: 15% (semester readiness)
 * 4. Domestic Cleanliness & Study Lifestyle: 15% (neatness routine 10% + study habit 5%)
 * 5. Sleep Schedule & Acoustic Noise Tolerance: 15% (chronotype 8% + ambient noise 7%)
 * 6. Household Boundaries: 10% (smoking 5% + guest policy 5%)
 */

import { RoommatePreference } from './types';

export interface CompatibilityResult {
  /** Normalized compatibility rating between 0 and 100 */
  score: number;
  /** Qualitative rating band for user presentation */
  matchBand: 'Excellent Match' | 'Great Match' | 'Moderate Match' | 'Low Match';
  /** Positive alignment points explained in natural language */
  matchingFactors: string[];
  /** Friction points or misalignments identified for student review */
  divergingFactors: string[];
}

/**
 * Computes an explainable, deterministic compatibility score between two students' preferences.
 *
 * Preconditions:
 * - `prefA` and `prefB` may be partial or contain missing optional properties; defensive
 *   null-coalescing ensures calculations never throw.
 *
 * Postconditions:
 * - Score is strictly clamped to [0, 100].
 * - `matchingFactors` and `divergingFactors` contain user-facing explanations.
 * - Pure function: does not mutate either input object.
 *
 * @param prefA - Profile preferences of the evaluating student.
 * @param prefB - Profile preferences of the candidate student.
 * @returns {CompatibilityResult} Calculated score, match band, and explanatory factors.
 */
const isNoPreference = (value?: string): boolean => {
  const normalized = (value || '').trim().toLowerCase();
  return (
    !normalized ||
    normalized === 'none' ||
    normalized === 'nil' ||
    normalized === 'no preference' ||
    normalized === 'n/a'
  );
};

const normalizePrefValue = (value?: string): string => (value || '').trim().toLowerCase();

export function calculateCompatibility(
  prefA: RoommatePreference,
  prefB: RoommatePreference
): CompatibilityResult {
  let score = 0;
  const matchingFactors: string[] = [];
  const divergingFactors: string[] = [];

  const safePrefA = prefA || ({} as Partial<RoommatePreference>);
  const safePrefB = prefB || ({} as Partial<RoommatePreference>);

  // 1. Budget overlap (25 pts)
  const minA = typeof safePrefA.minBudget === 'number' ? safePrefA.minBudget : 0;
  const maxA = typeof safePrefA.maxBudget === 'number' ? safePrefA.maxBudget : 0;
  const minB = typeof safePrefB.minBudget === 'number' ? safePrefB.minBudget : 0;
  const maxB = typeof safePrefB.maxBudget === 'number' ? safePrefB.maxBudget : 0;

  if ((minA === 0 && maxA === 0) || (minB === 0 && maxB === 0)) {
    score += 18;
    matchingFactors.push('Flexible or unspecified rental budget preference');
  } else {
    const overlapMin = Math.max(minA, minB);
    const overlapMax = Math.min(maxA, maxB);
    if (overlapMin <= overlapMax && overlapMax > 0) {
      score += 25;
      matchingFactors.push('Aligned budget ranges (₦' + overlapMin.toLocaleString() + ' - ₦' + overlapMax.toLocaleString() + ')');
    } else {
      const diff = overlapMin - overlapMax;
      if (diff <= 50000) {
        score += 12;
        divergingFactors.push('Close budget range within ₦50k difference');
      } else {
        divergingFactors.push('Substantial budget difference');
      }
    }
  }

  // 2. Preferred Location overlap (20 pts)
  const locationsA = Array.isArray(safePrefA.preferredNeighbourhoods) ? safePrefA.preferredNeighbourhoods : [];
  const locationsB = Array.isArray(safePrefB.preferredNeighbourhoods) ? safePrefB.preferredNeighbourhoods : [];
  const locationsAOpen = locationsA.length === 0 || locationsA.some((n) => isNoPreference(n));
  const locationsBOpen = locationsB.length === 0 || locationsB.some((n) => isNoPreference(n));
  const commonLocations = locationsA.filter((n) =>
    !isNoPreference(n) && locationsB.some((b) => normalizePrefValue(b) === normalizePrefValue(n))
  );
  if (commonLocations.length > 0) {
    score += 20;
    matchingFactors.push(`Mutual interest in ${commonLocations.join(', ')}`);
  } else if (locationsAOpen || locationsBOpen) {
    score += 15;
    matchingFactors.push('Open to flexible campus neighbourhoods');
  } else {
    score += 5;
    divergingFactors.push('Different preferred campus neighbourhoods');
  }

  // 3. Move-in period (15 pts)
  if (isNoPreference(safePrefA.moveInPeriod) || isNoPreference(safePrefB.moveInPeriod)) {
    score += 12;
    matchingFactors.push('Flexible move-in timing');
  } else if (normalizePrefValue(safePrefA.moveInPeriod) === normalizePrefValue(safePrefB.moveInPeriod)) {
    score += 15;
    matchingFactors.push(`Both planning to move in ${safePrefA.moveInPeriod}`);
  } else {
    score += 5;
    divergingFactors.push(`Different move-in targets (${safePrefA.moveInPeriod || 'TBD'} vs ${safePrefB.moveInPeriod || 'TBD'})`);
  }

  // 4. Cleanliness (10 pts) & Study Habits (5 pts)
  if (isNoPreference(safePrefA.cleanliness) || isNoPreference(safePrefB.cleanliness)) {
    score += 8;
  } else if (normalizePrefValue(safePrefA.cleanliness) === normalizePrefValue(safePrefB.cleanliness)) {
    score += 10;
    matchingFactors.push(`Compatible cleanliness expectations (${safePrefA.cleanliness})`);
  } else if (
    (safePrefA.cleanliness === 'Extremely Neat / Daily' && safePrefB.cleanliness === 'Relaxed') ||
    (safePrefA.cleanliness === 'Relaxed' && safePrefB.cleanliness === 'Extremely Neat / Daily')
  ) {
    divergingFactors.push('Divergent domestic neatness routines');
  } else {
    score += 6;
  }

  if (isNoPreference(safePrefA.studyHabits) || isNoPreference(safePrefB.studyHabits)) {
    score += 4;
  } else if (normalizePrefValue(safePrefA.studyHabits) === normalizePrefValue(safePrefB.studyHabits)) {
    score += 5;
    matchingFactors.push(`Harmonious study lifestyle (${safePrefA.studyHabits})`);
  } else {
    score += 2;
  }

  // 5. Sleep Schedule & Noise (15 pts)
  if (isNoPreference(safePrefA.sleepSchedule) || isNoPreference(safePrefB.sleepSchedule)) {
    score += 6;
  } else if (normalizePrefValue(safePrefA.sleepSchedule) === normalizePrefValue(safePrefB.sleepSchedule)) {
    score += 8;
    matchingFactors.push(`Synchronized sleep schedule (${safePrefA.sleepSchedule})`);
  } else {
    score += 3;
  }

  if (isNoPreference(safePrefA.noiseTolerance) || isNoPreference(safePrefB.noiseTolerance)) {
    score += 5;
  } else if (normalizePrefValue(safePrefA.noiseTolerance) === normalizePrefValue(safePrefB.noiseTolerance)) {
    score += 7;
    matchingFactors.push(`Similar acoustic tolerance (${safePrefA.noiseTolerance})`);
  } else {
    score += 3;
  }

  // 6. Smoking & Guest preference (10 pts)
  if (isNoPreference(safePrefA.smoking) || isNoPreference(safePrefB.smoking)) {
    score += 4;
  } else if (safePrefA.smoking === 'Non-Smoker Only' && safePrefB.smoking === 'Non-Smoker Only') {
    score += 5;
    matchingFactors.push('Both smoke-free living environment');
  } else if (
    (safePrefA.smoking === 'Non-Smoker Only' && safePrefB.smoking !== 'Non-Smoker Only') ||
    (safePrefB.smoking === 'Non-Smoker Only' && safePrefA.smoking !== 'Non-Smoker Only')
  ) {
    divergingFactors.push('Conflicting smoking boundary');
  } else if (normalizePrefValue(safePrefA.smoking) === normalizePrefValue(safePrefB.smoking)) {
    score += 5;
    matchingFactors.push(`Aligned smoking policy (${safePrefA.smoking})`);
  } else {
    score += 4;
  }

  if (isNoPreference(safePrefA.guestPreference) || isNoPreference(safePrefB.guestPreference)) {
    score += 4;
  } else if (normalizePrefValue(safePrefA.guestPreference) === normalizePrefValue(safePrefB.guestPreference)) {
    score += 5;
    matchingFactors.push(`Shared guest policy (${safePrefA.guestPreference})`);
  } else {
    score += 2;
  }

  // 7. Custom Other Preferences Table comparisons (Tribe, Language, Religion, etc.)
  const customA = Array.isArray(safePrefA.customPreferences) ? safePrefA.customPreferences : [];
  const customB = Array.isArray(safePrefB.customPreferences) ? safePrefB.customPreferences : [];
  if (customA.length > 0 && customB.length > 0) {
    for (const itemA of customA) {
      const catA = normalizePrefValue(itemA?.category);
      const valA = itemA?.value?.trim() || '';
      if (!catA || isNoPreference(valA)) continue;

      const matchB = customB.find((itemB) => normalizePrefValue(itemB?.category) === catA);
      if (!matchB || isNoPreference(matchB.value)) continue;

      if (normalizePrefValue(valA) === normalizePrefValue(matchB.value)) {
        score += 3;
        matchingFactors.push(`Shared ${itemA.category.trim()} preference (${valA})`);
      } else {
        divergingFactors.push(`Different ${itemA.category.trim()} preference (${valA} vs ${matchB.value.trim()})`);
      }
    }
  }

  // Determine Match Band
  const finalScore = Math.min(100, Math.max(0, score));
  let matchBand: CompatibilityResult['matchBand'] = 'Moderate Match';
  if (finalScore >= 85) matchBand = 'Excellent Match';
  else if (finalScore >= 70) matchBand = 'Great Match';
  else if (finalScore >= 50) matchBand = 'Moderate Match';
  else matchBand = 'Low Match';

  return {
    score: finalScore,
    matchBand,
    matchingFactors,
    divergingFactors,
  };
}
