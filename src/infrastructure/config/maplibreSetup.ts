/**
 * OUTPOST MapLibre GL Worker & Environment Setup
 *
 * Configures MapLibre GL JS web worker explicitly for Vite.
 * In Vite/ESM environments, MapLibre's automatic relative worker resolution
 * fails because import.meta.url does not point to the sibling worker asset.
 * Using Vite's `?worker&url` query bundles the worker as a self-contained asset
 * and provides a verified URL to `setWorkerUrl`.
 */

import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

let isWorkerConfigured = false;

export function initMaplibreWorker(): void {
  if (isWorkerConfigured) return;
  try {
    if (maplibreWorkerUrl) {
      maplibregl.setWorkerUrl(maplibreWorkerUrl);
      isWorkerConfigured = true;
    }
  } catch (err) {
    console.warn('Failed to configure MapLibre worker URL:', err);
  }
}

// Automatically configure when imported
initMaplibreWorker();

export { maplibregl };
