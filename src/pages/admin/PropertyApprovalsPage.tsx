import React, { useState } from 'react';
import {
  Building2,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  Clock,
  ExternalLink,
  MapPin,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { propertyService } from '../../application/services/propertyService';
import { Property } from '../../domain/types';
import { VerificationBadge, Badge } from '../../components/ui/Badge';
import { PropertyMap } from '../../components/map/PropertyMap';

export const PropertyApprovalsPage: React.FC = () => {
  const [properties, setProperties] = useState<Property[]>(() => propertyService.getAllProperties());
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [expandedMapPropId, setExpandedMapPropId] = useState<string | null>(null);

  const handleApprove = (prop: Property) => {
    // Approve property and verify location
    const updatedLocation = prop.location
      ? {
          ...prop.location,
          verificationStatus: 'verified' as const,
          reviewedBy: 'user-admin-1',
          reviewedAt: new Date().toISOString(),
        }
      : undefined;

    propertyService.updateProperty(prop.id, {
      verificationStatus: 'approved',
      location: updatedLocation,
    });
    setProperties(propertyService.getAllProperties());
    setActionSuccess(`Property "${prop.title}" and physical location verified & published!`);
    setTimeout(() => setActionSuccess(null), 3000);
  };

  const handleReject = (prop: Property) => {
    const updatedLocation = prop.location
      ? {
          ...prop.location,
          verificationStatus: 'rejected' as const,
          reviewedBy: 'user-admin-1',
          reviewedAt: new Date().toISOString(),
        }
      : undefined;

    propertyService.updateProperty(prop.id, {
      verificationStatus: 'rejected',
      location: updatedLocation,
    });
    setProperties(propertyService.getAllProperties());
    setActionSuccess(`Property "${prop.title}" listing rejected.`);
    setTimeout(() => setActionSuccess(null), 3000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
          Accommodation Listing Moderation
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Review student hostel submissions for address legitimacy, security provisions, and reasonable campus proximity.
        </p>
      </div>

      {actionSuccess && (
        <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 text-emerald-700 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>{actionSuccess}</span>
        </div>
      )}

      <div className="space-y-4">
        {properties.map((prop) => {
          const isMapExpanded = expandedMapPropId === prop.id;
          const loc = prop.location;

          return (
            <div
              key={prop.id}
              className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-emerald-600 uppercase">
                      {prop.propertyType} • {prop.university}
                    </span>
                    <VerificationBadge type="property" status={prop.verificationStatus} />
                    {loc && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                        Loc: {loc.verificationStatus}
                      </span>
                    )}
                  </div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                    {prop.title}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {prop.address}, {prop.neighbourhood} ({prop.distanceKm}km from campus gate) • Host: {prop.landlordName}
                  </p>
                </div>

                <div className="text-right">
                  <span className="text-base font-black text-emerald-600 dark:text-emerald-400">
                    ₦{prop.pricePerSession.toLocaleString()}
                  </span>
                  <span className="text-[11px] text-slate-400 block">per academic session</span>
                </div>
              </div>

              {/* Location Details & Verification Box */}
              {loc && (
                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 text-xs space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {loc.area} Area Settlement
                      </span>
                      <span className="text-[11px] font-mono text-slate-500">
                        ({loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)})
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setExpandedMapPropId(isMapExpanded ? null : prop.id)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline"
                    >
                      <span>{isMapExpanded ? 'Hide Map' : 'View on Map'}</span>
                      {isMapExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-4 text-[11px] text-slate-500 dark:text-slate-400">
                    <span>Precision: <strong className="text-slate-700 dark:text-slate-300">{loc.precision}</strong></span>
                    <span>Geohash: <strong className="font-mono text-slate-700 dark:text-slate-300">{loc.geohash}</strong></span>
                    <span>Source: <strong className="text-slate-700 dark:text-slate-300">{loc.source}</strong></span>
                    <span>Public Label: <strong className="text-slate-700 dark:text-slate-300">{loc.publicLocationLabel}</strong></span>
                  </div>

                  {/* Collapsible Mini MapLibre GL instance */}
                  {isMapExpanded && (
                    <div className="pt-2">
                      <PropertyMap
                        properties={[prop]}
                        selectedPropertyId={prop.id}
                        height="240px"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Specs & Amenities preview */}
              <div className="flex flex-wrap gap-1.5 text-xs">
                {prop.amenities.map((am) => (
                  <span
                    key={am}
                    className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px]"
                  >
                    {am}
                  </span>
                ))}
              </div>

              {/* Moderation Controls */}
              <div className="pt-3 flex items-center justify-between border-t border-slate-100 dark:border-slate-800 text-xs">
                <span className="text-slate-400">
                  Spaces: {prop.availableSpaces} available / {prop.totalCapacity} total
                </span>

                <div className="flex gap-2">
                  {prop.verificationStatus !== 'rejected' && (
                    <button
                      onClick={() => handleReject(prop)}
                      className="px-4 py-2 rounded-xl border border-rose-200 dark:border-rose-900 text-rose-600 hover:bg-rose-50 text-xs font-medium"
                    >
                      Reject Listing
                    </button>
                  )}

                  {prop.verificationStatus !== 'approved' && (
                    <button
                      onClick={() => handleApprove(prop)}
                      className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Approve & Verify Property Location</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
