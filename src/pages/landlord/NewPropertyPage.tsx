import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Building2, Plus, ArrowLeft, CheckCircle2, AlertCircle, Search, Navigation, AlertTriangle, MapPin, Loader2, X, Compass, Shield } from 'lucide-react';
import { authService } from '../../application/services/authService';
import { propertyService } from '../../application/services/propertyService';
import { LandlordPinPicker } from '../../components/map/LandlordPinPicker';
import { LandlordPinPlacementMapModal, PinLocationValue } from '../../components/map/LandlordPinPlacementMapModal';
import { PropertyImageCaptureUpload } from '../../components/property/PropertyImageCaptureUpload';
import { HousingArea, LocationPrecision, PropertyLocation, GeocodingSuggestion } from '../../domain/types';
import { AREA_CENTERS, encodeGeohash, computePublicCoordinates } from '../../domain/geoUtils';
import { searchAddress, resultMentionsArea, getPrecisionLabel } from '../../application/services/geocodingService';
import { requestCurrentDevicePosition, GeolocationErrorResult } from '../../application/services/geolocationService';
import { appConfig } from '../../infrastructure/config/appConfig';

export const NewPropertyPage: React.FC = () => {
  const session = authService.getSession();
  const profile = authService.getCurrentLandlordProfile();
  const navigate = useNavigate();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [university, setUniversity] = useState('Bayero University Kano (BUK)');
  const [campus, setCampus] = useState('New Campus (Gwarzo Road)');
  const [address, setAddress] = useState('');
  const [streetOrRoad, setStreetOrRoad] = useState('');
  const [nearestLandmark, setNearestLandmark] = useState('');
  const [directions, setDirections] = useState('');
  const [locationNote, setLocationNote] = useState('');
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [neighbourhood, setNeighbourhood] = useState('Dambare');
  const [city, setCity] = useState('Kano');
  const [distanceKm, setDistanceKm] = useState(0.5);

  const [locationData, setLocationData] = useState<{
    area: HousingArea;
    latitude: number;
    longitude: number;
    geohash: string;
    precision: LocationPrecision;
    publicLatitude: number;
    publicLongitude: number;
    publicLocationLabel: string;
  }>(() => {
    const defaultCoords = AREA_CENTERS.Dambare;
    const pub = computePublicCoordinates(defaultCoords.latitude, defaultCoords.longitude, 'nearby_building', 'Dambare');
    return {
      area: 'Dambare',
      latitude: defaultCoords.latitude,
      longitude: defaultCoords.longitude,
      geohash: encodeGeohash(defaultCoords.latitude, defaultCoords.longitude),
      precision: 'nearby_building',
      publicLatitude: pub.publicLatitude,
      publicLongitude: pub.publicLongitude,
      publicLocationLabel: pub.publicLocationLabel,
    };
  });

  const [propertyType, setPropertyType] = useState('Hostel');
  const [accommodationType, setAccommodationType] = useState('Single Room');
  const [genderPolicy, setGenderPolicy] = useState<'Mixed' | 'Male-Only' | 'Female-Only'>('Mixed');
  const [pricePerSession, setPricePerSession] = useState(450000);
  const [depositAmount, setDepositAmount] = useState(50000);
  const [utilitiesIncluded, setUtilitiesIncluded] = useState(true);

  // Rooms
  const [roomName, setRoomName] = useState('Deluxe Single Room');
  const [roomCapacity, setRoomCapacity] = useState(10);
  const [roomPrice, setRoomPrice] = useState(450000);

  // Amenities
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([
    'Solar Inverter Backup',
    'Borehole & Running Water',
    '24/7 Security Guard',
    'Study Desk & Chair',
  ]);

  const [images, setImages] = useState<string[]>([
    'https://images.unsplash.com/photo-1555854877-bab0e564b8d5?w=1000&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?w=1000&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1513694203232-719a280e022f?w=1000&auto=format&fit=crop&q=80',
  ]);
  const [rules, setRules] = useState('No smoking inside building\nVisitors must depart before 10pm\nQuiet hours 11pm - 6am');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Address geocoding states
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);
  const [addressSuggestions, setAddressSuggestions] = useState<GeocodingSuggestion[]>([]);
  const [geocodingWarning, setGeocodingWarning] = useState<string | null>(null);
  const [geocodingSuccess, setGeocodingSuccess] = useState<string | null>(null);

  // Private property-point device location capture states
  const [isCapturingDeviceLocation, setIsCapturingDeviceLocation] = useState(false);
  const [deviceLocationCaptured, setDeviceLocationCaptured] = useState(false);
  const [deviceLocationError, setDeviceLocationError] = useState<string | null>(null);

  const handleCaptureDeviceLocation = async () => {
    setDeviceLocationError(null);
    setIsCapturingDeviceLocation(true);

    try {
      if (appConfig.backendMode === 'mock') {
        // In mock mode, explain the limitation clearly and prevent insecure mock storage
        setDeviceLocationError(
          'Private device-location capture and secure nearby ranking require the live Firebase backend. In demo/mock mode, please enter written address and directions manually.'
        );
        setIsCapturingDeviceLocation(false);
        return;
      }

      const position = await requestCurrentDevicePosition();
      const lat = position.latitude;
      const lon = position.longitude;

      // Validate coordinate ranges
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        throw new Error('Device coordinates received are invalid or out of range.');
      }

      // Check case-study boundary: Danbare and Rimin Gata around Kano
      // Latitudes around Kano: ~11.8 to 12.2, Longitudes: ~8.3 to 8.6
      const isWithinKanoCorridor = lat >= 11.8 && lat <= 12.2 && lon >= 8.3 && lon <= 8.6;
      if (!isWithinKanoCorridor) {
        setGeocodingWarning(
          `Notice: Your current device coordinates (${lat.toFixed(4)}, ${lon.toFixed(4)}) appear to be outside the BUK New Site (Dambare/Rimin Gata) corridor. Please confirm your physical property location.`
        );
      }

      const pub = computePublicCoordinates(lat, lon, 'nearby_building', locationData.area);

      setLocationData({
        area: locationData.area,
        latitude: lat,
        longitude: lon,
        geohash: encodeGeohash(lat, lon),
        precision: 'exact_building',
        publicLatitude: pub.publicLatitude,
        publicLongitude: pub.publicLongitude,
        publicLocationLabel: pub.publicLocationLabel,
      });

      setDeviceLocationCaptured(true);
      setGeocodingSuccess(
        `Property location captured successfully from your device (GPS accuracy: ~${Math.round(position.accuracyMeters || 10)}m). This point will be stored privately and used only for approximate nearby search after administrator verification.`
      );
    } catch (err: any) {
      const geoErr = err as GeolocationErrorResult;
      setDeviceLocationError(
        geoErr?.message || err?.message || 'Could not capture current device location. You may continue with written location details.'
      );
    } finally {
      setIsCapturingDeviceLocation(false);
    }
  };

  const handleSearchAddress = async () => {
    if (!address.trim()) {
      setError('Please type a property address to search.');
      return;
    }
    setIsSearchingAddress(true);
    setError(null);
    setGeocodingWarning(null);
    try {
      const results = await searchAddress(address, locationData.area);
      setAddressSuggestions(results);
      if (results.length === 0) {
        setGeocodingWarning(
          `No matching geocoding results found in ${locationData.area}. Please refine the address text or place the pin manually on the map.`
        );
      }
    } catch (err: any) {
      setError(err?.message || 'Address search failed. Please try again.');
    } finally {
      setIsSearchingAddress(false);
    }
  };

  const handleSelectSuggestion = (suggestion: GeocodingSuggestion) => {
    const [longitude, latitude] = suggestion.center;

    if (!resultMentionsArea(suggestion, locationData.area)) {
      setGeocodingWarning(
        `Notice: Selected result (${suggestion.placeName}) may be outside ${locationData.area}. Please verify or adjust the marker to the building.`
      );
    } else {
      setGeocodingWarning(null);
    }

    const precisionInfo = getPrecisionLabel(suggestion.placeType);
    const pub = computePublicCoordinates(latitude, longitude, precisionInfo.precision, locationData.area);

    setLocationData({
      area: locationData.area,
      latitude,
      longitude,
      geohash: encodeGeohash(latitude, longitude),
      precision: precisionInfo.precision,
      publicLatitude: pub.publicLatitude,
      publicLongitude: pub.publicLongitude,
      publicLocationLabel: pub.publicLocationLabel,
    });

    setAddress(suggestion.placeName);
    setAddressSuggestions([]);
    setGeocodingSuccess(`Marker positioned at: ${suggestion.placeName}`);
    setTimeout(() => setGeocodingSuccess(null), 4000);
  };

  const availableAmenities = [
    'Solar Inverter Backup',
    'Borehole & Running Water',
    '24/7 Security Guard',
    'En-suite Bathroom',
    'High-Speed WiFi',
    'Air Conditioning',
    'Kitchenette',
    'Study Desk & Chair',
    'Wardrobe & Storage',
    'Gated Compound',
  ];

  const toggleAmenity = (name: string) => {
    if (selectedAmenities.includes(name)) {
      setSelectedAmenities(selectedAmenities.filter((a) => a !== name));
    } else {
      setSelectedAmenities([...selectedAmenities, name]);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!title.trim() || !address.trim()) {
      setError('Please provide property title and physical address.');
      return;
    }

    if (images.length < 3) {
      setError('Please provide at least 3 photos (and up to 5 photos) for property verification.');
      return;
    }

    setSubmitting(true);

    const houseRulesArray = rules
      .split('\n')
      .map((r) => r.trim())
      .filter(Boolean);

    const newProp = propertyService.createProperty({
      landlordId: session.user.id,
      landlordName: profile?.legalName || profile?.businessName || session.displayName,
      landlordVerified: profile?.verificationStatus === 'approved',
      title: title.trim(),
      description: description.trim() || 'Modern student accommodation located in prime campus neighbourhood with essential amenities.',
      propertyType,
      accommodationType,
      genderPolicy,
      address: address.trim(),
      fullAddress: address.trim(),
      streetOrRoad: streetOrRoad.trim(),
      nearestLandmark: nearestLandmark.trim(),
      directions: directions.trim(),
      locationNote: locationNote.trim(),
      area: locationData.area,
      city: city.trim(),
      state: 'Kano State',
      country: 'Nigeria',
      neighbourhood: locationData.area,
      locationId: locationData.area === 'Rimin Gata' ? 'loc-rimin-gata' : 'loc-dambare',
      campus: `${university} (${campus})`,
      university,
      distanceKm: Number(distanceKm),
      pricePerSession: Number(pricePerSession),
      billingPeriod: 'Academic Session (1 Year)',
      depositAmount: Number(depositAmount),
      utilitiesIncluded,
      totalCapacity: Number(roomCapacity),
      availableSpaces: Number(roomCapacity),
      latitude: locationData.latitude,
      longitude: locationData.longitude,
      publicLatitude: locationData.publicLatitude,
      publicLongitude: locationData.publicLongitude,
      locationSource: 'manual_pin',
      locationPrecision: locationData.precision,
      locationVerificationStatus: 'pending',
      location: {
        id: `loc-${Date.now()}`,
        propertyId: '',
        locationId: locationData.area === 'Rimin Gata' ? 'loc-rimin-gata' : 'loc-dambare',
        area: locationData.area,
        city: 'Kano',
        state: 'Kano State',
        country: 'Nigeria',
        fullAddress: address.trim(),
        streetOrRoad: streetOrRoad.trim(),
        nearestLandmark: nearestLandmark.trim(),
        directions: directions.trim(),
        locationNote: locationNote.trim(),
        latitude: locationData.latitude,
        longitude: locationData.longitude,
        geohash: locationData.geohash,
        source: 'manual_pin',
        verificationStatus: 'pending',
        locationVerificationStatus: 'pending',
        precision: locationData.precision,
        publicLatitude: locationData.publicLatitude,
        publicLongitude: locationData.publicLongitude,
        publicLocationLabel: locationData.publicLocationLabel,
        formattedAddress: address.trim(),
        submittedBy: session.user.id,
        submittedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      rooms: [
        {
          id: `room-${Date.now()}`,
          name: roomName,
          type: accommodationType,
          pricePerSession: Number(roomPrice),
          totalCapacity: Number(roomCapacity),
          availableSpaces: Number(roomCapacity),
        },
      ],
      amenities: selectedAmenities,
      houseRules: houseRulesArray,
      images: images,
    });

    setSubmitting(false);
    navigate('/landlord/properties');
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Link
        to="/landlord/properties"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>Back to My Properties</span>
      </Link>

      <div>
        <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
          List New Student Accommodation
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Submit accommodation details. New listings undergo platform physical verification before appearing on public search.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-900 p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-6 text-xs">
        {/* Core details */}
        <div className="space-y-4">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Basic Information</h2>

          <div className="space-y-1.5">
            <label className="font-semibold text-slate-700 dark:text-slate-300">Listing Title</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Royal Crown Luxury Student Hostel"
              className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700 dark:text-slate-300">University</label>
              <select
                value={university}
                onChange={(e) => setUniversity(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              >
                <option value="Bayero University Kano (BUK)">Bayero University Kano (BUK)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700 dark:text-slate-300">Distance from Campus Gate (km)</label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                max="10"
                value={distanceKm}
                onChange={(e) => setDistanceKm(Number(e.target.value))}
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              />
            </div>
          </div>

          {/* Case Study Area & Typed Address Geocoding */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-white pb-1 border-b border-slate-200 dark:border-slate-700">
              <MapPin className="w-4 h-4 text-emerald-600" />
              <span>Property Location & Address Geocoding</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  Select Case-Study Area
                </label>
                <select
                  value={locationData.area}
                  onChange={(e) => {
                    const newArea = e.target.value as HousingArea;
                    const center = AREA_CENTERS[newArea];
                    const pub = computePublicCoordinates(center.latitude, center.longitude, locationData.precision, newArea);
                    setLocationData({
                      area: newArea,
                      latitude: center.latitude,
                      longitude: center.longitude,
                      geohash: encodeGeohash(center.latitude, center.longitude),
                      precision: locationData.precision,
                      publicLatitude: pub.publicLatitude,
                      publicLongitude: pub.publicLongitude,
                      publicLocationLabel: pub.publicLocationLabel,
                    });
                    setNeighbourhood(newArea);
                  }}
                  className="w-full p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-bold text-slate-800 dark:text-slate-200"
                >
                  <option value="Dambare">Dambare, Kano State, Nigeria</option>
                  <option value="Rimin Gata">Rimin Gata, Kano State, Nigeria</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  Full Property Address
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="e.g. Plot 18, Dambare Off-Campus Layout, Gwarzo Road"
                    className="flex-1 p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200"
                  />
                  <button
                    type="button"
                    onClick={handleSearchAddress}
                    disabled={isSearchingAddress}
                    className="px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-xs transition flex items-center gap-1.5 shadow-xs cursor-pointer flex-shrink-0"
                  >
                    {isSearchingAddress ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Search className="w-3.5 h-3.5" />
                    )}
                    <span>Search Address</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Geocoding Warning or Success */}
            {geocodingWarning && (
              <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                <span>{geocodingWarning}</span>
              </div>
            )}

            {geocodingSuccess && (
              <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                <span>{geocodingSuccess}</span>
              </div>
            )}

            {/* Search Results Suggestion List */}
            {addressSuggestions.length > 0 && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
                <div className="px-3 py-2 bg-slate-100/70 dark:bg-slate-800 text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider flex justify-between items-center">
                  <span>Search results ({addressSuggestions.length})</span>
                  <span>Select matching location</span>
                </div>
                {addressSuggestions.map((item) => {
                  const info = getPrecisionLabel(item.placeType);
                  return (
                    <div
                      key={item.id}
                      className="p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-slate-800 dark:text-slate-200 text-xs truncate">
                          {item.placeName}
                        </p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {info.label} • {locationData.area}, Kano State
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleSelectSuggestion(item)}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-xs cursor-pointer flex-shrink-0"
                      >
                        Select
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Selected Location Details & Device Point Capture */}
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900 dark:text-white">
                      Physical Location Anchor
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      {deviceLocationCaptured ? 'Device Point Captured' : locationData.precision === 'exact_building' ? 'Exact building' : 'Street-level / Nearby'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    A captured device point supplements written directions and is stored privately to support approximate nearby search after admin review.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCaptureDeviceLocation}
                    disabled={isCapturingDeviceLocation}
                    className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white font-semibold text-xs transition flex items-center gap-2 shadow-xs cursor-pointer disabled:opacity-50"
                    title="Capture current GPS coordinates privately from your device"
                  >
                    {isCapturingDeviceLocation ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Compass className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {isCapturingDeviceLocation
                        ? 'Capturing location…'
                        : deviceLocationCaptured
                        ? 'Re-capture device location'
                        : 'Capture private property location'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsPinModalOpen(true)}
                    className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 transition cursor-pointer"
                  >
                    Adjust marker on map
                  </button>
                </div>
              </div>

              {/* Device location capture error display */}
              {deviceLocationError && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-800 dark:text-rose-300 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  <div className="flex-1 space-y-1">
                    <p>{deviceLocationError}</p>
                    <p className="text-[10px] text-rose-600 dark:text-rose-400">
                      You can continue submitting the property using your written address, landmark, and directions.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700 dark:text-slate-300">Street / Road Name</label>
              <input
                type="text"
                required
                value={streetOrRoad}
                onChange={(e) => setStreetOrRoad(e.target.value)}
                placeholder="e.g. Gwarzo Road / Main Feeder Street"
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700 dark:text-slate-300">Nearest Landmark</label>
              <input
                type="text"
                required
                value={nearestLandmark}
                onChange={(e) => setNearestLandmark(e.target.value)}
                placeholder="e.g. Opposite BUK Old Gate / Beside Al-Hikma Pharmacy"
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="font-semibold text-slate-700 dark:text-slate-300">Written Directions for Students</label>
            <textarea
              rows={2}
              required
              value={directions}
              onChange={(e) => setDirections(e.target.value)}
              placeholder="e.g. From BUK New Campus gate, take a Keke towards Dambare market, turn left at second solar streetlight, white 2-storey hostel on right."
              className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
            />
          </div>

          <div className="space-y-1.5">
            <label className="font-semibold text-slate-700 dark:text-slate-300">Gate / Compound Access Note (Optional)</label>
            <input
              type="text"
              value={locationNote}
              onChange={(e) => setLocationNote(e.target.value)}
              placeholder="e.g. Gated compound with black sliding gate, 24/7 security guard at entrance"
              className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
            />
          </div>

          {/* Interactive MapLibre Pin Placement */}
          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between">
              <label className="font-semibold text-slate-700 dark:text-slate-300 block">
                Property Map Location & Privacy
              </label>
              <button
                type="button"
                onClick={() => setIsPinModalOpen(true)}
                className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <span>Full Map Modal / GPS</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              Drag the pin or click on the map to mark the property building location in {locationData.area}.
            </p>
            <LandlordPinPicker
              initialArea={locationData.area}
              initialLatitude={locationData.latitude}
              initialLongitude={locationData.longitude}
              initialPrecision={locationData.precision}
              onLocationChange={(loc) => {
                setLocationData(loc);
                setNeighbourhood(loc.area);
              }}
            />
          </div>

          {/* Landlord Fullscreen Pin Placement Map Modal */}
          <LandlordPinPlacementMapModal
            isOpen={isPinModalOpen}
            area={locationData.area}
            caseStudyViewport={{
              center: [
                AREA_CENTERS[locationData.area]?.longitude || 8.4187,
                AREA_CENTERS[locationData.area]?.latitude || 11.9842,
              ],
              zoom: 15,
            }}
            initialLocation={{
              latitude: locationData.latitude,
              longitude: locationData.longitude,
              area: locationData.area,
              precision: locationData.precision,
              formattedAddress: address,
            }}
            onClose={() => setIsPinModalOpen(false)}
            onConfirm={(newLoc: PinLocationValue) => {
              const pub = computePublicCoordinates(newLoc.latitude, newLoc.longitude, newLoc.precision, newLoc.area);
              setLocationData({
                area: newLoc.area,
                latitude: newLoc.latitude,
                longitude: newLoc.longitude,
                geohash: encodeGeohash(newLoc.latitude, newLoc.longitude),
                precision: newLoc.precision,
                publicLatitude: pub.publicLatitude,
                publicLongitude: pub.publicLongitude,
                publicLocationLabel: pub.publicLocationLabel,
              });
              if (newLoc.formattedAddress && !address) {
                setAddress(newLoc.formattedAddress);
              }
              setNeighbourhood(newLoc.area);
              setIsPinModalOpen(false);
            }}
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700 dark:text-slate-300">Off-Campus Settlement</label>
              <select
                value={neighbourhood}
                onChange={(e) => setNeighbourhood(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              >
                <option value="Dambare">Dambare</option>
                <option value="Rimin Gata">Rimin Gata</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700 dark:text-slate-300">City / State</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              />
            </div>
          </div>
        </div>

        {/* Accommodation Specs */}
        <div className="space-y-4 pt-4 border-t border-slate-100 dark:border-slate-800">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Room Configurations & Pricing</h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700 dark:text-slate-300">Property Type</label>
              <select
                value={propertyType}
                onChange={(e) => setPropertyType(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              >
                <option value="Hostel">Hostel</option>
                <option value="Apartment">Apartment</option>
                <option value="Studio">Studio</option>
                <option value="Shared House">Shared House</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700 dark:text-slate-300">Accommodation Type</label>
              <select
                value={accommodationType}
                onChange={(e) => setAccommodationType(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              >
                <option value="Single Room">Single Room</option>
                <option value="Shared Room (2-person)">Shared Room (2-person)</option>
                <option value="Self-Contained Flat">Self-Contained Flat</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700 dark:text-slate-300">Gender Policy</label>
              <select
                value={genderPolicy}
                onChange={(e) => setGenderPolicy(e.target.value as any)}
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              >
                <option value="Mixed">Mixed</option>
                <option value="Female-Only">Female-Only</option>
                <option value="Male-Only">Male-Only</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700 dark:text-slate-300">Session Price (₦ NGN)</label>
              <input
                type="number"
                required
                value={pricePerSession}
                onChange={(e) => {
                  setPricePerSession(Number(e.target.value));
                  setRoomPrice(Number(e.target.value));
                }}
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700 dark:text-slate-300">Caution Deposit (₦ NGN)</label>
              <input
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(Number(e.target.value))}
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-semibold text-slate-700 dark:text-slate-300">Total Bed Spaces</label>
              <input
                type="number"
                min="1"
                value={roomCapacity}
                onChange={(e) => setRoomCapacity(Number(e.target.value))}
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              />
            </div>
          </div>
        </div>

        {/* Amenities Selection */}
        <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-800">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Amenities</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {availableAmenities.map((amenity) => {
              const checked = selectedAmenities.includes(amenity);
              return (
                <button
                  key={amenity}
                  type="button"
                  onClick={() => toggleAmenity(amenity)}
                  className={`p-2.5 rounded-xl border text-left transition ${
                    checked
                      ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 font-semibold'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {amenity}
                </button>
              );
            })}
          </div>
        </div>

        {/* House Rules & Description */}
        <div className="space-y-4 pt-4 border-t border-slate-100 dark:border-slate-800">
          <div className="space-y-1.5">
            <label className="font-semibold text-slate-700 dark:text-slate-300">Description</label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe hostel security, proximity to faculties, and ambiance..."
              className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
            />
          </div>

          <div className="space-y-1.5">
            <label className="font-semibold text-slate-700 dark:text-slate-300">House Rules (1 per line)</label>
            <textarea
              rows={3}
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-xs"
            />
          </div>

          <div className="space-y-1.5 pt-2">
            <PropertyImageCaptureUpload
              images={images}
              onChange={setImages}
              minImages={3}
              maxImages={5}
            />
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-50 text-rose-700 text-xs">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-md transition"
        >
          {submitting ? 'Submitting Property...' : 'Submit Accommodation for Verification'}
        </button>
      </form>
    </div>
  );
};
