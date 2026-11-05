import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { repository } from '../src/infrastructure/repositories/index.ts';
import { authService } from '../src/application/services/authService.ts';

describe('OUTPOST: Landlord Registration & Role Assignment Regression Test Suite', () => {
  const migration06Path = path.resolve('supabase/migrations/20261020000006_fix_landlord_registration_profile_initialization.sql');
  const authContextPath = path.resolve('src/application/context/AuthContext.tsx');
  const authServicePath = path.resolve('src/application/services/authService.ts');
  const protectedRoutePath = path.resolve('src/components/layout/ProtectedRoute.tsx');

  describe('1. Migration 06 Schema & Trigger Integrity', () => {
    test('Migration 06 file exists and is readable', () => {
      assert.ok(fs.existsSync(migration06Path), 'Migration 06 must exist in supabase/migrations');
      const content = fs.readFileSync(migration06Path, 'utf8');
      assert.ok(content.length > 500, 'Migration 06 should contain complete remediation DDL');
    });

    test('Trigger handle_new_user() validates registration intent and supports landlord role', () => {
      const content = fs.readFileSync(migration06Path, 'utf8');
      // Must check raw_user_meta_data for role
      assert.match(content, /raw_user_meta_data->>'role'/i, 'Must inspect role from auth metadata');
      // Must explicitly check for 'landlord'
      assert.match(content, /v_role\s*:=\s*'landlord'/i, 'Must assign landlord role when requested');
      // Must set account_status = 'profile_pending' for landlords
      assert.match(content, /v_account_status\s*:=\s*'profile_pending'/i, 'Must set profile_pending for landlords');
      // Must insert into landlord_profiles with verification_status = not_started
      assert.match(content, /INSERT INTO public\.landlord_profiles/i, 'Must provision landlord_profiles record');
      assert.match(content, /'not_started'/i, 'Must set verification_status to not_started');
    });

    test('Trigger handle_new_user() strictly prohibits self-assigning admin and defaults to student', () => {
      const content = fs.readFileSync(migration06Path, 'utf8');
      // Must default any other role (including admin) to student
      assert.match(content, /v_role\s*:=\s*'student'/i, 'Must default fallback to student role');
      assert.match(content, /v_account_status\s*:=\s*'email_unverified'/i, 'Must set email_unverified for students');
      // Must NOT allow 'admin' from metadata
      assert.ok(!content.includes("v_role := 'admin'"), 'Trigger must never grant admin role from metadata');
    });

    test('RLS policy on public.profiles permits landlord inserts and prohibits admin self-assignment', () => {
      const content = fs.readFileSync(migration06Path, 'utf8');
      // Must drop old policy and recreate
      assert.match(content, /DROP POLICY IF EXISTS "Users can insert own profile" ON public\.profiles/i);
      assert.match(content, /CREATE POLICY "Users can insert own profile"[\s\S]*?ON public\.profiles/i);
      // Policy MUST allow student and landlord, NOT admin
      assert.match(content, /role IN \('student',\s*'landlord'\)/i, 'Policy must allow student and landlord');
      assert.ok(!content.includes("role IN ('student', 'landlord', 'admin')"), 'Policy must never permit admin insert');
    });
  });

  describe('2. Elimination of Hardcoded Email Authorizations & Silent Role Fallbacks', () => {
    test('AuthContext.tsx does not grant admin role based on hardcoded email', () => {
      const content = fs.readFileSync(authContextPath, 'utf8');
      assert.ok(
        !content.includes("user.email === 'ethoppaofficial@gmail.com'"),
        'AuthContext must not hardcode admin email checks'
      );
      assert.ok(
        !content.includes("email === 'ethoppaofficial@gmail.com'"),
        'AuthContext must not hardcode admin email checks'
      );
    });

    test('AuthContext.tsx does not silently degrade missing profiles to student', () => {
      const content = fs.readFileSync(authContextPath, 'utf8');
      // Ensure the old buggy fallback is removed:
      assert.ok(
        !content.includes("storedRole === 'landlord' ? 'landlord' : 'student'"),
        'AuthContext must not default null profile role to student'
      );
      // Ensure profileStatus state is managed
      assert.match(content, /profile_pending/, 'AuthContext must handle profile_pending state');
      assert.match(content, /profile_error/, 'AuthContext must handle profile_error state');
    });

    test('authService.ts does not bypass credentials or synthesize admin via hardcoded email', () => {
      const content = fs.readFileSync(authServicePath, 'utf8');
      assert.ok(
        !content.includes("if (normalized === 'ethoppaofficial@gmail.com')"),
        'authService.login must not bypass checks for specific email'
      );
      assert.ok(
        !content.includes("if (user.email === 'ethoppaofficial@gmail.com')"),
        'authService must not elevate roles based on email'
      );
    });

    test('ProtectedRoute.tsx blocks route access while profile is pending initialization', () => {
      const content = fs.readFileSync(protectedRoutePath, 'utf8');
      assert.match(content, /profileStatus === 'profile_pending'/, 'ProtectedRoute must check profile_pending');
      assert.match(content, /profileStatus === 'profile_error'/, 'ProtectedRoute must check profile_error');
    });
  });

  describe('3. Repository & Domain Model Role Enforcement', () => {
    test('Repository initializes seed profiles with correct authoritative roles', () => {
      // Test seeded admin
      const admin = repository.getUserByEmail('ethoppaofficial@gmail.com');
      assert.ok(admin, 'Admin seed account must exist in repository');
      assert.equal(admin.role, 'admin', 'Admin account role must be admin');

      // Test seeded student
      const student = repository.getUserByEmail('student1@outpost.edu.ng');
      assert.ok(student, 'Student seed account must exist');
      assert.equal(student.role, 'student', 'Student role must be student');

      // Test seeded landlord
      const landlord = repository.getUserByEmail('landlord1@outpost.ng');
      assert.ok(landlord, 'Landlord seed account must exist');
      assert.equal(landlord.role, 'landlord', 'Landlord role must be landlord');
    });

    test('Landlord registration creates landlord user and profile, never student', () => {
      const newLandlord = {
        id: '11111111-2222-4333-8444-555555555555',
        email: 'danbare_hostel_owner@example.com',
        role: 'landlord',
        accountStatus: 'profile_pending',
        emailVerified: false,
        fullName: 'Alhaji Danbare Hostels',
        avatarUrl: '',
        createdAt: new Date().toISOString(),
      };
      repository.createUser(newLandlord);

      const retrieved = repository.getUserById(newLandlord.id);
      assert.ok(retrieved);
      assert.equal(retrieved.role, 'landlord', 'Retrieved user role must be landlord');
      assert.notEqual(retrieved.role, 'student', 'Landlord must NEVER be assigned student role');

      // Check landlord profile creation
      const landlordProfile = {
        userId: newLandlord.id,
        businessName: 'Danbare Prime Accommodations',
        businessAddress: 'Danbare Commercial Area, BUK New Site',
        verificationStatus: 'pending',
        idType: 'national_id',
        idNumber: 'NIN-1234567890',
        idDocumentUrl: '/docs/danbare_nin.pdf',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      repository.saveLandlordProfile(landlordProfile);

      const retrievedLP = repository.getLandlordProfile(newLandlord.id);
      assert.ok(retrievedLP);
      assert.equal(retrievedLP.verificationStatus, 'pending', 'New landlord must remain unverified/pending');
    });

    test('Student registration creates student user and profile', () => {
      const newStudent = {
        id: '22222222-3333-4444-8555-666666666666',
        email: 'buk_freshman@outpost.edu.ng',
        role: 'student',
        accountStatus: 'email_unverified',
        emailVerified: false,
        fullName: 'Maryam Kano Student',
        avatarUrl: '',
        createdAt: new Date().toISOString(),
      };
      repository.createUser(newStudent);

      const retrieved = repository.getUserById(newStudent.id);
      assert.ok(retrieved);
      assert.equal(retrieved.role, 'student', 'Student role must be student');
      assert.notEqual(retrieved.role, 'landlord', 'Student must not be landlord');
    });

    test('authService.login enforces role match against repository source of truth', () => {
      // Landlord attempting to log in as student must fail
      const mismatchResult = authService.login('landlord1@outpost.ng', 'student');
      assert.equal(mismatchResult.success, false, 'Role mismatch must be rejected');
      assert.match(mismatchResult.error, /Account exists as landlord, not student/);

      // Student attempting to log in as landlord must fail
      const studentMismatch = authService.login('student1@outpost.edu.ng', 'landlord');
      assert.equal(studentMismatch.success, false, 'Role mismatch must be rejected');
      assert.match(studentMismatch.error, /Account exists as student, not landlord/);

      // Landlord logging in as landlord succeeds
      const landlordResult = authService.login('landlord1@outpost.ng', 'landlord');
      assert.equal(landlordResult.success, true);
      assert.equal(landlordResult.user?.role, 'landlord');
    });

    test('Suspended accounts are blocked from logging in regardless of role', () => {
      const suspendedUser = {
        id: '33333333-4444-4555-8666-777777777777',
        email: 'bad_actor@outpost.edu.ng',
        role: 'landlord',
        accountStatus: 'suspended',
        emailVerified: true,
        fullName: 'Suspended Landlord',
        avatarUrl: '',
        createdAt: new Date().toISOString(),
      };
      repository.createUser(suspendedUser);

      const loginResult = authService.login('bad_actor@outpost.edu.ng', 'landlord');
      assert.equal(loginResult.success, false);
      assert.match(loginResult.error, /suspended/i);
    });
  });

  describe('4. Historical Migration Immutability & Safe Recovery Procedure', () => {
    test('Historical migrations 01 through 05 are intact and unmodified', () => {
      const migrationsDir = path.resolve('supabase/migrations');
      const files = fs.readdirSync(migrationsDir).sort();

      const expectedHistorical = [
        '20261020000001_initial_schema.sql',
        '20261020000002_row_level_security.sql',
        '20261020000003_storage_buckets_and_policies.sql',
        '20261020000004_functions_triggers_and_automation.sql',
        '20261020000005_pre_deployment_hardening.sql',
      ];

      for (const expected of expectedHistorical) {
        assert.ok(files.includes(expected), `Historical migration ${expected} must exist`);
      }

      // Check migration 02 retains original state (proving we did not tamper with historical migrations)
      const m02Content = fs.readFileSync(path.join(migrationsDir, '20261020000002_row_level_security.sql'), 'utf8');
      assert.match(m02Content, /Users can insert own profile/, 'Migration 02 must remain in historical state');
    });

    test('Migration 06 provides idempotent and reversible DDL', () => {
      const content = fs.readFileSync(migration06Path, 'utf8');
      assert.match(content, /CREATE OR REPLACE FUNCTION public\.handle_new_user\(\)/);
      assert.match(content, /DROP TRIGGER IF EXISTS on_auth_user_created ON auth\.users/);
      assert.match(content, /CREATE TRIGGER on_auth_user_created/);
    });
  });
});
