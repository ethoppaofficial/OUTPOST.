/**
 * @file urlUtils.ts
 * @module application/utils/urlUtils
 * @description URL sanitization, safe internal redirection, and external link validation.
 *
 * Security Rationale:
 * - Prevents Open Redirect vulnerabilities by strictly constraining post-login redirection
 *   to internal application paths.
 * - Prevents JavaScript URI injection in anchors or external links.
 */

/**
 * Validates that a target path is an internal application route.
 * Prevents open redirect attacks (e.g., `//evil.com`, `javascript:...`, `https:...`).
 */
export function getSafeInternalRedirect(targetPath: string | null | undefined, defaultFallback = '/'): string {
  if (!targetPath || typeof targetPath !== 'string') {
    return defaultFallback;
  }

  const trimmed = targetPath.trim();

  // Must begin with a single slash and NOT double slash (protocol-relative URL)
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return defaultFallback;
  }

  // Reject dangerous schemes or backslashes
  if (/[\\{}<>\r\n]|javascript:|data:|vbscript:/i.test(trimmed)) {
    return defaultFallback;
  }

  return trimmed;
}

/**
 * Validates external directions/maps URLs (e.g. Google Maps or OpenStreetMap).
 * Only HTTPS URLs are permitted.
 */
export function isSafeExternalHttpUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && parsed.hostname === 'localhost');
  } catch {
    return false;
  }
}

/**
 * Safe external anchor props with tabnabbing defense.
 */
export const SAFE_EXTERNAL_LINK_PROPS = {
  target: '_blank',
  rel: 'noopener noreferrer',
} as const;

/**
 * Validates coordinate pair before constructing external navigation URLs.
 */
function isValidNavCoordinate(lat: unknown, lon: unknown): boolean {
  if (typeof lat !== 'number' || typeof lon !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || isNaN(lat) || isNaN(lon)) return false;
  return lat >= 4.0 && lat <= 14.5 && lon >= 2.5 && lon <= 15.0; // Nigeria geographic bounds
}

/**
 * Generates a validated Google Maps pedestrian navigation URL.
 * URL structure: https://www.google.com/maps/dir/?api=1&destination=LAT,LON&travelmode=walking
 */
export function getGoogleMapsWalkingUrl(destinationLat: number, destinationLon: number): string | null {
  if (!isValidNavCoordinate(destinationLat, destinationLon)) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${destinationLat.toFixed(6)},${destinationLon.toFixed(6)}&travelmode=walking`;
}

/**
 * Generates a validated OpenStreetMap pedestrian navigation URL.
 * URL structure: https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=;DEST_LAT,DEST_LON
 */
export function getOpenStreetMapWalkingUrl(destinationLat: number, destinationLon: number): string | null {
  if (!isValidNavCoordinate(destinationLat, destinationLon)) return null;
  return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=;${destinationLat.toFixed(6)},${destinationLon.toFixed(6)}`;
}

