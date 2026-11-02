/**
 * @file walkingRouteService.ts
 * @module application/services/walkingRouteService
 * @description Pedestrian walking distance and estimated walking time calculator for BUK New Site.
 *
 * Requirements & Governance:
 * - Computes walking distance and duration to BUK New Site Gate 1 and Gate 2 simultaneously.
 * - Primary Routing: OSRM Pedestrian Foot Profile API with short timeout (4s).
 * - Honest Fallback: When offline, rate-limited, or network fails, automatically falls back
 *   to straight-line Haversine distance, explicitly labeled as:
 *   `"Approximately {meters} m straight-line distance"` (NEVER fabricating a fake walking time).
 * - Caching: Client-side LRU in-memory cache keyed by rounded coordinates and gate ID (24-hour TTL).
 * - Performance: Lazy evaluation; never queries in bulk on initial page load.
 */

import {
  BUK_NEW_CAMPUS_GATE_1,
  BUK_NEW_CAMPUS_GATE_2,
  calculateDistanceKm,
  isValidKanoCoordinate,
} from '../../domain/geoUtils';

export interface GateWalkingProximity {
  gateId: 'gate-1' | 'gate-2';
  gateName: string;
  gateLabel: string;
  distanceMeters: number;
  distanceKm: number;
  durationMinutes: number | null;
  isPedestrianRoute: boolean;
  formattedDuration: string;
  formattedDistance: string;
  displayText: string;
}

export interface DualGateProximity {
  gate1: GateWalkingProximity;
  gate2: GateWalkingProximity;
  nearestGate: GateWalkingProximity;
}

interface CacheEntry {
  result: GateWalkingProximity;
  timestamp: number;
}

// 24-hour cache TTL
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const routeCache = new Map<string, CacheEntry>();

/**
 * Generates cache key for a coordinate pair and gate ID.
 * Rounds to 4 decimal places (~11 meters) for sensible cache reuse.
 */
