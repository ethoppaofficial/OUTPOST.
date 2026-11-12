/**
 * @file PropertyDetailPage.tsx
 * @module pages/public/PropertyDetailPage
 * @description Comprehensive accommodation detail view for prospective student tenants.
 *
 * Workflows & Features:
 * - Lodge Showcase: High-resolution photo gallery, amenities checklist, gender policy, and verified landlord details.
 * - Units & Capacity: Displays individual room units, rental fees, and real-time available spaces.
 * - 7-Day Hold Booking: Authenticated students can trigger room space reservations.
 *   - Calls `reservationService.createReservation()` which dispatches to `create_reservation_atomic`.
 *   - Automatically decrements available spaces and generates an invoice with a 7-day payment deadline.
 */

import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  MapPin,
  Navigation,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  Bed,
  Calendar,
  DollarSign,
  Flag,
  Share2,
  Sparkles,
  Compass,
  ExternalLink,
} from 'lucide-react';
import { propertyService } from '../../application/services/propertyService';
import { reservationService } from '../../application/services/reservationService';
import { useAuth } from '../../application/context/AuthContext';
import { ImageGallery } from '../../components/ui/ImageGallery';
import { VerificationBadge, Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import { PropertyMap } from '../../components/map/PropertyMap';
import { Property } from '../../domain/types';
import { getNearestLandmarkOrientation } from '../../domain/geoUtils';
import {
  calculateDualGateProximity,
  getImmediateDualGateProximity,
  type DualGateProximity,
} from '../../application/services/walkingRouteService';
import {
  getGoogleMapsWalkingUrl,
  getOpenStreetMapWalkingUrl,
  SAFE_EXTERNAL_LINK_PROPS,
} from '../../application/utils/urlUtils';

export const PropertyDetailPage: React.FC = () => {
  const { id, propertyId } = useParams<{ id?: string; propertyId?: string }>();
  const lookupKey = propertyId || id || '';
  const navigate = useNavigate();
  const { currentUser } = useAuth();

  const [property, setProperty] = useState<Property | undefined>(() =>
    propertyService.getPropertyBySlug(lookupKey) ||
    propertyService.getPropertyById(lookupKey)
  );
  const [loading, setLoading] = useState(!property);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedUnitId, setSelectedUnitId] = useState<string>(
    property?.rooms[0]?.id || ''
  );
  const [reserveModalOpen, setReserveModalOpen] = useState(false);
  const [directionsModalOpen, setDirectionsModalOpen] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportReason, setReportReason] = useState<any>('Misleading photos');
  const [reportDetails, setReportDetails] = useState('');
  const [reportSubmitted, setReportSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadProperty = React.useCallback(async () => {
    if (!lookupKey) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const found = await propertyService.fetchPropertyByIdOrSlug(lookupKey);
      setProperty(found);
      if (found?.rooms?.[0]?.id) {
        setSelectedUnitId((prev) => prev || found.rooms[0].id);
      }
    } catch (err: any) {
      setLoadError(err?.message || 'Could not load property details from Supabase.');
    } finally {
      setLoading(false);
    }
  }, [lookupKey]);

  useEffect(() => {
    void loadProperty();
    const unsubscribe = propertyService.subscribeToProperties(() => {
      const updated =
        propertyService.getPropertyBySlug(lookupKey) ||
        propertyService.getPropertyById(lookupKey);
      if (updated) {
        setProperty(updated);
      }
    });
    return unsubscribe;
  }, [loadProperty, lookupKey]);

  const propLat = property?.location?.publicLatitude ?? property?.location?.latitude;
  const propLon = property?.location?.publicLongitude ?? property?.location?.longitude;
  const hasCoordinates = typeof propLat === 'number' && typeof propLon === 'number';

  // Dual-gate proximity state initialized cleanly regardless of loading state
  const [dualProximity, setDualProximity] = useState<DualGateProximity | null>(() => {
    if (!hasCoordinates) return null;
    return getImmediateDualGateProximity(propLat!, propLon!);
  });

  // Asynchronously compute true pedestrian walking routes to Gate 1 and Gate 2
  useEffect(() => {
    if (!hasCoordinates || typeof propLat !== 'number' || typeof propLon !== 'number') {
      setDualProximity(null);
      return;
    }
    setDualProximity(getImmediateDualGateProximity(propLat, propLon));
    let isCancelled = false;

    calculateDualGateProximity(propLat, propLon)
      .then((res) => {
        if (!isCancelled) {
          setDualProximity(res);
        }
      })
      .catch(() => {
        // Retain initial straight-line fallback on error
      });

    return () => {
      isCancelled = true;
    };
  }, [propLat, propLon, hasCoordinates]);

  if (loading && !property) {
    return (
      <div className="max-w-5xl mx-auto p-12 text-center space-y-3 text-slate-500">
        <div className="w-8 h-8 rounded-full border-2 border-emerald-600 border-t-transparent animate-spin mx-auto" />
        <p className="text-xs font-medium">Loading accommodation details…</p>
      </div>
    );
  }

  if (loadError && !property) {
    return (
      <div className="max-w-lg mx-auto p-8 text-center bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900 rounded-3xl space-y-3">
        <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
        <h2 className="text-base font-bold text-rose-900 dark:text-rose-200">Could Not Load Property</h2>
        <p className="text-xs text-rose-700 dark:text-rose-300">{loadError}</p>
        <div className="flex justify-center gap-2">
          <button
            type="button"
            onClick={() => void loadProperty()}
            className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-500 cursor-pointer"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={() => navigate('/properties')}
            className="px-4 py-2 rounded-xl border border-rose-300 text-rose-700 dark:text-rose-200 text-xs font-semibold cursor-pointer"
          >
            Back to Properties
          </button>
        </div>
      </div>
    );
  }

  if (!property) {
    return (
      <EmptyState
        title="Property Not Found"
        description="The accommodation you are looking for may have been archived or does not exist."
        actionText="Back to Properties"
        onAction={() => navigate('/properties')}
      />
    );
  }

  // Dynamic landmark orientation relative to nearest reference landmark
  const landmarkOrientation = hasCoordinates && typeof propLat === 'number' && typeof propLon === 'number'
    ? getNearestLandmarkOrientation(propLat, propLon)
    : null;

  const selectedRoom = property.rooms.find((r) => r.id === selectedUnitId) || property.rooms[0];

  const handleConfirmReservation = () => {
    setErrorMsg(null);
    if (!currentUser) {
      navigate('/login');
      return;
    }

    if (currentUser.role !== 'student') {
      setErrorMsg('Only registered students can reserve accommodation holds.');
      return;
    }

    if (!selectedRoom) {
      setErrorMsg('This listing has no active room inventory units configured yet.');
      return;
    }

    const result = reservationService.createReservation(
      currentUser.id,
      property.id,
      selectedRoom.id
    );

    if (result.success && result.reservation) {
      setReserveModalOpen(false);
      navigate(`/student/reservations/${result.reservation.id}`);
    } else {
      setErrorMsg(result.error || 'Failed to place reservation hold.');
    }
  };

  const handleReportSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setReportSubmitted(true);
    setTimeout(() => {
      setReportModalOpen(false);
      setReportSubmitted(false);
    }, 2000);
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Navigation Breadcrumb / Back Button */}
      <div className="flex items-center justify-between">
        <Link
          to="/properties"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Accommodation Directory</span>
        </Link>

        <button
          onClick={() => setReportModalOpen(true)}
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-rose-500 transition"
        >
          <Flag className="w-3.5 h-3.5" />
          <span>Report Listing</span>
        </button>
      </div>

      {/* Title & Badges Header */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <VerificationBadge type="property" status={property.verificationStatus} />
          {property.landlordVerified && (
            <Badge variant="success">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              Verified Landlord ({property.landlordName})
            </Badge>
          )}
          <Badge variant="neutral">{property.propertyType}</Badge>
          <Badge variant="info">{property.genderPolicy}</Badge>
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
            <MapPin className="w-3 h-3 text-emerald-500" />
            Off-Campus: {property.neighbourhood}
          </span>
        </div>

        <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight">
          {property.title}
        </h1>

        <div className="flex flex-wrap items-center gap-4 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-1.5">
            <MapPin className="w-4 h-4 text-slate-400" />
            <span>{property.address}, {property.neighbourhood}, {property.city}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Navigation className="w-4 h-4 text-emerald-500" />
            <span className="font-medium text-emerald-600 dark:text-emerald-400">
              {property.distanceKm} km from {property.campus}
            </span>
          </div>
        </div>

        {/* Off-Campus Settlement Area Notice */}
        <div className="p-3.5 rounded-2xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 flex items-start gap-3 text-xs">
          <MapPin className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <span className="font-semibold text-slate-900 dark:text-white">
              Off-Campus Area: {property.neighbourhood} Settlement (Gwarzo Road corridor)
            </span>
            <p className="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
              This property is situated in {property.neighbourhood}, an established student community adjacent to Bayero University Kano (BUK) New Campus. This is private, verified student housing, independent of university-managed dormitories.
            </p>
          </div>
        </div>
      </div>

      {/* Image Gallery */}
      <ImageGallery images={property.images} altTitle={property.title} />

      {/* Main Grid: Details & Sticky Reserve Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Description, Units, Amenities, Rules */}
        <div className="lg:col-span-2 space-y-8">
          {/* About Listing */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">About Accommodation</h2>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line">
              {property.description}
            </p>
          </section>

          {/* Unit / Room Selection */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Available Room Options</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {property.rooms.map((room) => {
                const isSelected = selectedUnitId === room.id;
                return (
                  <div
                    key={room.id}
                    onClick={() => setSelectedUnitId(room.id)}
                    className={`p-4 rounded-2xl border cursor-pointer transition ${
                      isSelected
                        ? 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20 ring-1 ring-emerald-500'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-semibold text-sm text-slate-900 dark:text-white">{room.name}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-mono">
                        {room.type}
                      </span>
                    </div>

                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-2 flex items-center justify-between">
                      <span>Available Spaces:</span>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">
                        {room.availableSpaces} of {room.totalCapacity}
                      </span>
                    </div>

                    <div className="mt-2 text-sm font-bold text-slate-900 dark:text-white">
                      ₦{room.pricePerSession.toLocaleString()}{' '}
                      <span className="text-xs font-normal text-slate-500">/ session</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Amenities */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Hostel Amenities</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {property.amenities.map((amenity, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  <span className="truncate">{amenity}</span>
                </div>
              ))}
            </div>
          </section>

          {/* House Rules */}
          <section className="space-y-3">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Hostel Rules & Expectations</h2>
            <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
              {property.houseRules.map((rule, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 flex-shrink-0" />
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Location & Neighborhood Map */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  <span>Settlement Location & Neighborhood</span>
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {property.neighbourhood} Settlement • ~{property.distanceKm} km from {property.campus}
                </p>
              </div>
              <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                {property.location?.precision === 'exact_building'
                  ? 'Exact Pin'
                  : 'Approx. Street Perimeter'}
              </span>
            </div>

            <div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800">
              <PropertyMap
                properties={[property]}
                selectedPropertyId={property.id}
                height="320px"
                zoomToFit={false}
              />
            </div>

            {/* Address, Landmark & Directions Information */}
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">
                  <Navigation className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>Physical Address & Campus Transit Guide</span>
                </div>

                {hasCoordinates && (
                  <button
                    type="button"
                    onClick={() => setDirectionsModalOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs transition cursor-pointer self-start sm:self-auto"
                  >
                    <Navigation className="w-3.5 h-3.5" />
                    <span>Get Directions</span>
                  </button>
                )}
              </div>

              {/* Dual BUK Gates Walking Proximity Panel */}
              {dualProximity && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    <span>Walking Proximity to BUK New Site Gates</span>
                    <span>
                      {dualProximity.gate1.isPedestrianRoute || dualProximity.gate2.isPedestrianRoute
                        ? 'Pedestrian Network Calculated'
                        : 'Straight-Line Distance Mode'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {/* Gate 1 Proximity Card */}
                    <div className="p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-800/60 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-emerald-900 dark:text-emerald-200">
                          BUK New Site Gate 1 (Main Gate)
                        </span>
                        {dualProximity.gate1.isPedestrianRoute && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-200/70 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300">
                            {dualProximity.gate1.formattedDuration}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-emerald-800 dark:text-emerald-300 font-medium">
                        {dualProximity.gate1.displayText}
                      </p>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 block">
                        Gwarzo Road corridor entrance (facing central Danbare)
                      </span>
                    </div>

                    {/* Gate 2 Proximity Card */}
                    <div className="p-3 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/80 dark:border-blue-800/60 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs text-blue-900 dark:text-blue-200">
                          BUK New Site Gate 2
                        </span>
                        {dualProximity.gate2.isPedestrianRoute && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-200/70 dark:bg-blue-900/60 text-blue-800 dark:text-blue-300">
                            {dualProximity.gate2.formattedDuration}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-blue-800 dark:text-blue-300 font-medium">
                        {dualProximity.gate2.displayText}
                      </p>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 block">
                        Southern campus perimeter gate (accessible from Rimin Gata)
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Landmark Orientation Context */}
              {landmarkOrientation && (
                <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70 text-xs">
                  <Compass className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">Landmark Orientation: </span>
                    <span className="text-slate-600 dark:text-slate-400">{landmarkOrientation.formattedDescription}</span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-1">
                <div>
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block">Address & Area</span>
                  <p className="font-medium text-slate-800 dark:text-slate-200 mt-0.5">
                    {property.fullAddress || property.address || `${property.neighbourhood}, Kano`}
                  </p>
                  {property.streetOrRoad && (
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Street: <span className="text-slate-700 dark:text-slate-300 font-medium">{property.streetOrRoad}</span>
                    </p>
                  )}
                </div>

                {property.nearestLandmark && (
                  <div>
                    <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block">Nearest Landmark</span>
                    <p className="font-medium text-slate-800 dark:text-slate-200 mt-0.5">
                      {property.nearestLandmark}
                    </p>
                  </div>
                )}
              </div>

              {property.directions && (
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block">Written Directions from BUK Gate</span>
                  <p className="text-slate-700 dark:text-slate-300 mt-0.5 leading-relaxed bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-xl border border-slate-200/60 dark:border-slate-700">
                    {property.directions}
                  </p>
                </div>
              )}

              {property.locationNote && (
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="font-medium text-slate-700 dark:text-slate-300">Access Note:</span> {property.locationNote}
                </div>
              )}
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-slate-900 dark:text-white block">
                  Student Safety & Gate Privacy Protection
                </span>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed mt-0.5">
                  To protect current student occupants from unannounced drop-ins, public markers indicate the vetted neighborhood perimeter. The specific gate number and caretaker arrival contact are provided upon locking your 7-day reservation hold.
                </p>
              </div>
            </div>
          </section>

          {/* Verified Landlord Summary */}
          <section className="p-5 rounded-2xl bg-slate-100/70 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 flex items-center justify-center font-bold">
                {property.landlordName[0]}
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{property.landlordName}</h4>
                <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Identity Verified & Ownership Deeds Vetted</span>
                </div>
              </div>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 pt-2">
              For student safety, private contact details and property gate access are protected until a reservation hold is locked and payment receipt is reviewed.
            </p>
          </section>
        </div>

        {/* Right Column: Pricing Breakdown & 7-Day Hold Box */}
        <div className="space-y-6">
          <div className="sticky top-24 bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-lg space-y-6">
            <div className="flex items-baseline justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
              <div>
                <span className="text-2xl font-black text-slate-900 dark:text-white">
                  ₦{(selectedRoom?.pricePerSession ?? property.pricePerSession).toLocaleString()}
                </span>
                <span className="text-xs text-slate-500 ml-1">/ {property.billingPeriod}</span>
              </div>
              <Badge variant="success" size="sm">7-Day Hold</Badge>
            </div>

            {/* Pricing breakdown */}
            <div className="space-y-2 text-xs">
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Selected Unit:</span>
                <span className="font-semibold text-slate-900 dark:text-white">{selectedRoom?.name || property.accommodationType}</span>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Cautionary Deposit:</span>
                <span>₦{property.depositAmount.toLocaleString()} (Refundable)</span>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Utilities Included:</span>
                <span>{property.utilitiesIncluded ? 'Yes (Solar/Water)' : 'Separate Metering'}</span>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Platform Booking Fee:</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">₦0.00 (Free for Students)</span>
              </div>
            </div>

            {/* 7-Day Hold Notice */}
            <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/40 text-[11px] text-amber-800 dark:text-amber-200 leading-relaxed">
              <span className="font-bold">How OUTPOST Works:</span> Placing a reservation locks your space for <strong>7 complete days</strong>. An invoice with official bank details is generated. You make external payment and upload the bank transfer receipt.
            </div>

            {/* Action Button */}
            {(selectedRoom?.availableSpaces ?? property.availableSpaces) > 0 && selectedRoom ? (
              <button
                onClick={() => setReserveModalOpen(true)}
                className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition shadow-md flex items-center justify-center gap-2"
              >
                <span>Reserve Room (7-Day Hold)</span>
              </button>
            ) : (
              <button
                disabled
                className="w-full py-3 px-4 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-400 font-semibold text-sm cursor-not-allowed"
              >
                No Spaces Available
              </button>
            )}

            <p className="text-[10px] text-slate-400 text-center">
              Protected by OUTPOST Fair Student Housing Protocol
            </p>
          </div>
        </div>
      </div>

      {/* Reservation Confirmation Modal */}
      <Modal
        isOpen={reserveModalOpen}
        onClose={() => setReserveModalOpen(false)}
        title="Confirm 7-Day Reservation Hold"
      >
        <div className="space-y-4 text-xs">
          <p className="text-slate-600 dark:text-slate-300">
            You are placing a temporary reservation hold on:
          </p>

          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 space-y-1.5 font-medium">
            <div className="text-sm font-bold text-slate-900 dark:text-white">{property.title}</div>
            <div className="text-slate-500">{selectedRoom?.name || property.accommodationType} ({selectedRoom?.type || property.propertyType})</div>
            <div className="text-emerald-600 font-bold">₦{(selectedRoom?.pricePerSession ?? property.pricePerSession).toLocaleString()} / session</div>
          </div>

          <ul className="space-y-1.5 text-slate-500 dark:text-slate-400 text-[11px] list-disc list-inside">
            <li>Your space is held for exactly 7 days from now.</li>
            <li>You will receive an official invoice with verified landlord direct bank payment details.</li>
            <li>After making external payment, upload your bank transfer receipt.</li>
            <li>If payment receipt is not approved within 7 days, the hold releases automatically.</li>
          </ul>

          {errorMsg && (
            <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 text-rose-700 text-xs">
              {errorMsg}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              onClick={() => setReserveModalOpen(false)}
              className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmReservation}
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-xs"
            >
              Confirm & Generate Invoice
            </button>
          </div>
        </div>
      </Modal>

      {/* Report Listing Modal */}
      <Modal
        isOpen={reportModalOpen}
        onClose={() => setReportModalOpen(false)}
        title="Report Accommodation Listing"
      >
        {reportSubmitted ? (
          <div className="text-center py-6 space-y-2">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">Report Logged</h4>
            <p className="text-xs text-slate-500">
              Our accommodation safety committee will investigate this property within 24 hours.
            </p>
          </div>
        ) : (
          <form onSubmit={handleReportSubmit} className="space-y-4 text-xs">
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700 dark:text-slate-300">Reason for Report</label>
              <select
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value as any)}
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
              >
                <option value="Misleading photos">Misleading or outdated photos</option>
                <option value="Price discrepancy">Price differs from physical quote</option>
                <option value="Safety concern">Safety or environmental hazard</option>
                <option value="Fraud / Impersonation">Suspected fraud or fake landlord</option>
                <option value="Other">Other issue</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700 dark:text-slate-300">Additional Details</label>
              <textarea
                value={reportDetails}
                onChange={(e) => setReportDetails(e.target.value)}
                placeholder="Explain the specific issue observed..."
                rows={3}
                required
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setReportModalOpen(false)}
                className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold"
              >
                Submit Safety Report
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* External Navigation / Directions Modal */}
      <Modal
        isOpen={directionsModalOpen}
        onClose={() => setDirectionsModalOpen(false)}
        title="Navigate to Accommodation"
      >
        <div className="space-y-4 text-xs">
          <p className="text-slate-600 dark:text-slate-300">
            Open external pedestrian navigation directly to the verified location of <strong>{property.title}</strong>:
          </p>

          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 space-y-1.5 border border-slate-200/80 dark:border-slate-700">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Target Area</span>
              <span className="font-bold text-slate-900 dark:text-white">{property.neighbourhood}, Kano</span>
            </div>
            {hasCoordinates && (
              <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                <span>Verified Coordinates</span>
                <span>{propLat?.toFixed(6)}, {propLon?.toFixed(6)}</span>
              </div>
            )}
            {landmarkOrientation && (
              <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
                🧭 {landmarkOrientation.formattedDescription}
              </div>
            )}
          </div>

          <div className="space-y-2 pt-1">
            {hasCoordinates && getGoogleMapsWalkingUrl(propLat!, propLon!) && (
              <a
                href={getGoogleMapsWalkingUrl(propLat!, propLon!)!}
                {...SAFE_EXTERNAL_LINK_PROPS}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center justify-between transition shadow-xs"
              >
                <div className="flex items-center gap-2">
                  <Navigation className="w-4 h-4" />
                  <span>Open Walking Route in Google Maps</span>
                </div>
                <ExternalLink className="w-4 h-4 opacity-80" />
              </a>
            )}

            {hasCoordinates && getOpenStreetMapWalkingUrl(propLat!, propLon!) && (
              <a
                href={getOpenStreetMapWalkingUrl(propLat!, propLon!)!}
                {...SAFE_EXTERNAL_LINK_PROPS}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-semibold flex items-center justify-between border border-slate-300 dark:border-slate-700 transition"
              >
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>Open Route in OpenStreetMap</span>
                </div>
                <ExternalLink className="w-4 h-4 text-slate-400" />
              </a>
            )}
          </div>

          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/40 text-[11px] text-amber-800 dark:text-amber-200 leading-relaxed">
            <span className="font-semibold">Pedestrian Advisory:</span> Navigation is handled externally. OUTPOST does not guarantee route safety or travel times. Always choose well-lit, active main thoroughfares around BUK New Campus when walking off-campus.
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={() => setDirectionsModalOpen(false)}
              className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
