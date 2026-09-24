import React from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Navigation, Bed, CheckCircle2 } from 'lucide-react';
import { Property } from '../../domain/types';
import { VerificationBadge, Badge } from './Badge';

interface PropertyCardProps {
  property: Property;
  isSelected?: boolean;
  onSelect?: (propertyId: string) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export const PropertyCard: React.FC<PropertyCardProps> = ({
  property,
  isSelected = false,
  onSelect,
  onMouseEnter,
  onMouseLeave,
}) => {
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
        <img
          src={property.images[0] || 'https://images.unsplash.com/photo-1555854877-bab0e564b8d5?w=800&auto=format&fit=crop&q=80'}
          alt={property.title}
          className="w-full h-full object-cover group-hover:scale-103 transition-transform duration-300"
        />

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

          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mt-1">
            <MapPin className="w-3.5 h-3.5 flex-shrink-0 text-slate-400" />
            <span className="truncate">{property.neighbourhood}, {property.city}</span>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mt-1">
            <Navigation className="w-3.5 h-3.5 flex-shrink-0 text-emerald-500" />
            <span>{property.distanceKm} km from {property.campus.split('(')[0]}</span>
          </div>
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
