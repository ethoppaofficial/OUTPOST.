"use strict";
/**
 * Pure, independently testable geometry and geospatial calculation helpers
 * for OUTPOST (Bayero University Kano off-campus case study).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidCoordinate = isValidCoordinate;
exports.calculateSphericalDistanceKm = calculateSphericalDistanceKm;
exports.roundDistanceToTenthKm = roundDistanceToTenthKm;
exports.calculateInitialBearingDegrees = calculateInitialBearingDegrees;
exports.bearingToCompassSector = bearingToCompassSector;
exports.calculateCoarseDirection = calculateCoarseDirection;
const EARTH_RADIUS_KM = 6371;
/**
 * Validates coordinate values: finite numbers, within standard geographic ranges.
 */
function isValidCoordinate(latitude, longitude) {
    return (typeof latitude === 'number' &&
        typeof longitude === 'number' &&
        Number.isFinite(latitude) &&
        Number.isFinite(longitude) &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180);
}
/**
 * Calculate straight-line spherical distance between two points in kilometers
 * using the Haversine formula. Returns full-precision distance for accurate ranking.
 */
function calculateSphericalDistanceKm(lat1, lon1, lat2, lon2) {
    if (!isValidCoordinate(lat1, lon1) || !isValidCoordinate(lat2, lon2)) {
        throw new Error('Invalid coordinates provided for distance calculation.');
    }
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const lat1Rad = toRad(lat1);
    const lat2Rad = toRad(lat2);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
    return EARTH_RADIUS_KM * c;
}
/**
 * Rounds a distance to the nearest 0.1 km (100 meters).
 */
function roundDistanceToTenthKm(distanceKm) {
    if (!Number.isFinite(distanceKm) || distanceKm < 0) {
        return 0;
    }
    return Math.round(distanceKm * 10) / 10;
}
/**
 * Computes initial bearing from point 1 toward point 2 in degrees [0, 360).
 * If points are coincident, returns null.
 */
function calculateInitialBearingDegrees(lat1, lon1, lat2, lon2, epsilon = 1e-7) {
    if (!isValidCoordinate(lat1, lon1) || !isValidCoordinate(lat2, lon2)) {
        throw new Error('Invalid coordinates provided for bearing calculation.');
    }
    if (Math.abs(lat1 - lat2) < epsilon && Math.abs(lon1 - lon2) < epsilon) {
        return null;
    }
    const toRad = (deg) => (deg * Math.PI) / 180;
    const toDeg = (rad) => (rad * 180) / Math.PI;
    const φ1 = toRad(lat1);
    const φ2 = toRad(lat2);
    const Δλ = toRad(lon2 - lon1);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    const θ = Math.atan2(y, x);
    const bearing = (toDeg(θ) + 360) % 360;
    return bearing;
}
/**
 * Maps a numeric bearing [0, 360) to one of the eight standard compass sectors.
 * Each sector spans 45 degrees:
 * - N:  337.5° to 22.5°
 * - NE: 22.5° to 67.5°
 * - E:  67.5° to 112.5°
 * - SE: 112.5° to 157.5°
 * - S:  157.5° to 202.5°
 * - SW: 202.5° to 247.5°
 * - W:  247.5° to 292.5°
 * - NW: 292.5° to 337.5°
 */
function bearingToCompassSector(bearing) {
    const normalized = ((bearing % 360) + 360) % 360;
    if (normalized >= 337.5 || normalized < 22.5)
        return 'N';
    if (normalized < 67.5)
        return 'NE';
    if (normalized < 112.5)
        return 'E';
    if (normalized < 157.5)
        return 'SE';
    if (normalized < 202.5)
        return 'S';
    if (normalized < 247.5)
        return 'SW';
    if (normalized < 292.5)
        return 'W';
    return 'NW';
}
/**
 * Calculates coarse compass direction from a student's point toward a property point.
 * Returns null if the points are coincident.
 */
function calculateCoarseDirection(studentLat, studentLon, propertyLat, propertyLon) {
    const bearing = calculateInitialBearingDegrees(studentLat, studentLon, propertyLat, propertyLon);
    if (bearing === null)
        return null;
    return bearingToCompassSector(bearing);
}
//# sourceMappingURL=geometry.js.map