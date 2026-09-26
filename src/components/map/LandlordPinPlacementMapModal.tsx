import React, { useCallback, useEffect, useRef, useState } from 'react';
import { maplibregl } from '../../infrastructure/config/maplibreSetup';
import type { Map, Marker, MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

export type HousingArea = 'Dambare' | 'Rimin Gata';
export type LocationSource = 'manual_pin' | 'device_gps' | 'geocoded_address';
export type LocationPrecision =
  | 'exact_building'
  | 'nearby_building'
  | 'street'
  | 'neighbourhood';

export interface PinLocationValue {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  source: LocationSource;
  area: HousingArea;
  precision: LocationPrecision;
  formattedAddress?: string;
}

export interface LandlordPinPlacementMapModalProps {
  isOpen: boolean;
  area: HousingArea;
  /** Verified [longitude, latitude] viewport supplied by the app's location records. */
  caseStudyViewport: { center: [number, number]; zoom: number };
  initialLocation?: Partial<PinLocationValue>;
  mapStyleUrl?: string;
  mapAttribution?: string;
  onClose: () => void;
  onConfirm: (location: PinLocationValue) => void;
  onReverseGeocode?: (input: {
    latitude: number;
    longitude: number;
  }) => Promise<string | undefined>;
}

const DEFAULT_STYLE_URL =
  'https://tiles.openfreemap.org/styles/liberty';
const DEFAULT_ATTRIBUTION =
  '© OpenFreeMap, © OpenStreetMap contributors';

function isValidCoordinate(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function createMarkerElement(): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className =
    'outpost-map-pin h-10 w-10 rounded-full border-4 border-white bg-emerald-600 shadow-xl transition-transform hover:scale-110 focus:outline-none focus:ring-4 focus:ring-emerald-300';
  element.setAttribute('aria-label', 'Selected accommodation location. Drag to adjust.');
  element.title = 'Drag to adjust the accommodation pin';
  return element;
}

export const LandlordPinPlacementMapModal: React.FC<
  LandlordPinPlacementMapModalProps
> = ({
  isOpen,
  area,
  caseStudyViewport,
  initialLocation,
  mapStyleUrl = DEFAULT_STYLE_URL,
  mapAttribution = DEFAULT_ATTRIBUTION,
  onClose,
  onConfirm,
  onReverseGeocode,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const [location, setLocation] = useState<PinLocationValue | null>(null);
  const [precision, setPrecision] = useState<LocationPrecision>(
    initialLocation?.precision ?? 'nearby_building',
  );
  const [address, setAddress] = useState(initialLocation?.formattedAddress ?? '');
  const [isLocating, setIsLocating] = useState(false);
  const [isReverseGeocoding, setIsReverseGeocoding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setSelectedLocation = useCallback(
    async (
      latitude: number,
      longitude: number,
      source: LocationSource,
      accuracyMeters?: number,
    ) => {
      if (!isValidCoordinate(latitude, longitude)) {
        setError('The selected map position is invalid. Please choose another point.');
        return;
      }

      setError(null);
      const nextLocation: PinLocationValue = {
        latitude,
        longitude,
        source,
        accuracyMeters,
        area,
        precision,
        formattedAddress: address || undefined,
      };
      setLocation(nextLocation);
      mapRef.current?.flyTo({ center: [longitude, latitude], zoom: 17 });

      if (onReverseGeocode) {
        setIsReverseGeocoding(true);
        try {
          const result = await onReverseGeocode({ latitude, longitude });
          if (result) {
            setAddress(result);
            setLocation((current) =>
              current
                ? { ...current, formattedAddress: result }
                : current,
            );
          }
        } catch {
          // A reverse-geocoder failure must not discard a valid manually placed pin.
          setError('Pin selected. We could not generate an address label; you can still submit it for review.');
        } finally {
          setIsReverseGeocoding(false);
        }
      }
    },
    [address, area, onReverseGeocode, precision],
  );

  useEffect(() => {
    if (!isOpen || !mapContainerRef.current || mapRef.current) return;

    const initialLatitude = initialLocation?.latitude;
    const initialLongitude = initialLocation?.longitude;
    const hasInitialLocation =
      typeof initialLatitude === 'number' &&
      typeof initialLongitude === 'number' &&
      isValidCoordinate(initialLatitude, initialLongitude);

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: mapStyleUrl,
      center: hasInitialLocation
        ? [initialLongitude as number, initialLatitude as number]
        : caseStudyViewport.center,
      zoom: hasInitialLocation ? 17 : caseStudyViewport.zoom,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    mapRef.current = map;

    const initialValue: PinLocationValue | null = hasInitialLocation
      ? {
          latitude: initialLatitude as number,
          longitude: initialLongitude as number,
          accuracyMeters: initialLocation?.accuracyMeters,
          source: initialLocation?.source ?? 'manual_pin',
          area,
          precision: initialLocation?.precision ?? 'nearby_building',
          formattedAddress: initialLocation?.formattedAddress,
        }
      : null;

    if (initialValue) {
      setLocation(initialValue);
      const marker = new maplibregl.Marker({
        element: createMarkerElement(),
        draggable: true,
      })
        .setLngLat([initialValue.longitude, initialValue.latitude])
        .addTo(map);

      marker.on('dragend', () => {
        const position = marker.getLngLat();
        void setSelectedLocation(
          position.lat,
          position.lng,
          'manual_pin',
        );
      });
      markerRef.current = marker;
    }

    const handleMapClick = (event: MapMouseEvent) => {
      const { lat, lng } = event.lngLat;
      const existingMarker = markerRef.current;

      if (existingMarker) {
        existingMarker.setLngLat([lng, lat]);
      } else {
        const marker = new maplibregl.Marker({
          element: createMarkerElement(),
          draggable: true,
        })
          .setLngLat([lng, lat])
          .addTo(map);

        marker.on('dragend', () => {
          const position = marker.getLngLat();
          void setSelectedLocation(
            position.lat,
            position.lng,
            'manual_pin',
          );
        });
        markerRef.current = marker;
      }

      void setSelectedLocation(lat, lng, 'manual_pin');
    };

    const handleMapError = () => {
      setError(
        'The map style or map tiles could not be loaded. You can retry or use the property address and submit for review.',
      );
    };

    map.on('click', handleMapClick);
    map.on('error', handleMapError);

    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [area, caseStudyViewport.center, caseStudyViewport.zoom, initialLocation, isOpen, mapStyleUrl, setSelectedLocation]);

  useEffect(() => {
    if (!isOpen) return;
    setPrecision(initialLocation?.precision ?? 'nearby_building');
    setAddress(initialLocation?.formattedAddress ?? '');
    setError(null);
  }, [initialLocation, isOpen]);

  useEffect(() => {
    setLocation((current) =>
      current ? { ...current, area, precision, formattedAddress: address || undefined } : current,
    );
  }, [address, area, precision]);

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setError('This browser does not support location access. Place the pin manually.');
      return;
    }

    setIsLocating(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        const existingMarker = markerRef.current;

        if (existingMarker) {
          existingMarker.setLngLat([longitude, latitude]);
        } else if (mapRef.current) {
          const marker = new maplibregl.Marker({
            element: createMarkerElement(),
            draggable: true,
          })
            .setLngLat([longitude, latitude])
            .addTo(mapRef.current);

          marker.on('dragend', () => {
            const positionAfterDrag = marker.getLngLat();
            void setSelectedLocation(
              positionAfterDrag.lat,
              positionAfterDrag.lng,
              'manual_pin',
            );
          });
          markerRef.current = marker;
        }

        void setSelectedLocation(latitude, longitude, 'device_gps', accuracy);
        setIsLocating(false);
      },
      (geolocationError) => {
        setIsLocating(false);
        setError(
          geolocationError.code === geolocationError.PERMISSION_DENIED
            ? 'Location permission was denied. You can still place the pin manually.'
            : 'Your current location could not be determined. Please place the pin manually.',
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      },
    );
  };

  const handleConfirm = () => {
    if (!location) {
      setError('Place the pin on the actual building before continuing.');
      return;
    }

    if (!isValidCoordinate(location.latitude, location.longitude)) {
      setError('The selected coordinates are invalid. Choose another map position.');
      return;
    }

    onConfirm({
      ...location,
      area,
      precision,
      formattedAddress: address || undefined,
    });
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pin-placement-title"
    >
      <div className="flex max-h-[95vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3 dark:border-slate-800 sm:px-6">
          <div>
            <h2 id="pin-placement-title" className="text-base font-bold text-slate-900 dark:text-white">
              Pin accommodation location
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {area}, Kano State · Click or drag the marker to the actual building
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Close location picker"
          >
            Close
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="relative min-h-[420px] bg-slate-200 dark:bg-slate-800">
            <div ref={mapContainerRef} className="absolute inset-0" />
            <div className="pointer-events-none absolute left-3 top-3 rounded-lg bg-white/95 px-3 py-2 text-xs text-slate-700 shadow dark:bg-slate-900/95 dark:text-slate-200">
              Click the map or drag the green marker to the building.
            </div>
            <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-white/90 px-2 py-1 text-[10px] text-slate-600 shadow dark:bg-slate-900/90 dark:text-slate-300">
              {mapAttribution}
            </div>
          </div>

          <aside className="space-y-4 overflow-y-auto border-t border-slate-200 p-4 dark:border-slate-800 lg:border-l lg:border-t-0 sm:p-5">
            <button
              type="button"
              onClick={handleUseCurrentLocation}
              disabled={isLocating}
              className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLocating ? 'Locating device…' : 'Use my current location'}
            </button>

            <label className="block space-y-1">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Public map precision
              </span>
              <select
                value={precision}
                onChange={(event) => setPrecision(event.target.value as LocationPrecision)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                <option value="exact_building">Exact building</option>
                <option value="nearby_building">Nearby building</option>
                <option value="street">Street</option>
                <option value="neighbourhood">Neighbourhood</option>
              </select>
            </label>

            <div className="rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800/70">
              <p className="font-semibold text-slate-800 dark:text-slate-200">Selected location</p>
              <p className="mt-2 text-slate-600 dark:text-slate-400">
                {address || 'No address label yet. The administrator can review the pin.'}
              </p>
              {location && (
                <dl className="mt-3 space-y-1 text-slate-600 dark:text-slate-400">
                  <div className="flex justify-between gap-3">
                    <dt>Latitude</dt>
                    <dd className="font-mono">{location.latitude.toFixed(6)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>Longitude</dt>
                    <dd className="font-mono">{location.longitude.toFixed(6)}</dd>
                  </div>
                  {location.accuracyMeters !== undefined && (
                    <div className="flex justify-between gap-3">
                      <dt>GPS accuracy</dt>
                      <dd>±{Math.round(location.accuracyMeters)} m</dd>
                    </div>
                  )}
                </dl>
              )}
            </div>

            {isReverseGeocoding && (
              <p className="text-xs text-slate-500">Generating a location label…</p>
            )}

            {error && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                {error}
              </div>
            )}

            <p className="text-[11px] leading-5 text-slate-500 dark:text-slate-400">
              This location will be submitted for verification. It will not appear on the public map until an administrator approves the property and its location.
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                className="flex-1 rounded-xl bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
              >
                Confirm pin
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default LandlordPinPlacementMapModal;
