"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.expireOverdueReservations = exports.reviewPaymentReceipt = exports.createReservation = void 0;
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const firebaseAdmin_1 = require("./firebaseAdmin");
function cleanString(value, maxLength) {
    if (typeof value !== 'string')
        return undefined;
    const clean = value.trim();
    return clean.length > 0 && clean.length <= maxLength ? clean : undefined;
}
/**
 * Atomically create a reservation hold and decrement unit/property availability.
 * Replaces non-atomic client-side write sequence.
 */
exports.createReservation = (0, https_1.onCall)(async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
        throw new https_1.HttpsError('unauthenticated', 'Sign in to create an accommodation reservation.');
    }
    const propertyId = cleanString(request.data?.propertyId, 128);
    const unitId = cleanString(request.data?.unitId, 128);
    const groupId = cleanString(request.data?.groupId, 128);
    if (!propertyId || !unitId) {
        throw new https_1.HttpsError('invalid-argument', 'Valid propertyId and unitId are required.');
    }
    // Verify account is active
    const userSnap = await firebaseAdmin_1.db.doc(`users/${uid}`).get();
    if (!userSnap.exists || userSnap.data()?.accountStatus === 'suspended') {
        throw new https_1.HttpsError('permission-denied', 'Your user account is suspended or not active.');
    }
    const userData = userSnap.data() || {};
    const studentSnap = await firebaseAdmin_1.db.doc(`studentProfiles/${uid}`).get();
    const studentData = studentSnap.exists ? studentSnap.data() : {};
    const propRef = firebaseAdmin_1.db.doc(`properties/${propertyId}`);
    const now = new Date();
    const holdExpires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7-day hold window
    const resId = `res-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const invId = `inv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const resNum = `OUT-RES-${Math.floor(1000 + Math.random() * 9000)}`;
    const invNum = `INV-OUT-${Math.floor(1000 + Math.random() * 9000)}`;
    const resRef = firebaseAdmin_1.db.doc(`reservations/${resId}`);
    const invRef = firebaseAdmin_1.db.doc(`invoices/${invId}`);
    return await firebaseAdmin_1.db.runTransaction(async (transaction) => {
        const propDoc = await transaction.get(propRef);
        if (!propDoc.exists) {
            throw new https_1.HttpsError('not-found', 'Target accommodation listing not found.');
        }
        const propData = propDoc.data();
        if (propData.verificationStatus !== 'approved' || propData.isActive === false) {
            throw new https_1.HttpsError('failed-precondition', 'Accommodation listing is not currently verified and active for bookings.');
        }
        const rooms = Array.isArray(propData.rooms) ? [...propData.rooms] : [];
        const unitIndex = rooms.findIndex((r) => r.id === unitId);
        if (unitIndex === -1) {
            throw new https_1.HttpsError('not-found', 'Selected room or unit not found.');
        }
        const unit = rooms[unitIndex];
        if (typeof unit.availableSpaces !== 'number' || unit.availableSpaces <= 0) {
            throw new https_1.HttpsError('resource-exhausted', 'No available spaces remaining in this unit.');
        }
        // Atomic decrement
        unit.availableSpaces = unit.availableSpaces - 1;
        rooms[unitIndex] = unit;
        const aggregateAvailable = rooms.reduce((acc, r) => acc + (typeof r.availableSpaces === 'number' ? r.availableSpaces : 0), 0);
        transaction.update(propRef, {
            rooms,
            availableSpaces: aggregateAvailable,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        const newRes = {
            id: resId,
            reservationNumber: resNum,
            studentId: uid,
            studentName: studentData?.fullName || userData?.fullName || 'Student',
            studentEmail: userData?.email || '',
            studentPhone: studentData?.phone || userData?.phoneNumber || '',
            propertyId,
            propertyName: propData.title || 'Student Accommodation',
            propertyTitle: propData.title || 'Student Accommodation',
            propertyAddress: `${propData.address || ''}, ${propData.neighbourhood || ''}`,
            unitId,
            unitName: unit.name || 'Standard Unit',
            roomName: unit.name || 'Standard Unit',
            landlordId: propData.landlordId,
            landlordName: propData.landlordName || 'Verified Property Manager',
            ...(groupId ? { groupId } : {}),
            amount: unit.pricePerSession,
            currency: 'NGN',
            status: 'pending_payment',
            createdAt: now.toISOString(),
            holdExpiresAt: holdExpires.toISOString(),
            invoiceId: invId,
            serverCreatedAt: firestore_1.FieldValue.serverTimestamp(),
        };
        const newInv = {
            id: invId,
            invoiceNumber: invNum,
            reservationId: resId,
            studentId: uid,
            studentName: studentData?.fullName || userData?.fullName || 'Student',
            registrationNumber: studentData?.registrationNumber || '',
            university: studentData?.university || 'Bayero University Kano (BUK)',
            landlordId: propData.landlordId,
            landlordName: propData.landlordName || 'Verified Property Manager',
            propertyId,
            propertyName: propData.title || 'Student Accommodation',
            propertyTitle: propData.title || 'Student Accommodation',
            unitName: unit.name || 'Standard Unit',
            roomName: unit.name || 'Standard Unit',
            amount: unit.pricePerSession,
            totalAmount: unit.pricePerSession,
            currency: 'NGN',
            bankDetails: {
                bankName: 'Access Bank Nigeria',
                accountName: propData.landlordName || 'Verified Landlord',
                accountNumber: '0000000000',
                paymentInstructions: `Include reservation reference ${resNum} in your transfer narration.`,
            },
            createdAt: now.toISOString(),
            dueDate: holdExpires.toISOString(),
            status: 'unpaid',
            serverCreatedAt: firestore_1.FieldValue.serverTimestamp(),
        };
        transaction.set(resRef, newRes);
        transaction.set(invRef, newInv);
        return {
            ok: true,
            reservation: newRes,
            invoice: newInv,
        };
    });
});
/**
 * Landlord or admin review of payment receipts and reservation status transition.
 * Executes on trusted server to resolve client authorization desynchronization.
 */
