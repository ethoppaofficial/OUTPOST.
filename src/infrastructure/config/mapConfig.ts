/**
 * OUTPOST MapLibre Configuration
 * 
 * Configures the MapLibre GL JS tile provider, style JSON URL,
 * and data attributions via environment variables.
 */

// Default openly licensed demo style from MapLibre
export const DEFAULT_MAP_STYLE_URL = 'https://demotiles.maplibre.org/style.json';

// OpenStreetMap standard tile fallback style spec (MapLibre Style Specification v8)
export const OPEN_STREET_MAP_FALLBACK_STYLE: any = {
  version: 8,
  name: 'OpenStreetMap Carto Fallback',
  sources: {
    'osm-tiles': {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    },
  },
  layers: [
    {
      id: 'osm-tiles-layer',
      type: 'raster',
      source: 'osm-tiles',
      minzoom: 0,
      maxzoom: 19,
    },
  ],
};

export interface MapConfig {
  styleUrl: string;
  attribution: string;
  providerName: string;
  hasCustomStyle: boolean;
  defaultCenter: [number, number]; // [lng, lat]
  defaultZoom: number;
}

const envStyleUrl = import.meta.env.VITE_MAP_STYLE_URL?.trim();
const envAttribution = import.meta.env.VITE_MAP_ATTRIBUTION?.trim();
const envProviderName = import.meta.env.VITE_MAP_PROVIDER_NAME?.trim();

export const mapConfig: MapConfig = {
  // If provided in env, use configured style URL; otherwise use verified MapLibre demo style
  styleUrl: envStyleUrl || DEFAULT_MAP_STYLE_URL,
  hasCustomStyle: Boolean(envStyleUrl),
  attribution:
    envAttribution ||
    '© MapLibre © OpenStreetMap contributors | OUTPOST Student Housing Kano',
  providerName: envProviderName || (envStyleUrl ? 'Custom Map Provider' : 'MapLibre Open Data'),
  // Centered on Dambare / BUK New Campus corridor in Kano, Nigeria
  defaultCenter: [8.4140, 11.9815], // [longitude, latitude]
  defaultZoom: 14.5,
};
