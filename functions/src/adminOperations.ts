import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { db } from './firebaseAdmin';

async function requireAdmin(request: CallableRequest): Promise<string> {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to continue.');
  if (request.auth?.token.admin !== true) {
    throw new HttpsError('permission-denied', 'Administrator permission is required.');
  }
  const profile = await db.doc(`users/${uid}`).get();
  if (!profile.exists || profile.data()?.accountStatus === 'suspended') {
    throw new HttpsError('permission-denied', 'This administrator account is not active.');
  }
  return uid;
}

function cleanString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.trim();
  return clean.length > 0 && clean.length <= maxLength ? clean : undefined;
}

function auditRef() {
  return db.collection('auditLogs').doc();
}

async function actorName(uid: string): Promise<string> {
  const snap = await db.doc(`users/${uid}`).get();
  const data = snap.data() || {};
  return cleanString(data.fullName ?? data.name, 120) || cleanString(data.email, 254) || 'Administrator';
}

function auditPayload(input: {
  actorId: string;
  actorName: string;
  action: string;
  targetEntity: string;
  targetId: string;
  details: string;
}) {
  return {
    actorId: input.actorId,
    actorName: input.actorName,
    actorRole: 'admin',
    action: input.action,
    targetEntity: input.targetEntity,
    targetId: input.targetId,
    details: input.details.slice(0, 1000),
    timestamp: FieldValue.serverTimestamp(),
  };
}

function notificationRef(uid: string) {
  return db.collection('notifications').doc(`${Date.now()}-${uid}-${Math.random().toString(36).slice(2, 8)}`);
}

async function areNotificationsEnabled(): Promise<boolean> {
  const snapshot = await db.doc('platformSettings/default').get();
  return snapshot.data()?.notificationsEnabled !== false;
}

export const adminRecordSecurityEvent = onCall(async (request) => {
  const actorId = await requireAdmin(request);
  const event = request.data?.event;
  if (!['ADMIN_LOGIN', 'ADMIN_LOGOUT'].includes(event)) {
    throw new HttpsError('invalid-argument', 'Unsupported administrator security event.');
  }
  const name = await actorName(actorId);
  await db.collection('auditLogs').add(auditPayload({
    actorId,
    actorName: name,
    action: event,
    targetEntity: 'AdministratorSession',
    targetId: actorId,
    details: event === 'ADMIN_LOGIN' ? 'Administrator signed in.' : 'Administrator signed out.',
  }));
  return { ok: true };
});

