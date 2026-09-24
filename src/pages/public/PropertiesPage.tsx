import React, { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
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
} from 'lucide-react';
import { propertyService, PropertyFilterParams } from '../../application/services/propertyService';
import { PropertyCard } from '../../components/ui/PropertyCard';
import { PropertyCardSkeleton } from '../../components/ui/LoadingSkeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { LOCATIONS, getLocationById } from '../../domain/locations';

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
  const [loading, setLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

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

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              Student Accommodations Directory
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400">
              BUK Off-Campus
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
            Showing {properties.length} verified listings across Dambare and Rimin Gata (Gwarzo Road)
          </p>
        </div>

        {/* Search Input Bar */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => updateParam('q', e.target.value)}
              placeholder="Search hostel, Dambare, Rimin Gata, solar..."
              className="w-full pl-9 pr-4 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-900 dark:text-white"
            />
          </div>

          <button
            onClick={() => setMobileFilterOpen(!mobileFilterOpen)}
            className="md:hidden flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-700 dark:text-slate-300"
          >
            <Filter className="w-4 h-4" />
            <span>Filters ({activeFilterCount})</span>
          </button>
        </div>
      </div>

      {/* Quick Location Pills / Chips */}
      <div className="flex flex-wrap items-center gap-2 pt-1 pb-1">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mr-1 flex items-center gap-1">
          <MapPin className="w-3 h-3 text-emerald-500" />
          Location:
        </span>

        <button
          onClick={() => {
            updateParam('loc', 'all');
            updateParam('neighbourhood', 'All');
          }}
          className={`px-3 py-1.5 rounded-xl text-xs font-medium transition ${
            locationParam === 'all' && neighbourhood === 'All'
              ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-xs'
              : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300'
          }`}
        >
          All Off-Campus Areas
        </button>

        <button
          onClick={() => {
            updateParam('loc', 'loc-dambare');
            updateParam('neighbourhood', 'Dambare');
          }}
          className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 transition ${
            locationParam === 'loc-dambare' || neighbourhood === 'Dambare'
              ? 'bg-emerald-600 text-white shadow-xs'
              : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300'
          }`}
        >
          <span>📍 Dambare Only</span>
          <span className="text-[10px] opacity-80">(~0.4km)</span>
        </button>

        <button
          onClick={() => {
            updateParam('loc', 'loc-rimin-gata');
            updateParam('neighbourhood', 'Rimin Gata');
          }}
          className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 transition ${
            locationParam === 'loc-rimin-gata' || neighbourhood === 'Rimin Gata'
              ? 'bg-purple-600 text-white shadow-xs'
              : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300'
          }`}
        >
          <span>📍 Rimin Gata Only</span>
          <span className="text-[10px] opacity-80">(~0.9km)</span>
        </button>

        <button
          onClick={() => updateParam('availableOnly', availabilityOnly ? '' : 'true')}
          className={`px-3 py-1.5 rounded-xl text-xs font-medium transition ${
            availabilityOnly
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 font-semibold'
              : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
          }`}
        >
          🟢 Spaces Available
        </button>

        <button
          onClick={() => updateParam('verifiedOnly', onlyVerifiedLandlord ? '' : 'true')}
          className={`px-3 py-1.5 rounded-xl text-xs font-medium transition ${
            onlyVerifiedLandlord
              ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-300 dark:border-blue-800 font-semibold'
              : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
          }`}
        >
          🛡️ Verified Landlords Only
        </button>
      </div>

      {/* Settlement Context Card (when filtered) */}
      {currentLocMeta && (
        <div className="p-3.5 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-800/40 flex items-start gap-3 text-xs">
          <Info className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <span className="font-semibold text-emerald-900 dark:text-emerald-200">
              Exploring {currentLocMeta.name} ({currentLocMeta.city}, {currentLocMeta.state})
            </span>
            <p className="text-emerald-700 dark:text-emerald-300 text-[11px] leading-relaxed">
              {currentLocMeta.description}. Proximity: {currentLocMeta.distanceEstimate} from Bayero University Kano New Campus main gate.
            </p>
          </div>
        </div>
      )}

      {/* Main Content Layout with Sidebar Filters */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
        {/* Filter Sidebar (Desktop & Mobile Drawer) */}
        <div
          className={`${
            mobileFilterOpen ? 'block' : 'hidden'
          } md:block md:col-span-1 space-y-6 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 self-start shadow-xs`}
        >
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <SlidersHorizontal className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>Filters</span>
              {activeFilterCount > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-bold">
                  {activeFilterCount}
                </span>
              )}
            </div>
            {activeFilterCount > 0 && (
              <button
                onClick={resetFilters}
                className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-emerald-600 transition"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset</span>
              </button>
            )}
          </div>

          {/* Sort By */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Sort Listings</label>
            <select
              value={sortBy}
              onChange={(e) => updateParam('sort', e.target.value)}
              className="w-full text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2 text-slate-800 dark:text-slate-200 focus:outline-none"
            >
              <option value="relevance">Relevance & Verified First</option>
              <option value="price_asc">Price: Lowest to Highest</option>
              <option value="price_desc">Price: Highest to Lowest</option>
              <option value="distance">Proximity: Closest to BUK Gate</option>
              <option value="availability">Highest Spaces Available</option>
              <option value="newest">Recently Listed</option>
            </select>
          </div>

          {/* Location / Settlement Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Off-Campus Settlement</label>
            <select
              value={locationParam}
              onChange={(e) => {
                updateParam('loc', e.target.value);
                if (e.target.value === 'loc-dambare') updateParam('neighbourhood', 'Dambare');
                else if (e.target.value === 'loc-rimin-gata') updateParam('neighbourhood', 'Rimin Gata');
                else updateParam('neighbourhood', 'All');
              }}
              className="w-full text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2 text-slate-800 dark:text-slate-200 focus:outline-none"
            >
              <option value="all">All Settlements (Dambare & Rimin Gata)</option>
              {LOCATIONS.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name} ({loc.distanceEstimate})
                </option>
              ))}
            </select>
          </div>

          {/* Property Type */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Property Type</label>
            <select
              value={propertyType}
              onChange={(e) => updateParam('propertyType', e.target.value)}
              className="w-full text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2 text-slate-800 dark:text-slate-200 focus:outline-none"
            >
              <option value="All">All Types</option>
              <option value="Hostel">Hostel</option>
              <option value="Apartment">Apartment</option>
              <option value="Studio">Studio</option>
              <option value="Shared House">Shared House</option>
            </select>
          </div>

          {/* Room Configuration */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Room Configuration</label>
            <select
              value={accommodationType}
              onChange={(e) => updateParam('accommodationType', e.target.value)}
              className="w-full text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2 text-slate-800 dark:text-slate-200 focus:outline-none"
            >
              <option value="All">Any Room Option</option>
              <option value="Single Room">Single Room (Private)</option>
              <option value="Shared Room (2-person)">Shared Room (2-Person)</option>
              <option value="Self-Contained Flat">Self-Contained Flat</option>
            </select>
          </div>

          {/* Gender Policy */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Gender Policy</label>
            <select
              value={genderPolicy}
              onChange={(e) => updateParam('genderPolicy', e.target.value)}
              className="w-full text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2 text-slate-800 dark:text-slate-200 focus:outline-none"
            >
              <option value="All">No Gender Restriction (All)</option>
              <option value="Mixed">Mixed Hostels</option>
              <option value="Female-Only">Female-Only Hostels</option>
              <option value="Male-Only">Male-Only Hostels</option>
            </select>
          </div>

          {/* Max Distance */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Max Distance to Gate</span>
              <span className="text-slate-500">{maxDistanceKm > 0 ? `${maxDistanceKm} km` : 'Any'}</span>
            </div>
            <input
              type="range"
              min="0"
              max="5"
              step="0.5"
              value={maxDistanceKm}
              onChange={(e) => updateParam('maxDistance', e.target.value)}
              className="w-full accent-emerald-600"
            />
          </div>

          {/* Max Price Range */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Max Session Budget</span>
              <span className="text-slate-500 font-medium">₦{maxPrice.toLocaleString()}</span>
            </div>
            <input
              type="range"
              min="150000"
              max="1000000"
              step="25000"
              value={maxPrice}
              onChange={(e) => updateParam('maxPrice', e.target.value)}
              className="w-full accent-emerald-600"
            />
          </div>

          {/* Amenities Multi-filter */}
          <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
              Required Amenities
            </span>
            <div className="space-y-1.5">
              {COMMON_AMENITIES.map((am) => {
                const checked = selectedAmenities.includes(am);
                return (
                  <label
                    key={am}
                    className="flex items-center gap-2 cursor-pointer text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleAmenity(am)}
                      className="w-3.5 h-3.5 rounded text-emerald-600 accent-emerald-600"
                    />
                    <span className="truncate">{am}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Verified Landlord & Availability Toggles */}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
            <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-800 dark:text-slate-200">
              <input
                type="checkbox"
                checked={onlyVerifiedLandlord}
                onChange={(e) => updateParam('verifiedOnly', e.target.checked ? 'true' : '')}
                className="w-4 h-4 rounded text-emerald-600 accent-emerald-600"
              />
              <span>Verified Landlords Only</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-800 dark:text-slate-200">
              <input
                type="checkbox"
                checked={availabilityOnly}
                onChange={(e) => updateParam('availableOnly', e.target.checked ? 'true' : '')}
                className="w-4 h-4 rounded text-emerald-600 accent-emerald-600"
              />
              <span>Only Available Units</span>
            </label>
          </div>
        </div>

        {/* Listings Grid */}
        <div className="md:col-span-3 space-y-6">
          {hasError ? (
            <div className="p-8 text-center bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900 rounded-3xl space-y-3">
              <AlertCircle className="w-10 h-10 text-rose-500 mx-auto" />
              <h3 className="text-base font-bold text-rose-900 dark:text-rose-200">
                Failed to Load Listings
              </h3>
              <p className="text-xs text-rose-700 dark:text-rose-300 max-w-sm mx-auto">
                An error occurred while querying accommodation records. Please reset filters and try again.
              </p>
              <button
                onClick={resetFilters}
                className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-500 transition"
              >
                Reset Search Filters
              </button>
            </div>
          ) : loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <PropertyCardSkeleton key={i} />
              ))}
            </div>
          ) : properties.length === 0 ? (
            <EmptyState
              icon={<Building2 className="w-10 h-10 text-slate-400" />}
              title="No Accommodations Found"
              description={`No properties matched your current criteria${
                locationParam !== 'all' ? ` in ${currentLocMeta?.name || 'this location'}` : ''
              }. Try adjusting your distance, budget, or clearing amenity filters.`}
              actionText="Reset All Filters"
              onAction={resetFilters}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {properties.map((property) => (
                <PropertyCard key={property.id} property={property} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
