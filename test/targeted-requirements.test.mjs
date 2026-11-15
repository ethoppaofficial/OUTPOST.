import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  normalizeRegistrationNumber,
  validateStudentRegistrationNumber,
} from '../src/application/utils/validation.ts';
import { propertyService } from '../src/application/services/propertyService.ts';
import { reservationService } from '../src/application/services/reservationService.ts';
import { verificationService } from '../src/application/services/verificationService.ts';
import { repository } from '../src/infrastructure/repositories/index.ts';
import { createAdminService } from '../src/application/services/adminService.ts';
import { authService } from '../src/application/services/authService.ts';

const read = (relPath) => fs.readFileSync(path.resolve(relPath), 'utf8');

describe('OUTPOST: Targeted Requirements Verification Suite (1-8)', () => {
  const m11 = read('supabase/migrations/20261114000011_targeted_profiles_availability_pay_verification.sql');
  const edgeReserve = read('supabase/functions/create-reservation/index.ts');

  describe('Requirement 1: Unique Student Registration Numbers & Legacy Safety', () => {
    test('Normalizes whitespace and validates realistic university matriculation numbers', () => {
      assert.equal(normalizeRegistrationNumber('  buk / 22 / chs / 00812 '), 'BUK/22/CHS/00812');
      assert.equal(normalizeRegistrationNumber('buk/23/eng/01492'), 'BUK/23/ENG/01492');

      const valid1 = validateStudentRegistrationNumber(' BUK/22/CHS/00812 ');
      assert.equal(valid1.isValid, true);
      assert.equal(valid1.normalized, 'BUK/22/CHS/00812');

      const valid2 = validateStudentRegistrationNumber('CST/21/COM/0014');
      assert.equal(valid2.isValid, true);

      const empty = validateStudentRegistrationNumber('   ');
      assert.equal(empty.isValid, false);

      const tooShort = validateStudentRegistrationNumber('AB');
      assert.equal(tooShort.isValid, false);

      const invalidChars = validateStudentRegistrationNumber('BUK@22#bad!');
      assert.equal(invalidChars.isValid, false);
    });

    test('Migration 11 enforces DB uniqueness & NOT VALID check without fabricating legacy NULL rows', () => {
      // Never fabricates dummy matric numbers when registration_number IS NULL
      assert.match(m11, /WHERE registration_number IS NOT NULL;/i);
      assert.doesNotMatch(m11, /SET registration_number\s*=.*COALESCE\(registration_number/i);

      // Unique functional index and NOT VALID constraint for legacy row preservation
      assert.match(m11, /CREATE UNIQUE INDEX IF NOT EXISTS uq_student_profiles_registration_number/i);
      assert.match(m11, /ADD CONSTRAINT chk_student_reg_number_required[\s\S]*NOT VALID/i);

      // Concurrent duplicate signup error mapping and pre-signup availability check
      assert.match(m11, /CREATE OR REPLACE FUNCTION public\.is_registration_number_available/i);
      assert.match(m11, /WHEN unique_violation THEN[\s\S]*ERRCODE = '23505'/i);

      // Verified students cannot self-clear or alter registration numbers
      assert.match(m11, /IF OLD\.registration_number IS NOT NULL AND \(NEW\.registration_number IS NULL/i);
      assert.match(m11, /IF OLD\.is_profile_verified = true AND NEW\.registration_number IS DISTINCT FROM OLD\.registration_number/i);
    });
  });

  describe('Requirements 2, 3, 4 & 7: Public Landlord & Student Profiles + Clickable Links + Zero PII', () => {
    const publicProfileSrc = read('src/pages/public/PublicProfilePage.tsx');
    const appSrc = read('src/App.tsx');
    const propCardSrc = read('src/components/ui/PropertyCard.tsx');
    const propDetailSrc = read('src/pages/public/PropertyDetailPage.tsx');
    const resDetailSrc = read('src/pages/student/ReservationDetailPage.tsx');
    const invoiceSrc = read('src/pages/student/InvoicePage.tsx');
    const roommatesSrc = read('src/pages/student/RoommatesPage.tsx');
    const reqsSrc = read('src/pages/student/RoommateRequestsPage.tsx');
    const groupDetailSrc = read('src/pages/student/GroupDetailPage.tsx');
    const userSearchSrc = read('src/pages/student/UserSearchPage.tsx');
    const receiptsSrc = read('src/pages/landlord/LandlordReceiptsPage.tsx');
    const studentDashSrc = read('src/pages/student/StudentDashboard.tsx');
    const studentVerifSrc = read('src/pages/student/StudentVerificationPage.tsx');

    test('Public profile RPCs strip PII (email, phone, tax_id, bank accounts) and revoke anon access for students', () => {
      assert.match(m11, /CREATE OR REPLACE FUNCTION public\.get_public_landlord_profile/i);
      assert.match(m11, /CREATE OR REPLACE FUNCTION public\.get_public_landlord_summaries/i);
      assert.match(m11, /CREATE OR REPLACE FUNCTION public\.get_public_student_profile/i);
      assert.match(m11, /CREATE OR REPLACE FUNCTION public\.lookup_student_by_registration_number/i);

      // Student profile RPC strictly revokes anon & requires auth.uid() IS NOT NULL
      assert.match(m11, /REVOKE EXECUTE ON FUNCTION public\.get_public_student_profile\(UUID\) FROM PUBLIC, anon/i);
      assert.match(m11, /REVOKE EXECUTE ON FUNCTION public\.lookup_student_by_registration_number\(TEXT\) FROM PUBLIC, anon/i);

      // Neither public RPC returns email, phone, tax_id, or bank account fields
      const landlordRpcSection = m11.slice(
        m11.indexOf('CREATE OR REPLACE FUNCTION public.get_public_landlord_profile'),
        m11.indexOf('CREATE OR REPLACE FUNCTION public.get_public_landlord_summaries')
      );
      assert.doesNotMatch(landlordRpcSection, /'email'|'phone'|tax_id|business_address|landlord_payment_accounts/i);

      const studentRpcSection = m11.slice(
        m11.indexOf('CREATE OR REPLACE FUNCTION public.get_public_student_profile'),
        m11.indexOf('REVOKE EXECUTE ON FUNCTION public.get_public_student_profile')
      );
      assert.doesNotMatch(studentRpcSection, /'email'|'phone'|student_verification_documents/i);

      // Suspended accounts render Account Unavailable with isVerified: false
      assert.match(m11, /'displayName', 'Account Unavailable'/i);
      assert.match(m11, /'isVerified', false/i);
    });

    test('Registers routes and renders clickable links across landlord & student surfaces', () => {
      assert.match(appSrc, /\/profiles\/landlord\/:userId/);
      assert.match(appSrc, /\/profiles\/student\/:userId/);
      assert.match(publicProfileSrc, /Account Unavailable/);

      // Clickable landlord links
      assert.match(propCardSrc, /\/profiles\/landlord\/\$\{property\.landlordId\}/);
      assert.match(propDetailSrc, /\/profiles\/landlord\/\$\{property\.landlordId\}/);
      assert.match(resDetailSrc, /\/profiles\/landlord\/\$\{reservation\.landlordId\}/);
      assert.match(invoiceSrc, /\/profiles\/landlord\/\$\{linkedLandlordId\}/);

      // Clickable student links & student reg number display on own profile
      assert.match(roommatesSrc, /\/profiles\/student\/\$\{st\.userId\}/);
      assert.match(reqsSrc, /\/profiles\/student\/\$\{req\.senderId\}/);
      assert.match(reqsSrc, /\/profiles\/student\/\$\{req\.receiverId\}/);
      assert.match(groupDetailSrc, /\/profiles\/student\/\$\{m\.userId\}/);
      assert.match(userSearchSrc, /\/profiles\/student\/\$\{result\.id\}/);
      assert.match(receiptsSrc, /\/profiles\/student\/\$\{rec\.studentId\}/);
      assert.match(studentDashSrc, /liveRegNumber/);
      assert.match(studentVerifSrc, /liveRegNumber/);
    });

    test('verificationService returns safe fallback profiles for suspended accounts without PII', async () => {
      const suspendedId = 'stu-suspended-test-1';
      repository.createUser({
        id: suspendedId,
        email: 'secret-email@example.com',
        fullName: 'Secret Name',
        role: 'student',
        accountStatus: 'suspended',
        isVerified: true,
        createdAt: new Date().toISOString(),
      });

      const pub = await verificationService.getPublicStudentProfile(suspendedId);
      assert.equal(pub?.unavailable, true);
      assert.equal(pub?.displayName, 'Account Unavailable');
      assert.equal(pub?.isVerified, false);
      assert.equal('email' in (pub || {}), false);
      assert.equal('phone' in (pub || {}), false);
    });
  });

  describe('Requirement 5: Accommodation Availability Removal & 7-Day Expiry Release', () => {
    const propsPageSrc = read('src/pages/public/PropertiesPage.tsx');
    const propMapSrc = read('src/components/map/PropertyMap.tsx');
    const studentMapSrc = read('src/components/map/StudentVerifiedPropertiesMap.tsx');

    test('Default browse/map views hide 0-space reserved properties and allow atomic reservation decrement', () => {
      assert.match(propsPageSrc, /searchParams\.get\('availableOnly'\) !== 'false'/);
      assert.match(propMapSrc, /hideUnavailable && typeof p\.availableSpaces === 'number' && p\.availableSpaces <= 0/);
      assert.match(studentMapSrc, /\.gt\('available_spaces', 0\)/);
      assert.match(studentMapSrc, /p\.availableSpaces > 0/);

      const testPropId = '77777777-7777-4777-8777-777777777777';
      const testUnitId = '88888888-8888-4888-8888-888888888888';
      const createdProp = repository.createProperty({
        id: testPropId,
        locationId: 'loc-dambare',
        landlordId: '33333333-3333-4333-8333-333333333333',
        landlordName: 'Alhaji Sani Bello',
        landlordVerified: true,
        title: 'Danbare Test Hostel',
        slug: 'danbare-test-hostel-1',
        description: 'Approved test listing in Danbare',
        propertyType: 'Self-Contained',
        accommodationType: 'Single Room',
        genderPolicy: 'Mixed',
        address: 'Plot 5 Danbare Road',
        city: 'Kano',
        neighbourhood: 'Dambare',
        campus: 'New Campus',
        university: 'Bayero University Kano',
        distanceKm: 0.4,
        pricePerSession: 180000,
        billingPeriod: 'Academic Session (1 Year)',
        depositAmount: 15000,
        utilitiesIncluded: true,
        amenities: ['Borehole Water'],
        houseRules: ['No smoking'],
        images: [],
        totalCapacity: 1,
        availableSpaces: 1,
        verificationStatus: 'approved',
        rooms: [
          {
            id: testUnitId,
            propertyId: testPropId,
            name: 'Room A1',
            type: 'Self-Contained',
            totalCapacity: 1,
            availableSpaces: 1,
            pricePerSession: 180000,
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const targetProp = repository.getPropertyById(createdProp.id);
      assert.ok(targetProp, 'Seeded test property should exist');

      // Initially visible in availableOnly listings
      assert.equal(
        propertyService.searchProperties({ onlyApproved: true, availabilityOnly: true }).some((p) => p.id === testPropId),
        true
      );

      // Simulate filling all spaces in unit/property
      targetProp.availableSpaces = 0;
      targetProp.rooms[0].availableSpaces = 0;

      const availableOnlyList = propertyService.searchProperties({ onlyApproved: true, availabilityOnly: true });
      assert.equal(
        availableOnlyList.some((p) => p.id === testPropId),
        false,
        'Fully reserved property with 0 available spaces must be excluded from available listings'
      );

      // Restore spaces for downstream tests
      targetProp.availableSpaces = 1;
      targetProp.rooms[0].availableSpaces = 1;
    });

    test('Migration 11 releases overdue 7-day holds atomically inside booking and preserves service_role lock', () => {
      assert.match(m11, /REVOKE EXECUTE ON FUNCTION public\.expire_pending_reservations\(\) FROM authenticated/i);
      assert.match(m11, /GRANT EXECUTE ON FUNCTION public\.expire_pending_reservations\(\) TO service_role/i);
      assert.match(m11, /CREATE OR REPLACE FUNCTION public\.expire_overdue_reservations_safe\(\)/i);
      assert.match(m11, /Lazy server-side release of any overdue 7-day unpaid holds on this unit/i);
      assert.match(m11, /available_spaces = LEAST\(capacity, available_spaces \+ 1\)/i);
    });
  });

  describe('Requirement 6: "Pay Now" Option Beside "Reserve Room (7-Day Hold)"', () => {
    const propDetailSrc = read('src/pages/public/PropertyDetailPage.tsx');
    const resDetailSrc = read('src/pages/student/ReservationDetailPage.tsx');

    test('UI presents both Pay Now and Reserve Room (7-Day Hold) and Edge Function forwards reservationMode', () => {
      assert.match(propDetailSrc, /Pay Now/);
      assert.match(propDetailSrc, /Reserve Room \(7-Day Hold\)/);
      assert.match(propDetailSrc, /openBookingModal\('pay_now'\)/);
      assert.match(propDetailSrc, /openBookingModal\('hold'\)/);
      assert.match(propDetailSrc, /\?mode=pay_now/);

      assert.match(resDetailSrc, /Direct Bank Transfer — Pay Now Mode/);
      assert.match(edgeReserve, /p_reservation_mode:\s*normalizedMode/);
      assert.match(m11, /reservation_mode IN \('hold', 'pay_now'\)/i);
    });

    test('Pay Now creates a pending_payment reservation + unpaid invoice and NEVER auto-confirms payment', () => {
      const targetProp = propertyService.searchProperties({ onlyApproved: true, availabilityOnly: true })[0];
      assert.ok(targetProp, 'Expected an available approved property');
      const targetRoom = targetProp.rooms.find((r) => r.availableSpaces > 0) || targetProp.rooms[0];

      const res = reservationService.createReservation(
        '11111111-1111-4111-8111-111111111111',
        targetProp.id,
        targetRoom.id,
        undefined,
        'pay_now'
      );

      assert.equal(res.success, true);
      assert.equal(res.reservation?.reservationMode, 'pay_now');
      assert.equal(res.reservation?.status, 'pending_payment');
      assert.equal(res.invoice?.status, 'unpaid');
    });
  });

  describe('Requirement 8: Verified User Tick Indicators & Admin Revocation', () => {
    const badgeSrc = read('src/components/ui/Badge.tsx');
    const usersPageSrc = read('src/pages/admin/UsersPage.tsx');

    test('Badge enforces green tick for verified landlords, high-contrast white tick for verified students, null otherwise', () => {
      assert.match(badgeSrc, /if \(!isVerified\) return null;/);
      assert.match(badgeSrc, /type === 'landlord'[\s\S]*bg-emerald-600 text-white/);
      assert.match(badgeSrc, /bg-slate-900 dark:bg-slate-950[\s\S]*text-white/);
      assert.match(badgeSrc, /aria-label=\{label\}/);
      assert.match(badgeSrc, /<span className="sr-only">\{label\}<\/span>/);
    });

    test('Admin can revoke verification via adminService & UsersPage modal, clearing is_verified & logging audit event', async () => {
      assert.match(m11, /CREATE OR REPLACE FUNCTION public\.admin_revoke_user_verification/i);
      assert.match(m11, /'ADMIN_REVOKE_VERIFICATION'/i);
      assert.match(usersPageSrc, /Revoke verification/);
      assert.match(usersPageSrc, /handleRevokeVerification/);

      const rpcCalls = [];
      const mockClient = {
        auth: {
          async getUser() {
            return { data: { user: { id: 'admin-1', email: 'admin@outpost.ng' } }, error: null };
          },
        },
        from(table) {
          const filters = [];
          const q = {
            select() { return q; },
            eq(col, val) { filters.push((r) => r[col] === val); return q; },
            async maybeSingle() {
              if (table === 'profiles' && filters.some((fn) => fn({ id: 'admin-1' }))) {
                return {
                  data: { id: 'admin-1', email: 'admin@outpost.ng', role: 'admin', account_status: 'active' },
                  error: null,
                };
              }
              return { data: null, error: null };
            },
          };
          return q;
        },
        async rpc(fnName, params) {
          rpcCalls.push({ fnName, params });
          return { data: { success: true, user_id: params.p_target_id, revoked: true }, error: null };
        },
      };

      const adminSvc = createAdminService({ client: mockClient });
      await assert.rejects(
        () => adminSvc.revokeUserVerification('stu-1', 'bad'),
        /at least 5 characters/
      );

      const res = await adminSvc.revokeUserVerification('stu-1', 'Credential expired during semester audit');
      assert.equal(res.revoked, true);
      assert.equal(rpcCalls[0]?.fnName, 'admin_revoke_user_verification');
      assert.equal(rpcCalls[0]?.params.p_target_id, 'stu-1');
    });
  });

  describe('Profile Photo Upload Hardening & Storage RLS Review (Migrations 12 & 14)', () => {
    const m12 = read('supabase/migrations/20261114000012_profile_avatar_upload_fix.sql');
    const m14 = read('supabase/migrations/20261114000014_profile_pictures_storage_rls_review.sql');
    const storageSrc = read('src/infrastructure/supabase/supabaseStorageService.ts');
    const repoSrc = read('src/infrastructure/supabase/supabaseRepository.ts');
    const errorUtilsSrc = read('src/application/utils/errorUtils.ts');

    test('Migration 12 & 14 define update_own_profile_avatar RPC and storage avoids upsert=true UPDATE policy dependency', () => {
      assert.match(m12, /CREATE OR REPLACE FUNCTION public\.update_own_profile_avatar/i);
      assert.match(m12, /REVOKE EXECUTE ON FUNCTION public\.update_own_profile_avatar\(TEXT\) FROM PUBLIC, anon/i);
      assert.match(m12, /GRANT EXECUTE ON FUNCTION public\.update_own_profile_avatar\(TEXT\) TO authenticated/i);
      assert.match(m14, /CREATE OR REPLACE FUNCTION public\.update_own_profile_avatar/i);
      assert.match(storageSrc, /from\('profile-pictures'\)[\s\S]*upsert:\s*false/);
      assert.match(storageSrc, /assertValidOwnerId\(userId,\s*'user'\)\.toLowerCase\(\)/);
      assert.match(repoSrc, /rpc\('update_own_profile_avatar'/);
      assert.match(repoSrc, /rpcError\.code === '42883'/);
      assert.match(repoSrc, /error\.code === '42703'/);
    });

    test('Migration 14 enforces public-read and owner-scoped authenticated-write Storage RLS policies for profile-pictures', () => {
      assert.match(m14, /INSERT INTO storage\.buckets[\s\S]*'profile-pictures'[\s\S]*true[\s\S]*2097152/i);
      assert.match(
        m14,
        /CREATE POLICY "Profile pictures public read"\s+ON storage\.objects FOR SELECT\s+TO public\s+USING \(bucket_id = 'profile-pictures'\)/i
      );
      assert.match(
        m14,
        /CREATE POLICY "Users upload own profile picture"\s+ON storage\.objects FOR INSERT\s+TO authenticated\s+WITH CHECK \(\s*bucket_id = 'profile-pictures'\s+AND auth\.uid\(\) IS NOT NULL\s+AND lower\(\(storage\.foldername\(name\)\)\[1\]\) = lower\(auth\.uid\(\)::text\)/i
      );
      assert.match(
        m14,
        /CREATE POLICY "Users update own profile picture"\s+ON storage\.objects FOR UPDATE\s+TO authenticated\s+USING[\s\S]*lower\(\(storage\.foldername\(name\)\)\[1\]\) = lower\(auth\.uid\(\)::text\)[\s\S]*WITH CHECK[\s\S]*lower\(\(storage\.foldername\(name\)\)\[1\]\) = lower\(auth\.uid\(\)::text\)/i
      );
      assert.match(
        m14,
        /CREATE POLICY "Users delete own profile picture"\s+ON storage\.objects FOR DELETE\s+TO authenticated\s+USING \(\s*bucket_id = 'profile-pictures'\s+AND auth\.uid\(\) IS NOT NULL\s+AND lower\(\(storage\.foldername\(name\)\)\[1\]\) = lower\(auth\.uid\(\)::text\)/i
      );
    });

    test('errorUtils classifies Storage bucket, RLS denial, and file validation errors cleanly', () => {
      assert.match(errorUtilsSrc, /ERR_STORAGE_BUCKET_MISSING/);
      assert.match(errorUtilsSrc, /row-level security/);
      assert.match(errorUtilsSrc, /ERR_STORAGE_VALIDATION/);
    });
  });

  describe('Migration 14: Student Reservation Deletion, Preset Avatars & broadcast_messages Persistence', () => {
    const m14 = read('supabase/migrations/20261114000014_broadcast_messages_presets_and_delete_fixes.sql');
    const avatarSrc = read('src/components/common/Avatar.tsx');
    const uploaderSrc = read('src/components/common/ProfileAvatarUploader.tsx');
    const presetsSrc = read('src/assets/avatars/index.ts');
    const appShellSrc = read('src/components/layout/AppShell.tsx');
    const broadcastPageSrc = read('src/pages/admin/AdminBroadcastsPage.tsx');

    test('Migration 14 defines broadcast_messages table, RLS, delete_student_reservation_atomic, and preset avatar RPC', () => {
      assert.match(m14, /CREATE TABLE IF NOT EXISTS public\.broadcast_messages/i);
      assert.match(m14, /target_audience IN \('all_users', 'all_landlords', 'all_students', 'specific_users', 'individual'\)/i);
      assert.match(m14, /target_user_ids UUID\[\]/i);
      assert.match(m14, /ALTER TABLE public\.broadcast_messages ENABLE ROW LEVEL SECURITY/i);
      assert.match(m14, /CREATE OR REPLACE FUNCTION public\.admin_send_broadcast/i);
      assert.match(m14, /INSERT INTO public\.broadcast_messages/i);

      assert.match(m14, /CREATE POLICY "Students or admins delete non-confirmed reservations"/i);
      assert.match(m14, /CREATE OR REPLACE FUNCTION public\.delete_student_reservation_atomic/i);

      assert.match(m14, /ADD COLUMN IF NOT EXISTS avatar_preset_id TEXT/i);
      assert.match(m14, /CREATE OR REPLACE FUNCTION public\.update_own_profile_avatar\(\s*p_avatar_url TEXT DEFAULT NULL,\s*p_avatar_preset_id TEXT DEFAULT NULL/i);
      assert.match(m14, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.notifications/i);
    });

    test('Preset profile avatars are wired into ProfileAvatarUploader, Avatar, and AppShell', () => {
      assert.match(presetsSrc, /export const AVATAR_PRESETS/);
      assert.match(presetsSrc, /id:\s*'owl'/);
      assert.match(presetsSrc, /id:\s*'gradcap'/);
      assert.match(uploaderSrc, /AVATAR_PRESETS\.map/);
      assert.match(uploaderSrc, /updateUserAvatarPresetPersisted/);
      assert.match(avatarSrc, /startsWith\('preset:'\)/);
      assert.match(appShellSrc, /<Avatar/);

      const supaRepoSrc = read('src/infrastructure/supabase/supabaseRepository.ts');
      assert.match(supaRepoSrc, /delete_student_reservation_atomic/);
      assert.match(supaRepoSrc, /\[DELETED_BY_STUDENT\]/);
      assert.match(supaRepoSrc, /softDeletedActiveHold/);
    });

    test('reservationService.deleteReservation releases occupied hold spaces and removes reservation', () => {
      const delPropId = '99999999-9999-4999-8999-999999999991';
      const delUnitId = '99999999-9999-4999-8999-999999999992';
      repository.createProperty({
        id: delPropId,
        locationId: 'loc-dambare',
        landlordId: '33333333-3333-4333-8333-333333333333',
        landlordName: 'Alhaji Sani Bello',
        landlordVerified: true,
        title: 'Reservation Delete Test Hostel',
        slug: 'reservation-delete-test-hostel',
        description: 'Hostel for reservation delete test',
        propertyType: 'Self-Contained',
        accommodationType: 'Single Room',
        genderPolicy: 'Mixed',
        address: 'Plot 8 Danbare Road',
        city: 'Kano',
        neighbourhood: 'Dambare',
        campus: 'New Campus',
        university: 'Bayero University Kano',
        distanceKm: 0.5,
        pricePerSession: 150000,
        billingPeriod: 'Academic Session (1 Year)',
        depositAmount: 10000,
        utilitiesIncluded: true,
        amenities: ['Water'],
        houseRules: [],
        images: [],
        totalCapacity: 1,
        availableSpaces: 1,
        verificationStatus: 'approved',
        rooms: [
          {
            id: delUnitId,
            propertyId: delPropId,
            name: 'Room D1',
            type: 'Self-Contained',
            totalCapacity: 1,
            availableSpaces: 1,
            pricePerSession: 150000,
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const targetProp = repository.getPropertyById(delPropId);
      assert.ok(targetProp, 'Expected seeded property');
      const targetRoom = targetProp.rooms[0];

      const created = reservationService.createReservation(
        'stu-delete-test-1',
        targetProp.id,
        targetRoom.id,
        undefined,
        'hold'
      );
      assert.equal(created.success, true, created.message || 'Expected reservation creation to succeed');
      assert.ok(created.reservation?.id);
      assert.equal(targetRoom.availableSpaces, 0);

      const deleted = reservationService.deleteReservation(created.reservation.id);
      assert.equal(deleted.success, true);
      assert.equal(targetRoom.availableSpaces, 1);
      assert.equal(repository.getReservationById(created.reservation.id), undefined);
    });

    test('adminService.sendBroadcast saves to broadcast_messages and getBroadcastHistory hydrates audience & recipients', async () => {
      assert.match(broadcastPageSrc, /Sent Broadcast History/);
      assert.match(broadcastPageSrc, /Audience: \{formatAudienceBadge/);

      const broadcastMessagesTable = [];
      const notificationsTable = [];
      const auditLogsTable = [];
      const profilesData = [
        { id: 'admin-1', email: 'admin@outpost.ng', full_name: 'Campus Admin', role: 'admin', account_status: 'active' },
        { id: 'stu-1', email: 'aminu@buk.edu.ng', full_name: 'Aminu Kano', role: 'student', account_status: 'active' },
        { id: 'll-1', email: 'sani@outpost.ng', full_name: 'Alhaji Sani', role: 'landlord', account_status: 'active' },
      ];

      const makeMockClient = ({ rpcMissing }) => ({
        auth: {
          async getUser() {
            return { data: { user: { id: 'admin-1', email: 'admin@outpost.ng' } }, error: null };
          },
        },
        from(table) {
          const filters = [];
          const inFilters = [];
          const q = {
            select() { return q; },
            eq(col, val) { filters.push((r) => r[col] === val); return q; },
            in(col, vals) { inFilters.push((r) => Array.isArray(vals) && vals.includes(r[col])); return q; },
            order() { return q; },
            limit() { return q; },
            async maybeSingle() {
              const rows = table === 'profiles' ? profilesData : [];
              const found = rows.find((r) => filters.every((fn) => fn(r)));
              return { data: found || null, error: null };
            },
            async insert(payload) {
              const arr = Array.isArray(payload) ? payload : [payload];
              if (table === 'broadcast_messages') broadcastMessagesTable.push(...arr);
              if (table === 'notifications') notificationsTable.push(...arr);
              if (table === 'audit_logs') auditLogsTable.push(...arr);
              return { data: arr, error: null };
            },
            then(resolve, reject) {
              let source = [];
              if (table === 'profiles') source = profilesData;
              if (table === 'broadcast_messages') source = broadcastMessagesTable;
              const filtered = source.filter(
                (r) => filters.every((fn) => fn(r)) && inFilters.every((fn) => fn(r))
              );
              return Promise.resolve({ data: filtered, error: null }).then(resolve, reject);
            },
          };
          return q;
        },
        async rpc(fnName, params) {
          if (rpcMissing) {
            return {
              data: null,
              error: { code: 'PGRST202', message: `Could not find the function public.${fnName} in the schema cache` },
            };
          }
          const created = new Date().toISOString();
          broadcastMessagesTable.unshift({
            id: 'bc-rpc-1',
            sender_id: 'admin-1',
            target_audience: params.p_target_audience,
            target_user_id: params.p_target_user_id,
            target_user_ids: params.p_target_user_ids || [],
            title: params.p_title,
            message: params.p_message,
            recipient_count: 1,
            created_at: created,
          });
          return {
            data: {
              success: true,
              broadcast_id: 'bc-rpc-1',
              target_audience: params.p_target_audience,
              recipient_count: 1,
              created_at: created,
            },
            error: null,
          };
        },
      });

      // Fallback persistence path when RPC is missing
      const fallbackAdmin = createAdminService({ client: makeMockClient({ rpcMissing: true }) });
      const resSpecific = await fallbackAdmin.sendBroadcast({
        targetAudience: 'specific_users',
        title: 'Inspect Room Notice',
        message: 'Please review your verification upload before Friday.',
        targetUserIds: ['stu-1', 'll-1'],
      });

      assert.equal(resSpecific.success, true);
      assert.equal(resSpecific.recipientCount, 2);
      assert.equal(notificationsTable.length, 2);
      assert.equal(broadcastMessagesTable.length, 1);
      assert.equal(broadcastMessagesTable[0].target_audience, 'specific_users');
      assert.deepEqual(broadcastMessagesTable[0].target_user_ids, ['stu-1', 'll-1']);
      assert.equal(auditLogsTable[0].action, 'ADMIN_SEND_BROADCAST');

      // RPC path
      const rpcAdmin = createAdminService({ client: makeMockClient({ rpcMissing: false }) });
      const resAllLandlords = await rpcAdmin.sendBroadcast({
        targetAudience: 'all_landlords',
        title: 'Landlord Compliance Update',
        message: 'Confirm payout bank details are accurate.',
      });
      assert.equal(resAllLandlords.success, true);
      assert.equal(resAllLandlords.broadcastId, 'bc-rpc-1');

      // History retrieval & recipient name hydration
      const history = await fallbackAdmin.getBroadcastHistory();
      assert.equal(history.length, 2);
      const specificRow = history.find((h) => h.targetAudience === 'specific_users');
      assert.ok(specificRow);
      assert.equal(specificRow.senderName, 'Campus Admin');
      assert.deepEqual(specificRow.targetUserNames, ['Aminu Kano', 'Alhaji Sani']);
    });

    test('Email confirmation UX handles token_hash links, inline 6-digit OTP verify, and accurate resend errors', async () => {
      const authSvcSrc = read('src/application/services/authService.ts');
      const loginPageSrc = read('src/pages/public/LoginPage.tsx');
      const registerPageSrc = read('src/pages/public/RegisterPage.tsx');

      assert.match(authSvcSrc, /public async verifySignupOtp\(/);
      assert.match(authSvcSrc, /verifyOtp\(\{\s*email:\s*cleanEmail,\s*token:\s*cleanToken,\s*type:\s*'signup'/);
      assert.match(authSvcSrc, /Disable "Confirm email" or configure SMTP in Supabase Dashboard/);
      assert.match(authSvcSrc, /Confirmation email rate limit reached on Supabase/);

      assert.match(loginPageSrc, /token_hash/);
      assert.match(loginPageSrc, /verifySignupOtp\(email,\s*otpCode\)/);
      assert.match(loginPageSrc, /useState<\{\s*ok:\s*boolean;\s*text:\s*string\s*\}\s*\|\s*null>/);
      assert.match(loginPageSrc, /role=\{resendStatus\.ok \? 'status' : 'alert'\}/);
      assert.match(registerPageSrc, /useState<\{\s*ok:\s*boolean;\s*text:\s*string\s*\}\s*\|\s*null>/);

      const emptyOtpRes = await authService.verifySignupOtp('student@buk.edu.ng', '   ');
      assert.equal(emptyOtpRes.success, false);
      assert.match(emptyOtpRes.error || '', /required/i);
    });

    test('Maps & Pin Placement Modal work without VITE_MAPTILER_API_KEY via OpenFreeMap/OSM + Nominatim fallback', async () => {
      const mapCfg = await import('../src/infrastructure/config/mapConfig.ts');
      const geoSvc = await import('../src/application/services/geocodingService.ts');
      const modalSrc = read('src/components/map/LandlordPinPlacementMapModal.tsx');
      const pickerSrc = read('src/components/map/LandlordPinPicker.tsx');
      const studentMapSrc = read('src/components/map/StudentVerifiedPropertiesMap.tsx');

      assert.ok(mapCfg.getEffectiveMapStyle(), 'Default map style must never be undefined');
      assert.equal(typeof mapCfg.getEffectiveMapStyle(false), 'string');
      assert.equal(typeof mapCfg.getEffectiveMapStyle(true), 'object');
      assert.ok(mapCfg.getEffectiveAttribution(false).includes('OpenStreetMap'));

      assert.doesNotMatch(modalSrc, /Map configuration is incomplete/);
      assert.doesNotMatch(modalSrc, /Enter MapTiler API Key/);
      assert.doesNotMatch(pickerSrc, /Map configuration is incomplete/);
      assert.doesNotMatch(studentMapSrc, /Map configuration is incomplete/);

      const geoSrc = read('src/application/services/geocodingService.ts');
      assert.doesNotMatch(geoSrc, /Map configuration is incomplete/);
      assert.match(geoSrc, /nominatim\.openstreetmap\.org/);
      assert.equal(
        geoSvc.resultMentionsArea(
          {
            id: 'test-1',
            placeName: 'Danbare, Kumbotso, Kano, Nigeria',
            center: [8.4187, 11.9842],
            longitude: 8.4187,
            latitude: 11.9842,
          },
          'Dambare',
        ),
        true,
      );
    });

    test('Removed Search Address button, Device Camera Direct button, and all case-study copy from UI', () => {
      const newPropSrc = read('src/pages/landlord/NewPropertyPage.tsx');
      const uploadSrc = read('src/components/property/PropertyImageCaptureUpload.tsx');
      const invoiceSrc = read('src/pages/student/InvoicePage.tsx');
      const locationsSrc = read('src/domain/locations.ts');
      const studentMapSrc = read('src/components/map/StudentVerifiedPropertiesMap.tsx');

      assert.doesNotMatch(newPropSrc, /Search Address/);
      assert.doesNotMatch(uploadSrc, /Device Camera Direct|Trigger phone camera shutter/);

      for (const content of [newPropSrc, uploadSrc, invoiceSrc, locationsSrc, studentMapSrc]) {
        assert.doesNotMatch(content, /case[- _]?study/i);
      }
    });

    test('Map pinpoint automatically reverse-geocodes and auto-fills property address fields', async () => {
      const geoSvc = await import('../src/application/services/geocodingService.ts');
      const geoUtils = await import('../src/domain/geoUtils.ts');

      // Test structured reverse geocoding using local Kano landmark fallback when network fetch fails
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        throw new Error('Offline in unit test');
      };

      try {
        const danbareHub = geoUtils.LOCAL_REFERENCE_LANDMARKS.find((l) => l.id === 'danbare-market');
        assert.ok(danbareHub, 'Danbare reference landmark must exist');
        const resolved = await geoSvc.reverseGeocodeDetailed(danbareHub.latitude, danbareHub.longitude);
        assert.ok(resolved, 'reverseGeocodeDetailed must resolve fallback address');
        assert.match(resolved.formattedAddress, /Danbare Market.*Kano State/i);
        assert.equal(resolved.nearestLandmark, danbareHub.fullName);
        assert.equal(resolved.city, 'Kano');
        assert.equal(resolved.detectedArea, 'Dambare');
      } finally {
        globalThis.fetch = originalFetch;
      }

      const pickerSrc = read('src/components/map/LandlordPinPicker.tsx');
      const modalSrc = read('src/components/map/LandlordPinPlacementMapModal.tsx');
      const newPropSrc = read('src/pages/landlord/NewPropertyPage.tsx');

      assert.match(pickerSrc, /reverseGeocodeDetailed/);
      assert.match(pickerSrc, /formattedAddress:\s*details\.formattedAddress/);
      assert.match(modalSrc, /reverseGeocodeDetailed/);
      assert.match(modalSrc, /streetOrRoad:\s*details\.streetOrRoad/);
      assert.match(newPropSrc, /applyAutoFilledAddressFromPin/);
      assert.match(newPropSrc, /Auto-filled from map pin/);
      assert.doesNotMatch(newPropSrc, /if\s*\(newLoc\.formattedAddress\s*&&\s*!address\)/);
    });
  });

  describe('UI Cleanup, MapLibre Clustering, Tenant Inquiries Removal & Sound Tones', () => {
    test('Both PropertyMap and StudentVerifiedPropertiesMap configure native MapLibre GeoJSON clustering', () => {
      const propMapSrc = read('src/components/map/PropertyMap.tsx');
      const studentMapSrc = read('src/components/map/StudentVerifiedPropertiesMap.tsx');

      for (const src of [propMapSrc, studentMapSrc]) {
        assert.match(src, /cluster:\s*true/);
        assert.match(src, /clusterMaxZoom:\s*16/);
        assert.match(src, /id:\s*'clusters'/);
        assert.match(src, /id:\s*'cluster-count'/);
        assert.match(src, /point_count_abbreviated/);
        assert.match(src, /getClusterExpansionZoom/);
      }
    });

    test('Admin UI pages format statuses cleanly and omit raw internal technical strings', () => {
      const approvalsSrc = read('src/pages/admin/PropertyApprovalsPage.tsx');
      const disputesSrc = read('src/pages/admin/DisputesPage.tsx');
      const auditSrc = read('src/pages/admin/AdminAuditLogsPage.tsx');
      const broadcastSrc = read('src/pages/admin/AdminBroadcastsPage.tsx');

      assert.match(approvalsSrc, /formatLocationStatus/);
      assert.match(approvalsSrc, /'Not Submitted'/);
      assert.doesNotMatch(approvalsSrc, /privileged PostgreSQL RPCs/);

      assert.match(disputesSrc, /ReceiptStatusBadge/);
      assert.doesNotMatch(disputesSrc, /get-private-asset-url/);
      assert.doesNotMatch(disputesSrc, /cannot mutate amounts/);

      assert.doesNotMatch(auditSrc, /<th[^>]*>Details<\/th>/i);
      assert.doesNotMatch(auditSrc, /\{log\.details/);

      assert.match(broadcastSrc, /User Directory Box/);
      assert.match(broadcastSrc, /aria-label="Broadcast recipient users list"/);
    });

    test('Tenant Inquiries is removed from Landlord navigation and chat search excludes landlords', () => {
      const appShellSrc = read('src/components/layout/AppShell.tsx');
      const repoSrc = read('src/infrastructure/supabase/supabaseRepository.ts');

      assert.doesNotMatch(appShellSrc, /Tenant Inquiries/);
      assert.doesNotMatch(appShellSrc, /\/landlord\/chat/);
      assert.match(repoSrc, /\.neq\('role',\s*'landlord'\)/);
    });

    test('Sound service, Realtime channels, and AppShell enable notification and landlord payment/reservation reminder tones', async () => {
      const soundMod = await import('../src/application/services/soundService.ts');
      const appShellSrc = read('src/components/layout/AppShell.tsx');
      const repoSrc = read('src/infrastructure/supabase/supabaseRepository.ts');
      const m18 = read('supabase/migrations/20261115000018_enable_realtime_reservations_and_receipts.sql');

      assert.equal(
        soundMod.soundService.isPaymentOrReservationNotification({
          title: 'New Bank Transfer Receipt Uploaded',
          message: 'Student submitted payment receipt for review.',
          type: 'payment',
        }),
        true,
      );
      assert.equal(
        soundMod.soundService.isPaymentOrReservationNotification({
          title: 'New Room Reservation Placed',
          message: 'A student placed a 7-day hold.',
          type: 'reservation',
        }),
        true,
      );
      assert.equal(
        soundMod.soundService.isPaymentOrReservationNotification({
          title: 'Welcome Notice',
          message: 'Platform announcement',
          type: 'broadcast',
        }),
        false,
      );

      assert.match(repoSrc, /subscribeToLandlordActivityRealtime/);
      assert.match(repoSrc, /notificationIncoming:/);
      assert.match(repoSrc, /landlordReminderAlert:/);
      assert.match(appShellSrc, /playNotificationTone/);
      assert.match(appShellSrc, /playLandlordReminderTone/);
      assert.match(m18, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.reservations/i);
      assert.match(m18, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.payment_receipts/i);
    });
  });
});
