import { Property, PropertyType, AccommodationType, GenderPolicy, PropertyVerificationStatus } from '../../domain/types';
import { repository } from '../../infrastructure/repositories/localStorageRepository';

export interface PropertyFilterParams {
  query?: string;
  propertyType?: string;
  accommodationType?: string;
  genderPolicy?: string;
  university?: string;
  campus?: string;
  neighbourhood?: string;
  minPrice?: number;
  maxPrice?: number;
  maxDistanceKm?: number;
  onlyVerifiedLandlord?: boolean;
  onlyApproved?: boolean;
  amenities?: string[];
  sortBy?: 'relevance' | 'price_asc' | 'price_desc' | 'newest' | 'distance';
}

class PropertyService {
  public searchProperties(params: PropertyFilterParams = {}): Property[] {
    let list = repository.getProperties();

    // Default to approved listings for public / student search unless onlyApproved === false
    if (params.onlyApproved !== false) {
      list = list.filter((p) => p.verificationStatus === 'approved');
    }

    if (params.query && params.query.trim()) {
      const q = params.query.toLowerCase().trim();
      list = list.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.neighbourhood.toLowerCase().includes(q) ||
          p.city.toLowerCase().includes(q) ||
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
      case 'newest':
        list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
      default:
        // Relevance: verified landlords and high availability first
        list.sort((a, b) => {
          if (a.landlordVerified && !b.landlordVerified) return -1;
          if (!a.landlordVerified && b.landlordVerified) return 1;
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
    data: Omit<Property, 'id' | 'landlordId' | 'landlordName' | 'landlordVerified' | 'slug' | 'verificationStatus' | 'createdAt' | 'updatedAt'>
  ): Property {
    const landlord = repository.getLandlordProfile(landlordId);
    const slug = data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Math.floor(100 + Math.random() * 900);

    const newProp: Property = {
      ...data,
      id: `prop-${Date.now()}`,
      landlordId,
      landlordName: landlord?.legalName || 'Landlord',
      landlordVerified: landlord?.verificationStatus === 'approved',
      slug,
      verificationStatus: 'pending', // submitted for admin approval
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    return repository.createProperty(newProp);
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
}

export const propertyService = new PropertyService();
