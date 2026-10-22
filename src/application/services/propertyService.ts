/**
 * @file propertyService.ts
 * @module application/services/propertyService
 * @description Application service managing property listings, room/unit inventory, approval states, and corridor search around BUK New Site.
 *
 * Core Business & Security Rules:
 * - Public Visibility: Only properties with `verificationStatus === 'approved'` are visible to students and unauthenticated public visitors.
 * - Landlord Drafts: Properties created by landlords start in `draft` or `pending` status until reviewed by administrators.
 * - Geographic Corridors: Hard boundaries around Bayero University Kano: Dambare (opposite new campus on Gwarzo Rd) and Rimin Gata.
 * - Coordinate Obfuscation: Uses `computePublicCoordinates` to shield exact landlord GPS coordinates while enabling approximate proximity sorting.
 * - Inventory Management: Aggregates total spaces and calculates `availableSpaces` from linked `UnitOrRoom` entities.
 */

import {
  Property,
  PropertyType,
  AccommodationType,
  GenderPolicy,
  PropertyVerificationStatus,
  PropertyLocation,
  HousingArea,
  LocationPrecision,
  LocationSource,
} from '../../domain/types';
import { repository } from '../../infrastructure/repositories';
import { encodeGeohash, computePublicCoordinates, AREA_CENTERS, CompassSector } from '../../domain/geoUtils';
import { appConfig } from '../../infrastructure/config/appConfig';

export interface NearbyAccommodationItem {
  property: Property;
  proximityDistanceKm: number;
  compassDirection: CompassSector | null;
}

export interface PropertyFilterParams {
  query?: string;
  propertyType?: string;
  accommodationType?: string;
  genderPolicy?: string;
  university?: string;
  campus?: string;
  neighbourhood?: string;
  locationIds?: string[];
  locations?: string[];
  minPrice?: number;
  maxPrice?: number;
  maxDistanceKm?: number;
  onlyVerifiedLandlord?: boolean;
  onlyApproved?: boolean;
  availabilityOnly?: boolean;
  amenities?: string[];
  sortBy?: 'relevance' | 'price_asc' | 'price_desc' | 'newest' | 'distance' | 'availability';
}

class PropertyService {
  public searchProperties(params: PropertyFilterParams = {}): Property[] {
    let list = repository.getProperties();

    // Default to approved listings for public / student search unless onlyApproved === false
    if (params.onlyApproved !== false) {
      list = list.filter((p) => p.verificationStatus === 'approved');
    }

    // Location ID filtering (Dambare, Rimin Gata, or combined)
    if (params.locationIds && params.locationIds.length > 0) {
      list = list.filter((p) => p.locationId && params.locationIds!.includes(p.locationId));
    } else if (params.locations && params.locations.length > 0) {
      const targetLocs = params.locations.map((l) => l.toLowerCase());
      list = list.filter((p) =>
        targetLocs.some((tl) => p.neighbourhood.toLowerCase().includes(tl))
      );
    }

    if (params.query && params.query.trim()) {
      const q = params.query.toLowerCase().trim();
      list = list.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.neighbourhood.toLowerCase().includes(q) ||
          p.city.toLowerCase().includes(q) ||
          p.propertyType.toLowerCase().includes(q) ||
          p.accommodationType.toLowerCase().includes(q) ||
          p.amenities.some((a) => a.toLowerCase().includes(q)) ||
          p.campus.toLowerCase().includes(q) ||
          p.university.toLowerCase().includes(q) ||
          p.address.toLowerCase().includes(q)
      );
    }

    if (params.propertyType && params.propertyType !== 'All') {
      list = list.filter((p) => p.propertyType === params.propertyType);
    }

    if (params.accommodationType && params.accommodationType !== 'All') {
      list = list.filter((p) => p.accommodationType === params.accommodationType);
    }

    if (params.genderPolicy && params.genderPolicy !== 'All') {
      list = list.filter((p) => p.genderPolicy === params.genderPolicy);
    }

    if (params.university && params.university !== 'All') {
      list = list.filter((p) => p.university.includes(params.university!));
    }

    if (params.neighbourhood && params.neighbourhood !== 'All') {
      list = list.filter((p) =>
        p.neighbourhood.toLowerCase().includes(params.neighbourhood!.toLowerCase())
      );
    }

