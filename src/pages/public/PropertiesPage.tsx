/**
 * @file PropertiesPage.tsx
 * @module pages/public/PropertiesPage
 * @description Primary public and student accommodation discovery catalog.
 *
 * Capabilities & Filters:
 * - Corridor Filtering: Scoped to BUK New Site off-campus residential settlements: Dambare and Rimin Gata.
 * - Price & Type Filters: Annual rental pricing range, property type (self-contained, single room, flat), gender policy.
 * - Verified Listings Only: By default, displays only properties approved by platform administrators (`verificationStatus === 'approved'`).
 * - Opt-in Location Proximity: Students can voluntarily trigger "Near Me" device geolocation; calculates straight-line
 *   distance and 8-point compass sector without storing coordinates.
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  Search,
  Filter,
  SlidersHorizontal,
  RotateCcw,
  Building2,
  MapPin,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Info,
  ShieldCheck,
  Map as MapIcon,
  List as ListIcon,
  X,
  ExternalLink,
} from 'lucide-react';
import { propertyService, PropertyFilterParams } from '../../application/services/propertyService';
import { PropertyCard } from '../../components/ui/PropertyCard';
import { PropertyCardSkeleton } from '../../components/ui/LoadingSkeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { LOCATIONS, getLocationById } from '../../domain/locations';
import { PropertyMap } from '../../components/map/PropertyMap';
import { requestCurrentDevicePosition, GeolocationErrorResult } from '../../application/services/geolocationService';
import { useAuth } from '../../application/context/AuthContext';
import { Compass, Loader2 } from 'lucide-react';
import { appConfig } from '../../infrastructure/config/appConfig';
import { NearbyAccommodationItem } from '../../application/services/propertyService';

const COMMON_AMENITIES = [
  'Solar Inverter Backup',
  'Borehole & Running Water',
  '24/7 Security Guard',
  'Study Desk & Chair',
  'High-speed WiFi',
  'Kitchenette',
  'Fenced & Gated Perimeter',
];

export const PropertiesPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const [mobileViewMode, setMobileViewMode] = useState<'list' | 'map'>('list');
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(
    searchParams.get('selected') || null
  );
  const [hoveredPropertyId, setHoveredPropertyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasError, setHasError] = useState(false);
  const [propertiesRevision, setPropertiesRevision] = useState(0);

  // Device-location nearby search state (sensitive, one-time only; never stored)
  const { currentUser } = useAuth();
  const [isLocating, setIsLocating] = useState(false);
  const [nearbyResults, setNearbyResults] = useState<NearbyAccommodationItem[] | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  const loadDirectory = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setHasError(false);
    try {
      await propertyService.ensurePropertiesLoaded();
      await propertyService.refreshApprovedProperties();
      setPropertiesRevision((n) => n + 1);
    } catch (err: any) {
      setLoadError(err?.message || 'Could not load approved accommodation listings.');
      setHasError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = propertyService.subscribeToProperties(() => {
      setPropertiesRevision((n) => n + 1);
    });
    void loadDirectory();
    return unsubscribe;
  }, [loadDirectory]);

  // References for smooth scrolling
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Parse search params into reactive filter state
  const query = searchParams.get('q') || '';
  const locationParam = searchParams.get('loc') || 'all'; // 'all' | 'loc-dambare' | 'loc-rimin-gata'
  const neighbourhood = searchParams.get('neighbourhood') || 'All';
  const propertyType = searchParams.get('propertyType') || 'All';
  const accommodationType = searchParams.get('accommodationType') || 'All';
  const genderPolicy = searchParams.get('genderPolicy') || 'All';
  const maxDistanceKm = searchParams.get('maxDistance') ? Number(searchParams.get('maxDistance')) : 0;
  const minPrice = searchParams.get('minPrice') ? Number(searchParams.get('minPrice')) : 0;
  const maxPrice = searchParams.get('maxPrice') ? Number(searchParams.get('maxPrice')) : 1000000;
  const onlyVerifiedLandlord = searchParams.get('verifiedOnly') === 'true';
  const availabilityOnly = searchParams.get('availableOnly') === 'true';
  const selectedAmenities = searchParams.getAll('amenity');
  const sortBy = (searchParams.get('sort') as PropertyFilterParams['sortBy']) || 'relevance';

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === 'All' || value === '0' || value === 'all') {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  };

  const toggleAmenity = (amenity: string) => {
    const next = new URLSearchParams(searchParams);
    const existing = next.getAll('amenity');
    next.delete('amenity');
    if (existing.includes(amenity)) {
      existing.filter((a) => a !== amenity).forEach((a) => next.append('amenity', a));
    } else {
      [...existing, amenity].forEach((a) => next.append('amenity', a));
    }
    setSearchParams(next, { replace: true });
  };

  const resetFilters = () => {
    setSearchParams(new URLSearchParams(), { replace: true });
    setHasError(false);
    setSelectedPropertyId(null);
    setNearbyResults(null);
    setLocationError(null);
  };

  const clearNearbySearch = () => {
    setNearbyResults(null);
    setLocationError(null);
  };

  const handleUseMyLocation = async () => {
    setLocationError(null);
    setIsLocating(true);

    try {
      // 1. One-time explicit geolocation request using browser Geolocation API
      const position = await requestCurrentDevicePosition();

      // 2. Derive results from backend ranking
      if (appConfig.backendMode === 'mock') {
        setLocationError(
          'Nearby ranking requires live Supabase authentication. In demo/mock mode, please use manual settlement filters (Dambare or Rimin Gata).'
        );
        setIsLocating(false);
        return;
      }

      if (!currentUser) {
        setLocationError(
          'Please sign in with your student account to search accommodations near your device.'
        );
        setIsLocating(false);
        return;
      }

      const results = await propertyService.findNearbyAccommodations(
        position.latitude,
        position.longitude
      );

      setNearbyResults(results);
      if (results.length === 0) {
        setLocationError(
          'No verified accommodations found within range of your current location. Try exploring Dambare or Rimin Gata manually.'
        );
      }
    } catch (err: any) {
      const geoErr = err as GeolocationErrorResult;
      setLocationError(
        geoErr?.message || err?.message || 'Could not determine device location. Please search manually.'
      );
    } finally {
      setIsLocating(false);
    }
  };

  // Determine active location IDs
  const activeLocationIds = useMemo(() => {
    if (locationParam === 'loc-dambare') return ['loc-dambare'];
    if (locationParam === 'loc-rimin-gata') return ['loc-rimin-gata'];
    if (neighbourhood === 'Dambare') return ['loc-dambare'];
    if (neighbourhood === 'Rimin Gata') return ['loc-rimin-gata'];
    return undefined; // All locations
  }, [locationParam, neighbourhood]);

  const properties = useMemo(() => {
    try {
      return propertyService.searchProperties({
        query,
        locationIds: activeLocationIds,
        neighbourhood: neighbourhood !== 'All' ? neighbourhood : undefined,
        propertyType,
        accommodationType,
        genderPolicy,
        maxDistanceKm: maxDistanceKm > 0 ? maxDistanceKm : undefined,
        minPrice: minPrice > 0 ? minPrice : undefined,
        maxPrice,
        onlyVerifiedLandlord,
        availabilityOnly,
        amenities: selectedAmenities.length > 0 ? selectedAmenities : undefined,
        sortBy,
        onlyApproved: true,
      });
    } catch (err) {
      console.error('Error searching properties:', err);
      setHasError(true);
      return [];
    }
  }, [
    propertiesRevision,
    query,
    activeLocationIds,
    neighbourhood,
    propertyType,
    accommodationType,
    genderPolicy,
    maxDistanceKm,
    minPrice,
    maxPrice,
    onlyVerifiedLandlord,
    availabilityOnly,
    selectedAmenities,
    sortBy,
  ]);

  // Combine standard search with nearby ranking if activated
  const displayedProperties = useMemo(() => {
    if (!nearbyResults || nearbyResults.length === 0) {
      return properties.map((p) => ({ property: p, proximity: undefined }));
    }

    // Map each nearby item to property and proximity metadata
    const nearbyMap = new Map<string, { distanceKm: number; compassDirection: 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | null }>();
    for (const item of nearbyResults) {
      nearbyMap.set(item.property.id, {
        distanceKm: item.proximityDistanceKm,
        compassDirection: item.compassDirection,
      });
    }

    // Filter by existing active search filters (e.g. price, propertyType, etc.)
    const matched: Array<{
      property: (typeof properties)[number];
      proximity?: { distanceKm: number; compassDirection: 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | null };
    }> = [];

    for (const item of nearbyResults) {
      const foundInFiltered = properties.find((p) => p.id === item.property.id);
      if (foundInFiltered) {
        matched.push({
          property: foundInFiltered,
          proximity: nearbyMap.get(foundInFiltered.id),
        });
      }
    }

    return matched;
  }, [properties, nearbyResults]);

  const activeFilterCount = [
    query ? 1 : 0,
    locationParam !== 'all' ? 1 : 0,
    neighbourhood !== 'All' ? 1 : 0,
    propertyType !== 'All' ? 1 : 0,
    accommodationType !== 'All' ? 1 : 0,
    genderPolicy !== 'All' ? 1 : 0,
    maxDistanceKm > 0 ? 1 : 0,
    minPrice > 0 ? 1 : 0,
    maxPrice < 1000000 ? 1 : 0,
    onlyVerifiedLandlord ? 1 : 0,
    availabilityOnly ? 1 : 0,
    selectedAmenities.length,
  ].reduce((a, b) => a + b, 0);

  // Selected location meta
  const currentLocMeta = locationParam !== 'all' ? getLocationById(locationParam) : null;

  // Selected property object for mobile drawer / bottom sheet
  const selectedProp = useMemo(() => {
    return properties.find((p) => p.id === selectedPropertyId);
  }, [properties, selectedPropertyId]);

  // Handle marker selection from map
  const handleSelectFromMap = (id: string) => {
    setSelectedPropertyId(id);
    const cardEl = cardRefs.current.get(id);
    if (cardEl && mobileViewMode === 'list') {
      cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              Student Accommodation Directory
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800">
              Bayero Univ. Kano (BUK)
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
            Displaying {properties.length} verified listings in Dambare & Rimin Gata off-campus corridor
          </p>
        </div>

        {/* Search Input Bar & Mobile Controls */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => updateParam('q', e.target.value)}
              placeholder="Search hostel, Dambare, Rimin Gata, solar..."
              className="w-full pl-9 pr-4 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-white"
            />
          </div>

          <button
            onClick={() => setMobileFilterOpen(!mobileFilterOpen)}
            className="lg:hidden flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-700 dark:text-slate-300"
          >
            <Filter className="w-4 h-4" />
            <span>Filters ({activeFilterCount})</span>
          </button>
        </div>
      </div>

      {/* Quick Location Pills / Settlement Area Filter Chips */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 pb-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mr-1 flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5 text-emerald-500" />
            Area:
          </span>

          <button
            onClick={() => {
              updateParam('loc', 'all');
              updateParam('neighbourhood', 'All');
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
              locationParam === 'all' && neighbourhood === 'All'
                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-xs'
                : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300'
            }`}
          >
            All Areas
          </button>

          <button
            onClick={() => {
              updateParam('loc', 'loc-dambare');
              updateParam('neighbourhood', 'Dambare');
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition ${
              locationParam === 'loc-dambare' || neighbourhood === 'Dambare'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300'
            }`}
          >
            <span>Dambare</span>
            <span className="text-[10px] opacity-80">(~0.4km opposite BUK Gate)</span>
          </button>

          <button
            onClick={() => {
              updateParam('loc', 'loc-rimin-gata');
              updateParam('neighbourhood', 'Rimin Gata');
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition ${
              locationParam === 'loc-rimin-gata' || neighbourhood === 'Rimin Gata'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300'
            }`}
          >
            <span>Rimin Gata</span>
            <span className="text-[10px] opacity-80">(~0.9km west)</span>
          </button>

          <button
            onClick={() => updateParam('availableOnly', availabilityOnly ? '' : 'true')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
              availabilityOnly
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            Spaces Available
          </button>

          {/* Explicit 'Use my location' control */}
          <button
            type="button"
            onClick={nearbyResults ? clearNearbySearch : handleUseMyLocation}
            disabled={isLocating}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
              nearbyResults
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40'
            }`}
            title="Search accommodations near your current device location"
            aria-label="Use my location for accommodation search"
          >
            {isLocating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Compass className="w-3.5 h-3.5" />
            )}
            <span>
              {isLocating
                ? 'Locating device…'
                : nearbyResults
                ? `Proximity Search Active (${nearbyResults.length}) • Clear`
                : 'Use my location'}
            </span>
          </button>
        </div>

        {/* Mobile Map / List Toggle Button */}
        <div className="hidden invisible" aria-hidden="true">
          <button
            onClick={() => setMobileViewMode('list')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg transition ${
              mobileViewMode === 'list'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <ListIcon className="w-3.5 h-3.5" />
            <span>List</span>
          </button>
          <button
            onClick={() => setMobileViewMode('map')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg transition ${
              mobileViewMode === 'map'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <MapIcon className="w-3.5 h-3.5" />
            <span>Map</span>
          </button>
        </div>
      </div>

      {/* Main Content Area: Split View on Desktop (List + Map) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Filter Sidebar (Desktop) + Property List */}
        <div
          className={`lg:col-span-7 space-y-6 ${
            mobileViewMode === 'map' ? 'hidden lg:block' : 'block'
          }`}
        >
          {/* Active Nearby Search Banner & Disclaimers */}
          {nearbyResults && (
            <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/80 space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-emerald-900 dark:text-emerald-200">
                  <Compass className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>Sorted by Proximity from Your Current Device Position</span>
                </div>
                <button
                  type="button"
                  onClick={clearNearbySearch}
                  className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 hover:underline cursor-pointer"
                >
                  Clear proximity sort
                </button>
              </div>
              <p className="text-[11px] text-emerald-800 dark:text-emerald-300 leading-relaxed">
                Distance is rounded to the nearest 0.1 km and direction shows coarse 8-point compass sector (N, NE, E, SE, S, SW, W, NW).
                <strong> Note:</strong> Distance and direction are approximate straight-line estimates and are not turn-by-turn navigation.
              </p>
            </div>
          )}

          {/* Location Error Display */}
          {locationError && (
            <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1">
                <p className="font-semibold">Nearby Search Notice</p>
                <p>{locationError}</p>
                <div className="flex items-center gap-3 pt-1 text-[11px]">
                  <button
                    type="button"
                    onClick={handleUseMyLocation}
                    className="font-bold underline text-amber-900 dark:text-amber-200 hover:text-amber-700"
                  >
                    Retry location request
                  </button>
                  <span className="text-amber-400">•</span>
                  <button
                    type="button"
                    onClick={() => setLocationError(null)}
                    className="text-amber-700 dark:text-amber-400 hover:underline"
                  >
                    Dismiss and search manually
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Active Filters Bar & Sorter */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200/80 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                {displayedProperties.length} Accommodations
              </span>
              {(activeFilterCount > 0 || nearbyResults !== null) && (
                <button
                  onClick={resetFilters}
                  className="inline-flex items-center gap-1 text-[11px] text-rose-600 hover:text-rose-700 font-medium cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset All</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-400 text-xs">Sort:</span>
              <select
                value={sortBy}
                onChange={(e) => updateParam('sort', e.target.value)}
                className="py-1 px-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-hidden"
              >
                <option value="relevance">Recommended (BUK Proximity)</option>
                <option value="price_asc">Price: Low to High</option>
                <option value="price_desc">Price: High to Low</option>
                <option value="distance">Distance from Campus</option>
                <option value="availability">Spaces Available</option>
                <option value="newest">Recently Listed</option>
              </select>
            </div>
          </div>

          {/* Properties List / Cards */}
          {hasError ? (
            <div className="p-8 text-center bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900 rounded-3xl space-y-3">
              <AlertCircle className="w-10 h-10 text-rose-500 mx-auto" />
              <h3 className="text-base font-bold text-rose-900 dark:text-rose-200">
                Failed to Query Listings
              </h3>
              <p className="text-xs text-rose-700 dark:text-rose-300 max-w-sm mx-auto">
                {loadError || 'An error occurred while loading accommodation records. Please retry.'}
              </p>
              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadDirectory()}
                  className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-500 transition cursor-pointer"
                >
                  Retry Loading
                </button>
                <button
                  type="button"
                  onClick={resetFilters}
                  className="px-4 py-2 rounded-xl border border-rose-300 text-rose-700 dark:text-rose-200 text-xs font-semibold hover:bg-rose-100/60 transition cursor-pointer"
                >
                  Reset Filters
                </button>
              </div>
            </div>
          ) : loading && displayedProperties.length === 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <PropertyCardSkeleton key={i} />
              ))}
            </div>
          ) : displayedProperties.length === 0 ? (
            <EmptyState
              icon={<Building2 className="w-10 h-10 text-slate-400" />}
              title="No Accommodations Match Criteria"
              description={`No student lodges matched your current filter criteria${
                locationParam !== 'all' ? ` in ${currentLocMeta?.name || 'this area'}` : ''
              }. Try adjusting price range, distance, or resetting filters.`}
              actionText="Reset All Filters"
              onAction={resetFilters}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {displayedProperties.map(({ property, proximity }) => (
                <div
                  key={property.id}
                  ref={(el) => {
                    if (el) cardRefs.current.set(property.id, el);
                    else cardRefs.current.delete(property.id);
                  }}
                >
                  <PropertyCard
                    property={property}
                    proximity={proximity}
                    isSelected={selectedPropertyId === property.id}
                    onSelect={(id) => setSelectedPropertyId(id)}
                    onMouseEnter={() => setHoveredPropertyId(property.id)}
                    onMouseLeave={() => setHoveredPropertyId(null)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Column: Sticky MapLibre Interactive Map (Desktop + Mobile Map Mode) */}
        <div
          className={`lg:col-span-5 ${
            mobileViewMode === 'list' ? 'hidden lg:block' : 'block'
          } sticky top-20`}
        >
          <div className="space-y-3">
            <PropertyMap
              properties={properties}
              selectedPropertyId={selectedPropertyId}
              hoveredPropertyId={hoveredPropertyId}
              onSelectProperty={handleSelectFromMap}
              height="calc(100vh - 150px)"
              className="min-h-[500px]"
              zoomToFit
            />

            {/* Case Study Legal & Privacy Notice */}
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                <strong>Privacy Protected:</strong> Building markers show neighborhood coordinates with privacy offsets. Exact physical gate addresses and contact records are unlocked after verified reservation hold.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Selected Marker Bottom Sheet (Visible on mobile when in map mode and a marker is selected) */}
      {mobileViewMode === 'map' && selectedProp && (
        <div className="fixed bottom-0 inset-x-0 z-50 p-4 bg-white dark:bg-slate-900 rounded-t-3xl border-t border-slate-200 dark:border-slate-800 shadow-2xl space-y-3 animate-in slide-in-from-bottom duration-200">
          <div className="w-10 h-1 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto" />
          <div className="flex items-start justify-between gap-3">
            <div className="flex gap-3">
              {selectedProp.images[0] ? (
                <img
                  src={selectedProp.images[0]}
                  alt={selectedProp.title}
                  className="w-20 h-20 rounded-2xl object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-20 h-20 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center flex-shrink-0 text-slate-400">
                  <Building2 className="w-7 h-7" />
                </div>
              )}
              <div className="space-y-1">
                <span className="text-[11px] font-semibold text-emerald-600 uppercase">
                  {selectedProp.propertyType} • {selectedProp.neighbourhood}
                </span>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white line-clamp-1">
                  {selectedProp.title}
                </h3>
                <p className="text-xs font-black text-slate-900 dark:text-white">
                  ₦{selectedProp.pricePerSession.toLocaleString()}{' '}
                  <span className="text-[10px] font-normal text-slate-400">/ session</span>
                </p>
                <div className="text-[11px] text-slate-500">
                  {selectedProp.availableSpaces} spaces available • {selectedProp.distanceKm}km from BUK Gate
                </div>
              </div>
            </div>

            <button
              onClick={() => setSelectedPropertyId(null)}
              className="p-1 rounded-full text-slate-400 hover:text-slate-600"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="pt-2 flex gap-2">
            <Link
              to={`/properties/${selectedProp.slug || selectedProp.id}`}
              className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs text-center shadow-xs flex items-center justify-center gap-1.5"
            >
              <span>View Property Details</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
};
