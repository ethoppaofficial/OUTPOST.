/**
 * @file LandlordPropertiesPage.tsx
 * @module pages/landlord/LandlordPropertiesPage
 * @description Landlord workspace page displaying owned accommodation properties and listings.
 *
 * Capabilities:
 * - Portfolio Overview: Displays owned lodges, room unit counts, and availability numbers.
 * - Verification Indicators: Tracks administrative approval status (`approved`, `pending`, `draft`).
 * - Quick Actions: Direct links to create new properties or jump to the availability manager.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Plus, Sliders, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { useAuth } from '../../application/context/AuthContext';
import { propertyService } from '../../application/services/propertyService';
import { VerificationBadge } from '../../components/ui/Badge';
import { Property } from '../../domain/types';

export const LandlordPropertiesPage: React.FC = () => {
  const { currentUser, loading: authLoading } = useAuth();
  const landlordId = currentUser?.id;

  const [properties, setProperties] = useState<Property[]>(() =>
    landlordId ? propertyService.getLandlordProperties(landlordId) : []
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});

  const loadListings = useCallback(async () => {
    if (authLoading) return;
    if (!landlordId || landlordId === 'anonymous') {
      setProperties([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const fresh = await propertyService.refreshLandlordProperties(landlordId);
      setProperties(fresh);
    } catch (err: any) {
      setLoadError(err?.message || 'Could not load your accommodation listings.');
    } finally {
      setLoading(false);
    }
  }, [authLoading, landlordId]);

  useEffect(() => {
    void loadListings();
    const unsubscribe = propertyService.subscribeToProperties(() => {
      if (landlordId) {
        setProperties(propertyService.getLandlordProperties(landlordId));
      }
    });
    return unsubscribe;
  }, [loadListings, landlordId]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            My Accommodation Listings
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Manage your student hostels, room inventory capacities, and monitor physical verification status
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => void loadListings()}
            disabled={loading}
            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <Link
            to="/landlord/properties/new"
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>Post New Property</span>
          </Link>
        </div>
      </div>

      {loadError && (
        <div role="alert" className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{loadError}</span>
          </div>
          <button type="button" onClick={() => void loadListings()} className="font-bold underline shrink-0 cursor-pointer">
            Retry
          </button>
        </div>
      )}

      {(authLoading || loading) && properties.length === 0 ? (
        <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 flex items-center justify-center gap-2 text-xs text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
          <span>Loading your property listings from Supabase…</span>
        </div>
      ) : properties.length === 0 ? (
        <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-slate-200 dark:border-slate-800 space-y-3">
          <Building2 className="w-8 h-8 text-slate-400 mx-auto" />
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">No Properties Listed Yet</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            List your student hostel or apartment near BUK New Campus (Dambare or Rimin Gata) to begin accepting verified reservations.
          </p>
          <Link
            to="/landlord/properties/new"
            className="inline-block px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold"
          >
            Create Your First Listing
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {properties.map((prop) => {
            const coverUrl = prop.images[0] || '';
            const showFallback = !coverUrl || brokenImages[prop.id];
            return (
              <div
                key={prop.id}
                className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 overflow-hidden shadow-xs flex flex-col justify-between"
              >
                <div>
                  <div className="relative h-44 bg-slate-100 dark:bg-slate-800">
                    {!showFallback ? (
                      <img
                        src={coverUrl}
                        alt={prop.title}
                        onError={() => setBrokenImages((prev) => ({ ...prev, [prop.id]: true }))}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-slate-400 dark:text-slate-500">
                        <Building2 className="w-8 h-8 opacity-60" />
                        <span className="text-[11px] font-medium">Photo unavailable</span>
                      </div>
                    )}
                    <div className="absolute top-3 left-3">
                      <VerificationBadge type="property" status={prop.verificationStatus} />
                    </div>
                    <div className="absolute bottom-3 right-3 bg-slate-900/80 text-white text-xs font-bold px-2.5 py-1 rounded-xl">
                      ₦{prop.pricePerSession.toLocaleString()} / session
                    </div>
                  </div>

                  <div className="p-5 space-y-2.5">
                    <div className="text-xs font-semibold text-emerald-600">{prop.propertyType} • {prop.genderPolicy}</div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white line-clamp-1">{prop.title}</h3>
                    <p className="text-xs text-slate-500">{prop.neighbourhood}, {prop.city} • {prop.campus}</p>

                    <div className="pt-2 text-xs text-slate-600 dark:text-slate-300 flex items-center justify-between">
                      <span>Available Spaces:</span>
                      <span className="font-bold text-emerald-600">{prop.availableSpaces} of {prop.totalCapacity}</span>
                    </div>
                  </div>
                </div>

                <div className="p-5 pt-0 flex gap-2">
                  <Link
                    to={`/properties/${prop.slug || prop.id}`}
                    className="flex-1 py-2 text-center rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200"
                  >
                    Preview Public View
                  </Link>
                  <Link
                    to={`/landlord/properties/${prop.id}/availability`}
                    className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs flex items-center gap-1"
                  >
                    <Sliders className="w-3.5 h-3.5" />
                    <span>Rooms & Spaces</span>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
