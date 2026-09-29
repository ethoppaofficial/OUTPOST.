import { HousingArea, LocationPrecision } from './types';

// Standard Base32 character set for geohashing
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/**
 * Encodes latitude and longitude into a geohash string.
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
 * Landmark coordinates for context (BUK New Campus Main Gate)
 */
export const BUK_NEW_CAMPUS_GATE = {
  latitude: 11.9808,
  longitude: 8.4235,
  name: 'Bayero University Kano (BUK) New Campus Gate',
};

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
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(2));
}