function getCacheKey(lat: number, lon: number, gateId: string): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}_${gateId}`;
}

/**
 * Formats distance into meters (<1000m) or kilometers (>=1000m).
 */
export function formatDistance(distanceMeters: number): string {
  if (distanceMeters < 1000) {
    return `${Math.round(distanceMeters)} m`;
  }
  return `${(distanceMeters / 1000).toFixed(1)} km`;
}

export const formatWalkingDistance = formatDistance;

/**
 * Formats duration into human-readable minutes.
 */
export function formatWalkingDuration(durationMinutes: number): string {
  const rounded = Math.round(durationMinutes);
  if (rounded <= 1) return '1 min walk';
  return `${rounded} min walk`;
}

/**
 * Computes straight-line fallback proximity when pedestrian routing is unavailable.
 */
export function getStraightLineFallback(
  propertyLat: number,
  propertyLon: number,
  gate: typeof BUK_NEW_CAMPUS_GATE_1 | typeof BUK_NEW_CAMPUS_GATE_2
): GateWalkingProximity {
  const distanceKm = calculateDistanceKm(
    propertyLat,
    propertyLon,
    gate.latitude,
    gate.longitude
  );
  const distanceMeters = Math.round(distanceKm * 1000);
  const formattedDist = formatDistance(distanceMeters);

  return {
    gateId: gate.id as 'gate-1' | 'gate-2',
    gateName: gate.name,
    gateLabel: gate.label,
    distanceMeters,
    distanceKm,
    durationMinutes: null, // Strictly null; no fabricated walking time
    isPedestrianRoute: false,
    formattedDuration: '',
    formattedDistance: `Approximately ${formattedDist}`,
    displayText: `Approximately ${formattedDist} straight-line distance`,
  };
}

/**
 * Fetches pedestrian walking route to a specific BUK gate using OSRM Foot Profile.
 */
async function fetchGateWalkingProximity(
  propertyLat: number,
  propertyLon: number,
  gate: typeof BUK_NEW_CAMPUS_GATE_1 | typeof BUK_NEW_CAMPUS_GATE_2
): Promise<GateWalkingProximity> {
  const cacheKey = getCacheKey(propertyLat, propertyLon, gate.id);
  const cached = routeCache.get(cacheKey);
  const now = Date.now();

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.result;
  }

  // Fallback immediately if outside Kano coordinates
  if (!isValidKanoCoordinate(propertyLat, propertyLon)) {
    return getStraightLineFallback(propertyLat, propertyLon, gate);
  }

  // In test/mock environments or when fetch is unavailable, return straight-line fallback
  if (typeof fetch === 'undefined') {
    return getStraightLineFallback(propertyLat, propertyLon, gate);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

  // OSRM coordinates format: {longitude},{latitude}
  const endpoint = `https://router.project-osrm.org/route/v1/foot/${propertyLon},${propertyLat};${gate.longitude},${gate.latitude}?overview=false`;

  try {
    const res = await fetch(endpoint, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Routing HTTP error: ${res.status}`);
    }

    const data = await res.json();
    const route = data?.routes?.[0];

    if (!route || typeof route.distance !== 'number' || typeof route.duration !== 'number') {
      throw new Error('No valid route returned by pedestrian routing service.');
    }

    const distanceMeters = Math.round(route.distance);
    const distanceKm = Number((distanceMeters / 1000).toFixed(2));
    const durationMinutes = Math.max(1, Math.round(route.duration / 60));

    const formattedDist = formatDistance(distanceMeters);
    const formattedDur = formatWalkingDuration(durationMinutes);

    const result: GateWalkingProximity = {
      gateId: gate.id as 'gate-1' | 'gate-2',
      gateName: gate.name,
      gateLabel: gate.label,
      distanceMeters,
      distanceKm,
      durationMinutes,
      isPedestrianRoute: true,
      formattedDuration: formattedDur,
      formattedDistance: formattedDist,
      displayText: `${formattedDur} (${formattedDist}) to ${gate.name}`,
    };

    routeCache.set(cacheKey, { result, timestamp: now });
    return result;
  } catch {
    clearTimeout(timeoutId);
    // Return honest straight-line fallback
    const fallback = getStraightLineFallback(propertyLat, propertyLon, gate);
    // Cache fallback for a shorter period (5 minutes) in case of transient network failure
    routeCache.set(cacheKey, { result: fallback, timestamp: now - CACHE_TTL_MS + 5 * 60 * 1000 });
    return fallback;
  }
}

/**
 * Calculates walking proximity to both BUK Gate 1 and Gate 2 simultaneously.
 *
 * @param propertyLat - Verified property latitude
 * @param propertyLon - Verified property longitude
 * @returns DualGateProximity containing Gate 1, Gate 2, and nearestGate data
 */
export async function calculateDualGateProximity(
  propertyLat: number,
  propertyLon: number
): Promise<DualGateProximity> {
  const [gate1, gate2] = await Promise.all([
    fetchGateWalkingProximity(propertyLat, propertyLon, BUK_NEW_CAMPUS_GATE_1),
    fetchGateWalkingProximity(propertyLat, propertyLon, BUK_NEW_CAMPUS_GATE_2),
  ]);

  const nearestGate = gate1.distanceMeters <= gate2.distanceMeters ? gate1 : gate2;

  return {
    gate1,
    gate2,
    nearestGate,
  };
}

/**
 * Synchronous helper returning immediate straight-line fallback for instant UI render
 * while asynchronous pedestrian routing loads in the background.
 */
export function getImmediateDualGateProximity(
  propertyLat: number,
  propertyLon: number
): DualGateProximity {
  const key1 = getCacheKey(propertyLat, propertyLon, BUK_NEW_CAMPUS_GATE_1.id);
  const key2 = getCacheKey(propertyLat, propertyLon, BUK_NEW_CAMPUS_GATE_2.id);

  const cached1 = routeCache.get(key1)?.result;
  const cached2 = routeCache.get(key2)?.result;

  const gate1 = cached1 || getStraightLineFallback(propertyLat, propertyLon, BUK_NEW_CAMPUS_GATE_1);
  const gate2 = cached2 || getStraightLineFallback(propertyLat, propertyLon, BUK_NEW_CAMPUS_GATE_2);
  const nearestGate = gate1.distanceMeters <= gate2.distanceMeters ? gate1 : gate2;

  return { gate1, gate2, nearestGate };
}

export const walkingRouteService = {
  calculateDualGateProximity,
  getImmediateDualGateProximity,
  fetchGateWalkingProximity,
  getStraightLineFallback,
  formatDistance,
  formatWalkingDuration,
};

export default walkingRouteService;
