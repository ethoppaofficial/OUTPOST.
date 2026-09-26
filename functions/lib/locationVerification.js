"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reviewPropertyLocation = exports.synchronizeVerifiedPropertyLocation = exports.submitPropertyLocation = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-functions/v2/firestore");
const v2_1 = require("firebase-functions/v2");
const app_1 = require("firebase-admin/app");
const firestore_2 = require("firebase-admin/firestore");
if ((0, app_1.getApps)().length === 0)
    (0, app_1.initializeApp)();
const db = (0, firestore_2.getFirestore)();
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
    const snapshot = await db.doc(`users/${uid}`).get();
    return snapshot.exists ? snapshot.data()?.role : undefined;
}
async function requireRole(uid, roles) {
    const role = await getUserRole(uid);
    if (!role || !roles.includes(role)) {
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
    await requireRole(uid, ['landlord', 'admin']);
    const submission = validateSubmission(request.data);
    const propertyRef = db.doc(`properties/${submission.propertyId}`);
    const locationRef = db.doc(`propertyLocations/${submission.propertyId}`);
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
    await db.runTransaction(async (transaction) => {
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
exports.synchronizeVerifiedPropertyLocation = (0, firestore_1.onDocumentWritten)('propertyLocations/{propertyId}', async (event) => {
    const after = event.data?.after;
    const before = event.data?.before;
    if (!after?.exists)
        return;
    const next = after.data();
    const previous = before?.exists ? before.data() : undefined;
    const propertyRef = db.doc(`properties/${event.params.propertyId}`);
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
            locationUpdatedAt: firestore_2.FieldValue.serverTimestamp(),
            updatedAt: firestore_2.FieldValue.serverTimestamp(),
        });
        await db.collection('auditLogs').add({
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
    await requireRole(uid, ['admin']);
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
    const locationRef = db.doc(`propertyLocations/${propertyId}`);
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
    return { ok: true, propertyId, verificationStatus: decision };
});
//# sourceMappingURL=locationVerification.js.map