exports.reviewPaymentReceipt = (0, https_1.onCall)(async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
        throw new https_1.HttpsError('unauthenticated', 'Sign in to review payment receipts.');
    }
    const receiptId = cleanString(request.data?.receiptId, 128);
    const decision = request.data?.decision;
    const rejectionReason = cleanString(request.data?.rejectionReason, 500);
    if (!receiptId || !['approved', 'rejected'].includes(decision)) {
        throw new https_1.HttpsError('invalid-argument', 'receiptId and valid decision (approved or rejected) are required.');
    }
    const isAdminCaller = request.auth?.token.admin === true;
    const receiptRef = firebaseAdmin_1.db.doc(`paymentReceipts/${receiptId}`);
    return await firebaseAdmin_1.db.runTransaction(async (transaction) => {
        const receiptDoc = await transaction.get(receiptRef);
        if (!receiptDoc.exists) {
            throw new https_1.HttpsError('not-found', 'Payment receipt not found.');
        }
        const receiptData = receiptDoc.data();
        if (!isAdminCaller && receiptData.landlordId !== uid) {
            throw new https_1.HttpsError('permission-denied', 'Only the property landlord or administrator can review this receipt.');
        }
        const resRef = firebaseAdmin_1.db.doc(`reservations/${receiptData.reservationId}`);
        const resDoc = await transaction.get(resRef);
        if (!resDoc.exists) {
            throw new https_1.HttpsError('not-found', 'Associated reservation record not found.');
        }
        const resData = resDoc.data();
        const now = Date.now();
        const expiryTime = new Date(resData.holdExpiresAt).getTime();
        if (decision === 'approved') {
            if (resData.status === 'confirmed') {
                return { ok: true, message: 'Reservation already confirmed.' };
            }
            if (resData.status === 'cancelled' || resData.status === 'expired') {
                throw new https_1.HttpsError('failed-precondition', `Cannot approve receipt for a reservation in ${resData.status} status.`);
            }
            if (expiryTime <= now) {
                throw new https_1.HttpsError('failed-precondition', 'The 7-day payment hold window has expired.');
            }
            transaction.update(receiptRef, {
                status: 'approved',
                reviewedAt: firestore_1.FieldValue.serverTimestamp(),
                reviewedBy: uid,
            });
            transaction.update(resRef, {
                status: 'confirmed',
                confirmedAt: firestore_1.FieldValue.serverTimestamp(),
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            });
            if (resData.invoiceId) {
                transaction.update(firebaseAdmin_1.db.doc(`invoices/${resData.invoiceId}`), {
                    status: 'paid',
                    updatedAt: firestore_1.FieldValue.serverTimestamp(),
                });
            }
        }
        else {
            transaction.update(receiptRef, {
                status: 'rejected',
                rejectionReason: rejectionReason || 'Receipt rejected by landlord.',
                reviewedAt: firestore_1.FieldValue.serverTimestamp(),
                reviewedBy: uid,
            });
            transaction.update(resRef, {
                status: 'rejected',
                cancellationReason: rejectionReason || 'Payment receipt rejected by landlord.',
                updatedAt: firestore_1.FieldValue.serverTimestamp(),
            });
            // Release unit inventory back to available spaces
            if (resData.propertyId && resData.unitId) {
                const propRef = firebaseAdmin_1.db.doc(`properties/${resData.propertyId}`);
                const propDoc = await transaction.get(propRef);
                if (propDoc.exists) {
                    const propData = propDoc.data();
                    const rooms = Array.isArray(propData.rooms) ? [...propData.rooms] : [];
                    const uIndex = rooms.findIndex((r) => r.id === resData.unitId);
                    if (uIndex !== -1) {
                        rooms[uIndex].availableSpaces = Math.min(rooms[uIndex].totalCapacity, (rooms[uIndex].availableSpaces || 0) + 1);
                        const aggregate = rooms.reduce((acc, r) => acc + (r.availableSpaces || 0), 0);
                        transaction.update(propRef, {
                            rooms,
                            availableSpaces: aggregate,
                            updatedAt: firestore_1.FieldValue.serverTimestamp(),
                        });
                    }
                }
            }
        }
        return { ok: true, decision };
    });
});
/**
 * Automates release of overdue 7-day reservations and restores unit capacity.
 */
