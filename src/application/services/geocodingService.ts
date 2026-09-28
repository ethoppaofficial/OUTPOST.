import { mapConfig } from '../../infrastructure/config/mapConfig';
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

/**
 * Forward geocoding query using MapTiler Geocoding API.
 * Combines typed address with selected case-study area (Dambare or Rimin Gata)
 * and Kano State, Nigeria.
 */
export async function searchAddress(
  fullAddress: string,
  area: HousingArea,
  signal?: AbortSignal,
): Promise<GeocodingSuggestion[]> {
  const apiKey = mapConfig.apiKey;

  if (!apiKey) {
    throw new Error('Map configuration is incomplete. Please contact the administrator.');
  }

  const cleanAddress = fullAddress.trim();
  if (cleanAddress.length < 2) return [];

  const query = `${cleanAddress}, ${area}, Kano State, Nigeria`;
  const url = new URL(
    `${mapConfig.geocodingBaseUrl}/${encodeURIComponent(query)}.json`,
  );

  url.searchParams.set('key', apiKey);
  url.searchParams.set('autocomplete', 'true');
  url.searchParams.set('limit', '5');

  const response = await fetch(url.toString(), { signal });
  if (!response.ok) {
    if (response.status === 403) {
      throw new Error('MapTiler key is restricted or quota exceeded. Please check your API key.');
    }
    throw new Error('Address search failed. Please try again.');
  }

  const payload = (await response.json()) as MapTilerResponse;

  return (payload.features ?? [])
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
}

/**
 * Reverse geocoding to resolve a street/road name or landmark from coordinates.
 */
export async function reverseGeocodeCoordinates(
  latitude: number,
  longitude: number,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const apiKey = mapConfig.apiKey;
  if (!apiKey) return undefined;

  try {
    const url = new URL(
      `${mapConfig.geocodingBaseUrl}/${longitude},${latitude}.json`,
    );
    url.searchParams.set('key', apiKey);
    url.searchParams.set('limit', '1');

    const res = await fetch(url.toString(), { signal });
    if (!res.ok) return undefined;

    const data = (await res.json()) as MapTilerResponse;
    const first = data.features?.[0];
    return first?.place_name;
  } catch {
    return undefined;
  }
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
  return text.includes(areaLower) || text.includes('kano');
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