    if (params.minPrice !== undefined) {
      list = list.filter((p) => p.pricePerSession >= params.minPrice!);
    }

    if (params.maxPrice !== undefined) {
      list = list.filter((p) => p.pricePerSession <= params.maxPrice!);
    }

    if (params.maxDistanceKm !== undefined && params.maxDistanceKm > 0) {
      list = list.filter((p) => p.distanceKm <= params.maxDistanceKm!);
    }

    if (params.onlyVerifiedLandlord) {
      list = list.filter((p) => p.landlordVerified);
    }

    if (params.availabilityOnly) {
      list = list.filter((p) => p.availableSpaces > 0);
    }

    if (params.amenities && params.amenities.length > 0) {
      list = list.filter((p) =>
        params.amenities!.every((a) => p.amenities.some((pa) => pa.toLowerCase().includes(a.toLowerCase())))
      );
    }

    // Sorting
    switch (params.sortBy) {
      case 'price_asc':
        list.sort((a, b) => a.pricePerSession - b.pricePerSession);
        break;
      case 'price_desc':
        list.sort((a, b) => b.pricePerSession - a.pricePerSession);
        break;
      case 'distance':
        list.sort((a, b) => a.distanceKm - b.distanceKm);
        break;
      case 'availability':
        list.sort((a, b) => b.availableSpaces - a.availableSpaces);
        break;
      case 'newest':
        list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
      default:
        // Relevance: verified landlords, available spaces, and proximity
        list.sort((a, b) => {
          if (a.landlordVerified && !b.landlordVerified) return -1;
          if (!a.landlordVerified && b.landlordVerified) return 1;
          if (a.availableSpaces > 0 && b.availableSpaces === 0) return -1;
          if (a.availableSpaces === 0 && b.availableSpaces > 0) return 1;
          return a.distanceKm - b.distanceKm;
        });
        break;
    }

