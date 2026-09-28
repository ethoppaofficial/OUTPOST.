import React, { useEffect, useMemo, useRef, useState } from 'react';
import { maplibregl } from '../../infrastructure/config/maplibreSetup';
import type { Map as MapInstance, Marker, Popup } from 'maplibre-gl';
import {
  collection,
  onSnapshot,
  query,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import 'maplibre-gl/dist/maplibre-gl.css';
import { db } from '../../infrastructure/firebase/firebaseConfig';
import {
  getEffectiveMapStyle,
  getEffectiveAttribution,
  subscribeToMapConfig,
} from '../../infrastructure/config/mapConfig';
import { MapStyleSelector } from './MapStyleSelector';

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
  images?: string[];
  slug?: string;
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

const DEFAULT_STYLE_URL =
  'https://tiles.openfreemap.org/styles/liberty';
const DEFAULT_ATTRIBUTION =
  '© OpenFreeMap, © OpenStreetMap contributors';

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
  snapshot: QueryDocumentSnapshot<DocumentData>,
): VerifiedMapProperty | null {
  const data = snapshot.data();

  // These checks are repeated client-side for defensive rendering. Firestore
  // rules remain the authoritative access-control layer.
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
    images: Array.isArray(data.images) ? data.images.filter((item) => typeof item === 'string') : [],
    slug: data.slug,
  };
}

function createPropertyMarker(property: VerifiedMapProperty): HTMLButtonElement {
  const marker = document.createElement('button');
  marker.type = 'button';
  marker.className =
    'outpost-property-marker h-8 w-8 rounded-full border-4 border-white bg-emerald-600 shadow-lg transition-transform hover:scale-110 focus:outline-none focus:ring-4 focus:ring-emerald-300';
  marker.setAttribute('aria-label', `Open ${property.title}`);
  marker.title = property.title;
  return marker;
}

function formatPrice(value?: number, currency = 'NGN'): string {
  if (value === undefined) return 'Price on request';
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export const StudentVerifiedPropertiesMap: React.FC<
  StudentVerifiedPropertiesMapProps
> = ({
  mapStyleUrl,
  mapAttribution,
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

  const [activeStyle, setActiveStyle] = useState<string | any>(
    () => mapStyleUrl || getEffectiveMapStyle(),
  );
  const [activeAttribution, setActiveAttribution] = useState<string>(
    () => mapAttribution || getEffectiveAttribution(),
  );

  useEffect(() => {
    const unsubscribe = subscribeToMapConfig(() => {
      const nextStyle = getEffectiveMapStyle();
      setActiveStyle(nextStyle);
      setActiveAttribution(getEffectiveAttribution());
      if (mapRef.current) {
        try {
          mapRef.current.setStyle(nextStyle);
        } catch (e) {
          console.warn('Could not update map style dynamically:', e);
        }
      }
    });
    return unsubscribe;
  }, []);

  const visibleProperties = useMemo(
    () => properties.filter((property) => property.area === area),
    [area, properties],
  );

  // Firestore rules enforce this same public visibility contract. The query is
  // intentionally limited to the two supported off-campus case-study areas.
  useEffect(() => {
    setLoading(true);
    setError(null);

    const propertiesQuery = query(
      collection(db, 'properties'),
      where('verificationStatus', '==', 'approved'),
      where('locationVerificationStatus', '==', 'verified'),
      where('area', 'in', ['Dambare', 'Rimin Gata']),
      where('state', '==', 'Kano State'),
      where('isActive', '==', true),
    );

    return onSnapshot(
      propertiesQuery,
      (snapshot) => {
        const next = snapshot.docs
          .map(toVerifiedProperty)
          .filter((property): property is VerifiedMapProperty => property !== null);
        setProperties(next);
        setLoading(false);
      },
      () => {
        setError('Verified accommodation could not be loaded. Please retry.');
        setLoading(false);
      },
    );
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

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

    const handleMapError = () => {
      setError('The map tiles could not be loaded. The verified property list is still available.');
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
  }, [caseStudyViewports, initialArea, mapStyleUrl]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const viewport = caseStudyViewports[area];
    map.flyTo({ center: viewport.center, zoom: viewport.zoom, essential: true });
  }, [area, caseStudyViewports]);

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

      const popup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: false,
        maxWidth: '280px',
      }).setHTML(`
        <div class="p-2 space-y-1">
          <strong class="text-xs font-bold text-slate-900 block">${escapeHtml(property.title)}</strong>
          <div class="text-[11px] text-slate-500">${escapeHtml(property.area)}, Kano State</div>
          <div class="text-xs font-bold text-emerald-600">${escapeHtml(formatPrice(property.pricePerSession, property.currency))}</div>
          <button data-property-id="${escapeHtml(property.id)}" class="outpost-popup-details mt-2 w-full py-1 px-2 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-500 transition cursor-pointer">View details</button>
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

      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          {error}
        </div>
      )}

      <div className="grid min-h-[560px] grid-cols-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="relative min-h-[420px] bg-slate-200 dark:bg-slate-800">
          <div ref={mapContainerRef} className="absolute inset-0" />
          <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-white/90 px-2 py-1 text-[10px] text-slate-600 shadow dark:bg-slate-900/90 dark:text-slate-300">
            {activeAttribution}
          </div>
          {loading && (
            <div className="absolute inset-0 grid place-items-center bg-white/60 dark:bg-slate-950/50">
              <p className="rounded-lg bg-white px-3 py-2 text-sm shadow dark:bg-slate-900 dark:text-white">
                Loading verified locations…
              </p>
            </div>
          )}
        </div>

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
              No verified properties are currently available in {area}. Properties remain hidden until their public location is approved.
            </div>
          )}

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {visibleProperties.map((property) => (
              <button
                key={property.id}
                type="button"
                onClick={() => selectProperty(property)}
                className={`block w-full p-4 text-left transition hover:bg-emerald-50 dark:hover:bg-emerald-950/20 cursor-pointer ${
                  selectedId === property.id ? 'bg-emerald-50 dark:bg-emerald-950/30' : ''
                }`}
              >
                <div className="flex gap-3">
                  {property.images?.[0] && (
                    <img
                      src={property.images[0]}
                      alt=""
                      className="h-16 w-16 rounded-lg object-cover"
                      loading="lazy"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-bold text-slate-900 dark:text-white">
                      {property.title}
                    </h3>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {property.publicLocationLabel || `${property.area}, Kano State`}
                    </p>
                    <p className="mt-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      {formatPrice(property.pricePerSession, property.currency)}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    };
    return entities[character];
  });
}

export default StudentVerifiedPropertiesMap;
