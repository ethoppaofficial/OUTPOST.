/**
 * @file geoUtils.ts
 * @module domain/geoUtils
 * @description Geospatial calculations, geohash encoding, and privacy-preserving coordinate obfuscation.
 *
 * Architecture & Privacy Design:
 * - Domain utility operating on BUK Kano New Site coordinates (Danbare and Rimin Gata).
 * - Exact landlord device GPS coordinates are considered sensitive private property data and
 *   are stored in `property_locations` (restricted to landlord owner and platform admin).
 * - Public property listings expose only obfuscated `public_latitude` / `public_longitude`
 *   via `computePublicCoordinates()`, using deterministic jitter (~30-50m offset) or street-level
 *   rounding to prevent unsolicited student loitering while allowing map clustering and proximity search.
 * - Distance calculations use the spherical Haversine formula against Earth radius (6,371 km).
 */

import { HousingArea, LocationPrecision } from './types';

// Standard Base32 character set for geohashing
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/**
 * Encodes latitude and longitude into a geohash string.
 *
 * @param latitude - Latitude coordinate in decimal degrees [-90, +90].
 * @param longitude - Longitude coordinate in decimal degrees [-180, +180].
 * @param precision - Character length of the resulting geohash (defaults to 8 characters, ~38m x 19m).
 * @returns {string} Base32 geohash string.
 */
export function encodeGeohash(latitude: number, longitude: number, precision: number = 8): string {
  let isEven = true;
  let latMin = -90;
  let latMax = 90;
  let lonMin = -180;
  let lonMax = 180;
  let bit = 0;
  let ch = 0;
  let geohash = '';

  while (geohash.length < precision) {
    if (isEven) {
      const lonMid = (lonMin + lonMax) / 2;
      if (longitude >= lonMid) {
        ch |= 1 << (4 - bit);
        lonMin = lonMid;
      } else {
        lonMax = lonMid;
      }
    } else {
      const latMid = (latMin + latMax) / 2;
      if (latitude >= latMid) {
        ch |= 1 << (4 - bit);
        latMin = latMid;
      } else {
        latMax = latMid;
      }
    }

    isEven = !isEven;
    if (bit < 4) {
      bit++;
    } else {
      geohash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }

  return geohash;
}

/**
 * Area reference centers in Kano around Bayero University Kano (BUK) New Campus corridor
 */
export const AREA_CENTERS: Record<HousingArea, { latitude: number; longitude: number; label: string }> = {
  Dambare: {
    latitude: 11.9842,
    longitude: 8.4187,
    label: 'Dambare Off-Campus Student Hub (Gwarzo Road)',
  },
  'Rimin Gata': {
    latitude: 11.9785,
    longitude: 8.4093,
    label: 'Rimin Gata Off-Campus Residential Settlement',
  },
};

/**
 * Landmark coordinates for context: BUK New Campus Gate 1 (Main Gate along Gwarzo Road)
 */
export const BUK_NEW_CAMPUS_GATE_1 = {
  id: 'gate-1',
  latitude: 11.9808,
  longitude: 8.4235,
  name: 'BUK New Site Gate 1',
  label: 'BUK New Site Gate 1 (Main Gate, Gwarzo Road)',
};

/**
 * Landmark coordinates for context: BUK New Campus Gate 2 (Secondary Access Gate)
 */
export const BUK_NEW_CAMPUS_GATE_2 = {
  id: 'gate-2',
  latitude: 11.9752,
  longitude: 8.4190,
  name: 'BUK New Site Gate 2',
  label: 'BUK New Site Gate 2 (Southern Corridor)',
};

/**
 * Backward compatibility alias: defaults to BUK New Campus Gate 1
 */
export const BUK_NEW_CAMPUS_GATE = BUK_NEW_CAMPUS_GATE_1;

/**
 * Canonical verified reference landmarks in Danbare and Rimin Gata
 */
export const LOCAL_REFERENCE_LANDMARKS = [
  {
    id: 'buk-gate-1',
    name: 'BUK Gate 1',
    fullName: 'BUK New Site Gate 1 (Main Gate)',
    latitude: 11.9808,
    longitude: 8.4235,
  },
  {
    id: 'buk-gate-2',
    name: 'BUK Gate 2',
    fullName: 'BUK New Site Gate 2',
    latitude: 11.9752,
    longitude: 8.4190,
  },
  {
    id: 'danbare-market',
    name: 'Danbare Market',
    fullName: 'Danbare Market Hub',
    latitude: 11.9848,
    longitude: 8.4172,
  },
  {
    id: 'rimin-gata-centre',
    name: 'Rimin Gata Centre',
    fullName: 'Rimin Gata Settlement Centre',
    latitude: 11.9785,
    longitude: 8.4093,
  },
] as const;

/**
 * Pseudo-random deterministic jitter for privacy protection based on propertyId string hash
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

/**
 * Compute safe public coordinates based on precision policy.
 * - 'exact_building': returns exact coordinates.
 * - 'nearby_building': applies a small deterministic offset (~30-50m) so exact gate is protected.
 * - 'street': rounds coordinates to ~3-4 decimal places (~100m street level).
 * - 'neighbourhood': falls back to neighbourhood centroid.
 */
export function computePublicCoordinates(
  latitude: number,
  longitude: number,
  precision: LocationPrecision,
  area: HousingArea,
  jitterKey: string = ''
): { publicLatitude: number; publicLongitude: number; publicLocationLabel: string } {
  switch (precision) {
    case 'exact_building':
      return {
        publicLatitude: latitude,
        publicLongitude: longitude,
        publicLocationLabel: `Verified Building in ${area}`,
      };

    case 'nearby_building': {
      // Deterministic jitter between -0.0003 and +0.0003 degrees (~30 meters)
      const h = Math.abs(hashString(jitterKey || `${latitude},${longitude}`));
      const latOffset = ((h % 100) / 100 - 0.5) * 0.0006;
      const lonOffset = (((h >> 4) % 100) / 100 - 0.5) * 0.0006;
      return {
        publicLatitude: Number((latitude + latOffset).toFixed(6)),
        publicLongitude: Number((longitude + lonOffset).toFixed(6)),
        publicLocationLabel: `Near accommodation perimeter in ${area}`,
      };
    }

    case 'street': {
      // Round to 3 decimal places (~100 meters resolution)
      return {
        publicLatitude: Number(latitude.toFixed(3)),
        publicLongitude: Number(longitude.toFixed(3)),
        publicLocationLabel: `Street vicinity in ${area}`,
      };
    }

    case 'neighbourhood':
    default: {
      const center = AREA_CENTERS[area] || AREA_CENTERS.Dambare;
      return {
        publicLatitude: center.latitude,
        publicLongitude: center.longitude,
        publicLocationLabel: center.label,
      };
    }
  }
}

/**
 * Calculate distance in kilometers between two GPS coordinates using Haversine formula
 */
export function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  return Number((R * c).toFixed(2));
}

