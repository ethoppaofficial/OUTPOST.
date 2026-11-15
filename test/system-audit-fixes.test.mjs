import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { repository } from '../src/infrastructure/repositories/index.ts';
import { propertyService } from '../src/application/services/propertyService.ts';
import { roommateService } from '../src/application/services/roommateService.ts';
import { groupChatService } from '../src/application/services/groupChatService.ts';
import { chatService } from '../src/application/services/chatService.ts';
import { authService } from '../src/application/services/authService.ts';
import { supabase } from '../src/infrastructure/supabase/supabaseClient.ts';

const read = (relPath) => fs.readFileSync(path.resolve(relPath), 'utf8');

describe('OUTPOST: System Audit & Breakdown Fixes (Migration 15)', () => {
  const m15 = read('supabase/migrations/20261115000015_system_audit_fixes.sql');
  const reqReceiptEdge = read('supabase/functions/request-receipt-upload/index.ts');
  const finReceiptEdge = read('supabase/functions/finalize-receipt-upload/index.ts');
  const supabaseClientSrc = read('src/infrastructure/supabase/supabaseClient.ts');
  const storageSvcSrc = read('src/infrastructure/supabase/supabaseStorageService.ts');
  const repoSrc = read('src/infrastructure/supabase/supabaseRepository.ts');
  const authCtxSrc = read('src/application/context/AuthContext.tsx');
  const authSvcSrc = read('src/application/services/authService.ts');
  const appSrc = read('src/App.tsx');
  const loginPageSrc = read('src/pages/public/LoginPage.tsx');
  const registerPageSrc = read('src/pages/public/RegisterPage.tsx');
  const resSvcSrc = read('src/application/services/reservationService.ts');
  const manageAvailSrc = read('src/pages/landlord/ManageAvailabilityPage.tsx');
  const propDetailSrc = read('src/pages/public/PropertyDetailPage.tsx');
  const auditLogsSrc = read('src/pages/admin/AdminAuditLogsPage.tsx');
  const roommatesSrc = read('src/pages/student/RoommatesPage.tsx');
  const roommateReqsSrc = read('src/pages/student/RoommateRequestsPage.tsx');
  const groupsSrc = read('src/pages/student/GroupsPage.tsx');
  const groupDetailSrc = read('src/pages/student/GroupDetailPage.tsx');

  describe('1. Migration 15 Schema & Atomic RPC Fixes', () => {
    test('Defines submit_payment_receipt_atomic RPC with ownership, status guard, and SECURITY DEFINER lock', () => {
      assert.match(m15, /CREATE OR REPLACE FUNCTION public\.submit_payment_receipt_atomic/i);
      assert.match(m15, /SECURITY DEFINER/i);
      assert.match(m15, /v_res\.status NOT IN \('pending_payment', 'payment_submitted'\)/i);
      assert.match(m15, /INSERT INTO public\.payment_receipts/i);
      assert.match(m15, /status = 'payment_submitted'/i);
      assert.match(m15, /status = 'processing'/i);
      assert.match(m15, /REVOKE EXECUTE ON FUNCTION public\.submit_payment_receipt_atomic[\s\S]*FROM PUBLIC, anon/i);
      assert.match(m15, /GRANT EXECUTE ON FUNCTION public\.submit_payment_receipt_atomic[\s\S]*TO authenticated/i);
    });

    test('Defines update_unit_availability_atomic RPC for approved properties without bypassing RLS security', () => {
      assert.match(m15, /CREATE OR REPLACE FUNCTION public\.update_unit_availability_atomic/i);
      assert.match(m15, /SECURITY DEFINER/i);
      assert.match(m15, /v_prop\.landlord_id != v_uid AND NOT public\.is_admin\(\)/i);
      assert.match(m15, /UPDATE public\.units/i);
      assert.match(m15, /UPDATE public\.properties/i);
      assert.match(m15, /'UPDATE_UNIT_AVAILABILITY'/i);
      assert.match(m15, /REVOKE EXECUTE ON FUNCTION public\.update_unit_availability_atomic[\s\S]*FROM PUBLIC, anon/i);
    });

    test('Adds accommodation_groups.visibility and property_reports table with FORCE RLS', () => {
      assert.match(m15, /ALTER TABLE public\.accommodation_groups[\s\S]*ADD COLUMN IF NOT EXISTS visibility TEXT/i);
      assert.match(m15, /visibility IN \('discoverable', 'invite_only', 'request_required'\)/i);
      assert.match(m15, /CREATE TABLE IF NOT EXISTS public\.property_reports/i);
      assert.match(m15, /ALTER TABLE public\.property_reports ENABLE ROW LEVEL SECURITY/i);
      assert.match(m15, /ALTER TABLE public\.property_reports FORCE ROW LEVEL SECURITY/i);
      assert.match(m15, /CREATE POLICY "Authenticated users create own property reports"/i);
      assert.match(m15, /CREATE POLICY "Reporters or admins read property reports"/i);
      assert.match(m15, /CREATE POLICY "Admins update property reports"/i);
      assert.match(m15, /NOTIFY pgrst, 'reload schema'/i);
    });
  });

  describe('2. Edge Function Status Guards & Error Body Propagation', () => {
    test('request-receipt-upload and finalize-receipt-upload block finalized/cancelled/expired reservations', () => {
      assert.match(
        reqReceiptEdge,
        /reservation\.status !== 'pending_payment' && reservation\.status !== 'payment_submitted'/
      );
      assert.match(
        finReceiptEdge,
        /reservation\.status !== 'pending_payment' && reservation\.status !== 'payment_submitted'/
      );
    });

    test('invokeEdgeFunction reads FunctionsHttpError response body text/JSON instead of swallowing error details', () => {
      assert.match(supabaseClientSrc, /ctx\.clone\(\)\.text\(\)/);
      assert.match(supabaseClientSrc, /typeof parsed\?\.error === 'string'/);
    });
  });

  describe('3. Storage Fallbacks, Session Hydration & AuthContext Guardrails', () => {
    test('supabaseStorageService uses atomic receipt RPC fallback and adds chat attachment Edge fallback with orphan cleanup', () => {
      assert.match(storageSvcSrc, /rpc\('submit_payment_receipt_atomic'/);
      assert.match(storageSvcSrc, /isEdgeFunctionUnavailableError\(sessionError\)/);
      assert.match(storageSvcSrc, /from\('conversation_participants'\)/);
      assert.match(storageSvcSrc, /from\('chat-attachments'\)\s*\.upload/);
      assert.match(storageSvcSrc, /deletePrivateAsset\('chat-attachments',\s*storagePath\)/);
      assert.match(storageSvcSrc, /from\('messages'\)\s*\.insert/);
    });

    test('AuthContext caches hydrated profile without writing to public.profiles on login/refresh', () => {
      assert.match(authCtxSrc, /\(repository as any\)\.cacheUser\(resolvedUser\)/);
      assert.doesNotMatch(authCtxSrc, /repository\.createUser\(resolvedUser\);\s*\n\s*repository\.setActiveUserId/);
    });

    test('Repository tracks hydratedUserId so reload hydration runs even if init() set activeUserId early', () => {
      assert.match(repoSrc, /private hydratedUserId: string = '';/);
      assert.match(repoSrc, /this\.hydratedUserId !== userId/);
      assert.match(repoSrc, /this\.hydratedUserId = '';/);
    });

    test('saveStudentProfile avoids overwriting immutable is_profile_verified column for non-admins', () => {
      const saveStudentIdx = repoSrc.indexOf('public saveStudentProfile(');
      const saveStudentEnd = repoSrc.indexOf('public getLandlordProfiles(');
      const saveStudentSection = repoSrc.slice(saveStudentIdx, saveStudentEnd);
      assert.match(
        saveStudentSection,
        /if \(this\.getUserById\(this\.activeUserId\)\?\.role === 'admin' && profile\.isProfileVerified !== undefined\)/
      );
    });

    test('cancelReservationPersisted uses cancellation_reason column instead of non-existent notes column', () => {
      const cancelIdx = repoSrc.indexOf('public async cancelReservationPersisted(');
      const cancelEnd = repoSrc.indexOf('public cancelReservation(');
      const cancelSection = repoSrc.slice(cancelIdx, cancelEnd);
      assert.match(cancelSection, /cancellation_reason:\s*reason\?\.trim\(\)\s*\|\|\s*null/);
      assert.doesNotMatch(cancelSection, /notes:\s*reason/);
    });

    test('reviewPaymentReceipt sync fallback uses rejected status and does not double-invoke Edge Function in service', () => {
      const reviewIdx = repoSrc.indexOf('public reviewPaymentReceipt(');
      const reviewEnd = repoSrc.indexOf('public checkAndExpireReservations(');
      const reviewSection = repoSrc.slice(reviewIdx, reviewEnd);
      assert.match(reviewSection, /res\.status = 'rejected'/);
      assert.doesNotMatch(resSvcSrc, /invokeEdgeFunction\('review-payment-receipt'/);
    });
  });

  describe('4. UI Wiring: Availability, Safety Reports, Audit Logs & Event Subscriptions', () => {
    test('ManageAvailabilityPage uses async updateUnitAvailabilityPersisted and displays error feedback', () => {
      assert.match(manageAvailSrc, /updateUnitAvailabilityPersisted/);
      assert.match(manageAvailSrc, /updatingRoomId/);
      assert.match(manageAvailSrc, /errorMsg/);
    });

    test('PropertyDetailPage submits safety reports via propertyService.submitPropertyReport instead of setTimeout simulation', () => {
      assert.match(propDetailSrc, /propertyService\.submitPropertyReport/);
      assert.match(propDetailSrc, /reportSubmitting/);
      assert.match(propDetailSrc, /reportError/);
    });

    test('AdminAuditLogsPage table header columns match the 5 rendered td cells', () => {
      assert.match(auditLogsSrc, /<th className="p-3">Details<\/th>/);
    });

    test('Roommate & Group pages subscribe to appEventBus hydration events', () => {
      assert.match(roommatesSrc, /appEventBus\.subscribe\('roommatesUpdated'/);
      assert.match(roommateReqsSrc, /appEventBus\.subscribe\('roommatesUpdated'/);
      assert.match(groupsSrc, /appEventBus\.subscribe\('groupsUpdated'/);
      assert.match(groupDetailSrc, /appEventBus\.subscribe\('groupsUpdated'/);
    });
  });

  describe('5. Dynamic Runtime Invariants', () => {
    test('Roommate preferences & group cohort creation/chat sync execute cleanly in repository', () => {
      const studentId = '11111111-1111-4111-8111-111111111111';
      const peerId = '22222222-2222-4222-8222-222222222222';

      repository.cacheUser({
        id: studentId,
        email: 's1@buk.edu.ng',
        fullName: 'Amina Musa',
        role: 'student',
        accountStatus: 'active',
        createdAt: new Date().toISOString(),
      });
      repository.cacheUser({
        id: peerId,
        email: 's2@buk.edu.ng',
        fullName: 'Zainab Bello',
        role: 'student',
        accountStatus: 'active',
        createdAt: new Date().toISOString(),
      });
      repository.setActiveUserId(studentId);

      const savedPref = roommateService.savePreferences({
        studentId,
        budgetMin: 120000,
        budgetMax: 220000,
        cleanlinessLevel: 'Very Neat',
        sleepSchedule: 'Early Bird',
        studyHabit: 'Quiet Focus',
        smokingTolerance: 'No Smoking',
        guestPolicy: 'Occasional Guests',
        preferredGender: 'Female',
        religion: 'Islam',
        bio: 'Computer Science level 300',
      });
      assert.equal(savedPref.sleepSchedule, 'Early Bird');
      assert.equal(roommateService.getPreferences(studentId)?.cleanlinessLevel, 'Very Neat');

      const group = groupChatService.createGroup(
        'Danbare CS Squad',
        'Looking for 2-bed flat near Gate 2',
        studentId,
        4,
        undefined,
        'request_required'
      );
      assert.ok(group.id);
      assert.equal(group.visibility, 'request_required');

      const conv = chatService.getUserConversations(studentId).find((c) => c.groupId === group.id);
      assert.ok(conv, 'Creating a group must initialize its linked group conversation');
      assert.equal(conv.title, 'Danbare CS Squad (Cohort)');

      const renamed = groupChatService.renameGroup(group.id, studentId, 'Danbare Scholars');
      assert.equal(renamed.success, true);
      const updatedConv = chatService.getConversationById(conv.id);
      assert.equal(updatedConv?.title, 'Danbare Scholars (Cohort)');
    });

    test('propertyService.submitPropertyReport validates details cleanly', async () => {
      const propId = '99999999-9999-4999-8999-999999999999';
      repository.createProperty({
        id: propId,
        locationId: 'loc-dambare',
        landlordId: '33333333-3333-4333-8333-333333333333',
        landlordName: 'Danbare Host',
        landlordVerified: true,
        title: 'Audit Test Lodge',
        slug: 'audit-test-lodge',
        description: 'Test property for report validation',
        propertyType: 'Self-Contained',
        accommodationType: 'Single Room',
        genderPolicy: 'Mixed',
        address: 'Plot 1 Danbare',
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
        houseRules: ['No smoking'],
        images: [],
        totalCapacity: 2,
        availableSpaces: 2,
        verificationStatus: 'approved',
        rooms: [
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            propertyId: propId,
            name: 'Room 1',
            type: 'Self-Contained',
            totalCapacity: 2,
            availableSpaces: 2,
            pricePerSession: 150000,
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const badReport = await propertyService.submitPropertyReport({
        propertyId: propId,
        reporterId: '11111111-1111-4111-8111-111111111111',
        reason: 'Other',
        details: 'ab',
      });
      assert.equal(badReport.success, false);
      assert.match(badReport.error || '', /at least 5 characters/i);
    });
  });

  describe('6. Signup Email Confirmation -> Login Redirect Flow', () => {
    test('Student and landlord signUp + resendVerificationEmail pass /login?confirmed=1 as emailRedirectTo', async () => {
      const origWindow = globalThis.window;
      const origSignUp = supabase.auth.signUp;
      const origResend = supabase.auth.resend;
      const origRpc = supabase.rpc;
      const capturedSignUps = [];
      const capturedResends = [];

      globalThis.window = { location: { origin: 'https://outpost.buk.test' } };
      supabase.rpc = async () => ({ data: true, error: null });
      supabase.auth.signUp = async (payload) => {
        capturedSignUps.push(payload);
        return {
          data: {
            user: {
              id: `user-${capturedSignUps.length}`,
              email: payload.email,
              email_confirmed_at: null,
            },
            session: null,
          },
          error: null,
        };
      };
      supabase.auth.resend = async (payload) => {
        capturedResends.push(payload);
        return { data: {}, error: null };
      };

      try {
        const studentRes = await authService.registerStudentWithSupabase({
          fullName: 'Aisha Bello',
          email: 'aisha.bello@buk.edu.ng',
          password: 'Password123!',
          phone: '08031234567',
          registrationNumber: 'BUK/22/CSC/00421',
          university: 'Bayero University Kano (BUK)',
          campus: 'New Campus (Gwarzo Road)',
          studyLevel: '200 Level',
          programme: 'Computer Science',
          gender: 'Female',
        });
        assert.equal(studentRes.success, true);
        assert.equal(studentRes.requiresEmailConfirmation, true);

        const landlordRes = await authService.registerLandlordWithSupabase({
          legalName: 'Musa Ibrahim',
          email: 'musa.estates@danbare.ng',
          password: 'Password123!',
          phone: '08091234567',
          businessName: 'Danbare Suites',
          contactAddress: '14 Gwarzo Road, Kano',
          idType: 'NIN',
          idReference: '12345678901',
        });
        assert.equal(landlordRes.success, true);
        assert.equal(landlordRes.requiresEmailConfirmation, true);

        const resendRes = await authService.resendVerificationEmail('aisha.bello@buk.edu.ng');
        assert.equal(resendRes.success, true);

        assert.equal(capturedSignUps.length, 2);
        assert.equal(capturedSignUps[0].options.emailRedirectTo, 'https://outpost.buk.test/login?confirmed=1');
        assert.equal(capturedSignUps[0].options.data.programme, 'Computer Science');
        assert.equal(capturedSignUps[1].options.emailRedirectTo, 'https://outpost.buk.test/login?confirmed=1');
        assert.equal(capturedSignUps[1].options.data.company_name, 'Danbare Suites');
        assert.equal(capturedSignUps[1].options.data.business_address, '14 Gwarzo Road, Kano');
        assert.equal(capturedSignUps[1].options.data.tax_id, '12345678901');

        assert.equal(capturedResends.length, 1);
        assert.equal(capturedResends[0].type, 'signup');
        assert.equal(capturedResends[0].options.emailRedirectTo, 'https://outpost.buk.test/login?confirmed=1');
      } finally {
        supabase.auth.signUp = origSignUp;
        supabase.auth.resend = origResend;
        supabase.rpc = origRpc;
        if (origWindow === undefined) {
          delete globalThis.window;
        } else {
          globalThis.window = origWindow;
        }
      }
    });

    test('loginWithSupabase surfaces actionable error when email is not yet confirmed', async () => {
      const origSignIn = supabase.auth.signInWithPassword;
      supabase.auth.signInWithPassword = async () => ({
        data: { user: null, session: null },
        error: { message: 'Email not confirmed' },
      });

      try {
        const res = await authService.loginWithSupabase('pending@buk.edu.ng', 'Password123!');
        assert.equal(res.success, false);
        assert.match(res.error || '', /has not been confirmed yet/i);
        assert.match(res.error || '', /click the confirmation link/i);
      } finally {
        supabase.auth.signInWithPassword = origSignIn;
      }
    });

    test('App RecoveryHashHandler routes signup confirmation to /login?confirmed=1 and leaves recovery on /reset-password', () => {
      assert.match(appSrc, /flowType === 'signup' \|\|[\s\S]*flowType === 'email' \|\|[\s\S]*isConfirmedFlow/);
      assert.match(appSrc, /window\.location\.replace\(`\/login\?\$\{nextParams\.toString\(\)\}\$\{hash\}`\)/);
      assert.match(appSrc, /flowType === 'recovery'/);
      assert.match(appSrc, /window\.location\.pathname !== '\/login'/);
      assert.doesNotMatch(authSvcSrc, /repository\.createUser\(authenticatedUser\)/);
      assert.match(authSvcSrc, /repository\.cacheUser\(authenticatedUser\)/);
    });

    test('LoginPage handles confirmation arrival, clears temporary auto-session, displays banner, and allows resending', () => {
      assert.match(loginPageSrc, /searchParams\.get\('confirmed'\) === '1'/);
      assert.match(loginPageSrc, /Your email address has been confirmed! Sign in below using the email and password you provided during registration\./);
      assert.match(loginPageSrc, /await supabase\.auth\.getSession\(\)/);
      assert.match(loginPageSrc, /supabase\.auth\.signOut\(\{ scope: 'local' \}\)/);
      assert.match(loginPageSrc, /repository\.clearActiveSession\(\)/);
      assert.match(loginPageSrc, /confirmationSignOutPendingRef/);
      assert.match(loginPageSrc, /Resend confirmation email/);
    });

    test('RegisterPage directs users to login with their registered password after confirming email and offers resend', () => {
      assert.match(registerPageSrc, /directed to the Sign In page to log in using your registered password/i);
      assert.match(registerPageSrc, /Resend Confirmation Email/);
      assert.match(registerPageSrc, /authService\.resendVerificationEmail/);
    });
  });
});

