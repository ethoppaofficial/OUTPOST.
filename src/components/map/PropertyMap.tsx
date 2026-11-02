import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { maplibregl } from '../../infrastructure/config/maplibreSetup';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Property } from '../../domain/types';
import {
  mapConfig,
  getEffectiveMapStyle,
  getEffectiveAttribution,
  subscribeToMapConfig,
  applyMapTilerBuildingsLayer,
} from '../../infrastructure/config/mapConfig';
import { MapStyleSelector } from './MapStyleSelector';
import {
  BUK_NEW_CAMPUS_GATE_1,
  BUK_NEW_CAMPUS_GATE_2,
  AREA_CENTERS,
  LOCAL_REFERENCE_LANDMARKS,
  getNearestLandmarkOrientation,
  isValidKanoCoordinate,
  calculateDistanceKm,
} from '../../domain/geoUtils';
import {
  walkingRouteService,
  DualGateProximity,
} from '../../application/services/walkingRouteService';
import {
  getGoogleMapsWalkingUrl,
  getOpenStreetMapWalkingUrl,
  SAFE_EXTERNAL_LINK_PROPS,
} from '../../application/utils/urlUtils';
import {
  MapPin,
  Compass,
  AlertTriangle,
  RotateCcw,
  Layers,
  ExternalLink,
  Navigation,
  X,
  Filter,
  SlidersHorizontal,
  ChevronDown,
  Check,
} from 'lucide-react';
import {
  requestCurrentDevicePosition,
  DevicePosition,
  GeolocationErrorResult,
} from '../../application/services/geolocationService';
import { Link } from 'react-router-dom';

interface PropertyMapProps {
  properties: Property[];
  selectedPropertyId?: string | null;
  hoveredPropertyId?: string | null;
  onSelectProperty?: (propertyId: string) => void;
  className?: string;
  height?: string;
  zoomToFit?: boolean;
  showFilters?: boolean;
}

