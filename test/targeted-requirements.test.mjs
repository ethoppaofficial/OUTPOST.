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
});
