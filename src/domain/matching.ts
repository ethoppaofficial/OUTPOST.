import { RoommatePreference } from './types';

export interface CompatibilityResult {
  score: number; // 0 - 100
  matchBand: 'Excellent Match' | 'Great Match' | 'Moderate Match' | 'Low Match';
  matchingFactors: string[];
  divergingFactors: string[];
}

/**
 * Calculates an explainable, weighted compatibility score between two students' preferences.
 * Weights:
 * - Budget overlap: 25%
 * - Location overlap: 20%
 * - Move-in timing: 15%
 * - Cleanliness & Habits: 15%
 * - Sleep schedule & Noise tolerance: 15%
 * - Guest & Smoking preferences: 10%
 */
export function calculateCompatibility(
  prefA: RoommatePreference,
  prefB: RoommatePreference
): CompatibilityResult {
  let score = 0;
  const matchingFactors: string[] = [];
  const divergingFactors: string[] = [];

  // 1. Budget overlap (25 pts)
  const overlapMin = Math.max(prefA.minBudget, prefB.minBudget);
  const overlapMax = Math.min(prefA.maxBudget, prefB.maxBudget);
  if (overlapMin <= overlapMax) {
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
  const commonLocations = prefA.preferredNeighbourhoods.filter((n) =>
    prefB.preferredNeighbourhoods.includes(n)
  );
  if (commonLocations.length > 0) {
    score += 20;
    matchingFactors.push(`Mutual interest in ${commonLocations.join(', ')}`);
  } else {
    score += 5;
    divergingFactors.push('Different preferred campus neighbourhoods');
  }

  // 3. Move-in period (15 pts)
  if (prefA.moveInPeriod === prefB.moveInPeriod) {
    score += 15;
    matchingFactors.push(`Both planning to move in ${prefA.moveInPeriod}`);
  } else {
    score += 5;
    divergingFactors.push(`Different move-in targets (${prefA.moveInPeriod} vs ${prefB.moveInPeriod})`);
  }

  // 4. Cleanliness (10 pts) & Study Habits (5 pts)
  if (prefA.cleanliness === prefB.cleanliness) {
    score += 10;
    matchingFactors.push(`Compatible cleanliness expectations (${prefA.cleanliness})`);
  } else if (
    (prefA.cleanliness === 'Extremely Neat / Daily' && prefB.cleanliness === 'Relaxed') ||
    (prefA.cleanliness === 'Relaxed' && prefB.cleanliness === 'Extremely Neat / Daily')
  ) {
    divergingFactors.push('Divergent domestic neatness routines');
  } else {
    score += 6;
  }

  if (prefA.studyHabits === prefB.studyHabits) {
    score += 5;
    matchingFactors.push(`Harmonious study lifestyle (${prefA.studyHabits})`);
  } else {
    score += 2;
  }

  // 5. Sleep Schedule & Noise (15 pts)
  if (prefA.sleepSchedule === prefB.sleepSchedule) {
    score += 8;
    matchingFactors.push(`Synchronized sleep schedule (${prefA.sleepSchedule})`);
  } else {
    score += 3;
  }

  if (prefA.noiseTolerance === prefB.noiseTolerance) {
    score += 7;
    matchingFactors.push(`Similar acoustic tolerance (${prefA.noiseTolerance})`);
  } else {
    score += 3;
  }

  // 6. Smoking & Guest preference (10 pts)
  if (prefA.smoking === 'Non-Smoker Only' && prefB.smoking === 'Non-Smoker Only') {
    score += 5;
    matchingFactors.push('Both smoke-free living environment');
  } else if (
    (prefA.smoking === 'Non-Smoker Only' && prefB.smoking !== 'Non-Smoker Only') ||
    (prefB.smoking === 'Non-Smoker Only' && prefA.smoking !== 'Non-Smoker Only')
  ) {
    divergingFactors.push('Conflicting smoking boundary');
  } else {
    score += 4;
  }

  if (prefA.guestPreference === prefB.guestPreference) {
    score += 5;
    matchingFactors.push(`Shared guest policy (${prefA.guestPreference})`);
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