exports.expireOverdueReservations = (0, https_1.onCall)(async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
        throw new https_1.HttpsError('unauthenticated', 'Authentication required.');
    }
    const now = new Date();
    const reservationsQuery = firebaseAdmin_1.db.collection('reservations')
        .where('status', 'in', ['pending_payment', 'receipt_submitted']);
    const snapshot = await reservationsQuery.get();
    let expiredCount = 0;
    for (const docSnap of snapshot.docs) {
        const data = docSnap.data();
        const holdExpires = new Date(data.holdExpiresAt).getTime();
        if (holdExpires <= now.getTime()) {
            await firebaseAdmin_1.db.runTransaction(async (transaction) => {
                const currentDoc = await transaction.get(docSnap.ref);
                if (!currentDoc.exists)
                    return;
                const currentData = currentDoc.data();
                if (!['pending_payment', 'receipt_submitted'].includes(currentData.status))
                    return;
                transaction.update(docSnap.ref, {
                    status: 'expired',
                    cancellationReason: 'Automated 7-day payment hold window expired.',
                    updatedAt: firestore_1.FieldValue.serverTimestamp(),
                });
                if (currentData.propertyId && currentData.unitId) {
                    const propRef = firebaseAdmin_1.db.doc(`properties/${currentData.propertyId}`);
                    const propDoc = await transaction.get(propRef);
                    if (propDoc.exists) {
                        const propData = propDoc.data();
                        const rooms = Array.isArray(propData.rooms) ? [...propData.rooms] : [];
                        const uIndex = rooms.findIndex((r) => r.id === currentData.unitId);
                        if (uIndex !== -1) {
                            rooms[uIndex].availableSpaces = Math.min(rooms[uIndex].totalCapacity, (rooms[uIndex].availableSpaces || 0) + 1);
                            const aggregate = rooms.reduce((acc, r) => acc + (r.availableSpaces || 0), 0);
                            transaction.update(propRef, {
                                rooms,
                                availableSpaces: aggregate,
                                updatedAt: firestore_1.FieldValue.serverTimestamp(),
                            });
                        }
                    }
                }
                if (currentData.invoiceId) {
                    transaction.update(firebaseAdmin_1.db.doc(`invoices/${currentData.invoiceId}`), {
                        status: 'expired',
                        updatedAt: firestore_1.FieldValue.serverTimestamp(),
                    });
                }
            });
            expiredCount++;
        }
    }
    return { ok: true, expiredCount };
});
//# sourceMappingURL=reservationOperations.js.map