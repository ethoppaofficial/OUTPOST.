import { mapConfig } from '../../infrastructure/config/mapConfig';
import {
  AREA_CENTERS,
  LOCAL_REFERENCE_LANDMARKS,
  getNearestLandmarkOrientation,
} from '../../domain/geoUtils';
import type { GeocodingSuggestion, HousingArea } from '../../domain/types';

interface MapTilerFeature {
  id?: string;
  type?: string;
  place_name?: string;
  text?: string;
  properties?: {
    address?: string;
  };
  place_type?: string[];
  relevance?: number;
  center?: [number, number]; // [lng, lat]
  geometry?: {
    type?: string;
    coordinates?: [number, number];
  };
}

interface MapTilerResponse {
  features?: MapTilerFeature[];
}

interface NominatimItem {
  place_id?: number | string;
  lat?: string;
  lon?: string;
  display_name?: string;
  name?: string;
  class?: string;
  type?: string;
  addresstype?: string;
  importance?: number;
  address?: {
    road?: string;
    suburb?: string;
    neighbourhood?: string;
    city?: string;
    town?: string;
    state?: string;
  };
}

const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';

function mapNominatimTypeToPlaceType(item: NominatimItem): string[] {
  const kind = `${item.addresstype || ''} ${item.type || ''} ${item.class || ''}`.toLowerCase();
  if (kind.includes('house') || kind.includes('building') || kind.includes('amenity')) {
    return ['address'];
  }
  if (kind.includes('road') || kind.includes('highway') || kind.includes('street') || kind.includes('residential')) {
    return ['street'];
  }
  if (kind.includes('suburb') || kind.includes('neighbourhood') || kind.includes('village') || kind.includes('city')) {
    return ['neighbourhood'];
  }
  return ['poi'];
}

function getLocalKanoSuggestions(query: string, area: HousingArea): GeocodingSuggestion[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const areaCenter = AREA_CENTERS[area] || AREA_CENTERS.Dambare;
  const localPool: Array<{
    id: string;
    placeName: string;
    text: string;
    lat: number;
    lng: number;
    placeType: string[];
  }> = [
    {
      id: `local-area-${area.toLowerCase().replace(/\s+/g, '-')}`,
      placeName: `${area} Student Housing Corridor, Kano State, Nigeria`,
      text: area,
      lat: areaCenter.latitude,
      lng: areaCenter.longitude,
      placeType: ['neighbourhood'],
    },
    ...LOCAL_REFERENCE_LANDMARKS.map((lm) => ({
      id: `local-${lm.id}`,
      placeName: `${lm.fullName}, ${lm.id.includes('rimin') ? 'Rimin Gata' : 'Dambare'}, Kano State`,
      text: lm.name,
      lat: lm.latitude,
      lng: lm.longitude,
      placeType: ['poi'],
    })),
    {
      id: 'local-gwarzo-road',
      placeName: 'Gwarzo Road (BUK New Campus Axis), Dambare, Kano State',
      text: 'Gwarzo Road',
      lat: 11.9818,
      lng: 8.4215,
      placeType: ['street'],
    },
    {
      id: 'local-dambare-main-feeder',
      placeName: 'Main Feeder Road, Dambare, Kano State',
      text: 'Main Feeder Road',
      lat: 11.9845,
      lng: 8.4176,
      placeType: ['street'],
    },
  ];

  return localPool
    .filter((entry) => {
      const hay = `${entry.placeName} ${entry.text}`.toLowerCase();
      return q.split(/\s+/).some((tok) => tok.length >= 2 && hay.includes(tok));
    })
    .map((entry) => ({
      id: entry.id,
      placeName: entry.placeName,
      center: [entry.lng, entry.lat] as [number, number],
      longitude: entry.lng,
      latitude: entry.lat,
      placeType: entry.placeType,
      text: entry.text,
    }));
}

