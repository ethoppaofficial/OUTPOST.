"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchNearbyProperties = exports.reviewPropertyLocation = exports.synchronizeVerifiedPropertyLocation = exports.submitPropertyLocation = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-functions/v2/firestore");
const v2_1 = require("firebase-functions/v2");
const firestore_2 = require("firebase-admin/firestore");
const firebaseAdmin_1 = require("./firebaseAdmin");
(0, v2_1.setGlobalOptions)({
    region: process.env.FUNCTION_REGION || 'europe-west2',
    maxInstances: 10,
});
const ALLOWED_AREAS = new Set(['Dambare', 'Rimin Gata']);
const ALLOWED_PRECISIONS = new Set([
    'exact_building',
    'nearby_building',
    'street',
    'neighbourhood',
]);
const ALLOWED_SOURCES = new Set([
    'manual_pin',
    'device_gps',
    'geocoded_address',
]);
function isFiniteCoordinate(latitude, longitude) {
    return (typeof latitude === 'number' &&
        typeof longitude === 'number' &&
        Number.isFinite(latitude) &&
        Number.isFinite(longitude) &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180);
}
function cleanString(value, maxLength) {
    if (typeof value !== 'string')
        return undefined;
    const clean = value.trim();
    return clean.length > 0 && clean.length <= maxLength ? clean : undefined;
}
async function getUserRole(uid) {
    const snapshot = await firebaseAdmin_1.db.doc(`users/${uid}`).get();
    return snapshot.exists ? snapshot.data()?.role : undefined;
}
async function requireRole(uid, roles, claims) {
    if (roles.includes('admin') && claims?.admin === true) {
        const profile = await firebaseAdmin_1.db.doc(`users/${uid}`).get();
        if (!profile.exists || profile.data()?.accountStatus === 'suspended') {
            throw new https_1.HttpsError('permission-denied', 'This administrator account is not active.');
        }
        return;
    }
    const role = await getUserRole(uid);
    if (!role || !roles.includes(role) || (role === 'admin' && claims?.admin !== true)) {
        throw new https_1.HttpsError('permission-denied', 'You are not authorized for this operation.');
    }
}
function validateSubmission(input) {
    if (!input || typeof input !== 'object') {
        throw new https_1.HttpsError('invalid-argument', 'A location submission is required.');
    }
    const raw = input;
    const propertyId = cleanString(raw.propertyId, 128);
    const area = cleanString(raw.area, 40);
    const precision = cleanString(raw.precision, 40);
    const source = cleanString(raw.source, 40);
    const formattedAddress = cleanString(raw.formattedAddress, 300);
    const latitude = raw.latitude;
    const longitude = raw.longitude;
    const accuracyMeters = raw.accuracyMeters;
    if (!propertyId || !ALLOWED_AREAS.has(area)) {
        throw new https_1.HttpsError('invalid-argument', 'A valid property and case-study area are required.');
    }
    if (!isFiniteCoordinate(latitude, longitude)) {
        throw new https_1.HttpsError('invalid-argument', 'Latitude or longitude is invalid.');
    }
    if (!ALLOWED_PRECISIONS.has(precision) || !ALLOWED_SOURCES.has(source)) {
        throw new https_1.HttpsError('invalid-argument', 'The location precision or source is invalid.');
    }
    if (accuracyMeters !== undefined &&
        (typeof accuracyMeters !== 'number' || !Number.isFinite(accuracyMeters) || accuracyMeters < 0)) {
        throw new https_1.HttpsError('invalid-argument', 'GPS accuracy is invalid.');
    }
    return {
        propertyId,
        area,
        latitude: latitude,
        longitude: longitude,
        accuracyMeters: accuracyMeters,
        precision,
        source,
        formattedAddress,
    };
}
/**
 * Called by the landlord form. It validates ownership and stores a pending
 * private submission. It intentionally cannot approve or publish coordinates.
 */
