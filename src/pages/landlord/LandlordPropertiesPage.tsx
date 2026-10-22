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

import React from 'react';
import { Link } from 'react-router-dom';
import { Building2, Plus, Bed, ShieldCheck, Clock, CheckCircle2, Sliders } from 'lucide-react';
import { authService } from '../../application/services/authService';
import { propertyService } from '../../application/services/propertyService';
import { VerificationBadge, Badge } from '../../components/ui/Badge';

export const LandlordPropertiesPage: React.FC = () => {
  const session = authService.getSession();
  const properties = propertyService.getLandlordProperties(session.user.id);

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

        <Link
          to="/landlord/properties/new"
          className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Post New Property</span>
        </Link>
      </div>

      {properties.length === 0 ? (
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
          {properties.map((prop) => (
            <div
              key={prop.id}
              className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 overflow-hidden shadow-xs flex flex-col justify-between"
            >
              <div>
                <div className="relative h-44 bg-slate-100 dark:bg-slate-800">
                  <img
                    src={prop.images[0] || 'https://images.unsplash.com/photo-1555854877-bab0e564b8d5?w=800'}
                    alt={prop.title}
                    className="w-full h-full object-cover"
                  />
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
          ))}
        </div>
      )}
    </div>
  );
};
