import React, { useEffect, useMemo, useRef, useState } from 'react';
import { maplibregl } from '../../infrastructure/config/maplibreSetup';
import type { Map as MapInstance, Marker, Popup } from 'maplibre-gl';
import { supabase } from '../../infrastructure/supabase/supabaseClient';
import { propertyService } from '../../application/services/propertyService';
import {
  mapConfig,
  getMaptilerApiKey,
  subscribeToMapConfig,
  applyMapTilerBuildingsLayer,
} from '../../infrastructure/config/mapConfig';
import { MapStyleSelector } from './MapStyleSelector';
import { AlertTriangle, MapPin, Building2, ExternalLink } from 'lucide-react';

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
  caseStudyViewports: Record<
    HousingArea,
    { center: [number, number]; zoom: number }
  >;
  onPropertyOpen?: (property: VerifiedMapProperty) => void;
}

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

function toVerifiedProperty(
  snapshot: any,
): VerifiedMapProperty | null {
  const data = snapshot.data();

  // Defensive validation: authoritative layer is Firestore rules
  if (
    data.verificationStatus !== 'approved' ||
    data.locationVerificationStatus !== 'verified' ||
    data.isActive === false ||
    !['Dambare', 'Rimin Gata'].includes(data.area) ||
    data.state !== 'Kano State' ||
    !isValidCoordinate(data.publicLatitude, data.publicLongitude)
  ) {
    return null;
  }

  return {
    id: snapshot.id,
    title: String(data.title ?? 'Student accommodation'),
    area: data.area as HousingArea,
    publicLatitude: data.publicLatitude,
    publicLongitude: data.publicLongitude,
    publicLocationPrecision: data.publicLocationPrecision,
    publicLocationLabel: data.publicLocationLabel,
    propertyType: data.propertyType,
    accommodationType: data.accommodationType,
    pricePerSession: typeof data.pricePerSession === 'number' ? data.pricePerSession : undefined,
    currency: data.currency ?? 'NGN',
    availableSpaces: typeof data.availableSpaces === 'number' ? data.availableSpaces : undefined,
    totalCapacity: typeof data.totalCapacity === 'number' ? data.totalCapacity : undefined,
    images: Array.isArray(data.images) ? data.images.filter((item) => typeof item === 'string') : [],
    slug: data.slug,
    fullAddress: data.fullAddress || data.address,
    nearestLandmark: data.nearestLandmark,
    directions: data.directions,
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function createPropertyMarker(property: VerifiedMapProperty): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className =
    'outpost-map-pin h-8 w-8 rounded-full border-2 border-white bg-emerald-600 shadow-md transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-emerald-400 cursor-pointer flex items-center justify-center text-white';
  element.setAttribute('aria-label', `Verified property: ${property.title}`);
  element.innerHTML = `
    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
      <circle cx="12" cy="10" r="3"/>
    </svg>
  `;
  return element;
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
  caseStudyViewports,
  onPropertyOpen,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const markersRef = useRef<globalThis.Map<string, Marker>>(new globalThis.Map());
  const popupsRef = useRef<globalThis.Map<string, Popup>>(new globalThis.Map());
  const [area, setArea] = useState<HousingArea>(initialArea);
  const [properties, setProperties] = useState<VerifiedMapProperty[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMapKey, setHasMapKey] = useState(Boolean(getMaptilerApiKey()));

  const activeStyle = mapStyleUrl || mapConfig.styleUrl;

  useEffect(() => {
    const unsubscribe = subscribeToMapConfig(() => {
      setHasMapKey(Boolean(getMaptilerApiKey()));
      if (mapRef.current && mapConfig.styleUrl) {
        try {
          mapRef.current.setStyle(mapConfig.styleUrl);
        } catch (e) {
          console.warn('Could not update map style dynamically:', e);
        }
      }
      if (mapRef.current) {
        applyMapTilerBuildingsLayer(mapRef.current);
      }
    });
    return unsubscribe;
  }, []);

  const visibleProperties = useMemo(
    () => properties.filter((property) => property.area === area),
    [area, properties],
  );

  // Firestore rules enforce this same public visibility contract.
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
        const { data, error } = await supabase
          .from('properties')
          .select(`
            id,
            title,
            property_type,
            rental_fee_annual,
            available_spaces,
            total_spaces,
            approval_status,
            is_published,
            property_locations (
              public_latitude,
              public_longitude,
              precision,
              verification_status,
              formatted_address
            )
          `)
          .eq('approval_status', 'approved')
          .eq('is_published', true);

        if (!error && data && data.length > 0) {
          const mapProps: VerifiedMapProperty[] = data.map((p: any) => ({
            id: p.id,
            title: p.title,
            area: 'Dambare' as HousingArea,
            publicLatitude: Number(p.property_locations?.[0]?.public_latitude || 11.9842),
            publicLongitude: Number(p.property_locations?.[0]?.public_longitude || 8.4187),
            publicLocationPrecision: p.property_locations?.[0]?.precision || 'nearby_building',
            publicLocationLabel: 'Verified in Dambare',
            propertyType: p.property_type || 'self_contained',
            accommodationType: 'off_campus',
            pricePerSession: Number(p.rental_fee_annual || 250000),
            currency: 'NGN',
            availableSpaces: p.available_spaces || 1,
            totalCapacity: p.total_spaces || 1,
            images: [],
            slug: p.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            fullAddress: p.property_locations?.[0]?.formatted_address || 'Kano State',
          }));
          setProperties(mapProps);
        } else {
          loadFallbackFromRepository();
        }
      } catch {
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

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    if (!activeStyle) {
      setError('Map configuration is incomplete. Please contact the administrator.');
      return;
    }

    const viewport = caseStudyViewports[initialArea];
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: activeStyle,
      center: viewport.center,
      zoom: viewport.zoom,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    mapRef.current = map;

    map.on('load', () => {
      applyMapTilerBuildingsLayer(map);
    });

    const handleMapError = () => {
      if (!getMaptilerApiKey()) {
        setError('Map configuration is incomplete. Please contact the administrator.');
      } else {
        setError('The map tiles could not be loaded. The verified property list is still available.');
      }
    };
    map.on('error', handleMapError);

    return () => {
      markersRef.current.forEach((marker: Marker) => marker.remove());
      popupsRef.current.forEach((popup: Popup) => popup.remove());
      markersRef.current.clear();
      popupsRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, [caseStudyViewports, initialArea, activeStyle]);

  // Handle area change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const viewport = caseStudyViewports[area];
    map.flyTo({ center: viewport.center, zoom: viewport.zoom, essential: true });
  }, [area, caseStudyViewports]);

  // Update Markers when properties change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((marker: Marker, id: string) => {
      if (!visibleProperties.some((property) => property.id === id)) {
        marker.remove();
        markersRef.current.delete(id);
        popupsRef.current.get(id)?.remove();
        popupsRef.current.delete(id);
      }
    });

    visibleProperties.forEach((property) => {
      const coordinates: [number, number] = [
        property.publicLongitude,
        property.publicLatitude,
      ];
      const existing = markersRef.current.get(property.id);

      if (existing) {
        existing.setLngLat(coordinates);
        return;
      }

      const landmarkHtml = property.nearestLandmark
        ? `<div class="text-[10px] text-slate-500">Landmark: <span class="text-slate-700 dark:text-slate-300 font-medium">${escapeHtml(property.nearestLandmark)}</span></div>`
        : '';

      const spacesHtml = property.availableSpaces !== undefined
        ? `<span class="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">${property.availableSpaces} spaces left</span>`
        : '';

      const directionsHtml = property.directions
        ? `<div class="text-[10px] text-slate-500 line-clamp-1 italic">${escapeHtml(property.directions)}</div>`
        : '';

      const popup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: false,
        maxWidth: '280px',
      }).setHTML(`
        <div class="p-2 space-y-1.5 text-left">
          <strong class="text-xs font-bold text-slate-900 block leading-tight">${escapeHtml(property.title)}</strong>
          <div class="text-[11px] text-slate-500 font-medium">${escapeHtml(property.area)}, Kano State</div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-bold text-emerald-600">${escapeHtml(formatPrice(property.pricePerSession, property.currency))}</span>
            ${spacesHtml}
          </div>
          ${landmarkHtml}
          ${directionsHtml}
          <button data-property-id="${escapeHtml(property.id)}" class="outpost-popup-details mt-2 w-full py-1.5 px-2 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-500 transition cursor-pointer">View details</button>
        </div>
      `);

      popup.on('open', () => {
        const button = document.querySelector<HTMLButtonElement>(
          `[data-property-id="${CSS.escape(property.id)}"]`,
        );
        button?.addEventListener('click', () => onPropertyOpen?.(property));
      });

      const marker = new maplibregl.Marker({
        element: createPropertyMarker(property),
      })
        .setLngLat(coordinates)
        .setPopup(popup)
        .addTo(map);

      marker.getElement().addEventListener('click', () => {
        setSelectedId(property.id);
      });

      markersRef.current.set(property.id, marker);
      popupsRef.current.set(property.id, popup);
    });

    // Fit map bounds to visible properties if more than 1 exists
    if (visibleProperties.length > 1) {
      const bounds = new maplibregl.LngLatBounds();
      visibleProperties.forEach((p) => bounds.extend([p.publicLongitude, p.publicLatitude]));
      map.fitBounds(bounds, { padding: 45, maxZoom: 16 });
    }
  }, [onPropertyOpen, visibleProperties]);

  const selectProperty = (property: VerifiedMapProperty) => {
    setSelectedId(property.id);
    mapRef.current?.flyTo({
      center: [property.publicLongitude, property.publicLatitude],
      zoom: 17,
      essential: true,
    });
    markersRef.current.get(property.id)?.togglePopup();
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
        <div className="flex items-center gap-2">
          <MapStyleSelector />
          <div className="flex rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900" role="tablist" aria-label="Case-study area">
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

      {/* Missing Key State */}
      {!hasMapKey && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <span>Map configuration is incomplete. Please contact the administrator.</span>
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
