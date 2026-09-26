/**
 * OUTPOST MapLibre & MapTiler Configuration
 *
 * Configures the map tile provider, vector style presets,
 * Google Maps visual matching (soft greens, bright yellow highways, detailed buildings),
 * and MapTiler Streets API key management.
 */

// Closest visual match to Google Maps (No API key required)
// Features identical soft greens for landscapes, bright yellows for major highways, and detailed building layouts.
export const OPEN_FREE_MAP_BRIGHT_URL = 'https://tiles.openfreemap.org/styles/bright';
export const OPEN_FREE_MAP_LIBERTY_URL = 'https://tiles.openfreemap.org/styles/liberty';
export const MAPTILER_STREETS_BASE_URL = 'https://api.maptiler.com/maps/streets-v2/style.json?key=';

// Default vector style URL
export const DEFAULT_MAP_STYLE_URL = OPEN_FREE_MAP_BRIGHT_URL;

// OpenStreetMap standard raster tile fallback style spec (MapLibre Style Specification v8)
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

export interface MapStylePreset {
  id: string;
  name: string;
  badge: string;
  description: string;
  requiresKey: boolean;
  attribution: string;
  getStyleUrl: (key?: string) => string | any;
}

export const MAP_STYLE_PRESETS: MapStylePreset[] = [
  {
    id: 'maptiler-streets',
    name: 'MapTiler Streets',
    badge: 'Google Maps Match',
    description:
      'Closest visual match to Google Maps. Features identical soft greens for landscapes, bright yellows for major highways, and highly detailed building layouts. (Requires free API key) General navigation, street-level accuracy, and business discovery.',
    requiresKey: true,
    attribution: '© MapTiler © OpenStreetMap contributors | OUTPOST BUK Corridor',
    getStyleUrl: (key) => {
      const activeKey = key || getMaptilerApiKey();
      if (!activeKey) {
        // Graceful fallback to Bright (identical aesthetic without key)
        return OPEN_FREE_MAP_BRIGHT_URL;
      }
      return `${MAPTILER_STREETS_BASE_URL}${encodeURIComponent(activeKey.trim())}`;
    },
  },
  {
    id: 'streets-bright',
    name: 'Streets Bright (Vector)',
    badge: 'Google Maps Visuals (No Key)',
    description:
      'High-definition vector style matching Google Maps palette: soft greens for landscapes, bright yellows for highways, and crisp building footprints without an API key.',
    requiresKey: false,
    attribution: '© OpenMapTiles © OpenFreeMap © OpenStreetMap contributors',
    getStyleUrl: () => OPEN_FREE_MAP_BRIGHT_URL,
  },
  {
    id: 'liberty',
    name: 'Liberty Vector',
    badge: 'Modern Clean',
    description: 'Clean modern cartography with prominent university corridors and off-campus zones.',
    requiresKey: false,
    attribution: '© OpenFreeMap © OpenStreetMap contributors',
    getStyleUrl: () => OPEN_FREE_MAP_LIBERTY_URL,
  },
  {
    id: 'osm-carto',
    name: 'OpenStreetMap Carto',
    badge: 'Raster Fallback',
    description: 'Standard OpenStreetMap cartographic raster tiles with 100% global uptime.',
    requiresKey: false,
    attribution: '© OpenStreetMap contributors',
    getStyleUrl: () => OPEN_STREET_MAP_FALLBACK_STYLE,
  },
];

const LOCAL_STORAGE_KEY_MAPTILER = 'outpost_maptiler_api_key';
const LOCAL_STORAGE_KEY_STYLE_ID = 'outpost_selected_map_style';

const listeners: Array<() => void> = [];

export function subscribeToMapConfig(callback: () => void): () => void {
  listeners.push(callback);
  return () => {
    const idx = listeners.indexOf(callback);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}

function notifyListeners(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (err) {
      console.error('Error in map config listener:', err);
    }
  });
}

/**
 * Retrieve MapTiler API Key from Vite env or user localStorage
 */
export function getMaptilerApiKey(): string {
  const envKey = (import.meta.env.VITE_MAPTILER_API_KEY as string | undefined)?.trim();
  if (envKey) return envKey;
  try {
    return localStorage.getItem(LOCAL_STORAGE_KEY_MAPTILER)?.trim() || '';
  } catch {
    return '';
  }
}

/**
 * Persist MapTiler API Key entered by user
 */
export function setMaptilerApiKey(key: string): void {
  try {
    if (key.trim()) {
      localStorage.setItem(LOCAL_STORAGE_KEY_MAPTILER, key.trim());
    } else {
      localStorage.removeItem(LOCAL_STORAGE_KEY_MAPTILER);
    }
    notifyListeners();
  } catch (err) {
    console.warn('Could not save MapTiler API key to localStorage', err);
  }
}

/**
 * Get selected style ID
 */
export function getActiveMapStyleId(): string {
  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY_STYLE_ID);
    if (stored && MAP_STYLE_PRESETS.some((p) => p.id === stored)) {
      return stored;
    }
  } catch {
    // ignore
  }

  // If user or env has MapTiler API key, prefer MapTiler Streets by default!
  if (getMaptilerApiKey()) {
    return 'maptiler-streets';
  }

  // Otherwise default to the Google Maps visual match (Streets Bright)
  return 'streets-bright';
}

/**
 * Set selected style ID
 */
export function setActiveMapStyleId(styleId: string): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY_STYLE_ID, styleId);
    notifyListeners();
  } catch (err) {
    console.warn('Could not save style preference', err);
  }
}

/**
 * Get the currently resolved style URL (or style spec object)
 */
export function getEffectiveMapStyle(): string | any {
  // Check if an explicit VITE_MAP_STYLE_URL override is present in environment
  const envStyleUrl = import.meta.env.VITE_MAP_STYLE_URL?.trim();
  if (envStyleUrl && envStyleUrl !== 'https://demotiles.maplibre.org/style.json') {
    return envStyleUrl;
  }

  const activeId = getActiveMapStyleId();
  const preset = MAP_STYLE_PRESETS.find((p) => p.id === activeId) || MAP_STYLE_PRESETS[1];
  return preset.getStyleUrl(getMaptilerApiKey());
}

/**
 * Get the active attribution text
 */
export function getEffectiveAttribution(): string {
  const activeId = getActiveMapStyleId();
  const preset = MAP_STYLE_PRESETS.find((p) => p.id === activeId);
  return preset?.attribution || '© MapTiler © OpenMapTiles © OpenStreetMap contributors';
}

export interface MapConfig {
  styleUrl: string;
  attribution: string;
  providerName: string;
  hasCustomStyle: boolean;
  defaultCenter: [number, number]; // [lng, lat]
  defaultZoom: number;
}

export const mapConfig: MapConfig = {
  get styleUrl() {
    const style = getEffectiveMapStyle();
    return typeof style === 'string' ? style : OPEN_FREE_MAP_BRIGHT_URL;
  },
  get attribution() {
    return getEffectiveAttribution();
  },
  get providerName() {
    const activeId = getActiveMapStyleId();
    if (activeId === 'maptiler-streets') return 'MapTiler Streets';
    if (activeId === 'streets-bright') return 'Streets Bright (Google Maps Style)';
    return 'OpenFreeMap';
  },
  hasCustomStyle: true,
  // Centered on Dambare / BUK New Campus corridor in Kano, Nigeria
  defaultCenter: [8.4140, 11.9815], // [longitude, latitude]
  defaultZoom: 14.5,
};
