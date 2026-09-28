/**
 * OUTPOST MapLibre & MapTiler Centralized Configuration
 *
 * Configures the map tile provider, MapTiler Streets visual style,
 * and key resolution.
 */

const envApiKey = (import.meta.env.VITE_MAPTILER_API_KEY as string | undefined)?.trim();

export const MAPTILER_STREETS_BASE_URL = 'https://api.maptiler.com/maps/streets-v2/style.json?key=';

// High-fidelity fallback vector style matching Google Maps palette
// (soft greens for landscapes, bright yellows for highways, detailed building footprints)
export const OPEN_FREE_MAP_BRIGHT_URL = 'https://tiles.openfreemap.org/styles/bright';
export const OPEN_FREE_MAP_LIBERTY_URL = 'https://tiles.openfreemap.org/styles/liberty';

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

export function notifyMapConfigChanged(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (err) {
      console.error('Error in map config listener:', err);
    }
  });
}

/**
 * Retrieve MapTiler API Key from Vite environment variable or user localStorage
 */
export function getMaptilerApiKey(): string {
  if (envApiKey) return envApiKey;
  try {
    return localStorage.getItem(LOCAL_STORAGE_KEY_MAPTILER)?.trim() || '';
  } catch {
    return '';
  }
}

/**
 * Persist user-entered MapTiler key and notify all active map instances
 */
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

/**
 * Check if a valid MapTiler API key is configured
 */
export function isMapTilerConfigured(): boolean {
  return Boolean(getMaptilerApiKey());
}

/**
 * Get active selected style ID
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

  // If MapTiler key is configured, use MapTiler Streets by default
  if (getMaptilerApiKey()) {
    return 'maptiler-streets';
  }
  return 'streets-bright';
}

/**
 * Set active selected style ID
 */
export function setActiveMapStyleId(styleId: string): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY_STYLE_ID, styleId);
    notifyMapConfigChanged();
  } catch (err) {
    console.warn('Could not save style preference', err);
  }
}

/**
 * Get effective MapLibre style: MapTiler Streets if key present, else high-fidelity Bright vector style
 */
export function getEffectiveMapStyle(): string | any {
  const activeId = getActiveMapStyleId();
  const preset = MAP_STYLE_PRESETS.find((p) => p.id === activeId) || MAP_STYLE_PRESETS[0];
  return preset.getStyleUrl(getMaptilerApiKey());
}

export function getEffectiveAttribution(): string {
  const activeId = getActiveMapStyleId();
  const preset = MAP_STYLE_PRESETS.find((p) => p.id === activeId);
  return preset?.attribution || '© MapTiler © OpenStreetMap contributors | OUTPOST BUK Corridor';
}

/**
 * Centralized map configuration object as specified in prompt:
 * { apiKey, styleUrl, attribution, providerName }
 */
export const mapConfig = {
  apiKey: envApiKey || undefined,

  styleUrl: envApiKey
    ? `${MAPTILER_STREETS_BASE_URL}${envApiKey}`
    : OPEN_FREE_MAP_BRIGHT_URL,

  attribution: '© MapTiler © OpenStreetMap contributors',

  providerName: 'MapTiler',

  // Centered on Dambare / BUK New Campus corridor in Kano, Nigeria
  // MapLibre format: [longitude, latitude]
  defaultCenter: [8.4140, 11.9815] as [number, number],
  defaultZoom: 14.5,
};
