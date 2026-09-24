import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Property } from '../../domain/types';
import { mapConfig, OPEN_STREET_MAP_FALLBACK_STYLE } from '../../infrastructure/config/mapConfig';
import { BUK_NEW_CAMPUS_GATE, AREA_CENTERS } from '../../domain/geoUtils';
import {
  MapPin,
  Compass,
  AlertTriangle,
  RotateCcw,
  Layers,
  School,
  Shield,
  Eye,
  ExternalLink,
  CheckCircle2,
} from 'lucide-react';
import { Link } from 'react-router-dom';

interface PropertyMapProps {
  properties: Property[];
  selectedPropertyId?: string | null;
  hoveredPropertyId?: string | null;
  onSelectProperty?: (propertyId: string) => void;
  className?: string;
  height?: string;
  zoomToFit?: boolean;
}

export const PropertyMap: React.FC<PropertyMapProps> = ({
  properties,
  selectedPropertyId,
  hoveredPropertyId,
  onSelectProperty,
  className = '',
  height = '100%',
  zoomToFit = false,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const landmarkMarkersRef = useRef<maplibregl.Marker[]>([]);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [activeStyleUrl, setActiveStyleUrl] = useState<string>(mapConfig.styleUrl);
  const [isUsingFallback, setIsUsingFallback] = useState(false);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    let isMounted = true;
    let map: maplibregl.Map | null = null;

    try {
      const styleToLoad = isUsingFallback ? OPEN_STREET_MAP_FALLBACK_STYLE : activeStyleUrl;

      map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: styleToLoad,
        center: mapConfig.defaultCenter,
        zoom: mapConfig.defaultZoom,
        minZoom: 11,
        maxZoom: 18,
        attributionControl: false, // Custom attribution rendered cleanly
      });

      // Add navigation controls (zoom in/out, rotate/pitch)
      map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');

      map.on('load', () => {
        if (!isMounted) return;
        setMapLoaded(true);
        setMapError(null);
        map?.resize();
      });

      map.on('error', (e) => {
        console.warn('MapLibre style/tile warning:', e);
        // If the primary configured style URL fails to load, gracefully switch to OSM fallback style
        if (!isUsingFallback && isMounted) {
          setIsUsingFallback(true);
        }
      });

      mapInstanceRef.current = map;
    } catch (err: any) {
      console.error('Failed to initialize MapLibre GL:', err);
      if (isMounted) {
        setMapError(err?.message || 'Unable to initialize interactive map engine.');
      }
    }

    // Resize observer for responsive layout adjustments
    const resizeObserver = new ResizeObserver(() => {
      mapInstanceRef.current?.resize();
    });
    if (mapContainerRef.current) {
      resizeObserver.observe(mapContainerRef.current);
    }

    return () => {
      isMounted = false;
      resizeObserver.disconnect();
      // Remove all property markers
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current.clear();
      // Remove landmarks
      landmarkMarkersRef.current.forEach((m) => m.remove());
      landmarkMarkersRef.current = [];
      map?.remove();
      mapInstanceRef.current = null;
      setMapLoaded(false);
    };
  }, [activeStyleUrl, isUsingFallback]);

  // Add BUK New Campus & Settlement Area Context Landmarks
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) return;

    // Clear previous landmarks
    landmarkMarkersRef.current.forEach((m) => m.remove());
    landmarkMarkersRef.current = [];

    // 1. BUK New Campus Landmark Pin
    const bukEl = document.createElement('div');
    bukEl.className = 'group relative flex flex-col items-center cursor-pointer pointer-events-auto';
    bukEl.innerHTML = `
      <div class="px-2 py-1 bg-slate-900/90 text-white text-[11px] font-bold rounded-lg shadow-md border border-slate-700/80 flex items-center gap-1 backdrop-blur-xs">
        <svg class="w-3.5 h-3.5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
          <path d="M6 12v5c3 3 9 3 12 0v-5"/>
        </svg>
        <span>BUK New Campus Gate</span>
      </div>
      <div class="w-2 h-2 bg-slate-900 rotate-45 -mt-1 border-r border-b border-slate-700"></div>
    `;
    const bukMarker = new maplibregl.Marker({ element: bukEl, anchor: 'bottom' })
      .setLngLat([BUK_NEW_CAMPUS_GATE.longitude, BUK_NEW_CAMPUS_GATE.latitude])
      .addTo(map);
    landmarkMarkersRef.current.push(bukMarker);

    // 2. Dambare Area Center Context Badge
    const dambareEl = document.createElement('div');
    dambareEl.className = 'pointer-events-none opacity-80';
    dambareEl.innerHTML = `
      <div class="px-2 py-0.5 rounded-full bg-emerald-100/90 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 text-[10px] font-semibold tracking-wide border border-emerald-300/80 uppercase shadow-xs">
        Dambare Settlement (Opposite BUK)
      </div>
    `;
    const dambareMarker = new maplibregl.Marker({ element: dambareEl, anchor: 'center' })
      .setLngLat([AREA_CENTERS.Dambare.longitude, AREA_CENTERS.Dambare.latitude])
      .addTo(map);
    landmarkMarkersRef.current.push(dambareMarker);

    // 3. Rimin Gata Area Center Context Badge
    const riminEl = document.createElement('div');
    riminEl.className = 'pointer-events-none opacity-80';
    riminEl.innerHTML = `
      <div class="px-2 py-0.5 rounded-full bg-blue-100/90 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300 text-[10px] font-semibold tracking-wide border border-blue-300/80 uppercase shadow-xs">
        Rimin Gata Settlement
      </div>
    `;
    const riminMarker = new maplibregl.Marker({ element: riminEl, anchor: 'center' })
      .setLngLat([AREA_CENTERS['Rimin Gata'].longitude, AREA_CENTERS['Rimin Gata'].latitude])
      .addTo(map);
    landmarkMarkersRef.current.push(riminMarker);
  }, [mapLoaded]);

  // Synchronize Property Markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) return;

    // Filter to approved properties that have valid public location coordinates
    const mappableProperties = properties.filter((p) => {
      // Must be approved listing for student search
      if (p.verificationStatus !== 'approved') return false;
      const loc = p.location;
      if (!loc) return false;
      const lat = loc.publicLatitude ?? loc.latitude;
      const lng = loc.publicLongitude ?? loc.longitude;
      return typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng);
    });

    const currentPropertyIds = new Set(mappableProperties.map((p) => p.id));

    // Remove markers that are no longer in the filtered list
    markersRef.current.forEach((marker, id) => {
      if (!currentPropertyIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    });

    // Create or update markers
    mappableProperties.forEach((prop) => {
      const isSelected = selectedPropertyId === prop.id;
      const isHovered = hoveredPropertyId === prop.id;
      const loc = prop.location!;
      const lat = loc.publicLatitude ?? loc.latitude;
      const lng = loc.publicLongitude ?? loc.longitude;

      let marker = markersRef.current.get(prop.id);

      // Create new marker DOM element
      const el = document.createElement('div');
      el.id = `marker-${prop.id}`;
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute(
        'aria-label',
        `Accommodation: ${prop.title}, ₦${(prop.pricePerSession / 1000).toFixed(0)}k per session in ${prop.neighbourhood}`
      );

      updateMarkerElement(el, prop, isSelected, isHovered);

      // Keyboard navigation support
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelectProperty?.(prop.id);
        }
      });

      // Click selection
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onSelectProperty?.(prop.id);
      });

      if (!marker) {
        marker = new maplibregl.Marker({
          element: el,
          anchor: 'bottom',
        })
          .setLngLat([lng, lat])
          .addTo(map);

        markersRef.current.set(prop.id, marker);
      } else {
        // Update existing marker element and z-index
        const existingEl = marker.getElement();
        updateMarkerElement(existingEl, prop, isSelected, isHovered);
        marker.setLngLat([lng, lat]);
      }
    });

    // Optional zoom-to-fit when initial properties load
    if (zoomToFit && mappableProperties.length > 0) {
      const bounds = new maplibregl.LngLatBounds();
      mappableProperties.forEach((p) => {
        const loc = p.location!;
        bounds.extend([loc.publicLongitude ?? loc.longitude, loc.publicLatitude ?? loc.latitude]);
      });
      bounds.extend([BUK_NEW_CAMPUS_GATE.longitude, BUK_NEW_CAMPUS_GATE.latitude]);
      map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 800 });
    }
  }, [properties, selectedPropertyId, hoveredPropertyId, mapLoaded, onSelectProperty, zoomToFit]);

  // Center/Pan smoothly when selected property changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded || !selectedPropertyId) return;

    const prop = properties.find((p) => p.id === selectedPropertyId);
    if (!prop?.location) return;

    const lat = prop.location.publicLatitude ?? prop.location.latitude;
    const lng = prop.location.publicLongitude ?? prop.location.longitude;

    map.easeTo({
      center: [lng, lat],
      zoom: Math.max(map.getZoom(), 15),
      duration: 600,
    });
  }, [selectedPropertyId, mapLoaded, properties]);

  // Helper function to update marker styling
  const updateMarkerElement = (
    el: HTMLElement,
    prop: Property,
    isSelected: boolean,
    isHovered: boolean
  ) => {
    const priceK = Math.round(prop.pricePerSession / 1000);
    const zIndex = isSelected ? '50' : isHovered ? '40' : '20';

    el.style.zIndex = zIndex;
    el.className = `cursor-pointer transition-transform duration-200 focus:outline-hidden ${
      isSelected ? 'scale-115 -translate-y-1' : isHovered ? 'scale-108 -translate-y-0.5' : 'hover:scale-105'
    }`;

    el.innerHTML = `
      <div class="flex flex-col items-center">
        <!-- Marker Pill -->
        <div class="px-2.5 py-1 rounded-full font-bold text-xs shadow-md border flex items-center gap-1.5 transition-all duration-200 ${
          isSelected
            ? 'bg-emerald-600 text-white border-emerald-400 ring-4 ring-emerald-500/30'
            : isHovered
            ? 'bg-slate-900 text-white border-slate-700 ring-2 ring-slate-400/40'
            : 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white border-slate-200 dark:border-slate-700 hover:border-emerald-500 shadow-xs'
        }">
          <span class="w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white animate-pulse' : 'bg-emerald-500'}"></span>
          <span>₦${priceK}k</span>
          ${
            prop.landlordVerified
              ? `<svg class="w-3 h-3 ${isSelected ? 'text-white' : 'text-emerald-500'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>`
              : ''
          }
        </div>
        <!-- Pointer Arrow -->
        <div class="w-2.5 h-2.5 rotate-45 -mt-1.5 border-r border-b ${
          isSelected
            ? 'bg-emerald-600 border-emerald-400'
            : isHovered
            ? 'bg-slate-900 border-slate-700'
            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700'
        }"></div>
      </div>
    `;
  };

  const handleResetView = () => {
    mapInstanceRef.current?.easeTo({
      center: mapConfig.defaultCenter,
      zoom: mapConfig.defaultZoom,
      pitch: 0,
      bearing: 0,
      duration: 600,
    });
  };

  // Find currently selected property for desktop preview card overlay
  const selectedProp = properties.find((p) => p.id === selectedPropertyId);

  return (
    <div className={`relative w-full rounded-2xl overflow-hidden bg-slate-100 dark:bg-slate-950 border border-slate-200/90 dark:border-slate-800 shadow-inner flex flex-col ${className}`} style={{ height }}>
      {/* Map Canvas Container */}
      <div ref={mapContainerRef} className="w-full h-full flex-1" />

      {/* Fallback & Attribution Banner */}
      <div className="absolute bottom-2 left-2 z-10 flex flex-col gap-1 text-[10px] pointer-events-auto max-w-xs">
        {isUsingFallback && (
          <div className="px-2 py-0.5 rounded-md bg-amber-500/90 text-white font-medium flex items-center gap-1 shadow-xs">
            <AlertTriangle className="w-3 h-3 flex-shrink-0" />
            <span>OpenStreetMap carto tiles active</span>
          </div>
        )}
        <div className="px-2 py-1 rounded-md bg-white/90 dark:bg-slate-900/90 text-slate-600 dark:text-slate-300 backdrop-blur-xs border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center gap-1.5">
          <Layers className="w-3 h-3 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
          <span className="truncate">{mapConfig.attribution}</span>
        </div>
      </div>

      {/* Map Reset View & Context Controls */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
        <button
          onClick={handleResetView}
          title="Reset map view to Dambare / BUK corridor"
          className="p-2 rounded-xl bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 shadow-md hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium flex items-center gap-1.5 transition"
        >
          <RotateCcw className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          <span className="hidden sm:inline">Reset View</span>
        </button>

        <div className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white/95 dark:bg-slate-900/95 text-slate-600 dark:text-slate-300 text-xs font-semibold border border-slate-200 dark:border-slate-800 shadow-md backdrop-blur-xs">
          <MapPin className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          <span>Bayero Univ. Kano (BUK) Off-Campus Corridor</span>
        </div>
      </div>

      {/* Selected Property Preview Overlay (Floating Card) */}
      {selectedProp && (
        <div className="absolute bottom-10 right-3 left-3 sm:left-auto sm:w-80 z-20 pointer-events-auto animate-in fade-in slide-in-from-bottom-3 duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-3 shadow-xl flex gap-3 items-center">
            <img
              src={selectedProp.images[0] || 'https://images.unsplash.com/photo-1555854877-bab0e564b8d5?w=200'}
              alt={selectedProp.title}
              className="w-16 h-16 rounded-xl object-cover flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold truncate">
                <span>{selectedProp.propertyType}</span>
                <span>•</span>
                <span>{selectedProp.neighbourhood}</span>
              </div>
              <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                {selectedProp.title}
              </h4>
              <div className="text-xs font-extrabold text-slate-900 dark:text-white mt-0.5">
                ₦{selectedProp.pricePerSession.toLocaleString()}{' '}
                <span className="text-[10px] font-normal text-slate-500">/ session</span>
              </div>
            </div>
            <Link
              to={`/properties/${selectedProp.slug || selectedProp.id}`}
              className="px-2.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center flex-shrink-0 shadow-xs"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      )}

      {/* Error state */}
      {mapError && (
        <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-6 text-center z-30">
          <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-rose-200 dark:border-rose-900 max-w-sm space-y-3">
            <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Map Engine Notice</h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {mapError}
            </p>
            <button
              onClick={() => {
                setIsUsingFallback(true);
                setMapError(null);
              }}
              className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-semibold hover:bg-emerald-500 transition"
            >
              Load OpenStreetMap Tiles
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
