import React, { useCallback, useEffect, useRef, useState } from 'react';
import { maplibregl } from '../../infrastructure/config/maplibreSetup';
import 'maplibre-gl/dist/maplibre-gl.css';
import { HousingArea, LocationPrecision } from '../../domain/types';
import {
  mapConfig,
  subscribeToMapConfig,
  applyMapTilerBuildingsLayer,
} from '../../infrastructure/config/mapConfig';
import { AREA_CENTERS, encodeGeohash, computePublicCoordinates } from '../../domain/geoUtils';
import { requestCurrentDevicePosition } from '../../application/services/geolocationService';
import { reverseGeocodeDetailed } from '../../application/services/geocodingService';
import { MapPin, Shield, Check, Navigation, AlertTriangle, Loader2 } from 'lucide-react';

export interface PinPickerLocationPayload {
  area: HousingArea;
  latitude: number;
  longitude: number;
  geohash: string;
  precision: LocationPrecision;
  publicLatitude: number;
  publicLongitude: number;
  publicLocationLabel: string;
  formattedAddress?: string;
  streetOrRoad?: string;
  nearestLandmark?: string;
  city?: string;
  detectedArea?: HousingArea;
}

interface LandlordPinPickerProps {
  initialArea: HousingArea;
  initialLatitude?: number;
  initialLongitude?: number;
  initialPrecision?: LocationPrecision;
  onLocationChange: (data: PinPickerLocationPayload) => void;
  className?: string;
  readOnly?: boolean;
}