async function searchWithNominatim(
  cleanAddress: string,
  area: HousingArea,
  signal?: AbortSignal,
): Promise<GeocodingSuggestion[]> {
  const osmArea = area === 'Dambare' ? 'Danbare' : area;
  const queries = [
    `${cleanAddress}, ${osmArea}, Kano, Nigeria`,
    `${cleanAddress}, Kano, Nigeria`,
  ];

  const collected: GeocodingSuggestion[] = [];
  const seen = new Set<string>();

  for (const q of queries) {
    const url = new URL(NOMINATIM_SEARCH_URL);
    url.searchParams.set('q', q);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('countrycodes', 'ng');
    url.searchParams.set('viewbox', '8.35,12.05,8.55,11.90');
    url.searchParams.set('limit', '5');

    try {
      const res = await fetch(url.toString(), {
        signal,
        headers: {
          Accept: 'application/json',
        },
      });
      if (!res.ok) continue;

      const items = (await res.json()) as NominatimItem[];
      for (const item of items) {
        const lat = Number(item.lat);
        const lng = Number(item.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !item.display_name) continue;
        const dedupeKey = `${lat.toFixed(4)}:${lng.toFixed(4)}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        collected.push({
          id: `osm-${item.place_id ?? dedupeKey}`,
          placeName: item.display_name,
          center: [lng, lat],
          longitude: lng,
          latitude: lat,
          relevance: item.importance,
          placeType: mapNominatimTypeToPlaceType(item),
          text: item.name || item.address?.road || item.display_name.split(',')[0],
          address: item.address?.road,
        });
      }

      if (collected.length >= 3) break;
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err;
    }
  }

  return collected;
}

/**
 * Forward geocoding query using MapTiler when configured, falling back to
 * OpenStreetMap Nominatim + local Kano / BUK corridor landmarks cleanly.
 */
export async function searchAddress(
  fullAddress: string,
  area: HousingArea,
  signal?: AbortSignal,
): Promise<GeocodingSuggestion[]> {
  const cleanAddress = fullAddress.trim();
  if (cleanAddress.length < 2) return [];

  const apiKey = mapConfig.apiKey;
  if (apiKey) {
    try {
      const query = `${cleanAddress}, ${area}, Kano State, Nigeria`;
      const url = new URL(
        `${mapConfig.geocodingBaseUrl}/${encodeURIComponent(query)}.json`,
      );
      url.searchParams.set('key', apiKey);
      url.searchParams.set('autocomplete', 'true');
      url.searchParams.set('limit', '5');

      const response = await fetch(url.toString(), { signal });
      if (response.ok) {
        const payload = (await response.json()) as MapTilerResponse;
        const mapped = (payload.features ?? [])
          .map((feature): GeocodingSuggestion | null => {
            const coordinates = feature.center ?? feature.geometry?.coordinates;
            if (!feature.id || !feature.place_name || !coordinates || coordinates.length < 2) {
              return null;
            }
            const [longitude, latitude] = coordinates;
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
              return null;
            }
            return {
              id: feature.id,
              placeName: feature.place_name,
              center: [longitude, latitude],
              longitude,
              latitude,
              relevance: feature.relevance,
              placeType: feature.place_type,
              text: feature.text,
              address: feature.properties?.address,
            };
          })
          .filter((item): item is GeocodingSuggestion => item !== null);

        if (mapped.length > 0) return mapped;
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err;
      // Fall through cleanly to Nominatim + local Kano landmarks
    }
  }

  const [osmResults, localResults] = await Promise.all([
    searchWithNominatim(cleanAddress, area, signal),
    Promise.resolve(getLocalKanoSuggestions(cleanAddress, area)),
  ]);

  const combined = [...osmResults];
  const seenCoords = new Set(
    combined.map((r) => `${r.latitude.toFixed(4)}:${r.longitude.toFixed(4)}`),
  );

  for (const local of localResults) {
    const key = `${local.latitude.toFixed(4)}:${local.longitude.toFixed(4)}`;
    if (!seenCoords.has(key)) {
      seenCoords.add(key);
      combined.push(local);
    }
  }

  return combined.slice(0, 6);
}

/**
 * Reverse geocoding to resolve a street/road name or landmark from coordinates.
 * Uses MapTiler when configured, falling back to OpenStreetMap Nominatim and
 * nearest Kano BUK reference landmark description.
 */
export async function reverseGeocodeCoordinates(
  latitude: number,
  longitude: number,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const apiKey = mapConfig.apiKey;
  if (apiKey) {
    try {
      const url = new URL(
        `${mapConfig.geocodingBaseUrl}/${longitude},${latitude}.json`,
      );
      url.searchParams.set('key', apiKey);
      url.searchParams.set('limit', '1');

      const res = await fetch(url.toString(), { signal });
      if (res.ok) {
        const data = (await res.json()) as MapTilerResponse;
        const first = data.features?.[0];
        if (first?.place_name) return first.place_name;
      }
    } catch {
      // Fall through to Nominatim
    }
  }

  try {
    const osmUrl = new URL(NOMINATIM_REVERSE_URL);
    osmUrl.searchParams.set('format', 'jsonv2');
    osmUrl.searchParams.set('lat', String(latitude));
    osmUrl.searchParams.set('lon', String(longitude));
    osmUrl.searchParams.set('zoom', '18');
    osmUrl.searchParams.set('addressdetails', '1');

    const res = await fetch(osmUrl.toString(), {
      signal,
      headers: {
        Accept: 'application/json',
      },
    });
    if (res.ok) {
      const data = (await res.json()) as NominatimItem;
      if (data?.display_name) {
        return data.display_name;
      }
    }
  } catch {
    // Non-fatal fallback
  }

  const orientation = getNearestLandmarkOrientation(latitude, longitude);
  if (orientation) {
    return `${orientation.formattedDescription}, Kano State`;
  }

  return undefined;
}

/**
 * Validates whether the geocoding suggestion is consistent with the selected area.
 */
export function resultMentionsArea(
  suggestion: GeocodingSuggestion,
  area: HousingArea,
): boolean {
  const text = suggestion.placeName.toLowerCase();
  const areaLower = area.toLowerCase();
  return (
    text.includes(areaLower) ||
    (areaLower === 'dambare' && text.includes('danbare')) ||
    text.includes('kano')
  );
}

/**
 * Convert placeType into a readable precision label
 */
export function getPrecisionLabel(placeType?: string[]): {
  label: string;
  precision: 'exact_building' | 'nearby_building' | 'street' | 'neighbourhood';
} {
  if (!placeType || placeType.length === 0) {
    return { label: 'Street-level result', precision: 'street' };
  }

  if (placeType.includes('address') || placeType.includes('poi')) {
    return { label: 'Exact building / address', precision: 'exact_building' };
  }
  if (placeType.includes('street') || placeType.includes('road')) {
    return { label: 'Street-level result', precision: 'street' };
  }
  if (placeType.includes('neighbourhood') || placeType.includes('suburb')) {
    return { label: 'Neighbourhood result', precision: 'neighbourhood' };
  }
  return { label: 'Nearby landmark / area', precision: 'nearby_building' };
}