export const adminSetUserStatus = onCall(async (request) => {
  const actorId = await requireAdmin(request);
  const targetId = cleanString(request.data?.targetId, 128);
  const status = request.data?.status;
  const reason = cleanString(request.data?.reason, 500);
  if (!targetId || !['active', 'suspended'].includes(status)) {
    throw new HttpsError('invalid-argument', 'A valid user and account status are required.');
  }
  if (status === 'suspended' && !reason) {
    throw new HttpsError('invalid-argument', 'A reason is required to suspend an account.');
  }
  if (targetId === actorId) {
    throw new HttpsError('failed-precondition', 'You cannot suspend your own administrator account.');
  }

  const targetRef = db.doc(`users/${targetId}`);
  const [targetSnap, targetAuth, name] = await Promise.all([
    targetRef.get(),
    getAuth().getUser(targetId).catch(() => null),
    actorName(actorId),
  ]);
  if (!targetSnap.exists || !targetAuth) throw new HttpsError('not-found', 'User was not found.');
  if (targetAuth.customClaims?.admin === true || targetSnap.data()?.role === 'admin') {
    throw new HttpsError('failed-precondition', 'Administrator accounts cannot be suspended from this screen.');
  }

  const nextDisabled = status === 'suspended';
  await getAuth().updateUser(targetId, { disabled: nextDisabled });
  if (nextDisabled) await getAuth().revokeRefreshTokens(targetId);
  const log = auditRef();
  const notification = notificationRef(targetId);
  const oldStatus = targetSnap.data()?.accountStatus || 'active';
  const sendNotification = await areNotificationsEnabled();

  await db.runTransaction(async (tx) => {
    tx.update(targetRef, {
      accountStatus: status,
      isActive: !nextDisabled,
      updatedAt: FieldValue.serverTimestamp(),
      statusChangedBy: actorId,
    });
    tx.create(log, auditPayload({
      actorId,
      actorName: name,
      action: nextDisabled ? 'SUSPEND_USER' : 'REACTIVATE_USER',
      targetEntity: 'User',
      targetId,
      details: `Account status changed from ${oldStatus} to ${status}.${reason ? ` Reason: ${reason}` : ''}`,
    }));
    if (sendNotification) tx.create(notification, {
      userId: targetId,
      title: nextDisabled ? 'Account suspended' : 'Account reactivated',
      message: nextDisabled
        ? `Your OUTPOST account has been suspended.${reason ? ` Reason: ${reason}` : ''} Contact support if you believe this is an error.`
        : 'Your OUTPOST account has been reactivated.',
      type: nextDisabled ? 'warning' : 'success',
      isRead: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { ok: true, targetId, status };
});

export const adminReviewVerification = onCall(async (request) => {
  const actorId = await requireAdmin(request);
  const kind = request.data?.kind;
  const targetId = cleanString(request.data?.targetId, 128);
  const decision = request.data?.decision;
  const reason = cleanString(request.data?.reason, 500);
  if (!targetId || !['student', 'landlord'].includes(kind) || !['approved', 'rejected'].includes(decision)) {
    throw new HttpsError('invalid-argument', 'A valid verification target and decision are required.');
  }
  if (decision === 'rejected' && !reason) {
    throw new HttpsError('invalid-argument', 'A rejection reason is required.');
  }

  const name = await actorName(actorId);
  const docRef = kind === 'student'
    ? db.doc(`studentVerificationDocuments/${targetId}`)
    : db.doc(`landlordProfiles/${targetId}`);
  const snapshot = await docRef.get();
  if (!snapshot.exists) throw new HttpsError('not-found', 'Verification submission was not found.');
  const record = snapshot.data()!;
  const userId = kind === 'student'
    ? cleanString(record.studentId, 128)
    : cleanString(record.userId, 128) || targetId;
  if (!userId) throw new HttpsError('failed-precondition', 'The submission has no valid account owner.');

  const log = auditRef();
  const notification = notificationRef(userId);
  const sendNotification = await areNotificationsEnabled();
  const profileRef = kind === 'student' ? db.doc(`studentProfiles/${userId}`) : docRef;
  const statusField = kind === 'student' ? 'status' : 'verificationStatus';
  const previousStatus = record[statusField] || 'pending';

  await db.runTransaction(async (tx) => {
    const ownerSnap = await tx.get(db.doc(`users/${userId}`));
    if (!ownerSnap.exists) throw new HttpsError('not-found', 'The account associated with this submission was not found.');
    tx.update(docRef, {
      [statusField]: decision,
      reviewedBy: actorId,
      reviewerId: actorId,
      reviewedAt: FieldValue.serverTimestamp(),
      verifiedAt: decision === 'approved' ? FieldValue.serverTimestamp() : null,
      rejectionReason: decision === 'rejected' ? reason : FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (kind === 'student') {
      tx.set(profileRef, {
        userId,
        isProfileVerified: decision === 'approved',
        verificationStatus: decision,
        verificationReviewedBy: actorId,
        verificationReviewedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    tx.create(log, auditPayload({
      actorId,
      actorName: name,
      action: `${kind.toUpperCase()}_VERIFICATION_${decision.toUpperCase()}`,
      targetEntity: kind === 'student' ? 'StudentVerificationDocument' : 'LandlordProfile',
      targetId,
      details: `Verification changed from ${previousStatus} to ${decision}.${reason ? ` Reason: ${reason}` : ''}`,
    }));
    if (sendNotification) tx.create(notification, {
      userId,
      title: `${kind === 'student' ? 'Student' : 'Landlord'} verification ${decision}`,
      message: decision === 'approved'
        ? 'Your submitted verification has been approved.'
        : `Your submitted verification was not approved. Reason: ${reason}`,
      type: decision === 'approved' ? 'success' : 'warning',
      link: kind === 'student' ? '/student/verification' : '/landlord/verification',
      isRead: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { ok: true, targetId, kind, decision };
});

export const adminReviewProperty = onCall(async (request) => {
  const actorId = await requireAdmin(request);
  const propertyId = cleanString(request.data?.propertyId, 128);
  const decision = request.data?.decision;
  const reason = cleanString(request.data?.reason, 500);
  const allowed = ['approve', 'reject', 'suspend', 'reactivate'];
  if (!propertyId || !allowed.includes(decision)) {
    throw new HttpsError('invalid-argument', 'A valid property and moderation action are required.');
  }
  if (['reject', 'suspend'].includes(decision) && !reason) {
    throw new HttpsError('invalid-argument', 'A reason is required for rejection or suspension.');
  }

  const propertyRef = db.doc(`properties/${propertyId}`);
  const snap = await propertyRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Property was not found.');
  const property = snap.data()!;
  const landlordId = cleanString(property.landlordId, 128);
  const name = await actorName(actorId);
  const log = auditRef();
  const notification = landlordId ? notificationRef(landlordId) : undefined;
  const sendNotification = await areNotificationsEnabled();
  const locationStatus = property.locationVerificationStatus || property.location?.verificationStatus;
  const updates: Record<string, unknown> = {
    reviewedBy: actorId,
    reviewedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (decision === 'approve') {
    updates.verificationStatus = 'approved';
    updates.moderationStatus = 'active';
    updates.isActive = locationStatus === 'verified';
  } else if (decision === 'reject') {
    updates.verificationStatus = 'rejected';
    updates.moderationStatus = 'rejected';
    updates.isActive = false;
    updates.adminReviewReason = reason;
  } else if (decision === 'suspend') {
    updates.moderationStatus = 'suspended';
    updates.isActive = false;
    updates.adminReviewReason = reason;
  } else {
    updates.moderationStatus = 'active';
    updates.isActive = property.verificationStatus === 'approved' && locationStatus === 'verified';
    updates.adminReviewReason = FieldValue.delete();
  }

  await db.runTransaction(async (tx) => {
    tx.update(propertyRef, updates);
    tx.create(log, auditPayload({
      actorId,
      actorName: name,
      action: `PROPERTY_${String(decision).toUpperCase()}`,
      targetEntity: 'Property',
      targetId: propertyId,
      details: `${cleanString(property.title, 200) || 'Property'}: ${decision}.${reason ? ` Reason: ${reason}` : ''} Property verification and location verification are recorded separately.`,
    }));
    if (notification && sendNotification) {
      tx.create(notification, {
        userId: landlordId,
        title: `Property listing ${decision === 'approve' ? 'approved' : decision === 'reactivate' ? 'reactivated' : decision === 'suspend' ? 'suspended' : 'rejected'}`,
        message: reason || 'An administrator reviewed your property listing.',
        type: decision === 'approve' || decision === 'reactivate' ? 'success' : 'warning',
        link: '/landlord/properties',
        isRead: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  });
  return { ok: true, propertyId, decision };
});

export const adminSaveSettings = onCall(async (request) => {
  const actorId = await requireAdmin(request);
  const input = request.data?.settings;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpsError('invalid-argument', 'Settings must be provided as an object.');
  }
  const allowedKeys = new Set([
    'reservationHoldDays',
    'receiptReviewDeadlineHours',
    'notificationsEnabled',
    'maintenanceMode',
    'studentVerificationRequired',
    'landlordVerificationRequired',
    'propertyVerificationRequired',
  ]);
  const settings: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!allowedKeys.has(key)) throw new HttpsError('invalid-argument', `Unsupported setting: ${key}.`);
    if (key === 'reservationHoldDays') {
      if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 7) {
        throw new HttpsError('invalid-argument', 'Reservation hold must be between 1 and 7 days.');
      }
    } else if (key === 'receiptReviewDeadlineHours') {
      if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 720) {
        throw new HttpsError('invalid-argument', 'Receipt review deadline must be between 1 and 720 hours.');
      }
    } else if (typeof value !== 'boolean') {
      throw new HttpsError('invalid-argument', `${key} must be true or false.`);
    }
    settings[key] = value;
  }
  if (Object.keys(settings).length === 0) throw new HttpsError('invalid-argument', 'At least one setting must be changed.');

  const name = await actorName(actorId);
  const settingsRef = db.doc('platformSettings/default');
  const publicSettingsRef = db.doc('publicSettings/default');
  const log = auditRef();
  await db.runTransaction(async (tx) => {
    const existing = await tx.get(settingsRef);
    tx.set(settingsRef, {
      ...settings,
      updatedBy: actorId,
      updatedAt: FieldValue.serverTimestamp(),
      ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    }, { merge: true });
    if (typeof settings.maintenanceMode === 'boolean') {
      tx.set(publicSettingsRef, {
        maintenanceMode: settings.maintenanceMode,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    tx.create(log, auditPayload({
      actorId,
      actorName: name,
      action: 'UPDATE_PLATFORM_SETTINGS',
      targetEntity: 'PlatformSettings',
      targetId: 'default',
      details: `Updated setting keys: ${Object.keys(settings).join(', ')}.`,
    }));
  });
  return { ok: true, settings };
});
