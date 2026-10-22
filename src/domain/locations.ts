/**
 * @file locations.ts
 * @module domain/locations
 * @description Master geographic reference nodes for OUTPOST around Bayero University Kano (BUK) New Site.
 *
 * Geographical Scope:
 * - Dambare: Primary private student off-campus residential hub situated directly opposite BUK New Campus along Gwarzo Road.
 * - Rimin Gata: Quiet residential community west of BUK New Campus featuring modern student lodges and flats.
 * - Both nodes serve off-campus students of Bayero University Kano.
 */

import { HousingLocation } from './types';

export const CASE_STUDY_DISCLAIMER =
  'OUTPOST is a housing-discovery case-study platform for off-campus accommodation around Bayero University Kano. Development listings and user records may be demonstration data and are not official university endorsements.';

export const HOUSING_LOCATIONS: HousingLocation[] = [
  {
    id: 'loc-dambare',
    name: 'Dambare',
    city: 'Kano',
    state: 'Kano State',
    country: 'Nigeria',
    isOffCampus: true,
    institutionContext: 'Bayero University Kano',
    description:
      'Settlement directly opposite BUK New Campus along Gwarzo Road. The primary private student off-campus residential hub.',
    aliases: ['Dambare', 'Opposite BUK New Campus', 'Gwarzo Road Dambare'],
    distanceEstimate: '~0.4 - 0.6 km',
    latitude: 11.9842,
    longitude: 8.4187,
    isActive: true,
  },
  {
    id: 'loc-rimin-gata',
    name: 'Rimin Gata',
    city: 'Kano',
    state: 'Kano State',
    country: 'Nigeria',
    isOffCampus: true,
    institutionContext: 'Bayero University Kano',
    description:
      'Quiet residential community located just west of BUK New Campus off Gwarzo Road, featuring modern student lodges and gated flats.',
    aliases: ['Rimin Gata', 'Rimingata', 'Off Gwarzo Road'],
    distanceEstimate: '~0.8 - 1.2 km',
    latitude: 11.9785,
    longitude: 8.4093,
    isActive: true,
  },
];

export const LOCATIONS = HOUSING_LOCATIONS;

export function getLocationById(id: string): HousingLocation | undefined {
  return HOUSING_LOCATIONS.find((loc) => loc.id === id);
}

export function getLocationByName(name: string): HousingLocation | undefined {
  const norm = name.trim().toLowerCase();
  return HOUSING_LOCATIONS.find(
    (loc) =>
      loc.name.toLowerCase() === norm ||
      loc.aliases.some((alias) => alias.toLowerCase() === norm)
  );
}
