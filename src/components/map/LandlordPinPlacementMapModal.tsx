import React, { useCallback, useEffect, useRef, useState } from 'react';
import { maplibregl } from '../../infrastructure/config/maplibreSetup';
import type { Map, Marker, MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  mapConfig,
  getMaptilerApiKey,
  setMaptilerApiKey,
  isMapTilerConfigured,
  subscribeToMapConfig,
  applyMapTilerBuildingsLayer,
} from '../../infrastructure/config/mapConfig';
import {
  searchAddress,
  resultMentionsArea,
  getPrecisionLabel,
  reverseGeocodeCoordinates,
} from '../../application/services/geocodingService';
import { requestCurrentDevicePosition, type GeolocationErrorResult } from '../../application/services/geolocationService';
import type { GeocodingSuggestion } from '../../domain/types';
import { Search, MapPin, Navigation, AlertTriangle, Check, Key, Loader2, X, ExternalLink } from 'lucide-react';

export type HousingArea = 'Dambare' | 'Rimin Gata';
export type LocationSource =
  | 'address_search'
  | 'manual_pin'
  | 'device_gps'
  | 'admin_adjusted';
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
    'outpost-map-pin h-10 w-10 rounded-full border-4 border-white bg-emerald-600 shadow-xl transition-transform hover:scale-110 focus:outline-none focus:ring-4 focus:ring-emerald-300 cursor-grab active:cursor-grabbing';
  element.setAttribute('aria-label', 'Selected accommodation location. Drag to adjust.');
  element.title = 'Drag to adjust the accommodation pin';
  return element;
}

export const LandlordPinPlacementMapModal: React.FC<
  LandlordPinPlacementMapModalProps