export type CompassSector = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

/**
 * Rounds a distance to the nearest 0.1 km (100 meters).
 */
export function roundDistanceToTenthKm(distanceKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return 0;
  return Math.round(distanceKm * 10) / 10;
}

/**
 * Maps a numeric bearing [0, 360) to one of the eight standard compass sectors.
 */
export function bearingToCompassSector(bearing: number): CompassSector {
  const normalized = ((bearing % 360) + 360) % 360;
  if (normalized >= 337.5 || normalized < 22.5) return 'N';
  if (normalized < 67.5) return 'NE';
  if (normalized < 112.5) return 'E';
  if (normalized < 157.5) return 'SE';
  if (normalized < 202.5) return 'S';
  if (normalized < 247.5) return 'SW';
  if (normalized < 292.5) return 'W';
  return 'NW';
}

/**
 * Calculates coarse compass direction from a student's point toward a property point.
 * Returns null if points are coincident.
 */
export function calculateCoarseDirection(
  studentLat: number,
  studentLon: number,
  propertyLat: number,
  propertyLon: number,
  epsilon = 1e-7
): CompassSector | null {
  if (Math.abs(studentLat - propertyLat) < epsilon && Math.abs(studentLon - propertyLon) < epsilon) {
    return null;
  }
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;

  const φ1 = toRad(studentLat);
  const φ2 = toRad(propertyLat);
  const Δλ = toRad(propertyLon - studentLon);

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

  const θ = Math.atan2(y, x);
  const bearing = (toDeg(θ) + 360) % 360;
  return bearingToCompassSector(bearing);
}

/**
 * Human-readable labels for the eight compass sectors.
 */
export const COMPASS_SECTOR_LABELS: Record<CompassSector, string> = {
  N: 'North',
  NE: 'North-East',
  E: 'East',
  SE: 'South-East',
  S: 'South',
  SW: 'South-West',
  W: 'West',
  NW: 'North-West',
};

export interface LandmarkOrientation {
  landmarkId: string;
  landmarkName: string;
  landmarkFullName: string;
  compassSector: CompassSector;
  compassLabel: string;
  distanceKm: number;
  distanceMeters: number;
  formattedDescription: string;
}

/**
 * Identifies the nearest verified reference landmark to a property and computes
 * the 8-point compass bearing from the landmark to the property.
 */
export function getNearestLandmarkOrientation(
  propertyLat: number,
  propertyLon: number
): LandmarkOrientation | null {
  if (!isValidKanoCoordinate(propertyLat, propertyLon)) {
    return null;
  }

  let closestLandmark: (typeof LOCAL_REFERENCE_LANDMARKS)[number] = LOCAL_REFERENCE_LANDMARKS[0];
  let minDistance = calculateDistanceKm(
    closestLandmark.latitude,
    closestLandmark.longitude,
    propertyLat,
    propertyLon
  );

  for (let i = 1; i < LOCAL_REFERENCE_LANDMARKS.length; i++) {
    const lk = LOCAL_REFERENCE_LANDMARKS[i];
    const dist = calculateDistanceKm(lk.latitude, lk.longitude, propertyLat, propertyLon);
    if (dist < minDistance) {
      minDistance = dist;
      closestLandmark = lk;
    }
  }

  const direction = calculateCoarseDirection(
    closestLandmark.latitude,
    closestLandmark.longitude,
    propertyLat,
    propertyLon
  );

  const compassSector = direction || 'N';
  const compassLabel = COMPASS_SECTOR_LABELS[compassSector];
  const distanceMeters = Math.round(minDistance * 1000);

  const formattedDistance =
    distanceMeters < 1000
      ? `~${distanceMeters} m`
      : `~${minDistance.toFixed(1)} km`;

  return {
    landmarkId: closestLandmark.id,
    landmarkName: closestLandmark.name,
    landmarkFullName: closestLandmark.fullName,
    compassSector,
    compassLabel,
    distanceKm: minDistance,
    distanceMeters,
    formattedDescription: `${compassLabel} of ${closestLandmark.name} (${formattedDistance})`,
  };
}

/**
 * Validates that latitude and longitude are finite numbers within Kano geographic bounds.
 */
export function isValidKanoCoordinate(lat: unknown, lon: unknown): boolean {
  if (typeof lat !== 'number' || typeof lon !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || isNaN(lat) || isNaN(lon)) return false;
  // Bounding box for Kano State and BUK New Site corridor
  return lat >= 11.75 && lat <= 12.25 && lon >= 8.20 && lon <= 8.70;
}

