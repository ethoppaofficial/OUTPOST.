import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { maplibregl } from '../../infrastructure/config/maplibreSetup';
import type { GeoJSONSource, Map as MapInstance, Marker, Popup } from 'maplibre-gl';
import { supabase } from '../../infrastructure/supabase/supabaseClient';
import { propertyService } from '../../application/services/propertyService';
import {
  mapConfig,
  subscribeToMapConfig,
  applyMapTilerBuildingsLayer,
} from '../../infrastructure/config/mapConfig';
import { MapStyleSelector } from './MapStyleSelector';
import { AlertTriangle, ExternalLink, Navigation, RotateCcw, X, Compass } from 'lucide-react';
import {
  requestCurrentDevicePosition,
  DevicePosition,
  GeolocationErrorResult,
} from '../../application/services/geolocationService';
import {
  calculateDistanceKm,
  AREA_CENTERS,
  getNearestLandmarkOrientation,
} from '../../domain/geoUtils';
import { walkingRouteService } from '../../application/services/walkingRouteService';
import { getGoogleMapsWalkingUrl } from '../../application/utils/urlUtils';

export type HousingArea = 'Dambare' | 'Rimin Gata';

export interface VerifiedMapProperty {
  id: string;
  title: string;
  area: HousingArea;
  publicLatitude: number;
  publicLongitude: number;
  publicLocationPrecision?:
    | 'exact_building'
    | 'nearby_building'
    | 'street'
    | 'neighbourhood';
  publicLocationLabel?: string;
  propertyType?: string;
  accommodationType?: string;
  pricePerSession?: number;
  currency?: string;
  availableSpaces?: number;
  totalCapacity?: number;
  images?: string[];
  slug?: string;
  fullAddress?: string;
  nearestLandmark?: string;
  directions?: string;
}

export interface StudentVerifiedPropertiesMapProps {
  mapStyleUrl?: string;
  mapAttribution?: string;
  initialArea?: HousingArea;
  areaViewports: Record<
    HousingArea,
    { center: [number, number]; zoom: number }
  >;
  onPropertyOpen?: (property: VerifiedMapProperty) => void;
}

const CLUSTER_SOURCE_ID = 'outpost-verified-properties';
const CLUSTER_LAYER_IDS = [
  'cluster-count',
  'clusters',
  'unclustered-label',
  'unclustered-point-selected',
  'unclustered-point',
] as const;

