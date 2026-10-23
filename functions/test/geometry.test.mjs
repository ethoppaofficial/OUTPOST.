import { test } from 'node:test';
import assert from 'node:assert';
import {
  calculateSphericalDistanceKm,
  roundDistanceToTenthKm,
  calculateInitialBearingDegrees,
  bearingToCompassSector,
  calculateCoarseDirection,
  isValidCoordinate,
} from '../src/geometry.ts';

test('Coordinate validation tests', () => {
  assert.strictEqual(isValidCoordinate(11.9808, 8.4235), true);
  assert.strictEqual(isValidCoordinate(-90, -180), true);
  assert.strictEqual(isValidCoordinate(90, 180), true);
  assert.strictEqual(isValidCoordinate(91, 0), false);
  assert.strictEqual(isValidCoordinate(-91, 0), false);
  assert.strictEqual(isValidCoordinate(0, 181), false);
  assert.strictEqual(isValidCoordinate(0, -181), false);
  assert.strictEqual(isValidCoordinate(NaN, 0), false);
  assert.strictEqual(isValidCoordinate(0, Infinity), false);
  assert.strictEqual(isValidCoordinate('11.98', 8.42), false);
  assert.strictEqual(isValidCoordinate(null, undefined), false);
});

test('Coincident points return null direction and 0 distance', () => {
  const lat = 11.9808;
  const lon = 8.4235;
  const dist = calculateSphericalDistanceKm(lat, lon, lat, lon);
  assert.strictEqual(dist, 0);
  assert.strictEqual(roundDistanceToTenthKm(dist), 0);
  assert.strictEqual(calculateCoarseDirection(lat, lon, lat, lon), null);
  assert.strictEqual(calculateInitialBearingDegrees(lat, lon, lat, lon), null);
});

test('Distance calculation and 0.1 km rounding', () => {
  // BUK New Campus Gate to Dambare Hub (~0.65 km)
  const bukLat = 11.9808;
  const bukLon = 8.4235;
  const dambareLat = 11.9842;
  const dambareLon = 8.4187;

  const rawDist = calculateSphericalDistanceKm(bukLat, bukLon, dambareLat, dambareLon);
  assert.ok(rawDist > 0.5 && rawDist < 0.8, `Expected distance ~0.65km, got ${rawDist}`);
  const rounded = roundDistanceToTenthKm(rawDist);
  assert.strictEqual(typeof rounded, 'number');
  assert.strictEqual(rounded, Math.round(rawDist * 10) / 10);

  // Exact rounding tests
  assert.strictEqual(roundDistanceToTenthKm(0.04), 0.0);
  assert.strictEqual(roundDistanceToTenthKm(0.06), 0.1);
  assert.strictEqual(roundDistanceToTenthKm(1.249), 1.2);
  assert.strictEqual(roundDistanceToTenthKm(1.251), 1.3);
  assert.strictEqual(roundDistanceToTenthKm(3.45), 3.5);
});

test('All eight compass sectors mapping from bearing', () => {
  // Test boundary and midpoints of all 8 sectors
  // N: [337.5, 360) and [0, 22.5)
  assert.strictEqual(bearingToCompassSector(0), 'N');
  assert.strictEqual(bearingToCompassSector(10), 'N');
  assert.strictEqual(bearingToCompassSector(355), 'N');
  assert.strictEqual(bearingToCompassSector(337.5), 'N');
  assert.strictEqual(bearingToCompassSector(22.4), 'N');

  // NE: [22.5, 67.5)
  assert.strictEqual(bearingToCompassSector(22.5), 'NE');
  assert.strictEqual(bearingToCompassSector(45), 'NE');
  assert.strictEqual(bearingToCompassSector(67.4), 'NE');

  // E: [67.5, 112.5)
  assert.strictEqual(bearingToCompassSector(67.5), 'E');
  assert.strictEqual(bearingToCompassSector(90), 'E');
  assert.strictEqual(bearingToCompassSector(112.4), 'E');

  // SE: [112.5, 157.5)
  assert.strictEqual(bearingToCompassSector(112.5), 'SE');
  assert.strictEqual(bearingToCompassSector(135), 'SE');
  assert.strictEqual(bearingToCompassSector(157.4), 'SE');

  // S: [157.5, 202.5)
  assert.strictEqual(bearingToCompassSector(157.5), 'S');
  assert.strictEqual(bearingToCompassSector(180), 'S');
  assert.strictEqual(bearingToCompassSector(202.4), 'S');

  // SW: [202.5, 247.5)
  assert.strictEqual(bearingToCompassSector(202.5), 'SW');
  assert.strictEqual(bearingToCompassSector(225), 'SW');
  assert.strictEqual(bearingToCompassSector(247.4), 'SW');

  // W: [247.5, 292.5)
  assert.strictEqual(bearingToCompassSector(247.5), 'W');
  assert.strictEqual(bearingToCompassSector(270), 'W');
  assert.strictEqual(bearingToCompassSector(292.4), 'W');

  // NW: [292.5, 337.5)
  assert.strictEqual(bearingToCompassSector(292.5), 'NW');
  assert.strictEqual(bearingToCompassSector(315), 'NW');
  assert.strictEqual(bearingToCompassSector(337.4), 'NW');
});

test('Compass direction calculated from student to property coordinates in all 8 directions', () => {
  const centerLat = 11.9800;
  const centerLon = 8.4200;
  const delta = 0.01; // ~1.1km offset

  // Target North (lat increases)
  assert.strictEqual(calculateCoarseDirection(centerLat, centerLon, centerLat + delta, centerLon), 'N');

  // Target North-East
  assert.strictEqual(calculateCoarseDirection(centerLat, centerLon, centerLat + delta, centerLon + delta), 'NE');

  // Target East (lon increases)
  assert.strictEqual(calculateCoarseDirection(centerLat, centerLon, centerLat, centerLon + delta), 'E');

  // Target South-East
  assert.strictEqual(calculateCoarseDirection(centerLat, centerLon, centerLat - delta, centerLon + delta), 'SE');

  // Target South (lat decreases)
  assert.strictEqual(calculateCoarseDirection(centerLat, centerLon, centerLat - delta, centerLon), 'S');

  // Target South-West
  assert.strictEqual(calculateCoarseDirection(centerLat, centerLon, centerLat - delta, centerLon - delta), 'SW');

  // Target West (lon decreases)
  assert.strictEqual(calculateCoarseDirection(centerLat, centerLon, centerLat, centerLon - delta), 'W');

  // Target North-West
  assert.strictEqual(calculateCoarseDirection(centerLat, centerLon, centerLat + delta, centerLon - delta), 'NW');
});

test('Invalid coordinate rejection throws', () => {
  assert.throws(() => calculateSphericalDistanceKm(95, 0, 11, 8));
  assert.throws(() => calculateInitialBearingDegrees(11, 8, 11, 200));
  assert.throws(() => calculateCoarseDirection(NaN, 8, 11, 8));
});