export type BudgetFilter = 'all' | 'under150k' | '150k-250k' | '250k-400k' | 'above400k';
export type AccomTypeFilter = 'all' | 'self_contained' | 'single_room' | 'shared_apartment' | 'room_and_parlour';
export type GenderPolicyFilter = 'all' | 'male_only' | 'female_only' | 'mixed';
export type AreaFilter = 'all' | 'Dambare' | 'Rimin Gata';

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export const PropertyMap: React.FC<PropertyMapProps> = ({
  properties,
  selectedPropertyId,
  hoveredPropertyId,
  onSelectProperty,
  className = '',
  height = '100%',
  zoomToFit = false,
  showFilters = true,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<maplibregl.Map | null>(null);
  const activePopupRef = useRef<maplibregl.Popup | null>(null);
  const landmarkMarkersRef = useRef<maplibregl.Marker[]>([]);
  const userLocationMarkerRef = useRef<maplibregl.Marker | null>(null);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [activeStyleUrl, setActiveStyleUrl] = useState<string | any>(() => getEffectiveMapStyle());
  const [isUsingFallback, setIsUsingFallback] = useState(false);
  const [attributionText, setAttributionText] = useState(() => getEffectiveAttribution());

  // Device Geolocation State
  const [isLocating, setIsLocating] = useState(false);
  const [userLocation, setUserLocation] = useState<DevicePosition | null>(null);
  const [userLocationError, setUserLocationError] = useState<string | null>(null);
  const [isOutsideStudyArea, setIsOutsideStudyArea] = useState(false);

  // Spatial Filter States
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const [budgetFilter, setBudgetFilter] = useState<BudgetFilter>('all');
  const [typeFilter, setTypeFilter] = useState<AccomTypeFilter>('all');
  const [genderFilter, setGenderFilter] = useState<GenderPolicyFilter>('all');
  const [areaFilter, setAreaFilter] = useState<AreaFilter>('all');

  // Filter Active Count
  const hasActiveFilters =
    budgetFilter !== 'all' || typeFilter !== 'all' || genderFilter !== 'all' || areaFilter !== 'all';

  const resetFilters = useCallback(() => {
    setBudgetFilter('all');
    setTypeFilter('all');
    setGenderFilter('all');
    setAreaFilter('all');
  }, []);

  // Filter approved properties with valid coordinates according to active spatial filters
  const filteredProperties = useMemo(() => {
    return properties.filter((p) => {
      // Must be approved listing for student search
      if (p.verificationStatus !== 'approved') return false;

      const loc = p.location;
      if (!loc) return false;
      const lat = loc.publicLatitude ?? loc.latitude;
      const lng = loc.publicLongitude ?? loc.longitude;
      if (!isValidKanoCoordinate(lat, lng)) return false;

      // Area filter
      const propArea = p.area || p.neighbourhood;
      if (areaFilter !== 'all') {
        if (areaFilter === 'Dambare' && !propArea?.toLowerCase().includes('dambar')) return false;
        if (areaFilter === 'Rimin Gata' && !propArea?.toLowerCase().includes('rimin')) return false;
      }

      // Budget filter
      if (budgetFilter !== 'all') {
        const price = p.pricePerSession;
        if (budgetFilter === 'under150k' && price >= 150000) return false;
        if (budgetFilter === '150k-250k' && (price < 150000 || price > 250000)) return false;
        if (budgetFilter === '250k-400k' && (price < 250000 || price > 400000)) return false;
        if (budgetFilter === 'above400k' && price <= 400000) return false;
      }

      // Accommodation Type filter
      if (typeFilter !== 'all') {
        const pType = (p.propertyType || '').toLowerCase();
        if (typeFilter === 'self_contained' && !pType.includes('self')) return false;
        if (typeFilter === 'single_room' && !pType.includes('single')) return false;
        if (typeFilter === 'shared_apartment' && !pType.includes('shared')) return false;
        if (typeFilter === 'room_and_parlour' && !pType.includes('parlour')) return false;
      }

      // Gender policy filter
      if (genderFilter !== 'all') {
        const policy = (p.genderPolicy || '').toLowerCase();
        if (genderFilter === 'male_only' && policy !== 'male_only') return false;
        if (genderFilter === 'female_only' && policy !== 'female_only') return false;
        if (genderFilter === 'mixed' && policy !== 'mixed' && policy !== 'any') return false;
      }

      return true;
    });
  }, [properties, areaFilter, budgetFilter, typeFilter, genderFilter]);

  // Convert filtered properties into GeoJSON FeatureCollection for MapLibre Native Vector Clustering
  const geojsonData = useMemo(() => {
    const features = filteredProperties.map((prop) => {
      const loc = prop.location!;
      const lat = loc.publicLatitude ?? loc.latitude;
      const lng = loc.publicLongitude ?? loc.longitude;
      const priceK = Math.round(prop.pricePerSession / 1000);

      return {
        type: 'Feature' as const,
        id: prop.id,
        geometry: {
          type: 'Point' as const,
          coordinates: [lng, lat],
        },
        properties: {
          id: prop.id,
          title: prop.title,
          pricePerSession: prop.pricePerSession,
          priceK,
          area: prop.neighbourhood || prop.area || 'Danbare',
          propertyType: prop.propertyType || 'Self Contained',
          landlordVerified: Boolean(prop.landlordVerified),
          slug: prop.slug || prop.id,
          image: prop.images?.[0] || 'https://images.unsplash.com/photo-1555854877-bab0e564b8d5?w=300',
          lat,
          lng,
        },
      };
    });

    return {
      type: 'FeatureCollection' as const,
      features,
    };
  }, [filteredProperties]);

  // Subscribe to reactive Map Configuration changes (e.g., MapTiler key, style change)
  useEffect(() => {
    const unsubscribe = subscribeToMapConfig(() => {
      const newStyle = getEffectiveMapStyle();
      setActiveStyleUrl(newStyle);
      setIsUsingFallback(false);
      setAttributionText(getEffectiveAttribution());
      if (mapInstanceRef.current && newStyle) {
        try {
          mapInstanceRef.current.setStyle(newStyle);
        } catch (e) {
          console.warn('Could not update map style dynamically:', e);
        }
      }
    });
    return unsubscribe;
  }, []);

  // Configure Native MapLibre Vector Circle Clustering Sources and Layers
  const setupClusteringLayers = useCallback(
    (map: maplibregl.Map) => {
      // Clean up previous layers & sources if they exist
      const layerIds = [
        'cluster-count',
        'clusters',
        'unclustered-label',
        'unclustered-point-selected',
        'unclustered-point',
      ];
      layerIds.forEach((id) => {
        if (map.getLayer(id)) map.removeLayer(id);
      });
      if (map.getSource('outpost-properties')) {
        map.removeSource('outpost-properties');
      }

      // Add clustered GeoJSON source
      map.addSource('outpost-properties', {
        type: 'geojson',
        data: geojsonData,
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });

      // 1. Cluster Circles Layer
      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'outpost-properties',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step',
            ['get', 'point_count'],
            '#10b981', // emerald-500 (< 5)
            5,
            '#059669', // emerald-600 (5-15)
            15,
            '#047857', // emerald-700 (> 15)
          ],
          'circle-radius': [
            'step',
            ['get', 'point_count'],
            18,
            5,
            24,
            15,
            30,
          ],
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-opacity': 0.95,
        },
      });

      // 2. Cluster Count Text Layer
      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'outpost-properties',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': 12,
        },
        paint: {
          'text-color': '#ffffff',
        },
      });

      // 3. Unclustered Single Accommodation Points
      map.addLayer({
        id: 'unclustered-point',
        type: 'circle',
        source: 'outpost-properties',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': '#059669',
          'circle-radius': 8,
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#ffffff',
        },
      });

      // 4. Selected Property Outer Ring (highlight)
      map.addLayer({
        id: 'unclustered-point-selected',
        type: 'circle',
        source: 'outpost-properties',
        filter: [
          'all',
          ['!', ['has', 'point_count']],
          ['==', ['get', 'id'], selectedPropertyId || ''],
        ],
        paint: {
          'circle-color': '#10b981',
          'circle-radius': 14,
          'circle-stroke-width': 3.5,
          'circle-stroke-color': '#ffffff',
        },
      });

      // 5. Unclustered Price Label
      map.addLayer({
        id: 'unclustered-label',
        type: 'symbol',
        source: 'outpost-properties',
        filter: ['!', ['has', 'point_count']],
        layout: {
          'text-field': ['concat', '₦', ['to-string', ['get', 'priceK']], 'k'],
          'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
          'text-size': 11,
          'text-offset': [0, 1.4],
          'text-anchor': 'top',
        },
        paint: {
          'text-color': '#0f172a',
          'text-halo-color': '#ffffff',
          'text-halo-width': 2,
        },
      });
    },
    [geojsonData, selectedPropertyId]
  );

  // Opens rich interactive popup on unclustered accommodation click
  const showAccommodationPopup = useCallback(
    (coordinates: [number, number], propData: any) => {
      const map = mapInstanceRef.current;
      if (!map) return;

      if (activePopupRef.current) {
        activePopupRef.current.remove();
        activePopupRef.current = null;
      }

      const [lng, lat] = coordinates;
      const initialProximity = walkingRouteService.getImmediateDualGateProximity(lat, lng);
      const landmarkOrientation = getNearestLandmarkOrientation(lat, lng);
      const googleMapsUrl = getGoogleMapsWalkingUrl(lat, lng);
      const osmUrl = getOpenStreetMapWalkingUrl(lat, lng);

      const popupContainer = document.createElement('div');
      popupContainer.className = 'outpost-map-popup p-1 max-w-[280px] text-left';

      const renderPopupContent = (proximity: DualGateProximity) => {
        popupContainer.innerHTML = `
          <div class="space-y-2">
            <div class="relative w-full h-24 rounded-lg overflow-hidden bg-slate-100">
              <img
                src="${escapeHtml(propData.image)}"
                alt="${escapeHtml(propData.title)}"
                class="w-full h-full object-cover"
                loading="lazy"
              />
              <span class="absolute top-1.5 right-1.5 px-2 py-0.5 rounded-full bg-slate-900/80 text-white text-[10px] font-bold backdrop-blur-xs">
                ₦${propData.pricePerSession ? Number(propData.pricePerSession).toLocaleString() : ''}/session
              </span>
            </div>

            <div>
              <div class="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 truncate">
                <span>${escapeHtml(propData.propertyType || 'Accommodation')}</span>
                <span>•</span>
                <span>${escapeHtml(propData.area)}</span>
              </div>
              <h4 class="text-xs font-bold text-slate-900 line-clamp-1 leading-snug">
                ${escapeHtml(propData.title)}
              </h4>
            </div>

            <!-- Landmark Orientation -->
            ${
              landmarkOrientation
                ? `
              <div class="px-2 py-1 rounded-md bg-slate-50 border border-slate-200/80 text-[10px] text-slate-600 flex items-center gap-1.5">
                <svg class="w-3 h-3 text-emerald-600 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"/><path d="m16.2 7.8-2 6.4-6.4 2 2-6.4z"/>
                </svg>
                <span class="truncate">${escapeHtml(landmarkOrientation.formattedDescription)}</span>
              </div>
            `
                : ''
            }

            <!-- Dual BUK Gate Walking Proximity -->
            <div class="space-y-1 pt-1 border-t border-slate-100 text-[10px]">
              <div class="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Walking Distance to Campus</div>
              <div class="grid grid-cols-2 gap-1.5">
                <div class="p-1.5 rounded-md bg-emerald-50/70 border border-emerald-100 flex flex-col">
                  <span class="font-bold text-emerald-900">Gate 1</span>
                  <span class="text-emerald-700 font-semibold truncate">${escapeHtml(proximity.gate1.displayText)}</span>
                </div>
                <div class="p-1.5 rounded-md bg-emerald-50/70 border border-emerald-100 flex flex-col">
                  <span class="font-bold text-emerald-900">Gate 2</span>
                  <span class="text-emerald-700 font-semibold truncate">${escapeHtml(proximity.gate2.displayText)}</span>
                </div>
              </div>
            </div>

            <!-- Actions -->
            <div class="pt-1.5 flex items-center gap-1.5">
              <a
                href="/properties/${escapeHtml(propData.slug || propData.id)}"
                class="flex-1 py-1.5 px-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-center text-[11px] font-bold shadow-xs transition inline-flex items-center justify-center gap-1"
              >
                <span>View Details</span>
                <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
              </a>
              ${
                googleMapsUrl
                  ? `
                <a
                  href="${escapeHtml(googleMapsUrl)}"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open pedestrian walking route in Google Maps"
                  class="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
                >
                  <svg class="w-3.5 h-3.5 text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="3 11 22 2 13 21 11 13 3 11"/>
                  </svg>
                </a>
              `
                  : ''
              }
            </div>
          </div>
        `;
      };

      renderPopupContent(initialProximity);

      const popup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: false,
        maxWidth: '300px',
        anchor: 'bottom',
        offset: [0, -10],
      })
        .setLngLat([lng, lat])
        .setDOMContent(popupContainer)
        .addTo(map);

      activePopupRef.current = popup;

      // Lazy load async OSRM pedestrian routing if initial was straight-line
      if (!initialProximity.gate1.isPedestrianRoute || !initialProximity.gate2.isPedestrianRoute) {
        walkingRouteService.calculateDualGateProximity(lat, lng).then((resolvedProximity) => {
          if (activePopupRef.current === popup) {
            renderPopupContent(resolvedProximity);
          }
        });
      }
    },
    []
  );

  // Initialize MapLibre GL
  useEffect(() => {
    if (!mapContainerRef.current) return;

    let isMounted = true;
    let map: maplibregl.Map | null = null;

    try {
      const styleToLoad = activeStyleUrl;

      if (!styleToLoad) {
        setMapError('Map configuration is incomplete. Please contact the administrator.');
        return;
      }

      map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: styleToLoad,
        center: mapConfig.defaultCenter,
        zoom: mapConfig.defaultZoom,
        minZoom: 11,
        maxZoom: 18,
        attributionControl: false,
      });

      // Navigation controls
      map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');

      map.on('load', () => {
        if (!isMounted || !map) return;
        setMapLoaded(true);
        setMapError(null);
        map.resize();
        applyMapTilerBuildingsLayer(map);
        setupClusteringLayers(map);
      });

      map.on('style.load', () => {
        if (!isMounted || !map) return;
        applyMapTilerBuildingsLayer(map);
        setupClusteringLayers(map);
      });

      // Click on Vector Circle Cluster -> Smooth Zoom Expansion
      map.on('click', 'clusters', (e) => {
        if (!map) return;
        const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
        const clusterId = features[0]?.properties?.cluster_id;
        if (clusterId === undefined) return;

        const source = map.getSource('outpost-properties') as maplibregl.GeoJSONSource;
        source
          .getClusterExpansionZoom(clusterId)
          .then((zoom) => {
            if (zoom === undefined || isNaN(zoom)) return;
            const coordinates = (features[0].geometry as any).coordinates.slice();
            map.easeTo({
              center: coordinates,
              zoom: zoom + 0.5,
              duration: 500,
            });
          })
          .catch((err) => {
            console.warn('Could not expand cluster:', err);
          });
      });

      // Click on Unclustered Single Point -> Open Rich Popup
      map.on('click', 'unclustered-point', (e) => {
        if (!map) return;
        const features = map.queryRenderedFeatures(e.point, { layers: ['unclustered-point'] });
        if (!features.length) return;
        const feature = features[0];
        const coordinates = (feature.geometry as any).coordinates.slice();
        const propProps = feature.properties;

        showAccommodationPopup(coordinates, propProps);
        if (propProps?.id) {
          onSelectProperty?.(propProps.id);
        }
      });

      // Interactive cursor styles
      map.on('mouseenter', 'clusters', () => {
        if (map) map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'clusters', () => {
        if (map) map.getCanvas().style.cursor = '';
      });
      map.on('mouseenter', 'unclustered-point', () => {
        if (map) map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'unclustered-point', () => {
        if (map) map.getCanvas().style.cursor = '';
      });

      map.on('error', (e) => {
        console.warn('MapLibre style/tile notice:', e);
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

    const resizeObserver = new ResizeObserver(() => {
      mapInstanceRef.current?.resize();
    });
    if (mapContainerRef.current) {
      resizeObserver.observe(mapContainerRef.current);
    }

    return () => {
      isMounted = false;
      resizeObserver.disconnect();
      if (activePopupRef.current) {
        activePopupRef.current.remove();
        activePopupRef.current = null;
      }
      landmarkMarkersRef.current.forEach((m) => m.remove());
      landmarkMarkersRef.current = [];
      if (userLocationMarkerRef.current) {
        userLocationMarkerRef.current.remove();
        userLocationMarkerRef.current = null;
      }
      map?.remove();
      mapInstanceRef.current = null;
      setMapLoaded(false);
    };
  }, [activeStyleUrl, isUsingFallback, onSelectProperty, setupClusteringLayers, showAccommodationPopup]);

  // Synchronize GeoJSON data whenever filteredProperties change
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) return;

    const source = map.getSource('outpost-properties') as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(geojsonData);
    } else {
      setupClusteringLayers(map);
    }

    // Update filter on selected ring layer
    if (map.getLayer('unclustered-point-selected')) {
      map.setFilter('unclustered-point-selected', [
        'all',
        ['!', ['has', 'point_count']],
        ['==', ['get', 'id'], selectedPropertyId || ''],
      ]);
    }
  }, [geojsonData, mapLoaded, selectedPropertyId, setupClusteringLayers]);

  // Add BUK New Campus Gates & Reference Landmarks
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded) return;

    landmarkMarkersRef.current.forEach((m) => m.remove());
    landmarkMarkersRef.current = [];

    // 1. BUK New Site Gate 1 Landmark Pin (Main Gate, Gwarzo Road)
    const gate1El = document.createElement('div');
    gate1El.className = 'group relative flex flex-col items-center cursor-pointer pointer-events-auto';
    gate1El.innerHTML = `
      <div class="px-2 py-1 bg-slate-900/90 text-white text-[11px] font-bold rounded-lg shadow-md border border-slate-700/80 flex items-center gap-1 backdrop-blur-xs">
        <svg class="w-3.5 h-3.5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
          <path d="M6 12v5c3 3 9 3 12 0v-5"/>
        </svg>
        <span>BUK Gate 1 (Main)</span>
      </div>
      <div class="w-2 h-2 bg-slate-900 rotate-45 -mt-1 border-r border-b border-slate-700"></div>
    `;
    const gate1Marker = new maplibregl.Marker({ element: gate1El, anchor: 'bottom' })
      .setLngLat([BUK_NEW_CAMPUS_GATE_1.longitude, BUK_NEW_CAMPUS_GATE_1.latitude])
      .addTo(map);
    landmarkMarkersRef.current.push(gate1Marker);

    // 2. BUK New Site Gate 2 Landmark Pin (Southern Corridor)
    const gate2El = document.createElement('div');
    gate2El.className = 'group relative flex flex-col items-center cursor-pointer pointer-events-auto';
    gate2El.innerHTML = `
      <div class="px-2 py-1 bg-slate-900/90 text-white text-[11px] font-bold rounded-lg shadow-md border border-slate-700/80 flex items-center gap-1 backdrop-blur-xs">
        <svg class="w-3.5 h-3.5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
          <path d="M6 12v5c3 3 9 3 12 0v-5"/>
        </svg>
        <span>BUK Gate 2</span>
      </div>
      <div class="w-2 h-2 bg-slate-900 rotate-45 -mt-1 border-r border-b border-slate-700"></div>
    `;
    const gate2Marker = new maplibregl.Marker({ element: gate2El, anchor: 'bottom' })
      .setLngLat([BUK_NEW_CAMPUS_GATE_2.longitude, BUK_NEW_CAMPUS_GATE_2.latitude])
      .addTo(map);
    landmarkMarkersRef.current.push(gate2Marker);

    // 3. Danbare Market Reference Badge
    const danbareEl = document.createElement('div');
    danbareEl.className = 'pointer-events-none opacity-85';
    danbareEl.innerHTML = `
      <div class="px-2 py-0.5 rounded-full bg-emerald-100/90 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 text-[10px] font-semibold tracking-wide border border-emerald-300/80 uppercase shadow-xs">
        Danbare Market Hub
      </div>
    `;
    const danbareMarker = new maplibregl.Marker({ element: danbareEl, anchor: 'center' })
      .setLngLat([LOCAL_REFERENCE_LANDMARKS[2].longitude, LOCAL_REFERENCE_LANDMARKS[2].latitude])
      .addTo(map);
    landmarkMarkersRef.current.push(danbareMarker);

    // 4. Rimin Gata Settlement Centre Reference Badge
    const riminEl = document.createElement('div');
    riminEl.className = 'pointer-events-none opacity-85';
    riminEl.innerHTML = `
      <div class="px-2 py-0.5 rounded-full bg-blue-100/90 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300 text-[10px] font-semibold tracking-wide border border-blue-300/80 uppercase shadow-xs">
        Rimin Gata Settlement
      </div>
    `;
    const riminMarker = new maplibregl.Marker({ element: riminEl, anchor: 'center' })
      .setLngLat([LOCAL_REFERENCE_LANDMARKS[3].longitude, LOCAL_REFERENCE_LANDMARKS[3].latitude])
      .addTo(map);
    landmarkMarkersRef.current.push(riminMarker);
  }, [mapLoaded]);

  // Smooth easeTo when selected property changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded || !selectedPropertyId) return;

    const prop = properties.find((p) => p.id === selectedPropertyId);
    if (!prop?.location) return;

    const lat = prop.location.publicLatitude ?? prop.location.latitude;
    const lng = prop.location.publicLongitude ?? prop.location.longitude;

    if (isValidKanoCoordinate(lat, lng)) {
      map.easeTo({
        center: [lng, lat],
        zoom: Math.max(map.getZoom(), 15),
        duration: 600,
      });

      // Show popup for selected accommodation
      showAccommodationPopup([lng, lat], {
        id: prop.id,
        title: prop.title,
        pricePerSession: prop.pricePerSession,
        area: prop.neighbourhood || prop.area || 'Danbare',
        propertyType: prop.propertyType,
        slug: prop.slug || prop.id,
        image: prop.images?.[0] || 'https://images.unsplash.com/photo-1555854877-bab0e564b8d5?w=300',
      });
    }
  }, [selectedPropertyId, mapLoaded, properties, showAccommodationPopup]);

  // Zoom-to-fit when requested on initial load
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapLoaded || !zoomToFit || filteredProperties.length === 0) return;

    const bounds = new maplibregl.LngLatBounds();
    filteredProperties.forEach((p) => {
      const loc = p.location!;
      const lat = loc.publicLatitude ?? loc.latitude;
      const lng = loc.publicLongitude ?? loc.longitude;
      if (isValidKanoCoordinate(lat, lng)) {
        bounds.extend([lng, lat]);
      }
    });
    bounds.extend([BUK_NEW_CAMPUS_GATE_1.longitude, BUK_NEW_CAMPUS_GATE_1.latitude]);
    bounds.extend([BUK_NEW_CAMPUS_GATE_2.longitude, BUK_NEW_CAMPUS_GATE_2.latitude]);

    map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 800 });
  }, [mapLoaded, zoomToFit, filteredProperties]);

  const handleResetView = () => {
    if (activePopupRef.current) {
      activePopupRef.current.remove();
      activePopupRef.current = null;
    }
    mapInstanceRef.current?.easeTo({
      center: mapConfig.defaultCenter,
      zoom: mapConfig.defaultZoom,
      pitch: 0,
      bearing: 0,
      duration: 600,
    });
  };

  const handleUseCurrentLocation = async () => {
    setUserLocationError(null);
    setIsOutsideStudyArea(false);
    setIsLocating(true);

    try {
      const position = await requestCurrentDevicePosition();
      setUserLocation(position);

      const map = mapInstanceRef.current;
      if (map) {
        if (userLocationMarkerRef.current) {
          userLocationMarkerRef.current.remove();
          userLocationMarkerRef.current = null;
        }

        const el = document.createElement('div');
        el.className = 'outpost-user-location-marker relative flex items-center justify-center';
        el.setAttribute('role', 'img');
        el.setAttribute('aria-label', 'Your current location');
        el.innerHTML = `
          <div class="absolute w-8 h-8 rounded-full bg-blue-500/30 animate-ping"></div>
          <div class="relative w-4 h-4 rounded-full bg-blue-600 border-2 border-white shadow-lg flex items-center justify-center">
            <div class="w-1.5 h-1.5 rounded-full bg-white"></div>
          </div>
        `;

        const marker = new maplibregl.Marker({
          element: el,
          anchor: 'center',
        })
          .setLngLat([position.longitude, position.latitude])
          .addTo(map);

        userLocationMarkerRef.current = marker;

        map.flyTo({
          center: [position.longitude, position.latitude],
          zoom: 16,
          essential: true,
        });

        const distDambare = calculateDistanceKm(
          position.latitude,
          position.longitude,
          AREA_CENTERS.Dambare.latitude,
          AREA_CENTERS.Dambare.longitude
        );
        const distRiminGata = calculateDistanceKm(
          position.latitude,
          position.longitude,
          AREA_CENTERS['Rimin Gata'].latitude,
          AREA_CENTERS['Rimin Gata'].longitude
        );

        if (distDambare > 8 && distRiminGata > 8) {
          setIsOutsideStudyArea(true);
        }
      }
    } catch (err: any) {
      const geoErr = err as GeolocationErrorResult;
      setUserLocationError(geoErr.message || 'Unable to retrieve device location.');
    } finally {
      setIsLocating(false);
    }
  };

  const selectedProp = properties.find((p) => p.id === selectedPropertyId);

  return (
    <div
      className={`relative w-full rounded-2xl overflow-hidden bg-slate-100 dark:bg-slate-950 border border-slate-200/90 dark:border-slate-800 shadow-inner flex flex-col ${className}`}
      style={{ height }}
    >
      {/* Map Canvas */}
      <div ref={mapContainerRef} className="w-full h-full flex-1" />

      {/* Attribution & Carto Warning */}
      <div className="absolute bottom-2 left-2 z-10 flex flex-col gap-1 text-[10px] pointer-events-auto max-w-xs">
        {isUsingFallback && (
          <div className="px-2 py-0.5 rounded-md bg-amber-500/90 text-white font-medium flex items-center gap-1 shadow-xs">
            <AlertTriangle className="w-3 h-3 flex-shrink-0" />
            <span>OpenStreetMap carto tiles active</span>
          </div>
        )}
        <div className="px-2 py-1 rounded-md bg-white/90 dark:bg-slate-900/90 text-slate-600 dark:text-slate-300 backdrop-blur-xs border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center gap-1.5">
          <Layers className="w-3 h-3 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
          <span className="truncate">{attributionText}</span>
        </div>
      </div>

      {/* Top Map Action Bar */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2 flex-wrap max-w-[calc(100%-20px)]">
        <button
          onClick={handleResetView}
          title="Reset map view to Danbare / BUK corridor"
          className="p-2 rounded-xl bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 shadow-md hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          <span className="hidden sm:inline">Reset View</span>
        </button>

        <button
          type="button"
          onClick={handleUseCurrentLocation}
          disabled={isLocating}
          title="Find accommodations near my current device location"
          aria-label="Use my current location"
          className="p-2 sm:px-3 rounded-xl bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 shadow-md hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-60"
        >
          {isLocating ? (
            <>
              <span className="w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              <span className="hidden sm:inline">Locating...</span>
            </>
          ) : (
            <>
              <Navigation className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span className="hidden sm:inline">My Location</span>
            </>
          )}
        </button>

        {/* Spatial Filter Bar Toggle (Visible if multiple properties) */}
        {showFilters && properties.length > 1 && (
          <button
            type="button"
            onClick={() => setIsFilterPanelOpen((prev) => !prev)}
            aria-expanded={isFilterPanelOpen}
            className={`p-2 sm:px-3 rounded-xl border shadow-md text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
              hasActiveFilters
                ? 'bg-emerald-600 text-white border-emerald-500'
                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Map Filters</span>
            {hasActiveFilters && (
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            )}
          </button>
        )}

        <MapStyleSelector />

        <div className="hidden lg:flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white/95 dark:bg-slate-900/95 text-slate-600 dark:text-slate-300 text-xs font-semibold border border-slate-200 dark:border-slate-800 shadow-md backdrop-blur-xs">
          <MapPin className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          <span>BUK New Site Corridor</span>
        </div>
      </div>

      {/* Floating Spatial Filter Controls Panel */}
      {showFilters && isFilterPanelOpen && (
        <div className="absolute top-16 left-3 right-3 sm:right-auto sm:w-96 z-20 pointer-events-auto bg-white/95 dark:bg-slate-900/95 backdrop-blur-md p-4 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-xl space-y-3 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-white">
              <Filter className="w-3.5 h-3.5 text-emerald-600" />
              <span>Spatial Map Filters</span>
            </div>
            <div className="flex items-center gap-2">
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 cursor-pointer"
                >
                  Clear all
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsFilterPanelOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                aria-label="Close filter panel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 text-xs">
            {/* Area Corridor */}
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">Corridor</label>
              <select
                value={areaFilter}
                onChange={(e) => setAreaFilter(e.target.value as AreaFilter)}
                className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:ring-1 focus:ring-emerald-500 outline-none"
              >
                <option value="all">All Corridors</option>
                <option value="Dambare">Danbare (Main Gate)</option>
                <option value="Rimin Gata">Rimin Gata (West)</option>
              </select>
            </div>

            {/* Budget */}
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">Budget / Session</label>
              <select
                value={budgetFilter}
                onChange={(e) => setBudgetFilter(e.target.value as BudgetFilter)}
                className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:ring-1 focus:ring-emerald-500 outline-none"
              >
                <option value="all">Any Budget</option>
                <option value="under150k">&lt; ₦150k</option>
                <option value="150k-250k">₦150k - ₦250k</option>
                <option value="250k-400k">₦250k - ₦400k</option>
                <option value="above400k">&gt; ₦400k</option>
              </select>
            </div>

            {/* Accommodation Type */}
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">Accommodation Type</label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as AccomTypeFilter)}
                className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:ring-1 focus:ring-emerald-500 outline-none"
              >
                <option value="all">All Room Types</option>
                <option value="self_contained">Self Contained</option>
                <option value="single_room">Single Room</option>
                <option value="shared_apartment">Shared Apartment</option>
                <option value="room_and_parlour">Room & Parlour</option>
              </select>
            </div>

            {/* Gender Policy */}
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 mb-1">Gender Policy</label>
              <select
                value={genderFilter}
                onChange={(e) => setGenderFilter(e.target.value as GenderPolicyFilter)}
                className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:ring-1 focus:ring-emerald-500 outline-none"
              >
                <option value="all">Any Policy</option>
                <option value="male_only">Male Only</option>
                <option value="female_only">Female Only</option>
                <option value="mixed">Mixed / Any</option>
              </select>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500">
            <span>
              Showing <strong className="text-emerald-600 font-bold">{filteredProperties.length}</strong> of{' '}
              {properties.length} verified pins
            </span>
            <button
              type="button"
              onClick={() => setIsFilterPanelOpen(false)}
              className="px-2.5 py-1 bg-emerald-600 text-white rounded-md font-semibold text-[10px] hover:bg-emerald-500 cursor-pointer"
            >
              Apply to Map
            </button>
          </div>
        </div>
      )}

      {/* Geolocation Feedback / Boundary Alert Banner */}
      {userLocationError && (
        <div className="absolute top-16 left-3 right-3 sm:right-auto sm:max-w-md z-20 pointer-events-auto animate-in fade-in slide-in-from-top-2">
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/90 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200 shadow-lg text-xs flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold">Location Access</p>
              <p className="mt-0.5 text-[11px] leading-relaxed">{userLocationError}</p>
            </div>
            <button
              type="button"
              onClick={() => setUserLocationError(null)}
              className="text-rose-500 hover:text-rose-700 p-0.5 rounded cursor-pointer"
              aria-label="Dismiss error"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {isOutsideStudyArea && (
        <div className="absolute top-16 left-3 right-3 sm:right-auto sm:max-w-md z-20 pointer-events-auto animate-in fade-in slide-in-from-top-2">
          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/90 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200 shadow-lg text-xs flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold">Outside Study Area</p>
              <p className="mt-0.5 text-[11px] leading-relaxed">
                Your device is outside the Danbare and Rimin Gata study area. OUTPOST focuses exclusively on off-campus accommodation near BUK New Campus.
              </p>
              <button
                type="button"
                onClick={() => {
                  handleResetView();
                  setIsOutsideStudyArea(false);
                }}
                className="mt-2 px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[11px] font-semibold cursor-pointer inline-flex items-center gap-1 shadow-xs"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Return to Danbare / Rimin Gata</span>
              </button>
            </div>
            <button
              type="button"
              onClick={() => setIsOutsideStudyArea(false)}
              className="text-amber-500 hover:text-amber-700 p-0.5 rounded cursor-pointer"
              aria-label="Dismiss notice"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

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
