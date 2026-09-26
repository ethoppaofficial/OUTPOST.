import React, { useEffect, useRef, useState } from 'react';
import { maplibregl, initMaplibreWorker } from '../../infrastructure/config/maplibreSetup';
import 'maplibre-gl/dist/maplibre-gl.css';
import { HousingArea, LocationPrecision, PropertyLocation } from '../../domain/types';
import { mapConfig, OPEN_STREET_MAP_FALLBACK_STYLE } from '../../infrastructure/config/mapConfig';
import { AREA_CENTERS, BUK_NEW_CAMPUS_GATE, encodeGeohash, computePublicCoordinates } from '../../domain/geoUtils';
import { MapPin, Shield, Info, Check, Navigation, AlertCircle } from 'lucide-react';

interface LandlordPinPickerProps {
  initialArea: HousingArea;
  initialLatitude?: number;
  initialLongitude?: number;
  initialPrecision?: LocationPrecision;
  onLocationChange: (data: {
    area: HousingArea;
    latitude: number;
    longitude: number;
    geohash: string;
    precision: LocationPrecision;
    publicLatitude: number;
    publicLongitude: number;
    publicLocationLabel: string;
  }) => void;
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

  const defaultCoords = AREA_CENTERS[initialArea] || AREA_CENTERS.Dambare;
  const [currentLat, setCurrentLat] = useState<number>(initialLatitude ?? defaultCoords.latitude);
  const [currentLng, setCurrentLng] = useState<number>(initialLongitude ?? defaultCoords.longitude);
  const [area, setArea] = useState<HousingArea>(initialArea);
  const [precision, setPrecision] = useState<LocationPrecision>(initialPrecision);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: mapConfig.styleUrl || OPEN_STREET_MAP_FALLBACK_STYLE,
      center: [currentLng, currentLat],
      zoom: 15,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');

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

    // Handle Marker Drag
    marker.on('dragend', () => {
      const lngLat = marker.getLngLat();
      updateCoordinates(lngLat.lat, lngLat.lng, area, precision);
    });

    // Handle Map Click to set Pin
    if (!readOnly) {
      map.on('click', (e) => {
        const { lat, lng } = e.lngLat;
        marker.setLngLat([lng, lat]);
        updateCoordinates(lat, lng, area, precision);
      });
    }

    return () => {
      marker.remove();
      map.remove();
    };
  }, []);

  const updateCoordinates = (
    lat: number,
    lng: number,
    targetArea: HousingArea,
    targetPrecision: LocationPrecision
  ) => {
    const latRounded = Number(lat.toFixed(6));
    const lngRounded = Number(lng.toFixed(6));
    setCurrentLat(latRounded);
    setCurrentLng(lngRounded);

    const geohash = encodeGeohash(latRounded, lngRounded);
    const pub = computePublicCoordinates(latRounded, lngRounded, targetPrecision, targetArea);

    onLocationChange({
      area: targetArea,
      latitude: latRounded,
      longitude: lngRounded,
      geohash,
      precision: targetPrecision,
      publicLatitude: pub.publicLatitude,
      publicLongitude: pub.publicLongitude,
      publicLocationLabel: pub.publicLocationLabel,
    });
  };

  const handleSelectArea = (newArea: HousingArea) => {
    setArea(newArea);
    const center = AREA_CENTERS[newArea];
    setCurrentLat(center.latitude);
    setCurrentLng(center.longitude);

    if (mapRef.current && markerRef.current) {
      mapRef.current.easeTo({
        center: [center.longitude, center.latitude],
        zoom: 15,
        duration: 600,
      });
      markerRef.current.setLngLat([center.longitude, center.latitude]);
    }

    updateCoordinates(center.latitude, center.longitude, newArea, precision);
  };

  const handleSelectPrecision = (newPrecision: LocationPrecision) => {
    setPrecision(newPrecision);
    updateCoordinates(currentLat, currentLng, area, newPrecision);
  };

  const geohash = encodeGeohash(currentLat, currentLng);
  const publicCoords = computePublicCoordinates(currentLat, currentLng, precision, area);

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Area Quick Selector */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
          Case-Study Off-Campus Area (Kano State)
        </label>
        <div className="grid grid-cols-2 gap-2">
          {(['Dambare', 'Rimin Gata'] as HousingArea[]).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => handleSelectArea(a)}
              disabled={readOnly}
              className={`p-3 rounded-xl border text-xs font-medium text-left flex items-start gap-2.5 transition ${
                area === a
                  ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-900 dark:text-emerald-300 ring-1 ring-emerald-500'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-slate-300'
              }`}
            >
              <MapPin className={`w-4 h-4 flex-shrink-0 mt-0.5 ${area === a ? 'text-emerald-600' : 'text-slate-400'}`} />
              <div>
                <span className="font-bold block">{a}</span>
                <span className="text-[11px] text-slate-500 block">
                  {a === 'Dambare' ? 'Opposite BUK New Campus' : 'West off Gwarzo Road'}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Map Instruction Hint */}
      {!readOnly && (
        <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Navigation className="w-4 h-4 text-emerald-500 flex-shrink-0" />
            <span>Click map or drag the pin directly onto your property building</span>
          </div>
          <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
            {currentLat.toFixed(4)}, {currentLng.toFixed(4)}
          </span>
        </div>
      )}

      {/* Interactive MapLibre Pin Picker Canvas */}
      <div className="relative h-64 sm:h-72 w-full rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-inner">
        <div ref={mapContainerRef} className="w-full h-full" />
      </div>

      {/* Privacy Precision Setting */}
      <div className="space-y-2 pt-1">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-emerald-500" />
            <span>Public Location Privacy Precision</span>
          </label>
          <span className="text-[10px] text-slate-400">Protects student residential gate privacy</span>
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

      {/* Coordinates & Security Review Audit Tag */}
      <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-[11px] space-y-1.5">
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
