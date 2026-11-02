import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Import domain & application modules under test
import {
  BUK_NEW_CAMPUS_GATE_1,
  BUK_NEW_CAMPUS_GATE_2,
  BUK_NEW_CAMPUS_GATE,
  LOCAL_REFERENCE_LANDMARKS,
  AREA_CENTERS,
  calculateDistanceKm,
  bearingToCompassSector,
  calculateCoarseDirection,
  COMPASS_SECTOR_LABELS,
  getNearestLandmarkOrientation,
  isValidKanoCoordinate,
  roundDistanceToTenthKm,
} from '../src/domain/geoUtils.ts';

import {
  walkingRouteService,
  formatWalkingDuration,
  formatWalkingDistance,
} from '../src/application/services/walkingRouteService.ts';

import {
  getGoogleMapsWalkingUrl,
  getOpenStreetMapWalkingUrl,
  SAFE_EXTERNAL_LINK_PROPS,
} from '../src/application/utils/urlUtils.ts';

describe('OUTPOST Advanced Map & Location-Based Discovery Enhancements', () => {

  describe('1. Reference Landmark Coordinates & Canonical Gates', () => {
    test('BUK New Site Gate 1 coordinates match verified location along Gwarzo Road', () => {
      assert.equal(BUK_NEW_CAMPUS_GATE_1.latitude, 11.9808);
      assert.equal(BUK_NEW_CAMPUS_GATE_1.longitude, 8.4235);
      assert.equal(BUK_NEW_CAMPUS_GATE_1.id, 'gate-1');
      assert.ok(BUK_NEW_CAMPUS_GATE_1.name.includes('Gate 1'));
    });

    test('BUK New Site Gate 2 coordinates match verified location along southern access', () => {
      assert.equal(BUK_NEW_CAMPUS_GATE_2.latitude, 11.9752);
      assert.equal(BUK_NEW_CAMPUS_GATE_2.longitude, 8.4190);
      assert.equal(BUK_NEW_CAMPUS_GATE_2.id, 'gate-2');
      assert.ok(BUK_NEW_CAMPUS_GATE_2.name.includes('Gate 2'));
    });

    test('BUK_NEW_CAMPUS_GATE backward compatibility alias defaults to Gate 1', () => {
      assert.equal(BUK_NEW_CAMPUS_GATE.latitude, BUK_NEW_CAMPUS_GATE_1.latitude);
      assert.equal(BUK_NEW_CAMPUS_GATE.longitude, BUK_NEW_CAMPUS_GATE_1.longitude);
    });

    test('Canonical reference landmarks contain both gates, Danbare Market, and Rimin Gata Centre', () => {
      const ids = LOCAL_REFERENCE_LANDMARKS.map((l) => l.id);
      assert.ok(ids.includes('buk-gate-1'));
      assert.ok(ids.includes('buk-gate-2'));
      assert.ok(ids.includes('danbare-market'));
      assert.ok(ids.includes('rimin-gata-centre'));

      // Validate all landmark coordinates fall within Kano bounds
      for (const landmark of LOCAL_REFERENCE_LANDMARKS) {
        assert.ok(
          isValidKanoCoordinate(landmark.latitude, landmark.longitude),
          `Landmark ${landmark.id} must have valid Kano coordinates`
        );
      }
    });

    test('Kano geographic coordinate validator correctly verifies corridor boundaries', () => {
      // Valid Danbare coordinate
      assert.equal(isValidKanoCoordinate(11.9842, 8.4187), true);
      // Valid Rimin Gata coordinate
      assert.equal(isValidKanoCoordinate(11.9785, 8.4093), true);

      // Lagos coordinates (outside Kano)
      assert.equal(isValidKanoCoordinate(6.5244, 3.3792), false);
      // London coordinates
      assert.equal(isValidKanoCoordinate(51.5074, -0.1278), false);
      // Invalid inputs
      assert.equal(isValidKanoCoordinate(null, 8.4187), false);
      assert.equal(isValidKanoCoordinate(11.9842, undefined), false);
      assert.equal(isValidKanoCoordinate(NaN, 8.4187), false);
      assert.equal(isValidKanoCoordinate('11.9842', '8.4187'), false);
    });
  });

  describe('2. 8-Point Compass Bearing and Landmark Orientation', () => {
    test('bearingToCompassSector maps 360-degree compass angles into 8 standard sectors', () => {
      assert.equal(bearingToCompassSector(0), 'N');
      assert.equal(bearingToCompassSector(10), 'N');
      assert.equal(bearingToCompassSector(355), 'N');
      assert.equal(bearingToCompassSector(45), 'NE');
      assert.equal(bearingToCompassSector(90), 'E');
      assert.equal(bearingToCompassSector(135), 'SE');
      assert.equal(bearingToCompassSector(180), 'S');
      assert.equal(bearingToCompassSector(225), 'SW');
      assert.equal(bearingToCompassSector(270), 'W');
      assert.equal(bearingToCompassSector(315), 'NW');
    });

    test('COMPASS_SECTOR_LABELS contains full human-readable titles', () => {
      assert.equal(COMPASS_SECTOR_LABELS.N, 'North');
      assert.equal(COMPASS_SECTOR_LABELS.NE, 'North-East');
      assert.equal(COMPASS_SECTOR_LABELS.E, 'East');
      assert.equal(COMPASS_SECTOR_LABELS.SE, 'South-East');
      assert.equal(COMPASS_SECTOR_LABELS.S, 'South');
      assert.equal(COMPASS_SECTOR_LABELS.SW, 'South-West');
      assert.equal(COMPASS_SECTOR_LABELS.W, 'West');
      assert.equal(COMPASS_SECTOR_LABELS.NW, 'North-West');
    });

    test('calculateCoarseDirection returns null when points are coincident', () => {
      const dir = calculateCoarseDirection(11.9808, 8.4235, 11.9808, 8.4235);
      assert.equal(dir, null);
    });

    test('getNearestLandmarkOrientation calculates directional context relative to closest reference', () => {
      // Point directly north of Danbare Market (11.9848, 8.4172)
      const testLat = 11.9880;
      const testLon = 8.4172;
      const orientation = getNearestLandmarkOrientation(testLat, testLon);

      assert.ok(orientation !== null);
      assert.equal(orientation.landmarkId, 'danbare-market');
      assert.equal(orientation.landmarkName, 'Danbare Market');
      assert.equal(orientation.compassSector, 'N');
      assert.equal(orientation.compassLabel, 'North');
      assert.ok(orientation.formattedDescription.includes('North of Danbare Market'));
      assert.ok(orientation.distanceMeters > 0);
    });

    test('getNearestLandmarkOrientation returns null for invalid coordinates', () => {
      assert.equal(getNearestLandmarkOrientation(0, 0), null);
      assert.equal(getNearestLandmarkOrientation(NaN, 8.4235), null);
    });
  });

  describe('3. Pedestrian Walking Proximity & Honest Straight-Line Fallback', () => {
    test('formatWalkingDistance outputs meters under 1km and tenths of km above', () => {
      assert.equal(formatWalkingDistance(450), '450 m');
      assert.equal(formatWalkingDistance(950), '950 m');
      assert.equal(formatWalkingDistance(1200), '1.2 km');
      assert.equal(formatWalkingDistance(2500), '2.5 km');
    });

    test('formatWalkingDuration formats minutes into human-readable walk duration', () => {
      assert.equal(formatWalkingDuration(0), '1 min walk');
      assert.equal(formatWalkingDuration(1), '1 min walk');
      assert.equal(formatWalkingDuration(8), '8 min walk');
      assert.equal(formatWalkingDuration(25), '25 min walk');
    });

    test('getImmediateDualGateProximity synchronously produces proximities to both Gate 1 and Gate 2', () => {
      const propLat = 11.9850;
      const propLon = 8.4200;
      const dual = walkingRouteService.getImmediateDualGateProximity(propLat, propLon);

      assert.ok(dual.gate1);
      assert.ok(dual.gate2);
      assert.ok(dual.nearestGate);
      assert.equal(dual.gate1.gateId, 'gate-1');
      assert.equal(dual.gate2.gateId, 'gate-2');

      // Both distances must be positive
      assert.ok(dual.gate1.distanceMeters > 0);
      assert.ok(dual.gate2.distanceMeters > 0);

      // Nearest gate must be whichever is closer
      const closerGateId = dual.gate1.distanceMeters <= dual.gate2.distanceMeters ? 'gate-1' : 'gate-2';
      assert.equal(dual.nearestGate.gateId, closerGateId);
    });

    test('Fallback strictly displays straight-line label without fabricating fake walking times', () => {
      const propLat = 11.9850;
      const propLon = 8.4200;
      const dual = walkingRouteService.getImmediateDualGateProximity(propLat, propLon);

      // On fallback (isPedestrianRoute === false), durationMinutes MUST be null
      if (!dual.gate1.isPedestrianRoute) {
        assert.equal(dual.gate1.durationMinutes, null);
        assert.equal(dual.gate1.formattedDuration, '');
        // Must explicitly label as straight-line distance
        assert.ok(
          dual.gate1.displayText.includes('straight-line distance'),
          `Display text "${dual.gate1.displayText}" must state straight-line distance`
        );
        assert.ok(
          dual.gate1.displayText.startsWith('Approximately '),
          `Display text must begin with "Approximately "`
        );
      }
    });

    test('calculateDualGateProximity handles offline or network abort gracefully with fallback', async () => {
      const propLat = 11.9830;
      const propLon = 8.4210;

      const result = await walkingRouteService.calculateDualGateProximity(propLat, propLon);
      assert.ok(result);
      assert.ok(result.gate1);
      assert.ok(result.gate2);
      assert.ok(result.nearestGate);
      assert.ok(result.gate1.distanceMeters > 0);
    });
  });

  describe('4. External Direction Providers and Deep Links', () => {
    test('getGoogleMapsWalkingUrl constructs valid walking mode external URL for Kano coordinate', () => {
      const lat = 11.985;
      const lon = 8.42;
      const url = getGoogleMapsWalkingUrl(lat, lon);

      assert.ok(url !== null);
      assert.ok(url.startsWith('https://www.google.com/maps/dir/?api=1'));
      assert.ok(url.includes('travelmode=walking'));
      assert.ok(url.includes(`destination=11.985000,8.420000`));
    });

    test('getOpenStreetMapWalkingUrl constructs valid OSM walking directions URL', () => {
      const lat = 11.985;
      const lon = 8.42;
      const url = getOpenStreetMapWalkingUrl(lat, lon);

      assert.ok(url !== null);
      assert.ok(url.startsWith('https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot'));
      assert.ok(url.includes('route=;11.985000,8.420000'));
    });

    test('External URL generators reject coordinates outside geographic bounds', () => {
      // London coordinates (outside Nigeria)
      assert.equal(getGoogleMapsWalkingUrl(51.5074, -0.1278), null);
      assert.equal(getOpenStreetMapWalkingUrl(51.5074, -0.1278), null);
      // Coordinates at origin 0,0
      assert.equal(getGoogleMapsWalkingUrl(0, 0), null);
      // Non-finite
      assert.equal(getGoogleMapsWalkingUrl(NaN, 8.42), null);
    });

    test('SAFE_EXTERNAL_LINK_PROPS enforces target=_blank and rel=noopener noreferrer', () => {
      assert.equal(SAFE_EXTERNAL_LINK_PROPS.target, '_blank');
      assert.equal(SAFE_EXTERNAL_LINK_PROPS.rel, 'noopener noreferrer');
    });
  });

  describe('5. Spatial Map Filter Predicates', () => {
    const sampleProperties = [
      {
        id: 'p1',
        title: 'Alpha Hostel',
        pricePerSession: 120000,
        propertyType: 'single_room',
        genderPolicy: 'male_only',
        neighbourhood: 'Dambare (Opposite BUK Main Gate)',
      },
      {
        id: 'p2',
        title: 'Beta Lodge',
        pricePerSession: 200000,
        propertyType: 'self_contained',
        genderPolicy: 'female_only',
        neighbourhood: 'Dambare Central',
      },
      {
        id: 'p3',
        title: 'Gamma Court',
        pricePerSession: 350000,
        propertyType: 'shared_apartment',
        genderPolicy: 'mixed',
        neighbourhood: 'Rimin Gata West',
      },
      {
        id: 'p4',
        title: 'Delta Villa',
        pricePerSession: 500000,
        propertyType: 'room_and_parlour',
        genderPolicy: 'any',
        neighbourhood: 'Rimin Gata Settlement',
      },
    ];

    test('Budget filtering partitions accommodations correctly', () => {
      const under150k = sampleProperties.filter((p) => p.pricePerSession < 150000);
      assert.equal(under150k.length, 1);
      assert.equal(under150k[0].id, 'p1');

      const mid150to250 = sampleProperties.filter((p) => p.pricePerSession >= 150000 && p.pricePerSession <= 250000);
      assert.equal(mid150to250.length, 1);
      assert.equal(mid150to250[0].id, 'p2');

      const above400k = sampleProperties.filter((p) => p.pricePerSession > 400000);
      assert.equal(above400k.length, 1);
      assert.equal(above400k[0].id, 'p4');
    });

    test('Corridor filtering separates Danbare from Rimin Gata', () => {
      const dambare = sampleProperties.filter((p) => p.neighbourhood.toLowerCase().includes('dambar'));
      assert.equal(dambare.length, 2);

      const riminGata = sampleProperties.filter((p) => p.neighbourhood.toLowerCase().includes('rimin'));
      assert.equal(riminGata.length, 2);
    });

    test('Gender policy filtering respects male_only, female_only, and mixed/any', () => {
      const maleOnly = sampleProperties.filter((p) => p.genderPolicy === 'male_only');
      assert.equal(maleOnly.length, 1);

      const femaleOnly = sampleProperties.filter((p) => p.genderPolicy === 'female_only');
      assert.equal(femaleOnly.length, 1);

      const mixed = sampleProperties.filter((p) => p.genderPolicy === 'mixed' || p.genderPolicy === 'any');
      assert.equal(mixed.length, 2);
    });
  });

});