> = ({
  isOpen,
  area: initialArea,
  caseStudyViewport,
  initialLocation,
  mapStyleUrl,
  mapAttribution = mapConfig.attribution,
  onClose,
  onConfirm,
  onReverseGeocode = ({ latitude, longitude }) =>
    reverseGeocodeCoordinates(latitude, longitude),
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const markerRef = useRef<Marker | null>(null);

  const [selectedArea, setSelectedArea] = useState<HousingArea>(initialArea);
  const [location, setLocation] = useState<PinLocationValue | null>(null);
  const [precision, setPrecision] = useState<LocationPrecision>(
    initialLocation?.precision ?? 'nearby_building',
  );
  const [address, setAddress] = useState(initialLocation?.formattedAddress ?? '');
  const [searchQuery, setSearchQuery] = useState(initialLocation?.formattedAddress ?? '');
  const [suggestions, setSuggestions] = useState<GeocodingSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isReverseGeocoding, setIsReverseGeocoding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [areaWarning, setAreaWarning] = useState<string | null>(null);
  const [hasMapKey, setHasMapKey] = useState(isMapTilerConfigured());
  const [manualKeyInput, setManualKeyInput] = useState('');
  const [keySaved, setKeySaved] = useState(false);

  const activeStyleUrl = mapStyleUrl || mapConfig.styleUrl;

  useEffect(() => {
    const unsub = subscribeToMapConfig(() => {
      setHasMapKey(isMapTilerConfigured());
      if (mapRef.current && mapConfig.styleUrl) {
        try {
          mapRef.current.setStyle(mapConfig.styleUrl);
        } catch (e) {
          console.warn('Could not update map style:', e);
        }
      }
    });
    return unsub;
  }, []);

  const setSelectedLocation = useCallback(
    async (
      latitude: number,
      longitude: number,
      source: LocationSource,
      accuracyMeters?: number,
      sourceAddress?: string,
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
        area: selectedArea,
        precision,
        formattedAddress: sourceAddress || address || undefined,
      };
      setLocation(nextLocation);
      mapRef.current?.flyTo({ center: [longitude, latitude], zoom: 17, essential: true });

      if (!sourceAddress && onReverseGeocode) {
        setIsReverseGeocoding(true);
        try {
          const result = await onReverseGeocode({ latitude, longitude });
          if (result) {
            setAddress(result);
            setLocation((current) =>
              current ? { ...current, formattedAddress: result } : current,
            );
          }
        } catch {
          // Failure to reverse geocode does not invalidate manually placed pin
        } finally {
          setIsReverseGeocoding(false);
        }
      }
    },
    [address, onReverseGeocode, precision, selectedArea],
  );

  // Address search with debouncing
  useEffect(() => {
    if (!searchQuery || searchQuery.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    const abortController = new AbortController();
    const timeout = setTimeout(async () => {
      setIsSearching(true);
      setError(null);
      try {
        const results = await searchAddress(searchQuery, selectedArea, abortController.signal);
        setSuggestions(results);
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          setError(err.message || 'Address search failed. Please try again.');
        }
      } finally {
        setIsSearching(false);
      }
    }, 350);

    return () => {
      clearTimeout(timeout);
      abortController.abort();
    };
  }, [searchQuery, selectedArea]);

  // Handle selecting a geocoding result
  const handleSelectSuggestion = (suggestion: GeocodingSuggestion) => {
    const [longitude, latitude] = suggestion.center;

    // Verify area match
    if (!resultMentionsArea(suggestion, selectedArea)) {
      setAreaWarning(
        `Notice: This result (${suggestion.placeName}) may be outside ${selectedArea}. Please drag the pin on the map to place it at the exact building location.`,
      );
    } else {
      setAreaWarning(null);
    }

    const precisionInfo = getPrecisionLabel(suggestion.placeType);
    setPrecision(precisionInfo.precision);
    setAddress(suggestion.placeName);
    setSuggestions([]);

    // Update map marker
    const map = mapRef.current;
    if (map) {
      if (markerRef.current) {
        markerRef.current.setLngLat([longitude, latitude]);
      } else {
        const marker = new maplibregl.Marker({
          element: createMarkerElement(),
          draggable: true,
        })
          .setLngLat([longitude, latitude])
          .addTo(map);

        marker.on('dragend', () => {
          const pos = marker.getLngLat();
          void setSelectedLocation(pos.lat, pos.lng, 'manual_pin');
        });
        markerRef.current = marker;
      }
      map.flyTo({ center: [longitude, latitude], zoom: 17, essential: true });
    }

    void setSelectedLocation(latitude, longitude, 'address_search', undefined, suggestion.placeName);
  };

  // Initialize MapLibre
  useEffect(() => {
    if (!isOpen || !mapContainerRef.current || mapRef.current) return;

    const initialLatitude = initialLocation?.latitude;
    const initialLongitude = initialLocation?.longitude;
    const hasInitialLocation =
      typeof initialLatitude === 'number' &&
      typeof initialLongitude === 'number' &&
      isValidCoordinate(initialLatitude, initialLongitude);

    const styleToLoad = activeStyleUrl;

    if (!styleToLoad) {
      setError('Map configuration is incomplete. Please contact the administrator.');
      return;
    }

    try {
      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: styleToLoad,
        center: hasInitialLocation
          ? [initialLongitude as number, initialLatitude as number]
          : caseStudyViewport.center,
        zoom: hasInitialLocation ? 17 : caseStudyViewport.zoom,
        attributionControl: false,
      });

      map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
      mapRef.current = map;

      const initialValue: PinLocationValue | null = hasInitialLocation
        ? {
            latitude: initialLatitude as number,
            longitude: initialLongitude as number,
            accuracyMeters: initialLocation?.accuracyMeters,
            source: initialLocation?.source ?? 'manual_pin',
            area: selectedArea,
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
          void setSelectedLocation(position.lat, position.lng, 'manual_pin');
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
            void setSelectedLocation(position.lat, position.lng, 'manual_pin');
          });
          markerRef.current = marker;
        }

        void setSelectedLocation(lat, lng, 'manual_pin');
      };

      const handleMapError = (e: any) => {
        console.warn('MapLibre error in Landlord modal:', e);
        if (!getMaptilerApiKey()) {
          setError('Map configuration is incomplete. Please contact the administrator.');
        }
      };

      map.on('click', handleMapClick);
      map.on('error', handleMapError);

      map.on('load', () => {
        map.resize();
        applyMapTilerBuildingsLayer(map);
      });

      return () => {
        markerRef.current?.remove();
        markerRef.current = null;
        map.remove();
        mapRef.current = null;
      };
    } catch (err: any) {
      setError(err?.message || 'Failed to initialize MapLibre GL JS engine.');
    }
  }, [activeStyleUrl, caseStudyViewport.center, caseStudyViewport.zoom, initialLocation, isOpen, selectedArea, setSelectedLocation]);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedArea(initialArea);
    setPrecision(initialLocation?.precision ?? 'nearby_building');
    setAddress(initialLocation?.formattedAddress ?? '');
    setSearchQuery(initialLocation?.formattedAddress ?? '');
    setError(null);
  }, [initialArea, initialLocation, isOpen]);

  const handleUseCurrentLocation = async () => {
    setIsLocating(true);
    setError(null);

    try {
      const position = await requestCurrentDevicePosition();
      const { latitude, longitude, accuracyMeters } = position;
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

      void setSelectedLocation(latitude, longitude, 'device_gps', accuracyMeters);
    } catch (err: unknown) {
      const geoErr = err as GeolocationErrorResult;
      setError(geoErr?.message || 'Your current location could not be determined. Please place the pin manually.');
    } finally {
      setIsLocating(false);
    }
  };

  const handleSaveManualKey = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualKeyInput.trim()) return;
    setMaptilerApiKey(manualKeyInput.trim());
    setKeySaved(true);
    setError(null);
    setTimeout(() => setKeySaved(false), 2000);
  };

  const handleConfirm = () => {
    if (!location) {
      setError('Please search an address or place the pin on the actual building before confirming.');
      return;
    }

    if (!isValidCoordinate(location.latitude, location.longitude)) {
      setError('The selected coordinates are invalid. Please choose another map position.');
      return;
    }

    onConfirm({
      ...location,
      area: selectedArea,
      precision,
      formattedAddress: address || undefined,
    });
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/75 backdrop-blur-xs p-2 sm:p-4 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pin-placement-title"
    >
      <div className="flex max-h-[96vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
        {/* Header */}
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3 dark:border-slate-800 sm:px-6">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <h2 id="pin-placement-title" className="text-base font-bold text-slate-900 dark:text-white">
                Pin Property Building Location
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {selectedArea}, Kano State • MapTiler Streets & Address Geocoding
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
            aria-label="Close location picker"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Address Search Bar */}
        <div className="p-3 sm:px-6 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800">
          <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-2 items-center relative">
            {/* Area Selector */}
            <div>
              <label htmlFor="area-select" className="sr-only">Select Area</label>
              <select
                id="area-select"
                value={selectedArea}
                onChange={(e) => setSelectedArea(e.target.value as HousingArea)}
                className="w-full p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-800 dark:text-slate-200"
              >
                <option value="Dambare">Dambare</option>
                <option value="Rimin Gata">Rimin Gata</option>
              </select>
            </div>

            {/* Address Input */}
            <div className="relative">
              <div className="relative flex items-center">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={`Search property address in ${selectedArea}, Kano (e.g. Plot 14, Main Feeder Road)...`}
                  className="w-full pl-9 pr-10 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                {isSearching && (
                  <Loader2 className="w-4 h-4 text-emerald-600 animate-spin absolute right-3" />
                )}
                {searchQuery && !isSearching && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setSuggestions([]);
                    }}
                    className="absolute right-3 p-0.5 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Suggestions Dropdown */}
              {suggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xl z-50 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
                  <div className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex justify-between">
                    <span>Address Suggestions ({suggestions.length})</span>
                    <span>Click to select</span>
                  </div>
                  {suggestions.map((item) => {
                    const info = getPrecisionLabel(item.placeType);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSelectSuggestion(item)}
                        className="w-full text-left p-3 hover:bg-emerald-50/60 dark:hover:bg-emerald-950/20 transition flex items-start justify-between gap-3 group cursor-pointer"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 group-hover:text-emerald-700 dark:group-hover:text-emerald-400 line-clamp-1">
                            {item.placeName}
                          </p>
                          <span className="text-[10px] text-slate-500 dark:text-slate-400">
                            {info.label} • {selectedArea}, Kano
                          </span>
                        </div>
                        <span className="px-2 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 flex-shrink-0">
                          Select
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Missing API Key Banner */}
        {!hasMapKey && (
          <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-3 sm:px-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-medium text-amber-800 dark:text-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                <span>Map configuration is incomplete. Please contact the administrator.</span>
              </div>
              <form onSubmit={handleSaveManualKey} className="flex items-center gap-2">
                <input
                  type="text"
                  value={manualKeyInput}
                  onChange={(e) => setManualKeyInput(e.target.value)}
                  placeholder="Enter MapTiler API Key"
                  className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-mono"
                />
                <button
                  type="submit"
                  className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold shadow-xs cursor-pointer"
                >
                  Save
                </button>
              </form>
            </div>
            {keySaved && (
              <p className="text-[10px] text-emerald-600 font-semibold mt-1">
                MapTiler key saved successfully! Reloading map...
              </p>
            )}
          </div>
        )}

        {/* Area Warning Banner */}
        {areaWarning && (
          <div className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900/60 px-4 py-2 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
            <span>{areaWarning}</span>
          </div>
        )}

        {/* Main Grid: Map & Details Sidebar */}
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* Map Canvas */}
          <div className="relative min-h-[400px] bg-slate-200 dark:bg-slate-800">
            <div ref={mapContainerRef} className="absolute inset-0" />

            {/* Instruction tooltip */}
            <div className="pointer-events-none absolute left-3 top-3 rounded-xl bg-white/95 dark:bg-slate-900/95 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 shadow-md border border-slate-200 dark:border-slate-800">
              💡 Type address above, or click/drag green marker to the exact building.
            </div>

            {/* Attribution */}
            <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-white/90 px-2 py-1 text-[10px] text-slate-600 shadow dark:bg-slate-900/90 dark:text-slate-300">
              {mapAttribution}
            </div>
          </div>

          {/* Sidebar Controls */}
          <aside className="space-y-4 overflow-y-auto border-t border-slate-200 p-4 dark:border-slate-800 lg:border-l lg:border-t-0 sm:p-5">
            {/* GPS Locate Button */}
            <button
              type="button"
              onClick={handleUseCurrentLocation}
              disabled={isLocating}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-2.5 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60 shadow-xs cursor-pointer"
            >
              <Navigation className={`w-3.5 h-3.5 ${isLocating ? 'animate-spin' : ''}`} />
              <span>{isLocating ? 'Locating device via GPS…' : 'Use Current GPS Location'}</span>
            </button>

            {/* Public Map Precision Selector */}
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Location Precision
              </span>
              <select
                value={precision}
                onChange={(event) => setPrecision(event.target.value as LocationPrecision)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                <option value="exact_building">Exact building (high confidence)</option>
                <option value="nearby_building">Nearby building / compound</option>
                <option value="street">Street-level result</option>
                <option value="neighbourhood">Neighbourhood area</option>
              </select>
            </label>

            {/* Selected Location Card */}
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 p-3 text-xs border border-slate-200/80 dark:border-slate-700/80 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-800 dark:text-slate-200">Selected Location</span>
                {location?.source && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                    {location.source === 'address_search'
                      ? 'Geocoded'
                      : location.source === 'device_gps'
                      ? 'GPS'
                      : 'Manual Pin'}
                  </span>
                )}
              </div>

              <p className="text-slate-600 dark:text-slate-300 font-medium">
                {address || 'No address label yet. Click on the map to place building pin.'}
              </p>

              {location ? (
                <dl className="mt-2 space-y-1 text-slate-600 dark:text-slate-400 text-[11px] pt-2 border-t border-slate-200/60 dark:border-slate-700/60">
                  <div className="flex justify-between gap-3">
                    <dt>Area</dt>
                    <dd className="font-semibold text-slate-800 dark:text-slate-200">{selectedArea}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>Latitude</dt>
                    <dd className="font-mono text-slate-900 dark:text-white font-bold">{location.latitude.toFixed(6)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>Longitude</dt>
                    <dd className="font-mono text-slate-900 dark:text-white font-bold">{location.longitude.toFixed(6)}</dd>
                  </div>
                  {location.accuracyMeters !== undefined && (
                    <div className="flex justify-between gap-3">
                      <dt>GPS accuracy</dt>
                      <dd>±{Math.round(location.accuracyMeters)} m</dd>
                    </div>
                  )}
                </dl>
              ) : (
                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                  ⚠️ No marker placed yet. Search an address or click the map.
                </p>
              )}
            </div>

            {isReverseGeocoding && (
              <p className="text-xs text-slate-500 flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600" />
                <span>Resolving location address…</span>
              </p>
            )}

            {error && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200 flex items-start gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800/50 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              Coordinates remain <strong className="text-slate-700 dark:text-slate-300">Pending</strong> until reviewed and verified by an administrator. Public coordinates are released only after approval.
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={!location}
                className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-3 py-2 text-xs font-semibold text-white transition shadow-xs cursor-pointer"
              >
                Confirm Location Pin
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default LandlordPinPlacementMapModal;