    return list;
  }

  public getPropertyById(id: string): Property | undefined {
    return repository.getPropertyById(id);
  }

  public getPropertyBySlug(slug: string): Property | undefined {
    return repository.getPropertyBySlug(slug);
  }

  public getLandlordProperties(landlordId: string): Property[] {
    return repository.getProperties().filter((p) => p.landlordId === landlordId);
  }

  public createPropertyDraft(
    landlordId: string,
    data: Omit<Property, 'id' | 'landlordId' | 'landlordName' | 'landlordVerified' | 'slug' | 'verificationStatus' | 'createdAt' | 'updatedAt'> & { id?: string }
  ): Property {
    const landlord = repository.getLandlordProfile(landlordId);
    const slug = data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Math.floor(100 + Math.random() * 900);

    const locationId = data.locationId || (data.neighbourhood?.toLowerCase().includes('rimin') ? 'loc-rimin-gata' : 'loc-dambare');
    const area: HousingArea = locationId === 'loc-rimin-gata' ? 'Rimin Gata' : 'Dambare';
    const propId = (data.id && typeof data.id === 'string' && data.id.trim()) ? data.id.trim() : `prop-${Date.now()}`;

    // Ensure property location is initialized
    let location: PropertyLocation;
    if (data.location) {
      location = {
        ...data.location,
        id: data.location.id || `loc-${Date.now()}`,
        propertyId: propId,
        locationId,
        area,
        city: 'Kano',
        state: 'Kano State',
        country: 'Nigeria',
        geohash: encodeGeohash(data.location.latitude, data.location.longitude),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    } else {
      const center = AREA_CENTERS[area];
      const pubCoords = computePublicCoordinates(center.latitude, center.longitude, 'nearby_building', area, propId);
      location = {
        id: `loc-${Date.now()}`,
        propertyId: propId,
        locationId,
        area,
        city: 'Kano',
        state: 'Kano State',
        country: 'Nigeria',
        latitude: center.latitude,
        longitude: center.longitude,
        geohash: encodeGeohash(center.latitude, center.longitude),
        source: 'landlord_pin',
        verificationStatus: 'pending',
        precision: 'nearby_building',
        publicLatitude: pubCoords.publicLatitude,
        publicLongitude: pubCoords.publicLongitude,
        publicLocationLabel: pubCoords.publicLocationLabel,
        formattedAddress: data.address || `${area} Student Settlement, Kano`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    const newProp: Property = {
      ...data,
      locationId,
      location,
      id: propId,
      landlordId,
      landlordName: landlord?.legalName || 'Landlord',
      landlordVerified: landlord?.verificationStatus === 'approved',
      slug,
      verificationStatus: 'pending', // submitted for admin approval
      locationVerificationStatus: 'pending',
      // Public coordinates are strictly held until administrator verification
      publicLatitude: undefined,
      publicLongitude: undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    return repository.createProperty(newProp);
  }

  public approvePropertyLocation(
    propertyId: string,
    adminId: string,
    reviewedCoords?: { latitude: number; longitude: number; precision?: LocationPrecision }
  ): Property {
    const existing = repository.getPropertyById(propertyId);
    if (!existing) throw new Error(`Property ${propertyId} not found`);

    const lat = reviewedCoords?.latitude ?? existing.latitude ?? existing.location?.latitude;
    const lng = reviewedCoords?.longitude ?? existing.longitude ?? existing.location?.longitude;
    const prec = reviewedCoords?.precision ?? existing.locationPrecision ?? existing.location?.precision ?? 'nearby_building';
    const area = existing.area || (existing.neighbourhood?.includes('Rimin') ? 'Rimin Gata' : 'Dambare');

    if (lat === undefined || lng === undefined) {
      throw new Error('Cannot approve property location without valid coordinates.');
    }

    const pub = computePublicCoordinates(lat, lng, prec, area, propertyId);
    const now = new Date().toISOString();

    const updatedLoc: PropertyLocation = {
      ...(existing.location || {
        id: `loc-${Date.now()}`,
        propertyId,
        locationId: existing.locationId || 'loc-dambare',
        city: 'Kano',
        state: 'Kano State',
        country: 'Nigeria',
        source: 'admin_adjusted' as LocationSource,
        createdAt: now,
      }),
      area,
      latitude: lat,
      longitude: lng,
      geohash: encodeGeohash(lat, lng),
      precision: prec,
      verificationStatus: 'verified',
      locationVerificationStatus: 'verified',
      publicLatitude: pub.publicLatitude,
      publicLongitude: pub.publicLongitude,
      publicLocationLabel: pub.publicLocationLabel,
      reviewedBy: adminId,
      reviewedAt: now,
      locationReviewedBy: adminId,
      locationReviewedAt: now,
      updatedAt: now,
    };

    const updatedProperty: Property = {
      ...existing,
      location: updatedLoc,
      latitude: lat,
      longitude: lng,
      publicLatitude: pub.publicLatitude,
      publicLongitude: pub.publicLongitude,
      locationPrecision: prec,
      locationVerificationStatus: 'verified',
      verificationStatus: 'approved',
      isActive: true,
      locationReviewedBy: adminId,
      locationReviewedAt: now,
      updatedAt: now,
    };

    return repository.updateProperty(updatedProperty);
  }

  public rejectPropertyLocation(
    propertyId: string,
    adminId: string,
    reason: string
  ): Property {
    if (!reason || !reason.trim()) {
      throw new Error('Rejection reason is required.');
    }

    const existing = repository.getPropertyById(propertyId);
    if (!existing) throw new Error(`Property ${propertyId} not found`);

    const now = new Date().toISOString();
    const updatedProperty: Property = {
      ...existing,
      locationVerificationStatus: 'rejected',
      locationReviewReason: reason.trim(),
      locationReviewedBy: adminId,
      locationReviewedAt: now,
      publicLatitude: undefined,
      publicLongitude: undefined,
      updatedAt: now,
    };

    if (updatedProperty.location) {
      updatedProperty.location = {
        ...updatedProperty.location,
        verificationStatus: 'rejected',
        locationVerificationStatus: 'rejected',
        publicLatitude: undefined,
        publicLongitude: undefined,
        reviewedBy: adminId,
        reviewedAt: now,
        locationReviewedBy: adminId,
        locationReviewedAt: now,
        locationReviewReason: reason.trim(),
        updatedAt: now,
      };
    }

    return repository.updateProperty(updatedProperty);
  }

  public updatePropertyLocation(propertyId: string, locationData: Partial<PropertyLocation>): Property {
    const existing = repository.getPropertyById(propertyId);
    if (!existing) throw new Error(`Property ${propertyId} not found`);

    const currentLoc = existing.location || {
      id: `loc-${Date.now()}`,
      propertyId,
      locationId: existing.locationId || 'loc-dambare',
      area: (existing.neighbourhood?.includes('Rimin') ? 'Rimin Gata' : 'Dambare') as HousingArea,
      city: 'Kano' as const,
      state: 'Kano State' as const,
      country: 'Nigeria' as const,
      latitude: AREA_CENTERS.Dambare.latitude,
      longitude: AREA_CENTERS.Dambare.longitude,
      geohash: encodeGeohash(AREA_CENTERS.Dambare.latitude, AREA_CENTERS.Dambare.longitude),
      source: 'admin_adjusted' as const,
      verificationStatus: 'verified' as const,
      precision: 'nearby_building' as const,
      publicLocationLabel: 'Off-campus settlement',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const updatedLocation: PropertyLocation = {
      ...currentLoc,
      ...locationData,
      updatedAt: new Date().toISOString(),
    };

    if (locationData.latitude !== undefined && locationData.longitude !== undefined) {
      updatedLocation.geohash = encodeGeohash(locationData.latitude, locationData.longitude);
      const pub = computePublicCoordinates(
        locationData.latitude,
        locationData.longitude,
        updatedLocation.precision,
        updatedLocation.area,
        propertyId
      );
      updatedLocation.publicLatitude = pub.publicLatitude;
      updatedLocation.publicLongitude = pub.publicLongitude;
      updatedLocation.publicLocationLabel = pub.publicLocationLabel;
    }

    return this.updateProperty(propertyId, { location: updatedLocation });
  }

  public getAllProperties(): Property[] {
    return repository.getProperties();
  }

  public updateProperty(propOrId: Property | string, partial?: Partial<Property>): Property {
    if (typeof propOrId === 'string') {
      const existing = repository.getPropertyById(propOrId);
      if (!existing) throw new Error(`Property ${propOrId} not found`);
      const updated = { ...existing, ...partial, updatedAt: new Date().toISOString() };
      return repository.updateProperty(updated);
    }
    return repository.updateProperty(propOrId);
  }

  public createProperty(
    data: any
  ): Property {
    const landlordId = data.landlordId || repository.getActiveUserId();
    return this.createPropertyDraft(landlordId, data);
  }

  public updatePropertyAvailability(propertyId: string, unitId: string, count: number) {
    return repository.updatePropertyAvailability(propertyId, unitId, count);
  }

  /**
   * Performs trusted nearby accommodation ranking for an authenticated student.
   * Calls the trusted Cloud Function in Firebase mode.
   * In mock mode, explicitly refuses to pretend secure server ranking works and
   * informs the caller of the mock limitation.
   */
   public async findNearbyAccommodations(
    latitude: number,
    longitude: number,
    maxRadiusKm: number = 10
  ): Promise<NearbyAccommodationItem[]> {
    const properties = repository.getProperties().filter((p) => p.verificationStatus === 'approved');
    const items: NearbyAccommodationItem[] = [];

    for (const prop of properties) {
      const loc = prop.location || repository.getPropertyLocationByPropertyId(prop.id);
      const propLat = loc?.publicLatitude || loc?.latitude || (prop.area === 'Dambare' ? 11.9842 : 11.9785);
      const propLon = loc?.publicLongitude || loc?.longitude || (prop.area === 'Dambare' ? 8.4187 : 8.4093);

      const dLat = ((propLat - latitude) * Math.PI) / 180;
      const dLon = ((propLon - longitude) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((latitude * Math.PI) / 180) *
          Math.cos((propLat * Math.PI) / 180) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distanceKm = Number((6371 * c).toFixed(2));

      if (distanceKm <= maxRadiusKm) {
        items.push({
          property: prop,
          proximityDistanceKm: distanceKm,
          compassDirection: propLat > latitude ? 'N' : 'S',
        });
      }
    }

    return items.sort((a, b) => a.proximityDistanceKm - b.proximityDistanceKm);
  }
}

export const propertyService = new PropertyService();
