/**
 * OUTPOST MapLibre & MapTiler Centralized Configuration
 *
 * Uses MapTiler Streets vector tiles when VITE_MAPTILER_API_KEY is configured,
 * and falls back seamlessly to keyless OpenFreeMap Liberty vector tiles and
 * OpenStreetMap raster tiles so interactive maps work out of the box.
 */

import type { StyleSpecification } from 'maplibre-gl';

const LOCAL_STORAGE_KEY_MAPTILER = 'outpost_maptiler_api_key';
const LOCAL_STORAGE_KEY_3D_BUILDINGS = 'outpost_maptiler_3d_buildings';
const listeners: Array<() => void> = [];

export const OPENFREEMAP_LIBERTY_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

export const OSM_RASTER_FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'osm-raster': {
      type: 'raster',
      tiles: [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'osm-raster-layer',
      type: 'raster',
      source: 'osm-raster',
      minzoom: 0,
      maxzoom: 19,
    },
  ],
};

export function getMaptilerApiKey(): string | undefined {
  const envKey = import.meta.env
    ? (import.meta.env.VITE_MAPTILER_API_KEY as string | undefined)?.trim()
    : undefined;
  if (envKey) return envKey;
  try {
    const local = localStorage.getItem(LOCAL_STORAGE_KEY_MAPTILER)?.trim();
    if (local) return local;
  } catch {
    // Ignore storage restrictions
  }
  return undefined;
}

export function setMaptilerApiKey(key: string): void {
  try {
    if (key.trim()) {
      localStorage.setItem(LOCAL_STORAGE_KEY_MAPTILER, key.trim());
    } else {
      localStorage.removeItem(LOCAL_STORAGE_KEY_MAPTILER);
    }
    notifyMapConfigChanged();
  } catch (err) {
    console.warn('Could not save MapTiler API key to localStorage', err);
  }
}

export function is3DBuildingsEnabled(): boolean {
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY_3D_BUILDINGS);
    return saved !== null ? saved === 'true' : true;
  } catch {
    return true;
  }
}

export function set3DBuildingsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY_3D_BUILDINGS, String(enabled));
    notifyMapConfigChanged();
  } catch (err) {
    console.warn('Could not save 3D buildings preference', err);
  }
}

export function isMapTilerConfigured(): boolean {
  return Boolean(getMaptilerApiKey());
}

export function subscribeToMapConfig(callback: () => void): () => void {
  listeners.push(callback);
  return () => {
    const idx = listeners.indexOf(callback);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}

export function notifyMapConfigChanged(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (err) {
      console.error('Error in map config listener:', err);
    }
  });
}

export const MAPTILER_STREETS_BASE_URL = 'https://api.maptiler.com/maps/streets-v2/style.json?key=';
export const MAPTILER_GEOCODING_BASE_URL = 'https://api.maptiler.com/geocoding';
export const MAPTILER_BUILDINGS_TILES_CLOUD_URL = 'https://cloud.maptiler.com/tiles/buildings/';
export const MAPTILER_BUILDINGS_TILES_JSON_BASE_URL = 'https://api.maptiler.com/tiles/buildings/tiles.json?key=';

export const mapConfig = {
  get apiKey(): string | undefined {
    return getMaptilerApiKey();
  },

  get styleUrl(): string {
    const key = getMaptilerApiKey();
    return key
      ? `${MAPTILER_STREETS_BASE_URL}${encodeURIComponent(key)}`
      : OPENFREEMAP_LIBERTY_STYLE_URL;
  },

  fallbackStyle: OSM_RASTER_FALLBACK_STYLE,

  get buildingsTilesUrl(): string | undefined {
    const key = getMaptilerApiKey();
    return key
      ? `${MAPTILER_BUILDINGS_TILES_JSON_BASE_URL}${encodeURIComponent(key)}`
      : undefined;
  },

  buildingsCloudUrl: MAPTILER_BUILDINGS_TILES_CLOUD_URL,

  geocodingBaseUrl: MAPTILER_GEOCODING_BASE_URL,

  get attribution(): string {
    return getMaptilerApiKey()
      ? '© MapTiler © OpenStreetMap contributors'
      : '© OpenFreeMap © OpenStreetMap contributors';
  },

  get providerName(): string {
    return getMaptilerApiKey() ? 'MapTiler Streets' : 'OpenFreeMap Streets';
  },

  // Centered on Dambare / BUK New Campus corridor in Kano, Nigeria
  // MapLibre coordinate order: [longitude, latitude]
  defaultCenter: [8.4140, 11.9815] as [number, number],
  defaultZoom: 15,
};

export function getEffectiveMapStyle(useRasterFallback = false): string | StyleSpecification {
  if (useRasterFallback) {
    return OSM_RASTER_FALLBACK_STYLE;
  }
  return mapConfig.styleUrl;
}

export function getEffectiveAttribution(useRasterFallback = false): string {
  if (useRasterFallback) {
    return '© OpenStreetMap contributors';
  }
  return mapConfig.attribution;
}

/**
 * Injects MapTiler Buildings tiles (https://cloud.maptiler.com/tiles/buildings/)
 * as an interactive 3D fill-extrusion layer when a MapTiler API key is configured.
 * OpenFreeMap Liberty already bundles building footprints natively.
 */
export function applyMapTilerBuildingsLayer(map: any): void {
  const apiKey = getMaptilerApiKey();
  if (!map) {
    return;
  }
  if (map.isStyleLoaded && !map.isStyleLoaded()) {
    map.once('styledata', () => {
      applyMapTilerBuildingsLayer(map);
    });
    return;
  }

  if (!apiKey || !is3DBuildingsEnabled()) {
    if (map.getLayer && map.getLayer('3d-buildings')) {
      try {
        map.removeLayer('3d-buildings');
      } catch {
        // Ignore removal error
      }
    }
    return;
  }

  try {
    if (!map.getSource('maptiler-buildings')) {
      map.addSource('maptiler-buildings', {
        type: 'vector',
        url: `${MAPTILER_BUILDINGS_TILES_JSON_BASE_URL}${encodeURIComponent(apiKey)}`,
      });
    }

    if (!map.getLayer('3d-buildings')) {
      const style = map.getStyle ? map.getStyle() : null;
      let labelLayerId: string | undefined;
      if (style && Array.isArray(style.layers)) {
        for (const layer of style.layers) {
          if (layer.type === 'symbol' && layer.layout?.['text-field']) {
            labelLayerId = layer.id;
            break;
          }
        }
      }

      map.addLayer(
        {
          id: '3d-buildings',
          source: 'maptiler-buildings',
          'source-layer': 'building',
          type: 'fill-extrusion',
          minzoom: 13,
          paint: {
            'fill-extrusion-color': [
              'interpolate',
              ['linear'],
              ['coalesce', ['get', 'render_height'], ['get', 'height'], 0],
              0,
              '#e2e8f0',
              15,
              '#cbd5e1',
              30,
              '#94a3b8',
              50,
              '#64748b',
            ],
            'fill-extrusion-height': [
              'interpolate',
              ['linear'],
              ['zoom'],
              13,
              0,
              14,
              ['coalesce', ['get', 'render_height'], ['get', 'height'], 6],
            ],
            'fill-extrusion-base': [
              'interpolate',
              ['linear'],
              ['zoom'],
              13,
              0,
              14,
              ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
            ],
            'fill-extrusion-opacity': 0.85,
          },
        },
        labelLayerId
      );
    }
  } catch (err) {
    console.warn('Could not apply MapTiler 3D buildings layer:', err);
  }
}
