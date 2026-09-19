import React, { useState } from 'react';
import { Building2, CheckCircle2, XCircle, ShieldCheck, Clock, ExternalLink } from 'lucide-react';
import { propertyService } from '../../application/services/propertyService';
import { Property } from '../../domain/types';
import { VerificationBadge, Badge } from '../../components/ui/Badge';

export const PropertyApprovalsPage: React.FC = () => {
  const [properties, setProperties] = useState<Property[]>(() => propertyService.getAllProperties());
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const handleApprove = (propId: string) => {
    propertyService.updateProperty(propId, {
      verificationStatus: 'approved',
    });
    setProperties(propertyService.getAllProperties());
    setActionSuccess('Property verified and published to public search!');
    setTimeout(() => setActionSuccess(null), 3000);
  };

  const handleReject = (propId: string) => {
    propertyService.updateProperty(propId, {
      verificationStatus: 'rejected',
    });
    setProperties(propertyService.getAllProperties());
    setActionSuccess('Property listing rejected.');
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
        {properties.map((prop) => (
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
                    onClick={() => handleReject(prop.id)}
                    className="px-4 py-2 rounded-xl border border-rose-200 dark:border-rose-900 text-rose-600 hover:bg-rose-50 text-xs font-medium"
                  >
                    Reject Listing
                  </button>
                )}

                {prop.verificationStatus !== 'approved' && (
                  <button
                    onClick={() => handleApprove(prop.id)}
                    className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Approve & Verify Property</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