export const LandlordPinPicker: React.FC<LandlordPinPickerProps> = ({
  initialArea,
  initialLatitude,
  initialLongitude,
  initialPrecision = 'nearby_building',
  onLocationChange,
  className = '',
  readOnly = false,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const geocodeAbortRef = useRef<AbortController | null>(null);

  const defaultCoords = AREA_CENTERS[initialArea] || AREA_CENTERS.Dambare;
  const [currentLat, setCurrentLat] = useState<number>(initialLatitude ?? defaultCoords.latitude);
  const [currentLng, setCurrentLng] = useState<number>(initialLongitude ?? defaultCoords.longitude);
  const [area, setArea] = useState<HousingArea>(initialArea);
  const [precision, setPrecision] = useState<LocationPrecision>(initialPrecision);
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  const [isResolvingAddress, setIsResolvingAddress] = useState(false);
  const fallbackAppliedRef = useRef(false);

  // Refs prevent stale closures inside MapLibre click/dragend listeners
  const areaRef = useRef<HousingArea>(area);
  const precisionRef = useRef<LocationPrecision>(precision);
  const onLocationChangeRef = useRef(onLocationChange);

  useEffect(() => {
    areaRef.current = area;
  }, [area]);
  useEffect(() => {
    precisionRef.current = precision;
  }, [precision]);
  useEffect(() => {
    onLocationChangeRef.current = onLocationChange;
  }, [onLocationChange]);

  const updateCoordinates = useCallback(
    async (
      lat: number,
      lng: number,
      targetArea: HousingArea,
      targetPrecision: LocationPrecision,
      shouldReverseGeocode: boolean = true
    ) => {
      const latRounded = Number(lat.toFixed(6));
      const lngRounded = Number(lng.toFixed(6));
      setCurrentLat(latRounded);
      setCurrentLng(lngRounded);

      const geohash = encodeGeohash(latRounded, lngRounded);
      const pub = computePublicCoordinates(latRounded, lngRounded, targetPrecision, targetArea);

      const basePayload: PinPickerLocationPayload = {
        area: targetArea,
        latitude: latRounded,
        longitude: lngRounded,
        geohash,
        precision: targetPrecision,
        publicLatitude: pub.publicLatitude,
        publicLongitude: pub.publicLongitude,
        publicLocationLabel: pub.publicLocationLabel,
      };

      onLocationChangeRef.current(basePayload);

      if (!shouldReverseGeocode) return;

      if (geocodeAbortRef.current) {
        geocodeAbortRef.current.abort();
      }
      const controller = new AbortController();
      geocodeAbortRef.current = controller;

      setIsResolvingAddress(true);
      try {
        const details = await reverseGeocodeDetailed(
          latRounded,
          lngRounded,
          controller.signal
        );
        if (controller.signal.aborted || !details?.formattedAddress) return;

        setResolvedAddress(details.formattedAddress);
        onLocationChangeRef.current({
          ...basePayload,
          formattedAddress: details.formattedAddress,
          streetOrRoad: details.streetOrRoad,
          nearestLandmark: details.nearestLandmark,
          city: details.city,
          detectedArea: details.detectedArea,
        });
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          // Non-fatal: manual pin coordinates remain saved even if reverse geocoding fails
        }
      } finally {
        if (geocodeAbortRef.current === controller) {
          setIsResolvingAddress(false);
        }
      }
    },
    []
  );

  // Subscribe to config changes
  useEffect(() => {
    const unsubscribe = subscribeToMapConfig(() => {
      if (mapRef.current && mapConfig.styleUrl) {
        try {
          fallbackAppliedRef.current = false;
          mapRef.current.setStyle(mapConfig.styleUrl as any);
        } catch (e) {
          console.warn('Could not update style in LandlordPinPicker', e);
        }
      }
      if (mapRef.current) {
        applyMapTilerBuildingsLayer(mapRef.current);
      }
    });
    return unsubscribe;
  }, []);

  // Sync with external coordinate changes (e.g. from Full Map Modal or GPS button)
  useEffect(() => {
    if (initialLatitude !== undefined && initialLongitude !== undefined) {
      if (
        Math.abs(initialLatitude - currentLat) > 1e-6 ||
        Math.abs(initialLongitude - currentLng) > 1e-6
      ) {
        setCurrentLat(initialLatitude);
        setCurrentLng(initialLongitude);
        if (markerRef.current) {
          markerRef.current.setLngLat([initialLongitude, initialLatitude]);
        }
        if (mapRef.current) {
          mapRef.current.flyTo({ center: [initialLongitude, initialLatitude], zoom: 16 });
        }
      }
    }
  }, [initialLatitude, initialLongitude, currentLat, currentLng]);

  useEffect(() => {
    setArea(initialArea);
  }, [initialArea]);

  useEffect(() => {
    if (initialPrecision) {
      setPrecision(initialPrecision);
    }
  }, [initialPrecision]);

  // Initialize Map once
  useEffect(() => {
    if (!mapContainerRef.current) return;

    fallbackAppliedRef.current = false;
    const styleUrl = mapConfig.styleUrl;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: styleUrl as any,
      center: [currentLng, currentLat],
      zoom: 15,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');

    map.on('load', () => {
      map.resize();
      applyMapTilerBuildingsLayer(map);
    });

    // Create Pin marker element
    const el = document.createElement('div');
    el.className = 'cursor-grab active:cursor-grabbing';
    el.innerHTML = `
      <div class="flex flex-col items-center">
        <div class="p-2 rounded-full bg-emerald-600 text-white shadow-xl ring-4 ring-emerald-400/40 border border-white">
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
        </div>
        <div class="w-2 h-2 bg-emerald-700 rotate-45 -mt-1"></div>
      </div>
    `;

    const marker = new maplibregl.Marker({
      element: el,
      draggable: !readOnly,
      anchor: 'bottom',
    })
      .setLngLat([currentLng, currentLat])
      .addTo(map);

    markerRef.current = marker;
    mapRef.current = map;

    // Handle Marker Drag -> updates coords & auto-fills address
    marker.on('dragend', () => {
      const lngLat = marker.getLngLat();
      void updateCoordinates(lngLat.lat, lngLat.lng, areaRef.current, precisionRef.current, true);
    });

    // Handle Map Click -> moves pin, updates coords & auto-fills address
    if (!readOnly) {
      map.on('click', (e) => {
        const { lat, lng } = e.lngLat;
        marker.setLngLat([lng, lat]);
        void updateCoordinates(lat, lng, areaRef.current, precisionRef.current, true);
      });
    }

    map.on('error', () => {
      if (!fallbackAppliedRef.current) {
        fallbackAppliedRef.current = true;
        try {
          map.setStyle(mapConfig.fallbackStyle as any);
        } catch {
          // Ignore fallback errors
        }
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      map.resize();
    });
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      geocodeAbortRef.current?.abort();
      resizeObserver.disconnect();
      marker.remove();
      map.remove();
    };
  }, [readOnly, updateCoordinates]);

  const handleSelectPrecision = (newPrecision: LocationPrecision) => {
    setPrecision(newPrecision);
    void updateCoordinates(currentLat, currentLng, area, newPrecision, false);
  };

  const [gpsError, setGpsError] = useState<string | null>(null);

  const handleDeviceGPS = async () => {
    setGpsError(null);
    try {
      const pos = await requestCurrentDevicePosition();
      const { latitude, longitude } = pos;
      if (markerRef.current && mapRef.current) {
        markerRef.current.setLngLat([longitude, latitude]);
        mapRef.current.flyTo({ center: [longitude, latitude], zoom: 17 });
        void updateCoordinates(latitude, longitude, area, precision, true);
      }
    } catch (err: any) {
      setGpsError(err?.message || 'Device location unavailable. Please place marker manually.');
    }
  };

  const geohash = encodeGeohash(currentLat, currentLng);
  const publicCoords = computePublicCoordinates(currentLat, currentLng, precision, area);

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Map Canvas */}
      <div className="relative w-full h-80 sm:h-96 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950">
        <div ref={mapContainerRef} className="w-full h-full" />

        {/* Floating Instruction Banner */}
        <div className="absolute top-2.5 left-2.5 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/95 dark:bg-slate-900/95 text-slate-700 dark:text-slate-200 text-xs font-medium border border-slate-200/90 dark:border-slate-800 shadow-md backdrop-blur-xs">
          <MapPin className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
          <span>Click map or drag marker to pinpoint building & auto-fill address</span>
        </div>

        {/* Use GPS Button */}
        {!readOnly && (
          <button
            type="button"
            onClick={handleDeviceGPS}
            title="Use Device GPS Location"
            className="absolute bottom-3 right-3 z-10 px-3 py-2 rounded-xl bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 shadow-md hover:bg-slate-50 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
          >
            <Navigation className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>Use GPS</span>
          </button>
        )}
      </div>

      {gpsError && (
        <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 text-amber-800 dark:text-amber-300 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{gpsError}</span>
        </div>
      )}

      {/* Privacy & Precision Control */}
      <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-white">
            <Shield className="w-4 h-4 text-emerald-600" />
            <span>Public Location Precision</span>
          </div>
          <span className="text-[10px] text-slate-500 font-medium">Controls student-facing coordinate jitter</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {[
            {
              id: 'nearby_building' as LocationPrecision,
              label: 'Nearby (~30m Jitter)',
              desc: 'Recommended: Approximate pin protects exact building gate until booking',
            },
            {
              id: 'street' as LocationPrecision,
              label: 'Street Vicinity (~100m)',
              desc: 'Shows public marker on street axis',
            },
            {
              id: 'exact_building' as LocationPrecision,
              label: 'Exact Building',
              desc: 'Pins exact roof coordinates on public search',
            },
          ].map((item) => (
            <div
              key={item.id}
              onClick={() => !readOnly && handleSelectPrecision(item.id)}
              className={`p-3 rounded-xl border cursor-pointer transition ${
                precision === item.id
                  ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20 ring-1 ring-emerald-500'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-slate-900 dark:text-white">{item.label}</span>
                {precision === item.id && <Check className="w-3.5 h-3.5 text-emerald-600" />}
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">
                {item.desc}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Coordinates, Auto-Filled Address & Security Review Audit Tag */}
      <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-[11px] space-y-1.5">
        {(isResolvingAddress || resolvedAddress) && (
          <div className="flex items-center gap-1.5 pb-1.5 border-b border-slate-200/70 dark:border-slate-800 text-slate-700 dark:text-slate-200">
            {isResolvingAddress ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600 flex-shrink-0" />
                <span>Resolving address from map pinpoint…</span>
              </>
            ) : (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                <span className="truncate">
                  Auto-filled Address: <strong className="font-semibold">{resolvedAddress}</strong>
                </span>
              </>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 text-slate-500 dark:text-slate-400">
          <span>
            Physical Lat/Lng: <strong className="text-slate-700 dark:text-slate-300 font-mono">{currentLat}, {currentLng}</strong>
          </span>
          <span>
            Geohash: <strong className="text-slate-700 dark:text-slate-300 font-mono">{geohash}</strong>
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-slate-500 dark:text-slate-400">
          <span>
            Public Search Pin: <strong className="text-emerald-600 dark:text-emerald-400 font-mono">{publicCoords.publicLatitude}, {publicCoords.publicLongitude}</strong>
          </span>
          <span>
            Label: <strong className="text-slate-700 dark:text-slate-300">{publicCoords.publicLocationLabel}</strong>
          </span>
        </div>
      </div>
    </div>
  );
};

export default LandlordPinPicker;
