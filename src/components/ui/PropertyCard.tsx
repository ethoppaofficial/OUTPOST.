/**
 * @file PropertyCard.tsx
 * @module components/ui/PropertyCard
 * @description Standard accommodation listing presentation card used in search feeds, map sidebars, and home catalog.
 *
 * Visual Indicators & Data Presentation:
 * - Cover Photo with lazy fallback placeholder.
 * - Verification status badge (`approved`, `pending`) and landlord verified shield.
 * - Annual session rental pricing in Nigerian Naira (₦).
 * - Corridor badge (Dambare vs Rimin Gata) with walking distance estimates to BUK New Campus.
 * - Real-time space availability indicator (`availableSpaces / totalCapacity`).
 * - Optional relative proximity indicator with distance (km) and 8-point compass sector.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Navigation, Bed, CheckCircle2, Compass, Building2, User as UserIcon } from 'lucide-react';
import { Property } from '../../domain/types';
import { VerificationBadge, Badge, VerificationTick } from './Badge';
import { getNearestLandmarkOrientation } from '../../domain/geoUtils';
import { getImmediateDualGateProximity } from '../../application/services/walkingRouteService';

interface PropertyCardProps {
  /** Accommodation listing entity to render */
  property: Property;
  /** Whether the card is actively highlighted (e.g. from map pin hover) */
  isSelected?: boolean;
  /** Callback when card is clicked */
  onSelect?: (propertyId: string) => void;
  /** Hover callbacks for synchronizing with map markers */
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  /** Optional approximate straight-line proximity to search origin */
  proximity?: {
    distanceKm: number;
    compassDirection: 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | null;
  };
}

/**
 * Accommodation listing preview card component.
 */
export const PropertyCard: React.FC<PropertyCardProps> = ({
  property,
  isSelected = false,
  onSelect,
  onMouseEnter,
  onMouseLeave,
  proximity,
}) => {
  const coverUrl = property.images[0] || '';
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [coverUrl]);

  return (
    <div
      onClick={() => onSelect?.(property.id)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`group bg-white dark:bg-slate-900 rounded-2xl border overflow-hidden shadow-xs hover:shadow-md transition-all duration-200 flex flex-col cursor-pointer ${
        isSelected
          ? 'border-emerald-500 ring-2 ring-emerald-500/30 dark:border-emerald-400'
          : 'border-slate-200/90 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
      }`}
    >
      {/* Image Header */}
      <div className="relative h-52 w-full overflow-hidden bg-slate-100 dark:bg-slate-800">
        {coverUrl && !imgError ? (
          <img
            src={coverUrl}
            alt={property.title}
            onError={() => setImgError(true)}
            className="w-full h-full object-cover group-hover:scale-103 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-slate-400 dark:text-slate-500">
            <Building2 className="w-10 h-10 opacity-60" />
            <span className="text-[11px] font-medium">Property photo unavailable</span>
          </div>
        )}

        {/* Verification Pill */}
        <div className="absolute top-3 left-3 flex flex-col gap-1.5 items-start">
          <VerificationBadge type="property" status={property.verificationStatus} />
          {property.landlordVerified && (
            <Badge variant="success" size="sm">
              <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
              Verified Landlord
            </Badge>
          )}
        </div>

        {/* Price Tag */}
        <div className="absolute bottom-3 right-3 bg-slate-900/80 backdrop-blur-md text-white px-3 py-1 rounded-xl text-sm font-semibold shadow-sm">
          ₦{property.pricePerSession.toLocaleString()}{' '}
          <span className="text-xs font-normal text-slate-300">/ session</span>
        </div>
      </div>

      {/* Body Content */}
      <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-400 mb-1.5">
            <span>{property.propertyType}</span>
            <span>•</span>
            <span>{property.genderPolicy}</span>
          </div>

          <h3 className="text-base font-semibold text-slate-900 dark:text-white line-clamp-1 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition">
            <Link to={`/properties/${property.slug || property.id}`}>
              {property.title}
            </Link>
          </h3>

          <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 mt-1.5">
            <UserIcon className="w-3.5 h-3.5 flex-shrink-0 text-slate-400" />
            <span className="text-slate-400">Host:</span>
            <Link
              to={`/profiles/landlord/${property.landlordId}`}
              onClick={(e) => e.stopPropagation()}
              className="font-semibold text-slate-800 dark:text-slate-200 hover:text-emerald-600 dark:hover:text-emerald-400 hover:underline truncate"
            >
              {property.landlordName || 'Property Host'}
            </Link>
            <VerificationTick type="landlord" isVerified={Boolean(property.landlordVerified)} />
          </div>

          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mt-1">
            <MapPin className="w-3.5 h-3.5 flex-shrink-0 text-slate-400" />
            <span className="truncate">{property.neighbourhood}, {property.city}</span>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mt-1">
            <Navigation className="w-3.5 h-3.5 flex-shrink-0 text-emerald-500" />
            <span>{property.distanceKm} km from {property.campus.split('(')[0]}</span>
          </div>

          {/* Dual BUK Gates Proximity & Landmark Orientation */}
          {(() => {
            const loc = property.location;
            const lat = loc?.publicLatitude ?? loc?.latitude;
            const lon = loc?.publicLongitude ?? loc?.longitude;
            if (typeof lat !== 'number' || typeof lon !== 'number') return null;

            const dual = getImmediateDualGateProximity(lat, lon);
            const orientation = getNearestLandmarkOrientation(lat, lon);

            return (
              <div className="mt-2.5 space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px]">
                {/* Dual Gate badges */}
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="p-1.5 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300">
                    <span className="font-semibold block text-[10px] text-emerald-700 dark:text-emerald-400">Gate 1 (Main)</span>
                    <span className="font-medium truncate block">
                      {dual.gate1.formattedDuration ? `${dual.gate1.formattedDuration} • ` : ''}
                      {dual.gate1.formattedDistance}
                    </span>
                  </div>

                  <div className="p-1.5 rounded-lg bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200/60 dark:border-blue-800/60 text-blue-800 dark:text-blue-300">
                    <span className="font-semibold block text-[10px] text-blue-700 dark:text-blue-400">Gate 2</span>
                    <span className="font-medium truncate block">
                      {dual.gate2.formattedDuration ? `${dual.gate2.formattedDuration} • ` : ''}
                      {dual.gate2.formattedDistance}
                    </span>
                  </div>
                </div>

                {/* Landmark Orientation Context */}
                {orientation && (
                  <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400 text-[11px] px-1">
                    <Compass className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                    <span className="truncate">{orientation.formattedDescription}</span>
                  </div>
                )}
              </div>
            );
          })()}

          {proximity && (
            <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/80 px-2.5 py-1 rounded-xl mt-2">
              <Compass className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>
                ~{proximity.distanceKm.toFixed(1)} km
                {proximity.compassDirection ? ` ${proximity.compassDirection}` : ''} from your current device point
              </span>
            </div>
          )}
        </div>

        {/* Availability & Amenities Footer */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
            <Bed className="w-4 h-4 text-slate-400" />
            <span className="font-medium">
              {property.availableSpaces > 0 ? (
                <span className="text-emerald-600 dark:text-emerald-400">
                  {property.availableSpaces} spaces available
                </span>
              ) : (
                <span className="text-rose-500">Fully Booked</span>
              )}
            </span>
          </div>

          <Link
            to={`/properties/${property.slug || property.id}`}
            className="inline-flex items-center px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white dark:bg-emerald-600 dark:hover:bg-emerald-500 text-xs font-medium transition"
          >
            View Details
          </Link>
        </div>
      </div>
    </div>
  );
};