function isValidCoordinate(latitude: unknown, longitude: unknown): boolean {
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatPrice(price?: number, currency = 'NGN'): string {
  if (typeof price !== 'number') return 'Contact landlord';
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(price);
}

export const StudentVerifiedPropertiesMap: React.FC<
  StudentVerifiedPropertiesMapProps
> = ({
  mapStyleUrl,
  mapAttribution = mapConfig.attribution,
  initialArea = 'Dambare',
  areaViewports,
  onPropertyOpen,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const activePopupRef = useRef<Popup | null>(null);
  const userLocationMarkerRef = useRef<Marker | null>(null);

  const [area, setArea] = useState<HousingArea>(initialArea);
  const [properties, setProperties] = useState<VerifiedMapProperty[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fallbackAppliedRef = useRef(false);

  // Device Geolocation State
  const [isLocating, setIsLocating] = useState(false);
  const [userLocation, setUserLocation] = useState<DevicePosition | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isOutsideStudyArea, setIsOutsideStudyArea] = useState(false);

  const activeStyle = mapStyleUrl || mapConfig.styleUrl;

  const visibleProperties = useMemo(
    () =>
      properties.filter(
        (property) =>
          property.area === area &&
          (typeof property.availableSpaces !== 'number' || property.availableSpaces > 0)
      ),
    [area, properties],
  );

  const visiblePropertiesRef = useRef<VerifiedMapProperty[]>(visibleProperties);
  visiblePropertiesRef.current = visibleProperties;

  const onPropertyOpenRef = useRef(onPropertyOpen);
  onPropertyOpenRef.current = onPropertyOpen;

  const geojsonData = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: visibleProperties.map((property) => ({
        type: 'Feature' as const,
        id: property.id,
        geometry: {
          type: 'Point' as const,
          coordinates: [property.publicLongitude, property.publicLatitude],
        },
        properties: {
          id: property.id,
          title: property.title,
          area: property.area,
          propertyType: property.propertyType || 'Hostel',
          accommodationType: property.accommodationType || 'Student unit',
          pricePerSession: typeof property.pricePerSession === 'number' ? property.pricePerSession : -1,
          priceK:
            typeof property.pricePerSession === 'number'
              ? Math.round(property.pricePerSession / 1000)
              : -1,
          currency: property.currency || 'NGN',
          availableSpaces:
            typeof property.availableSpaces === 'number' ? property.availableSpaces : -1,
          nearestLandmark: property.nearestLandmark || '',
          directions: property.directions || '',
          lat: property.publicLatitude,
          lng: property.publicLongitude,
        },
      })),
    }),
    [visibleProperties],
  );

  const geojsonDataRef = useRef(geojsonData);
  geojsonDataRef.current = geojsonData;

  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const showPropertyPopup = useCallback((property: VerifiedMapProperty) => {
    const map = mapRef.current;
    if (!map) return;

    if (activePopupRef.current) {
      activePopupRef.current.remove();
      activePopupRef.current = null;
    }

    const landmarkHtml = property.nearestLandmark
      ? `<div class="text-[10px] text-slate-500">Landmark: <span class="text-slate-700 font-medium">${escapeHtml(property.nearestLandmark)}</span></div>`
      : '';

    const spacesHtml =
      property.availableSpaces !== undefined
        ? `<span class="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">${property.availableSpaces} spaces left</span>`
        : '';

    const directionsHtml = property.directions
      ? `<div class="text-[10px] text-slate-500 line-clamp-1 italic">${escapeHtml(property.directions)}</div>`
      : '';

    const proximity = walkingRouteService.getImmediateDualGateProximity(
      property.publicLatitude,
      property.publicLongitude
    );
    const orientation = getNearestLandmarkOrientation(
      property.publicLatitude,
      property.publicLongitude
    );
    const googleMapsUrl = getGoogleMapsWalkingUrl(
      property.publicLatitude,
      property.publicLongitude
    );

    const orientationHtml = orientation
      ? `<div class="px-2 py-1 rounded bg-slate-50 border border-slate-200/80 text-[10px] text-slate-600 flex items-center gap-1">
          <span class="text-emerald-600">🧭</span>
          <span>${escapeHtml(orientation.formattedDescription)}</span>
        </div>`
      : '';

    const gatesHtml = `
      <div class="space-y-1 pt-1 border-t border-slate-100 text-[10px]">
        <div class="text-[9px] font-bold text-slate-400 uppercase tracking-wider">BUK Campus Access</div>
        <div class="grid grid-cols-2 gap-1.5">
          <div class="p-1 rounded bg-emerald-50 border border-emerald-100 text-[10px]">
            <div class="font-bold text-emerald-900">Gate 1</div>
            <div class="text-emerald-700 font-semibold">${escapeHtml(proximity.gate1.displayText)}</div>
          </div>
          <div class="p-1 rounded bg-blue-50 border border-blue-100 text-[10px]">
            <div class="font-bold text-blue-900">Gate 2</div>
            <div class="text-blue-700 font-semibold">${escapeHtml(proximity.gate2.displayText)}</div>
          </div>
        </div>
      </div>
    `;

    const popupContainer = document.createElement('div');
    popupContainer.className = 'p-2 space-y-1.5 text-left';
    popupContainer.innerHTML = `
      <strong class="text-xs font-bold text-slate-900 block leading-tight">${escapeHtml(property.title)}</strong>
      <div class="text-[11px] text-slate-500 font-medium">${escapeHtml(property.area)}, Kano State</div>
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs font-bold text-emerald-600">${escapeHtml(formatPrice(property.pricePerSession, property.currency))}</span>
        ${spacesHtml}
      </div>
      ${orientationHtml}
      ${gatesHtml}
      ${landmarkHtml}
      ${directionsHtml}
      <div class="flex items-center gap-1.5 pt-1">
        <button type="button" data-property-id="${escapeHtml(property.id)}" class="outpost-popup-details flex-1 py-1.5 px-2 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-500 transition cursor-pointer">View details</button>
        ${googleMapsUrl ? `<a href="${escapeHtml(googleMapsUrl)}" target="_blank" rel="noopener noreferrer" title="Walking route in Google Maps" class="p-1.5 rounded-lg border border-slate-200 text-blue-600 hover:bg-slate-50 text-xs">🚶</a>` : ''}
      </div>
    `;

    const detailsBtn = popupContainer.querySelector<HTMLButtonElement>('[data-property-id]');
    detailsBtn?.addEventListener('click', () => onPropertyOpenRef.current?.(property));

    const popup = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: false,
      maxWidth: '280px',
      offset: [0, -10],
    })
      .setLngLat([property.publicLongitude, property.publicLatitude])
      .setDOMContent(popupContainer)
      .addTo(map);

    activePopupRef.current = popup;
  }, []);

  const setupClusteringLayers = useCallback((map: MapInstance) => {
    for (const id of CLUSTER_LAYER_IDS) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    if (map.getSource(CLUSTER_SOURCE_ID)) {
      map.removeSource(CLUSTER_SOURCE_ID);
    }

    map.addSource(CLUSTER_SOURCE_ID, {
      type: 'geojson',
      data: geojsonDataRef.current,
      cluster: true,
      clusterMaxZoom: 16,
      clusterRadius: 55,
    });

    map.addLayer({
      id: 'clusters',
      type: 'circle',
      source: CLUSTER_SOURCE_ID,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': [
          'step',
          ['get', 'point_count'],
          '#10b981',
          5,
          '#059669',
          15,
          '#047857',
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

    map.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: CLUSTER_SOURCE_ID,
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

    map.addLayer({
      id: 'unclustered-point',
      type: 'circle',
      source: CLUSTER_SOURCE_ID,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': '#059669',
        'circle-radius': 8.5,
        'circle-stroke-width': 2.5,
        'circle-stroke-color': '#ffffff',
      },
    });

    map.addLayer({
      id: 'unclustered-point-selected',
      type: 'circle',
      source: CLUSTER_SOURCE_ID,
      filter: [
        'all',
        ['!', ['has', 'point_count']],
        ['==', ['get', 'id'], selectedIdRef.current || ''],
      ],
      paint: {
        'circle-color': '#10b981',
        'circle-radius': 13.5,
        'circle-stroke-width': 3.5,
        'circle-stroke-color': '#ffffff',
      },
    });

    map.addLayer({
      id: 'unclustered-label',
      type: 'symbol',
      source: CLUSTER_SOURCE_ID,
      filter: ['all', ['!', ['has', 'point_count']], ['>', ['get', 'priceK'], 0]],
      layout: {
        'text-field': ['concat', '₦', ['to-string', ['get', 'priceK']], 'k'],
        'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
        'text-size': 11,
        'text-offset': [0, 1.35],
        'text-anchor': 'top',
      },
      paint: {
        'text-color': '#0f172a',
        'text-halo-color': '#ffffff',
        'text-halo-width': 2,
      },
    });
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToMapConfig(() => {
      if (mapRef.current && mapConfig.styleUrl) {
        try {
          fallbackAppliedRef.current = false;
          mapRef.current.setStyle(mapConfig.styleUrl as any);
        } catch (e) {
          console.warn('Could not update map style dynamically:', e);
        }
      }
    });
    return unsubscribe;
  }, []);

  // PostgreSQL Row Level Security enforces this same public visibility contract.
  useEffect(() => {
    setLoading(true);
    setError(null);

    const loadFallbackFromRepository = () => {
      try {
        const localProps = propertyService
          .getAllProperties()
          .filter(
            (p) =>
              p.verificationStatus === 'approved' &&
              (p.locationVerificationStatus === 'verified' ||
                p.location?.verificationStatus === 'verified') &&
              p.isActive !== false &&
              (typeof p.availableSpaces !== 'number' || p.availableSpaces > 0) &&
              ['Dambare', 'Rimin Gata'].includes(p.area || p.location?.area || '') &&
              isValidCoordinate(
                p.publicLatitude ?? p.location?.publicLatitude,
                p.publicLongitude ?? p.location?.publicLongitude
              )
          )
          .map((p) => ({
            id: p.id,
            title: p.title,
            area: (p.area || p.location?.area || 'Dambare') as HousingArea,
            publicLatitude: (p.publicLatitude ?? p.location?.publicLatitude)!,
            publicLongitude: (p.publicLongitude ?? p.location?.publicLongitude)!,
            publicLocationPrecision: p.location?.precision,
            publicLocationLabel: p.location?.publicLocationLabel,
            propertyType: p.propertyType,
            accommodationType: p.accommodationType,
            pricePerSession: p.pricePerSession,
            currency: 'NGN',
            availableSpaces: p.availableSpaces,
            totalCapacity: p.totalCapacity,
            images: p.images,
            slug: p.slug,
            fullAddress: p.fullAddress || p.address,
            nearestLandmark: p.nearestLandmark,
            directions: p.directions,
          }));
        setProperties(localProps);
      } catch (e) {
        console.warn('Could not load fallback verified properties:', e);
      }
    };

    const loadProperties = async () => {
      try {
        try {
          await supabase.rpc('expire_overdue_reservations_safe');
        } catch {
          // Ignore if overdue hold expiration RPC is unavailable
        }
        const { data, error } = await supabase
          .from('properties')
          .select(`
            id,
            title,
            area,
            address,
            landmark,
            property_type,
            rental_fee_annual,
            available_spaces,
            total_spaces,
            approval_status,
            is_published,
            images,
            featured_image_url,
            property_locations (
              public_latitude,
              public_longitude,
              precision,
              verification_status,
              formatted_address
            )
          `)
          .eq('approval_status', 'approved')
          .eq('is_published', true)
          .gt('available_spaces', 0);

        if (error) {
          setError('Could not fetch verified properties from live database. Showing available verified listings from local cache.');
          loadFallbackFromRepository();
          return;
        }

        if (data && data.length > 0) {
          const mapProps: VerifiedMapProperty[] = data
            .filter((p: any) => {
              const loc = p.property_locations?.[0];
              const validLat = typeof loc?.public_latitude === 'number' && Number.isFinite(loc.public_latitude);
              const validLng = typeof loc?.public_longitude === 'number' && Number.isFinite(loc.public_longitude);
              const hasSpaces = typeof p.available_spaces === 'number' ? p.available_spaces > 0 : true;
              return hasSpaces && validLat && validLng && ['Dambare', 'Rimin Gata'].includes(p.area);
            })
            .map((p: any) => {
              const loc = p.property_locations?.[0];
              const propArea: HousingArea = p.area === 'Rimin Gata' ? 'Rimin Gata' : 'Dambare';
              const imgList = Array.isArray(p.images) && p.images.length > 0
                ? p.images
                : (p.featured_image_url ? [p.featured_image_url] : []);

              return {
                id: p.id,
                title: p.title || 'Student Accommodation',
                area: propArea,
                publicLatitude: Number(loc.public_latitude),
                publicLongitude: Number(loc.public_longitude),
                publicLocationPrecision: loc.precision || 'nearby_building',
                publicLocationLabel: `Verified in ${propArea}`,
                propertyType: p.property_type || 'self_contained',
                accommodationType: 'off_campus',
                pricePerSession: typeof p.rental_fee_annual === 'number' ? p.rental_fee_annual : undefined,
                currency: 'NGN',
                availableSpaces: typeof p.available_spaces === 'number' ? p.available_spaces : undefined,
                totalCapacity: typeof p.total_spaces === 'number' ? p.total_spaces : undefined,
                images: imgList,
                slug: (p.title || 'property').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                fullAddress: p.address || loc.formatted_address || `${propArea}, Kano State`,
                nearestLandmark: p.landmark || undefined,
              };
            });

          setProperties(mapProps);
        } else {
          loadFallbackFromRepository();
        }
      } catch {
        setError('Map data synchronization interrupted. Textual listings remain fully accessible.');
        loadFallbackFromRepository();
      } finally {
        setLoading(false);
      }
    };

    loadProperties();

    const channel = supabase
      .channel('public:properties:map')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'properties' }, () => {
        loadProperties();
      })
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, []);

  // Initialize Map with Native Vector Clustering
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    fallbackAppliedRef.current = false;
    const viewport = areaViewports[initialArea];
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: activeStyle as any,
      center: viewport.center,
      zoom: viewport.zoom,
      minZoom: 11,
      maxZoom: 18,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    mapRef.current = map;

    map.on('load', () => {
      map.resize();
      setMapLoaded(true);
      applyMapTilerBuildingsLayer(map);
      setupClusteringLayers(map);
    });

    map.on('style.load', () => {
      applyMapTilerBuildingsLayer(map);
      setupClusteringLayers(map);
    });

    const handleClusterClick = (e: maplibregl.MapLayerMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
      const clusterId = features[0]?.properties?.cluster_id;
      if (clusterId === undefined) return;

      const source = map.getSource(CLUSTER_SOURCE_ID) as GeoJSONSource | undefined;
      if (!source) return;

      source
        .getClusterExpansionZoom(clusterId)
        .then((zoom) => {
          if (zoom === undefined || isNaN(zoom)) return;
          const coordinates = (features[0].geometry as any).coordinates.slice();
          map.easeTo({
            center: coordinates,
            zoom: Math.min(18, zoom + 0.65),
            duration: 500,
          });
        })
        .catch((err) => {
          console.warn('Could not expand cluster:', err);
        });
    };

    map.on('click', 'clusters', handleClusterClick);
    map.on('click', 'cluster-count', handleClusterClick);

    map.on('click', 'unclustered-point', (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ['unclustered-point'] });
      if (!features.length) return;
      const featureId = features[0]?.properties?.id;
      const property = visiblePropertiesRef.current.find((p) => p.id === featureId);
      if (!property) return;

      setSelectedId(property.id);
      showPropertyPopup(property);
    });

    for (const layerId of ['clusters', 'cluster-count', 'unclustered-point']) {
      map.on('mouseenter', layerId, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', layerId, () => {
        map.getCanvas().style.cursor = '';
      });
    }

    const handleMapError = () => {
      if (!fallbackAppliedRef.current) {
        fallbackAppliedRef.current = true;
        try {
          map.setStyle(mapConfig.fallbackStyle as any);
          return;
        } catch {
          // Ignore and show non-blocking notice below
        }
      }
      setError('The map tiles could not be loaded. The verified property list is still available.');
    };
    map.on('error', handleMapError);

    return () => {
      if (activePopupRef.current) {
        activePopupRef.current.remove();
        activePopupRef.current = null;
      }
      if (userLocationMarkerRef.current) {
        userLocationMarkerRef.current.remove();
        userLocationMarkerRef.current = null;
      }
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
  }, [areaViewports, initialArea, activeStyle, setupClusteringLayers, showPropertyPopup]);

  // Handle area change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (activePopupRef.current) {
      activePopupRef.current.remove();
      activePopupRef.current = null;
    }

    const viewport = areaViewports[area];
    map.flyTo({ center: viewport.center, zoom: viewport.zoom, essential: true });
  }, [area, areaViewports]);

  // Update GeoJSON Clustered Source & Selection Filter when visibleProperties or selectedId change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const source = map.getSource(CLUSTER_SOURCE_ID) as GeoJSONSource | undefined;
    if (source) {
      source.setData(geojsonData);
    } else {
      setupClusteringLayers(map);
    }

    if (map.getLayer('unclustered-point-selected')) {
      map.setFilter('unclustered-point-selected', [
        'all',
        ['!', ['has', 'point_count']],
        ['==', ['get', 'id'], selectedId || ''],
      ]);
    }
  }, [geojsonData, mapLoaded, selectedId, setupClusteringLayers]);

  // Fit bounds when visibleProperties updates (keeps points grouped via clusters)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || visibleProperties.length <= 1) return;

    const bounds = new maplibregl.LngLatBounds();
    visibleProperties.forEach((p) => bounds.extend([p.publicLongitude, p.publicLatitude]));
    map.fitBounds(bounds, { padding: 45, maxZoom: 15 });
  }, [mapLoaded, visibleProperties]);

  const handleUseCurrentLocation = async () => {
    setLocationError(null);
    setIsOutsideStudyArea(false);
    setIsLocating(true);

    try {
      const position = await requestCurrentDevicePosition();
      setUserLocation(position);

      const map = mapRef.current;
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
        } else if (distRiminGata < distDambare) {
          setArea('Rimin Gata');
        } else {
          setArea('Dambare');
        }
      }
    } catch (err: any) {
      const geoErr = err as GeolocationErrorResult;
      setLocationError(geoErr.message || 'Unable to retrieve device location.');
    } finally {
      setIsLocating(false);
    }
  };

  const selectProperty = (property: VerifiedMapProperty) => {
    setSelectedId(property.id);
    mapRef.current?.flyTo({
      center: [property.publicLongitude, property.publicLatitude],
      zoom: 17,
      essential: true,
    });
    showPropertyPopup(property);
  };

  return (
    <section className="space-y-4" aria-label="Verified student accommodation map">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            Verified accommodation near BUK
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Only approved properties with administrator-verified public locations are shown.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={handleUseCurrentLocation}
            disabled={isLocating}
            title="Locate my position on the accommodation map"
            aria-label="Use my current location"
            className="p-2 sm:px-3 rounded-xl bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-60"
          >
            {isLocating ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                <span className="hidden sm:inline">Locating...</span>
              </>
            ) : (
              <>
                <Navigation className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span className="hidden sm:inline">Use my current location</span>
              </>
            )}
          </button>

          <MapStyleSelector />
          <div className="flex rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900" role="tablist" aria-label="Housing area">
            {(['Dambare', 'Rimin Gata'] as HousingArea[]).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={area === item}
                onClick={() => setArea(item)}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition cursor-pointer ${
                  area === item
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Location Error Feedback */}
      {locationError && (
        <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/80 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200 shadow-sm text-xs flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">Location Access</p>
            <p className="mt-0.5 text-[11px] leading-relaxed">{locationError}</p>
          </div>
          <button
            type="button"
            onClick={() => setLocationError(null)}
            className="text-rose-500 hover:text-rose-700 p-0.5 rounded cursor-pointer"
            aria-label="Dismiss error"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Outside Study Area Notice */}
      {isOutsideStudyArea && (
        <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/80 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200 shadow-sm text-xs flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">Device Location Outside Study Area</p>
            <p className="mt-0.5 text-[11px] leading-relaxed">
              Your device is located outside the Danbare and Rimin Gata study area. Showing OUTPOST accommodations in {area}.
            </p>
            <button
              type="button"
              onClick={() => {
                const viewport = areaViewports[area];
                mapRef.current?.flyTo({ center: viewport.center, zoom: viewport.zoom, essential: true });
                setIsOutsideStudyArea(false);
              }}
              className="mt-2 px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[11px] font-semibold cursor-pointer inline-flex items-center gap-1 shadow-xs"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Center on {area} Accommodations</span>
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
      )}

      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          {error}
        </div>
      )}

      <div className="grid min-h-[560px] grid-cols-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Map Canvas */}
        <div className="relative min-h-[420px] bg-slate-200 dark:bg-slate-800">
          <div ref={mapContainerRef} className="absolute inset-0" />
          <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-white/90 px-2 py-1 text-[10px] text-slate-600 shadow dark:bg-slate-900/90 dark:text-slate-300">
            {mapAttribution}
          </div>
          {loading && (
            <div className="absolute inset-0 grid place-items-center bg-white/60 dark:bg-slate-950/50">
              <p className="rounded-lg bg-white px-3 py-2 text-sm shadow dark:bg-slate-900 dark:text-white">
                Loading verified locations…
              </p>
            </div>
          )}
        </div>

        {/* Listings Aside */}
        <aside className="max-h-[560px] overflow-y-auto border-t border-slate-200 dark:border-slate-800 lg:border-l lg:border-t-0">
          <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
            <p className="text-sm font-bold text-slate-900 dark:text-white">
              {area} listings
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {visibleProperties.length} verified {visibleProperties.length === 1 ? 'property' : 'properties'}
            </p>
          </div>

          {!loading && visibleProperties.length === 0 && (
            <div className="p-5 text-sm text-slate-500 dark:text-slate-400">
              No verified properties are currently available in {area}. Properties remain hidden until their public location is approved by an administrator.
            </div>
          )}

          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {visibleProperties.map((property) => (
              <li
                key={property.id}
                onClick={() => selectProperty(property)}
                className={`p-4 transition cursor-pointer ${
                  selectedId === property.id
                    ? 'bg-emerald-50/70 dark:bg-emerald-950/30'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    {property.title}
                  </h3>
                  <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex-shrink-0">
                    {formatPrice(property.pricePerSession, property.currency)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {property.propertyType ?? 'Hostel'} · {property.accommodationType ?? 'Student unit'}
                </p>
                {property.nearestLandmark && (
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                    📍 {property.nearestLandmark}
                  </p>
                )}
                {property.directions && (
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1 italic">
                    "{property.directions}"
                  </p>
                )}
                {(() => {
                  const proximity = walkingRouteService.getImmediateDualGateProximity(
                    property.publicLatitude,
                    property.publicLongitude
                  );
                  const orientation = getNearestLandmarkOrientation(
                    property.publicLatitude,
                    property.publicLongitude
                  );
                  return (
                    <div className="mt-2 space-y-1">
                      {orientation && (
                        <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                          <Compass className="w-3 h-3 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                          <span className="truncate">{orientation.formattedDescription}</span>
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-1 text-[10px]">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-medium border border-emerald-200 dark:border-emerald-800">
                          <span className="font-bold">Gate 1:</span> {proximity.gate1.displayText}
                        </span>
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 font-medium border border-blue-200 dark:border-blue-800">
                          <span className="font-bold">Gate 2:</span> {proximity.gate2.displayText}
                        </span>
                      </div>
                    </div>
                  );
                })()}
                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">
                    {property.availableSpaces !== undefined ? `${property.availableSpaces} spaces available` : 'Available'}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPropertyOpen?.(property);
                    }}
                    className="font-bold text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 flex items-center gap-1 cursor-pointer"
                  >
                    <span>View details</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  );
};

export default StudentVerifiedPropertiesMap;