exports.submitPropertyLocation = (0, https_1.onCall)(async (request) => {
    const uid = request.auth?.uid;
    if (!uid)
        throw new https_1.HttpsError('unauthenticated', 'Sign in to submit a location.');
    await requireRole(uid, ['landlord', 'admin'], request.auth?.token);
    const submission = validateSubmission(request.data);
    const propertyRef = firebaseAdmin_1.db.doc(`properties/${submission.propertyId}`);
    const locationRef = firebaseAdmin_1.db.doc(`propertyLocations/${submission.propertyId}`);
    const propertySnapshot = await propertyRef.get();
    if (!propertySnapshot.exists) {
        throw new https_1.HttpsError('not-found', 'Property was not found.');
    }
    const property = propertySnapshot.data();
    if (property.landlordId !== uid && (await getUserRole(uid)) !== 'admin') {
        throw new https_1.HttpsError('permission-denied', 'You do not own this property.');
    }
    const now = firestore_2.FieldValue.serverTimestamp();
    const pendingRecord = {
        ...submission,
        submittedBy: uid,
        verificationStatus: 'pending',
        publicLatitude: null,
        publicLongitude: null,
        submittedAt: now,
        updatedAt: now,
    };
    await firebaseAdmin_1.db.runTransaction(async (transaction) => {
        transaction.set(locationRef, pendingRecord, { merge: true });
        transaction.update(propertyRef, {
            locationVerificationStatus: 'pending',
            publicLatitude: firestore_2.FieldValue.delete(),
            publicLongitude: firestore_2.FieldValue.delete(),
            locationUpdatedAt: now,
            updatedAt: now,
        });
    });
    return {
        ok: true,
        propertyId: submission.propertyId,
        verificationStatus: 'pending',
    };
});
/**
 * Triggered whenever propertyLocations/{propertyId} changes. A landlord's
 * submission remains private. Only an administrator-approved verified record
 * releases public coordinates onto the property document.
 */
exports.synchronizeVerifiedPropertyLocation = (0, firestore_1.onDocumentWritten)({ document: 'propertyLocations/{propertyId}', database: firebaseAdmin_1.FIRESTORE_DATABASE_ID }, async (event) => {
    const after = event.data?.after;
    const before = event.data?.before;
    if (!after?.exists)
        return;
    const next = after.data();
    const previous = before?.exists ? before.data() : undefined;
    const propertyRef = firebaseAdmin_1.db.doc(`properties/${event.params.propertyId}`);
    const propertySnapshot = await propertyRef.get();
    if (!propertySnapshot.exists)
        return;
    const property = propertySnapshot.data();
    const statusChanged = previous?.verificationStatus !== next.verificationStatus;
    const coordinatesChanged = previous?.publicLatitude !== next.publicLatitude ||
        previous?.publicLongitude !== next.publicLongitude;
    if (!statusChanged && !coordinatesChanged)
        return;
    if (next.verificationStatus === 'verified') {
        const reviewedBy = cleanString(next.reviewedBy, 128);
        const reviewerRole = reviewedBy ? await getUserRole(reviewedBy) : undefined;
        if (!reviewedBy || reviewerRole !== 'admin') {
            console.error('Verified location has no valid administrator reviewer', {
                propertyId: event.params.propertyId,
            });
            return;
        }
        if (!isFiniteCoordinate(next.publicLatitude, next.publicLongitude)) {
            console.error('Verified location has no valid public coordinates', {
                propertyId: event.params.propertyId,
            });
            return;
        }
        if (!ALLOWED_AREAS.has(next.area))
            return;
        await propertyRef.update({
            locationVerificationStatus: 'verified',
            publicLatitude: next.publicLatitude,
            publicLongitude: next.publicLongitude,
            publicLocationPrecision: next.precision,
            publicLocationLabel: next.formattedAddress || `${next.area}, Kano State`,
            isActive: property.verificationStatus === 'approved' && property.moderationStatus !== 'suspended',
            locationUpdatedAt: firestore_2.FieldValue.serverTimestamp(),
            updatedAt: firestore_2.FieldValue.serverTimestamp(),
        });
        await firebaseAdmin_1.db.collection('auditLogs').add({
            action: 'property_location_verified',
            actorType: 'admin',
            actorId: reviewedBy,
            propertyId: event.params.propertyId,
            area: next.area,
            createdAt: firestore_2.FieldValue.serverTimestamp(),
        });
        return;
    }
    // Pending or rejected locations must never remain publicly visible.
    await propertyRef.update({
        locationVerificationStatus: next.verificationStatus,
        isActive: false,
        publicLatitude: firestore_2.FieldValue.delete(),
        publicLongitude: firestore_2.FieldValue.delete(),
        publicLocationPrecision: firestore_2.FieldValue.delete(),
        publicLocationLabel: firestore_2.FieldValue.delete(),
        locationUpdatedAt: firestore_2.FieldValue.serverTimestamp(),
        updatedAt: firestore_2.FieldValue.serverTimestamp(),
    });
});
/**
 * Administrator-only callable for approving or rejecting a location. The
 * public-coordinate release trigger performs the final synchronization.
 */
