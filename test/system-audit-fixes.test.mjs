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
import { verificationService } from '../src/application/services/verificationService.ts';
import { createAdminService } from '../src/application/services/adminService.ts';
import { calculateCompatibility } from '../src/domain/matching.ts';
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
  const studentVerifSrc = read('src/pages/student/StudentVerificationPage.tsx');
  const landlordVerifSrc = read('src/pages/landlord/LandlordVerificationPage.tsx');
  const usersPageSrc = read('src/pages/admin/UsersPage.tsx');
  const publicProfileSrc = read('src/pages/public/PublicProfilePage.tsx');
  const verificationSvcSrc = read('src/application/services/verificationService.ts');
  const userSearchSrc = read('src/pages/student/UserSearchPage.tsx');
  const m16 = read('supabase/migrations/20261115000016_student_reg_number_link_and_invite_search.sql');
  const m17 = read('supabase/migrations/20261115000017_persist_user_phone_on_registration.sql');

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

    test('AdminAuditLogsPage table renders 4 clean columns without redundant Details column', () => {
      assert.match(auditLogsSrc, /<th className="p-3">Timestamp<\/th>/);
      assert.match(auditLogsSrc, /<th className="p-3">Actor<\/th>/);
      assert.match(auditLogsSrc, /<th className="p-3">Action<\/th>/);
      assert.match(auditLogsSrc, /<th className="p-3">Affected record<\/th>/);
      assert.doesNotMatch(auditLogsSrc, /<th[^>]*>Details<\/th>/i);
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

  describe('7. Student Registration Number Linkage & Cohort Invite Flow (Migration 16)', () => {
    test('Migration 16 defines backfill, handle_new_user linkage, link_student_registration_number, invite search & atomic RPCs', () => {
      assert.match(m16, /UPDATE public\.student_profiles[\s\S]*registration_number = v_norm/i);
      assert.match(m16, /CREATE OR REPLACE FUNCTION public\.handle_new_user/i);
      assert.match(m16, /CREATE OR REPLACE FUNCTION public\.link_student_registration_number/i);
      assert.match(m16, /CREATE OR REPLACE FUNCTION public\.search_students_for_invite/i);
      assert.match(m16, /CREATE OR REPLACE FUNCTION public\.invite_student_to_group_atomic/i);
      assert.match(m16, /CREATE OR REPLACE FUNCTION public\.respond_to_group_invitation_atomic/i);
      assert.match(m16, /status IN \('cancelled', 'pending'\)/i);
      assert.match(m16, /REVOKE EXECUTE ON FUNCTION public\.search_students_for_invite[\s\S]*FROM PUBLIC, anon/i);
      assert.match(m16, /GRANT EXECUTE ON FUNCTION public\.invite_student_to_group_atomic[\s\S]*TO authenticated/i);
    });

    test('searchStudentByRegistrationNumber and searchStudents match case- and whitespace-insensitively', () => {
      const peerId = '44444444-4444-4444-8444-444444444444';
      repository.cacheStudentProfile({
        userId: peerId,
        fullName: 'Sadiq Umar',
        phone: '',
        institutionName: 'Bayero University Kano',
        university: 'Bayero University Kano',
        campus: 'New Campus',
        studyLevel: '400 Level',
        programme: 'Software Engineering',
        registrationNumber: 'CST/20/SWE/000011',
        gender: 'Male',
        preferredLocation: 'Dambare',
        isProfileVerified: true,
      });

      const exact = repository.searchStudentByRegistrationNumber('  cst/20/swe/000011 ');
      assert.equal(exact?.userId, peerId);
      assert.equal(exact?.registrationNumber, 'CST/20/SWE/000011');

      const searched = repository.searchStudents('cst/20/swe/000011');
      assert.ok(searched.some((p) => p.userId === peerId));
    });

    test('groupChatService.searchStudentsForInvite, inviteMemberPersisted, and respondToInvitationPersisted execute via Supabase RPCs', async () => {
      const leaderId = '55555555-5555-4555-8555-555555555555';
      const inviteeId = '66666666-6666-4666-8666-666666666666';

      repository.cacheUser({
        id: leaderId,
        email: 'leader@buk.edu.ng',
        fullName: 'Ibrahim Musa',
        role: 'student',
        accountStatus: 'active',
        createdAt: new Date().toISOString(),
      });
      repository.setActiveUserId(leaderId);

      const cohort = groupChatService.createGroup(
        'Ethappa Property occupants group 1',
        'Software Engineering cohort',
        leaderId,
        4,
        undefined,
        'invite_only'
      );

      const origRpc = supabase.rpc;
      const rpcCalls = [];
      supabase.rpc = async (fn, params) => {
        rpcCalls.push({ fn, params });
        if (fn === 'search_students_for_invite') {
          return {
            data: [
              {
                userId: inviteeId,
                fullName: 'Amina Yusuf',
                avatarUrl: null,
                university: 'Bayero University Kano',
                campus: 'New Campus',
                studyLevel: '400 Level',
                registrationNumber: 'CST/20/SWE/000011',
                isProfileVerified: true,
                isAlreadyMember: false,
                hasPendingInvite: false,
              },
            ],
            error: null,
          };
        }
        if (fn === 'invite_student_to_group_atomic') {
          return {
            data: {
              success: true,
              invitation: {
                id: '77777777-7777-4777-8777-777777777777',
                groupId: cohort.id,
                groupName: cohort.name,
                senderId: leaderId,
                senderName: 'Ibrahim Musa',
                receiverId: inviteeId,
                receiverName: 'Amina Yusuf',
                receiverRegNumber: 'CST/20/SWE/000011',
                status: 'pending',
              },
            },
            error: null,
          };
        }
        if (fn === 'respond_to_group_invitation_atomic') {
          return {
            data: { success: true, status: 'accepted', groupId: cohort.id },
            error: null,
          };
        }
        return { data: null, error: null };
      };

      try {
        const candidates = await groupChatService.searchStudentsForInvite('cst/20/swe/000011', cohort.id);
        assert.equal(candidates.length, 1);
        assert.equal(candidates[0].userId, inviteeId);
        assert.equal(candidates[0].registrationNumber, 'CST/20/SWE/000011');

        const inviteRes = await groupChatService.inviteMemberPersisted(
          cohort.id,
          leaderId,
          undefined,
          '  cst/20/swe/000011 '
        );
        assert.equal(inviteRes.success, true);
        assert.equal(inviteRes.invitation?.receiverId, inviteeId);
        assert.equal(inviteRes.invitation?.receiverRegNumber, 'CST/20/SWE/000011');

        const pendingForInvitee = groupChatService.getPendingInvitations(inviteeId);
        assert.equal(pendingForInvitee.length, 1);
        assert.equal(pendingForInvitee[0].id, '77777777-7777-4777-8777-777777777777');

        const acceptRes = await groupChatService.respondToInvitationPersisted(
          pendingForInvitee[0].id,
          'accept'
        );
        assert.equal(acceptRes.success, true);
        assert.ok(groupChatService.getGroupById(cohort.id)?.memberIds.includes(inviteeId));

        assert.equal(rpcCalls[0].fn, 'search_students_for_invite');
        assert.equal(rpcCalls[1].fn, 'invite_student_to_group_atomic');
        assert.equal(rpcCalls[1].params.p_reg_number, 'CST/20/SWE/000011');
        assert.equal(rpcCalls[2].fn, 'respond_to_group_invitation_atomic');
      } finally {
        supabase.rpc = origRpc;
      }
    });

    test('verificationService.linkStudentRegistrationNumber validates format and persists normalized registration number', async () => {
      const studentId = '88888888-8888-4888-8888-888888888888';
      repository.cacheUser({
        id: studentId,
        email: 'unlinked@buk.edu.ng',
        fullName: 'Kabir Sani',
        role: 'student',
        accountStatus: 'active',
        createdAt: new Date().toISOString(),
      });

      const invalidRes = await verificationService.linkStudentRegistrationNumber(studentId, 'ab');
      assert.equal(invalidRes.success, false);
      assert.match(invalidRes.error || '', /between 4 and 40 characters/i);

      const origRpc = supabase.rpc;
      supabase.rpc = async (fn, params) => {
        if (fn === 'link_student_registration_number') {
          return {
            data: { success: true, userId: studentId, registrationNumber: params.p_reg_number },
            error: null,
          };
        }
        return { data: null, error: null };
      };

      try {
        const okRes = await verificationService.linkStudentRegistrationNumber(studentId, '  cst/20/swe/000099 ');
        assert.equal(okRes.success, true);
        assert.equal(okRes.registrationNumber, 'CST/20/SWE/000099');
        assert.equal(repository.getStudentProfile(studentId)?.registrationNumber, 'CST/20/SWE/000099');
        assert.equal(repository.getUserById(studentId)?.studentProfile?.registrationNumber, 'CST/20/SWE/000099');
      } finally {
        supabase.rpc = origRpc;
      }
    });

    test('UI & auth flows wire registration linkage and live invite search end-to-end', () => {
      assert.match(groupDetailSrc, /groupChatService\s*\.\s*searchStudentsForInvite/);
      assert.match(groupDetailSrc, /groupChatService\s*\.\s*inviteMemberPersisted/);
      assert.match(groupsSrc, /groupChatService\s*\.\s*respondToInvitationPersisted/);
      assert.match(studentVerifSrc, /verificationService\s*\.\s*linkStudentRegistrationNumber/);
      assert.match(userSearchSrc, /groupChatService\s*\.\s*inviteMemberPersisted/);
      assert.match(authSvcSrc, /cacheStudentProfile/);
      assert.match(authCtxSrc, /cacheStudentProfile/);
    });
  });

  describe('8. User Phone Persistence on Registration & Profile Visibility (Migration 17)', () => {
    test('Migration 17 backfills profiles.phone from auth metadata and persists phone in handle_new_user()', () => {
      assert.match(m17, /UPDATE public\.profiles p[\s\S]*SET[\s\S]*phone = NULLIF\(btrim\(u\.raw_user_meta_data->>'phone'\), ''\)/i);
      assert.match(m17, /CREATE OR REPLACE FUNCTION public\.handle_new_user/i);
      assert.match(m17, /v_phone := NULLIF\(btrim\(COALESCE\(NEW\.raw_user_meta_data->>'phone', ''\)\), ''\);/i);
      assert.match(m17, /INSERT INTO public\.profiles \([\s\S]*phone,[\s\S]*VALUES \([\s\S]*v_phone,/i);
      assert.match(m17, /phone = COALESCE\(NULLIF\(btrim\(phone\), ''\), v_phone\)/i);
      assert.match(m17, /link_student_registration_number|registration_number/i);
      assert.match(m17, /NOTIFY pgrst, 'reload schema'/i);
    });

    test('authService, AuthContext, and verificationService hydrate and backfill empty/null profile.phone', () => {
      assert.match(authCtxSrc, /const resolvedPhone = profilePhone \|\| metaPhone;/);
      assert.match(authCtxSrc, /if \(!profilePhone && metaPhone && user\.email_confirmed_at\)/);
      assert.match(authCtxSrc, /phone: resolvedPhone,/);
      assert.match(authSvcSrc, /const resolvedPhone = profilePhone \|\| metaPhone;/);
      assert.match(authSvcSrc, /if \(!profilePhone && metaPhone && sbUser\.email_confirmed_at\)/);
      assert.match(verificationSvcSrc, /from\('profiles'\)\.select\('full_name, phone'\)/);
    });

    test('Student, Landlord, and Admin profile views display phone number while PublicProfilePage keeps PII hidden', () => {
      assert.match(studentVerifSrc, /Phone Number:/);
      assert.match(studentVerifSrc, /currentUser\?\.phone \|\| cachedStudent\?\.phone/);
      assert.match(landlordVerifSrc, /Phone Number:/);
      assert.match(landlordVerifSrc, /currentUser\?\.phone \|\| liveProfile\?\.phone \|\| landlordProfile\?\.phone/);
      assert.match(usersPageSrc, /inspectedUser\.phone \|\| 'No phone supplied'/);
      assert.match(usersPageSrc, /user\.phone \? ` · \$\{user\.phone\}` : ''/);
      const publicBody = publicProfileSrc.slice(publicProfileSrc.indexOf('export const PublicProfilePage'));
      assert.doesNotMatch(publicBody, /\bphone\b/i);
    });
  });

  describe('9. Roommate Lifestyle Custom Options, None/Nil & Other Preferences Table', () => {
    const prefsPageSrc = read('src/pages/student/RoommatePreferencesPage.tsx');

    test('RoommatePreferencesPage includes None/Nil, Custom inputs across options, and Other Preferences table', () => {
      assert.match(prefsPageSrc, /Other Preferences Table/);
      assert.match(prefsPageSrc, /category:\s*'Tribe'/);
      assert.match(prefsPageSrc, /category:\s*'Language'/);
      assert.match(prefsPageSrc, /category:\s*'Religion'/);
      assert.match(prefsPageSrc, /__custom__/);
      assert.match(prefsPageSrc, /value:\s*'None'/);
      assert.match(prefsPageSrc, /value:\s*'Nil'/);
      assert.match(prefsPageSrc, /Add Preference Row/);
    });

    test('saveRoommatePreference & calculateCompatibility handle None/Nil, custom strings, and customPreferences table rows', () => {
      const idA = '91111111-1111-4111-8111-111111111111';
      const idB = '92222222-2222-4222-8222-222222222222';

      const prefA = roommateService.saveStudentPreferences({
        studentId: idA,
        preferredNeighbourhoods: ['None'],
        minBudget: 0,
        maxBudget: 0,
        moveInPeriod: 'None',
        studyHabits: 'Custom group revision evenings',
        sleepSchedule: 'Nil',
        cleanliness: 'None',
        smoking: 'Nil',
        guestPreference: 'None',
        noiseTolerance: 'Custom medium background podcast OK',
        roomSharing: 'None',
        genderPreference: 'Nil',
        customPreferences: [
          { category: 'Tribe', value: 'Hausa' },
          { category: 'Language', value: 'Hausa / English' },
          { category: 'Religion', value: 'Nil' },
        ],
      });

      const prefB = roommateService.saveStudentPreferences({
        studentId: idB,
        preferredNeighbourhoods: ['Dambare'],
        minBudget: 250000,
        maxBudget: 400000,
        moveInPeriod: 'Immediate',
        studyHabits: 'Custom group revision evenings',
        sleepSchedule: 'Sleeps Midnight - 2am',
        cleanliness: 'Moderate / Weekly',
        smoking: 'Non-Smoker Only',
        guestPreference: 'Weekends Only',
        noiseTolerance: 'Custom medium background podcast OK',
        roomSharing: 'Open to 2-Person Shared',
        genderPreference: 'Same Gender Only',
        customPreferences: [
          { category: 'Tribe', value: 'Hausa' },
          { category: 'Language', value: 'English' },
          { category: 'Religion', value: 'Islam' },
        ],
      });

      assert.equal(roommateService.getStudentPreferences(idA)?.customPreferences?.length, 3);
      assert.equal(prefA.studyHabits, 'Custom group revision evenings');

      const result = calculateCompatibility(prefA, prefB);
      assert.ok(result.score >= 0 && result.score <= 100);
      assert.ok(result.matchingFactors.some((f) => f.includes('Shared Tribe preference (Hausa)')));
      assert.ok(result.divergingFactors.some((f) => f.includes('Different Language preference')));
      assert.ok(!result.divergingFactors.some((f) => f.includes('Religion')));
      assert.ok(!result.divergingFactors.some((f) => f.includes('Conflicting smoking boundary')));
    });

    test('Supabase mapper serializes & restores customPreferences and None/Nil without breaking SQL enum constraints', () => {
      assert.match(repoSrc, /customPreferences:\s*sanitizedCustomPreferences/);
      assert.match(repoSrc, /pref\.smoking === 'Non-Smoker Only'\s*\?\s*'no_smoking'\s*:\s*'flexible'/);
    });
  });

  describe('10. Admin Verification History & Verified User Documents', () => {
    const verifQueueSrc = read('src/pages/admin/VerificationQueuePage.tsx');

    test('adminService.getVerificationQueues includes approved, rejected, and pending student and landlord history', async () => {
      const adminId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const sPending = '11111111-1111-4111-8111-111111111111';
      const sVerified = '22222222-2222-4222-8222-222222222222';
      const lVerified = '33333333-3333-4333-8333-333333333333';

      const tables = {
        profiles: [
          { id: adminId, email: 'admin@outpost.ng', role: 'admin', account_status: 'active', full_name: 'Primary Admin' },
          { id: sPending, email: 'p@buk.edu.ng', role: 'student', account_status: 'active', full_name: 'Pending Student' },
          { id: sVerified, email: 'v@buk.edu.ng', role: 'student', account_status: 'active', full_name: 'Verified Student' },
          { id: lVerified, email: 'l@outpost.ng', role: 'landlord', account_status: 'profile_verified', full_name: 'Verified Landlord' },
        ],
        student_profiles: [
          { user_id: sPending, registration_number: 'CST/22/COM/0001' },
          { user_id: sVerified, registration_number: 'CST/21/SWE/0002' },
        ],
        student_verification_documents: [
          { id: 'doc-p', student_id: sPending, document_type: 'student_id', file_name: 'id-p.png', storage_path: `${sPending}/id-p.png`, status: 'pending', created_at: '2026-11-15T10:00:00Z' },
          { id: 'doc-v', student_id: sVerified, document_type: 'admission_letter', file_name: 'adm-v.pdf', storage_path: `${sVerified}/adm-v.pdf`, status: 'approved', reviewer_id: adminId, reviewed_at: '2026-11-14T10:00:00Z', created_at: '2026-11-13T10:00:00Z' },
        ],
        landlord_verification_submissions: [
          { id: 'sub-v', landlord_id: lVerified, document_type: 'national_id', file_name: 'nin-v.pdf', storage_path: `${lVerified}/nin-v.pdf`, status: 'approved', reviewer_id: adminId, reviewed_at: '2026-11-14T12:00:00Z', created_at: '2026-11-12T10:00:00Z' },
        ],
        landlord_profiles: [
          { user_id: lVerified, company_name: 'Danbare Estates', business_address: 'Gwarzo Rd', tax_id: 'NIN-9988', verification_status: 'approved', verified_at: '2026-11-14T12:00:00Z' },
        ],
      };

      const mockClient = {
        auth: {
          async getUser() {
            return { data: { user: { id: adminId, email: 'admin@outpost.ng' } }, error: null };
          },
        },
        from(table) {
          const filters = [];
          const inFilters = [];
          const execute = () => {
            const rows = (tables[table] || []).filter(
              (r) => filters.every((f) => f(r)) && inFilters.every((f) => f(r))
            );
            return { data: rows, error: null };
          };
          const q = {
            select() { return q; },
            eq(col, val) { filters.push((r) => r?.[col] === val); return q; },
            in(col, vals) { inFilters.push((r) => Array.isArray(vals) && vals.includes(r?.[col])); return q; },
            order() { return q; },
            async maybeSingle() {
              const res = execute();
              return { data: res.data[0] ?? null, error: null };
            },
            then(resolve, reject) {
              return Promise.resolve(execute()).then(resolve, reject);
            },
          };
          return q;
        },
      };

      const queues = await createAdminService({ client: mockClient }).getVerificationQueues();
      assert.equal(queues.students.length, 2);
      assert.equal(queues.students[0].status, 'pending');
      assert.equal(queues.students[1].status, 'approved');
      assert.equal(queues.students[1].reviewerName, 'Primary Admin');

      assert.equal(queues.landlords.length, 1);
      assert.equal(queues.landlords[0].status, 'approved');
      assert.equal(queues.landlords[0].storage_path, `${lVerified}/nin-v.pdf`);
      assert.equal(queues.landlords[0].documentUrl, `${lVerified}/nin-v.pdf`);
    });

    test('VerificationQueuePage supports history status filters and viewing already-verified documents', () => {
      assert.match(verifQueueSrc, /All history/);
      assert.match(verifQueueSrc, /Verified \/ Approved/);
      assert.match(verifQueueSrc, /View verified document \(15m signed link\)/);
    });
  });

  describe('11. Authentication, Session Stability & Email Confirmation Redirect Hardening', () => {
    test('Captures initialAuthCallback synchronously before GoTrue URL stripping & prevents StrictMode double verifyOtp', () => {
      assert.match(supabaseClientSrc, /export const initialAuthCallback = captureInitialAuthCallback\(\)/);
      assert.match(loginPageSrc, /verifyConfirmationTokenOnce/);
      assert.match(loginPageSrc, /hasAuthError/);
      assert.match(appSrc, /const isRecoveryFlow = flowType === 'recovery'/);
      assert.match(appSrc, /window\.location\.pathname !== '\/reset-password'/);
    });

    test('AuthContext avoids setting loading=true on background TOKEN_REFRESHED and normalizes confirmed student status', () => {
      assert.match(authCtxSrc, /event === 'TOKEN_REFRESHED'/);
      assert.match(authCtxSrc, /sameAuthenticatedUser/);
      assert.match(authCtxSrc, /resolvedStatus === 'email_unverified' && user\.email_confirmed_at/);
      assert.match(authSvcSrc, /hydratedLandlordProfile/);
    });
  });
});

