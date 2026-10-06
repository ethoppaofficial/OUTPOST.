/**
 * Browser Geolocation Helper for OUTPOST.
 *
 * Adheres strictly to security, privacy, and UX guidelines:
 * - Sensitive one-time retrieval only (no background watching, caching, or tracking).
 * - Never requested automatically on page load, navigation, or sign-in.
 * - Explicit user gesture required.
 * - Disables cached positions (maximumAge: 0), reasonable timeout (10s), handles
 *   unsupported API, insecure non-HTTPS/non-localhost context, permission denial,
 *   timeout, and position unavailable errors.
 * - Coordinates are never stored in localStorage, sessionStorage, profile, or logs.
 */

export interface DevicePosition {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
}

export type GeolocationErrorCode =
  | 'NOT_SUPPORTED'
  | 'INSECURE_CONTEXT'
  | 'PERMISSION_DENIED'
  | 'POSITION_UNAVAILABLE'
  | 'TIMEOUT'
  | 'UNKNOWN';

export interface GeolocationErrorResult {
  code: GeolocationErrorCode;
  message: string;
  canRetry: boolean;
}

/**
 * Checks if the browser environment supports geolocation and is in a secure context.
 */
export function isGeolocationAvailable(): { available: boolean; reason?: string } {
  if (typeof window === 'undefined') {
    return { available: false, reason: 'Geolocation is unavailable in a server environment.' };
  }

  // Geolocation requires HTTPS or localhost
  if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return {
      available: false,
      reason: 'Device location requires a secure connection (HTTPS or localhost).',
    };
  }

  if (!navigator.geolocation) {
    return {
      available: false,
      reason: 'Location access is not supported by this browser.',
    };
  }

  return { available: true };
}

/**
 * Request current position one-time from the browser Geolocation API.
 * Caller MUST initiate this only from an explicit user action.
 */
export function requestCurrentDevicePosition(): Promise<DevicePosition> {
  return new Promise((resolve, reject) => {
    const availability = isGeolocationAvailable();
    if (!availability.available) {
      const err: GeolocationErrorResult = {
        code: availability.reason?.includes('secure connection')
          ? 'INSECURE_CONTEXT'
          : 'NOT_SUPPORTED',
        message: availability.reason || 'Location access is not supported.',
        canRetry: false,
      };
      return reject(err);
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          return reject({
            code: 'POSITION_UNAVAILABLE',
            message: 'Received invalid coordinates from device.',
            canRetry: true,
          } satisfies GeolocationErrorResult);
        }

        resolve({
          latitude,
          longitude,
          accuracyMeters: Number.isFinite(accuracy) ? accuracy : undefined,
        });
      },
      (error) => {
        let code: GeolocationErrorCode = 'UNKNOWN';
        let message = 'Unable to determine your location.';
        let canRetry = true;

        switch (error.code) {
          case error.PERMISSION_DENIED:
            code = 'PERMISSION_DENIED';
            message =
              'Location permission was denied. You can enable location in your browser settings and try again, or continue searching manually with area filters.';
            canRetry = true;
            break;
          case error.POSITION_UNAVAILABLE:
            code = 'POSITION_UNAVAILABLE';
            message =
              'Your current location is currently unavailable from your device sensors. Please check GPS settings or use manual area filters.';
            canRetry = true;
            break;
          case error.TIMEOUT:
            code = 'TIMEOUT';
            message =
              'Location request timed out. Please retry or search using the Dambare / Rimin Gata filters.';
            canRetry = true;
            break;
          default:
            code = 'UNKNOWN';
            message = error.message || 'An unexpected error occurred while requesting device location.';
            canRetry = true;
            break;
        }

        reject({ code, message, canRetry } satisfies GeolocationErrorResult);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000, // 10 seconds timeout
        maximumAge: 0, // Disable cached position; request fresh fix
      }
    );
  });
}