exports.reviewPropertyLocation = (0, https_1.onCall)(async (request) => {
    const uid = request.auth?.uid;
    if (!uid)
        throw new https_1.HttpsError('unauthenticated', 'Sign in to review locations.');
    await requireRole(uid, ['admin'], request.auth?.token);
    const raw = (request.data ?? {});
    const propertyId = cleanString(raw.propertyId, 128);
    const decision = cleanString(raw.decision, 20);
    const reviewReason = cleanString(raw.reviewReason, 500);
    const publicLatitude = raw.publicLatitude;
    const publicLongitude = raw.publicLongitude;
    const precision = cleanString(raw.precision, 40);
    if (!propertyId || !['verified', 'rejected'].includes(decision ?? '')) {
        throw new https_1.HttpsError('invalid-argument', 'Property and review decision are required.');
    }
    const locationRef = firebaseAdmin_1.db.doc(`propertyLocations/${propertyId}`);
    const snapshot = await locationRef.get();
    if (!snapshot.exists)
        throw new https_1.HttpsError('not-found', 'Location submission was not found.');
    const current = snapshot.data();
    if (decision === 'verified') {
        if (!isFiniteCoordinate(publicLatitude, publicLongitude)) {
            throw new https_1.HttpsError('invalid-argument', 'Valid public coordinates are required.');
        }
        if (!ALLOWED_PRECISIONS.has(precision)) {
            throw new https_1.HttpsError('invalid-argument', 'A valid public precision is required.');
        }
        if (!ALLOWED_AREAS.has(current.area)) {
            throw new https_1.HttpsError('failed-precondition', 'The property is outside the supported case-study areas.');
        }
    }
    else if (!reviewReason) {
        throw new https_1.HttpsError('invalid-argument', 'A rejection reason is required.');
    }
    await locationRef.update({
        verificationStatus: decision,
        publicLatitude: decision === 'verified' ? publicLatitude : null,
        publicLongitude: decision === 'verified' ? publicLongitude : null,
        precision: decision === 'verified' ? precision : current.precision,
        reviewedBy: uid,
        reviewedAt: firestore_2.FieldValue.serverTimestamp(),
        reviewReason: reviewReason || firestore_2.FieldValue.delete(),
        updatedAt: firestore_2.FieldValue.serverTimestamp(),
    });
    if (decision === 'rejected') {
        await firebaseAdmin_1.db.collection('auditLogs').add({
            action: 'PROPERTY_LOCATION_REJECTED',
            actorType: 'admin',
            actorId: uid,
            targetEntity: 'PropertyLocation',
            targetId: propertyId,
            details: reviewReason,
            timestamp: firestore_2.FieldValue.serverTimestamp(),
        });
    }
    return { ok: true, propertyId, verificationStatus: decision };
});
/**
 * Student-only trusted Cloud Function for nearby accommodation ranking.
 * Takes the student's current device coordinates, reads private verified property
 * locations on the server, calculates full-precision spherical distance, and returns
 * ONLY the minimum necessary public fields (propertyId, distance rounded to 0.1km,
 * and coarse 8-point compass direction). Exact coordinates are NEVER returned.
 */
