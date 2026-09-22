import React, { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Filter, SlidersHorizontal, RotateCcw, Building2 } from 'lucide-react';
import { propertyService, PropertyFilterParams } from '../../application/services/propertyService';
import { PropertyCard } from '../../components/ui/PropertyCard';
import { PropertyCardSkeleton } from '../../components/ui/LoadingSkeleton';
import { EmptyState } from '../../components/ui/EmptyState';

export const PropertiesPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Parse search params into filter state
  const query = searchParams.get('q') || '';
  const university = searchParams.get('university') || 'All';
  const neighbourhood = searchParams.get('neighbourhood') || 'All';
  const propertyType = searchParams.get('propertyType') || 'All';
  const accommodationType = searchParams.get('accommodationType') || 'All';
  const genderPolicy = searchParams.get('genderPolicy') || 'All';
  const maxDistanceKm = searchParams.get('maxDistance') ? Number(searchParams.get('maxDistance')) : 0;
  const maxPrice = searchParams.get('maxPrice') ? Number(searchParams.get('maxPrice')) : 1000000;
  const onlyVerifiedLandlord = searchParams.get('verifiedOnly') === 'true';
  const sortBy = (searchParams.get('sort') as PropertyFilterParams['sortBy']) || 'relevance';

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === 'All' || value === '0') {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    setSearchParams(next);
  };

  const resetFilters = () => {
    setSearchParams(new URLSearchParams());
  };

  const availableInstitutions = useMemo(() => {
    const all = propertyService.searchProperties({ onlyApproved: false });
    const set = new Set<string>();
    all.forEach((p) => {
      if (p.university) set.add(p.university);
    });
    return Array.from(set).sort();
  }, []);

  const availableNeighbourhoods = useMemo(() => {
    const all = propertyService.searchProperties({ onlyApproved: false });
    const set = new Set<string>();
    all.forEach((p) => {
      if (p.neighbourhood) set.add(p.neighbourhood);
    });
    return Array.from(set).sort();
  }, []);

  const properties = useMemo(() => {
    return propertyService.searchProperties({
      query,
      university,
      neighbourhood,
      propertyType,
      accommodationType,
      genderPolicy,
      maxDistanceKm: maxDistanceKm > 0 ? maxDistanceKm : undefined,
      maxPrice,
      onlyVerifiedLandlord,
      sortBy,
      onlyApproved: true,
    });
  }, [query, university, neighbourhood, propertyType, accommodationType, genderPolicy, maxDistanceKm, maxPrice, onlyVerifiedLandlord, sortBy]);

  const activeFilterCount = [
    query ? 1 : 0,
    university !== 'All' ? 1 : 0,
    neighbourhood !== 'All' ? 1 : 0,
    propertyType !== 'All' ? 1 : 0,
    accommodationType !== 'All' ? 1 : 0,
    genderPolicy !== 'All' ? 1 : 0,
    maxDistanceKm > 0 ? 1 : 0,
    maxPrice < 1000000 ? 1 : 0,
    onlyVerifiedLandlord ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Browse Student Accommodations
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
            Showing {properties.length} verified listings across campuses
          </p>
        </div>

        {/* Search Input Bar */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => updateParam('q', e.target.value)}
              placeholder="Search area, hostel name..."
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
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Sort Results</label>
            <select
              value={sortBy}
              onChange={(e) => updateParam('sort', e.target.value)}
              className="w-full text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2 text-slate-800 dark:text-slate-200 focus:outline-none"
            >
              <option value="relevance">Relevance & Verified Landlord</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
              <option value="distance">Distance from Campus Gate</option>
              <option value="newest">Recently Added</option>
            </select>
          </div>

          {/* University / Institution */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Institution / Campus</label>
            <select
              value={university}
              onChange={(e) => updateParam('university', e.target.value)}
              className="w-full text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2 text-slate-800 dark:text-slate-200 focus:outline-none"
            >
              <option value="All">All Institutions & Campuses</option>
              {availableInstitutions.map((inst) => (
                <option key={inst} value={inst}>
                  {inst}
                </option>
              ))}
            </select>
          </div>

          {/* Student Neighbourhood / Settlement */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Student Settlement / Area</label>
            <select
              value={neighbourhood}
              onChange={(e) => updateParam('neighbourhood', e.target.value)}
              className="w-full text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2 text-slate-800 dark:text-slate-200 focus:outline-none"
            >
              <option value="All">All Settlements (Dambare, Rimin Gata...)</option>
              {availableNeighbourhoods.map((nb) => (
                <option key={nb} value={nb}>
                  {nb}
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
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Room Option</label>
            <select
              value={accommodationType}
              onChange={(e) => updateParam('accommodationType', e.target.value)}
              className="w-full text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2 text-slate-800 dark:text-slate-200 focus:outline-none"
            >
              <option value="All">Any Room Option</option>
              <option value="Single Room">Single Room</option>
              <option value="Shared Room (2-person)">Shared Room (2-person)</option>
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
              <option value="All">No Restriction (All)</option>
              <option value="Mixed">Mixed</option>
              <option value="Female-Only">Female-Only</option>
              <option value="Male-Only">Male-Only</option>
            </select>
          </div>

          {/* Max Distance */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Max Distance</span>
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
              <span className="font-semibold text-slate-700 dark:text-slate-300">Max Budget</span>
              <span className="text-slate-500 font-medium">₦{maxPrice.toLocaleString()}</span>
            </div>
            <input
              type="range"
              min="200000"
              max="1000000"
              step="50000"
              value={maxPrice}
              onChange={(e) => updateParam('maxPrice', e.target.value)}
              className="w-full accent-emerald-600"
            />
          </div>

          {/* Verified Landlord Toggle */}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
            <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-800 dark:text-slate-200">
              <input
                type="checkbox"
                checked={onlyVerifiedLandlord}
                onChange={(e) => updateParam('verifiedOnly', e.target.checked ? 'true' : '')}
                className="w-4 h-4 rounded text-emerald-600 accent-emerald-600"
              />
              <span>Verified Landlords Only</span>
            </label>
          </div>
        </div>

        {/* Listings Grid */}
        <div className="md:col-span-3 space-y-6">
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {Array.from({ length: 6 }).map((_, i) => (
                <PropertyCardSkeleton key={i} />
              ))}
            </div>
          ) : properties.length === 0 ? (
            <EmptyState
              icon={<Building2 className="w-10 h-10 text-slate-400" />}
              title="No Accommodations Found"
              description="No properties matched your current search filters. Try broadening your distance range or resetting filters."
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
