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

  // 2. Preferred Location overlap (20 pts)
  const locationsA = Array.isArray(safePrefA.preferredNeighbourhoods) ? safePrefA.preferredNeighbourhoods : [];
  const locationsB = Array.isArray(safePrefB.preferredNeighbourhoods) ? safePrefB.preferredNeighbourhoods : [];
  const commonLocations = locationsA.filter((n) => locationsB.includes(n));
  if (commonLocations.length > 0) {
    score += 20;
    matchingFactors.push(`Mutual interest in ${commonLocations.join(', ')}`);
  } else {
    score += 5;
    divergingFactors.push('Different preferred campus neighbourhoods');
  }

  // 3. Move-in period (15 pts)
  if (safePrefA.moveInPeriod && safePrefA.moveInPeriod === safePrefB.moveInPeriod) {
    score += 15;
    matchingFactors.push(`Both planning to move in ${safePrefA.moveInPeriod}`);
  } else {
    score += 5;
    divergingFactors.push(`Different move-in targets (${safePrefA.moveInPeriod || 'TBD'} vs ${safePrefB.moveInPeriod || 'TBD'})`);
  }

  // 4. Cleanliness (10 pts) & Study Habits (5 pts)
  if (safePrefA.cleanliness && safePrefA.cleanliness === safePrefB.cleanliness) {
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

  if (safePrefA.studyHabits && safePrefA.studyHabits === safePrefB.studyHabits) {
    score += 5;
    matchingFactors.push(`Harmonious study lifestyle (${safePrefA.studyHabits})`);
  } else {
    score += 2;
  }

  // 5. Sleep Schedule & Noise (15 pts)
  if (safePrefA.sleepSchedule && safePrefA.sleepSchedule === safePrefB.sleepSchedule) {
    score += 8;
    matchingFactors.push(`Synchronized sleep schedule (${safePrefA.sleepSchedule})`);
  } else {
    score += 3;
  }

  if (safePrefA.noiseTolerance && safePrefA.noiseTolerance === safePrefB.noiseTolerance) {
    score += 7;
    matchingFactors.push(`Similar acoustic tolerance (${safePrefA.noiseTolerance})`);
  } else {
    score += 3;
  }

  // 6. Smoking & Guest preference (10 pts)
  if (safePrefA.smoking === 'Non-Smoker Only' && safePrefB.smoking === 'Non-Smoker Only') {
    score += 5;
    matchingFactors.push('Both smoke-free living environment');
  } else if (
    (safePrefA.smoking === 'Non-Smoker Only' && safePrefB.smoking !== 'Non-Smoker Only') ||
    (safePrefB.smoking === 'Non-Smoker Only' && safePrefA.smoking !== 'Non-Smoker Only')
  ) {
    divergingFactors.push('Conflicting smoking boundary');
  } else {
    score += 4;
  }

  if (safePrefA.guestPreference && safePrefA.guestPreference === safePrefB.guestPreference) {
    score += 5;
    matchingFactors.push(`Shared guest policy (${safePrefA.guestPreference})`);
  } else {
    score += 2;
  }

  // Determine Match Band
  let matchBand: CompatibilityResult['matchBand'] = 'Moderate Match';
  if (score >= 85) matchBand = 'Excellent Match';
  else if (score >= 70) matchBand = 'Great Match';
  else if (score >= 50) matchBand = 'Moderate Match';
  else matchBand = 'Low Match';

  return {
    score: Math.min(100, Math.max(0, score)),
    matchBand,
    matchingFactors,
    divergingFactors,
  };
}