exports.searchNearbyProperties = (0, https_1.onCall)(async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
        throw new https_1.HttpsError('unauthenticated', 'Authentication is required for nearby accommodation search.');
    }
    // Enforce Student role strictly from trusted profile/token data
    await requireRole(uid, ['student', 'admin'], request.auth?.token);
    const raw = (request.data ?? {});
    const latitude = raw.latitude;
    const longitude = raw.longitude;
    if (!isFiniteCoordinate(latitude, longitude)) {
        throw new https_1.HttpsError('invalid-argument', 'Valid, finite GPS coordinates are required.');
    }
    const studentLat = latitude;
    const studentLon = longitude;
    // Maximum radius in km to prevent unbounded queries (e.g. 50km around Kano)
    const maxRadiusKm = typeof raw.maxRadiusKm === 'number' && Number.isFinite(raw.maxRadiusKm) && raw.maxRadiusKm > 0
        ? Math.min(raw.maxRadiusKm, 25)
        : 20;
    // Query only approved, active properties within the approved study area
    const propertiesSnap = await firebaseAdmin_1.db
        .collection('properties')
        .where('verificationStatus', '==', 'approved')
        .where('locationVerificationStatus', '==', 'verified')
        .get();
    if (propertiesSnap.empty) {
        return { results: [] };
    }
    // Filter properties in memory for active status and allowed case study areas
    const candidatePropertyIds = [];
    for (const doc of propertiesSnap.docs) {
        const data = doc.data();
        if (data.isActive !== false && data.moderationStatus !== 'suspended') {
            const area = data.area || data.neighbourhood;
            if (ALLOWED_AREAS.has(area)) {
                candidatePropertyIds.push(doc.id);
            }
        }
    }
    if (candidatePropertyIds.length === 0) {
        return { results: [] };
    }
    // Read the private property locations using Admin SDK
    // Firestore getAll supports up to 500 document references
    const chunkSize = 200;
    const locationDocs = [];
    for (let i = 0; i < candidatePropertyIds.length; i += chunkSize) {
        const chunkIds = candidatePropertyIds.slice(i, i + chunkSize);
        const refs = chunkIds.map((id) => firebaseAdmin_1.db.doc(`propertyLocations/${id}`));
        const chunkSnaps = await firebaseAdmin_1.db.getAll(...refs);
        locationDocs.push(...chunkSnaps);
    }
    const toRad = (deg) => (deg * Math.PI) / 180;
    const toDeg = (rad) => (rad * 180) / Math.PI;
    const ranked = [];
    for (const locDoc of locationDocs) {
        if (!locDoc.exists)
            continue;
        const loc = locDoc.data();
        if (loc.verificationStatus !== 'verified')
            continue;
        if (!ALLOWED_AREAS.has(loc.area))
            continue;
        // Use the verified property coordinates (publicLatitude/publicLongitude or latitude/longitude)
        const propLat = typeof loc.publicLatitude === 'number' && Number.isFinite(loc.publicLatitude)
            ? loc.publicLatitude
            : loc.latitude;
        const propLon = typeof loc.publicLongitude === 'number' && Number.isFinite(loc.publicLongitude)
            ? loc.publicLongitude
            : loc.longitude;
        if (!isFiniteCoordinate(propLat, propLon))
            continue;
        // Spherical distance (Haversine)
        const dLat = toRad(propLat - studentLat);
        const dLon = toRad(propLon - studentLon);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(studentLat)) * Math.cos(toRad(propLat)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
        const rawDistanceKm = 6371 * c;
        if (rawDistanceKm > maxRadiusKm)
            continue;
        // Coarse 8-point compass direction
        let compassDirection = null;
        const epsilon = 1e-7;
        if (Math.abs(studentLat - propLat) >= epsilon || Math.abs(studentLon - propLon) >= epsilon) {
            const y = Math.sin(dLon) * Math.cos(toRad(propLat));
            const x = Math.cos(toRad(studentLat)) * Math.sin(toRad(propLat)) -
                Math.sin(toRad(studentLat)) * Math.cos(toRad(propLat)) * Math.cos(dLon);
            const θ = Math.atan2(y, x);
            const bearing = (toDeg(θ) + 360) % 360;
            if (bearing >= 337.5 || bearing < 22.5)
                compassDirection = 'N';
            else if (bearing < 67.5)
                compassDirection = 'NE';
            else if (bearing < 112.5)
                compassDirection = 'E';
            else if (bearing < 157.5)
                compassDirection = 'SE';
            else if (bearing < 202.5)
                compassDirection = 'S';
            else if (bearing < 247.5)
                compassDirection = 'SW';
            else if (bearing < 292.5)
                compassDirection = 'W';
            else
                compassDirection = 'NW';
        }
        // Expose ONLY rounded distance to 0.1km
        const distanceKm = Math.round(rawDistanceKm * 10) / 10;
        ranked.push({
            propertyId: loc.propertyId,
            rawDistanceKm,
            distanceKm,
            compassDirection,
        });
    }
    // Sort by full-precision spherical distance
    ranked.sort((a, b) => a.rawDistanceKm - b.rawDistanceKm);
    // Return strictly minimal fields: propertyId, distanceKm (0.1km rounded), compassDirection
    const results = ranked.map((item) => ({
        propertyId: item.propertyId,
        distanceKm: item.distanceKm,
        compassDirection: item.compassDirection,
    }));
    return { results };
});
//# sourceMappingURL=locationVerification.js.map