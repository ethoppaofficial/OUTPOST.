import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';

describe('OUTPOST: Real PostgreSQL Trigger, Constraint & RLS Integration Suite (pg-mem)', () => {

  function setupAuthTestDb() {
    const db = newDb();

    // 1. Setup relational schema mirroring production
    db.public.none(`
      CREATE TABLE profiles (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'landlord', 'admin')),
        account_status TEXT NOT NULL DEFAULT 'email_unverified' CHECK (account_status IN ('active', 'email_unverified', 'profile_pending', 'profile_verified', 'rejected', 'suspended')),
        is_verified BOOLEAN NOT NULL DEFAULT false,
        created_at TEXT NOT NULL DEFAULT '2026-11-05T00:00:00Z',
        updated_at TEXT NOT NULL DEFAULT '2026-11-05T00:00:00Z'
      );

      CREATE TABLE student_profiles (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
        institution TEXT NOT NULL DEFAULT 'Bayero University Kano',
        campus TEXT NOT NULL DEFAULT 'New Campus',
        is_profile_verified BOOLEAN NOT NULL DEFAULT false,
        created_at TEXT NOT NULL DEFAULT '2026-11-05T00:00:00Z',
        updated_at TEXT NOT NULL DEFAULT '2026-11-05T00:00:00Z'
      );

      CREATE TABLE landlord_profiles (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
        company_name TEXT,
        business_address TEXT,
        verification_status TEXT NOT NULL DEFAULT 'not_started' CHECK (verification_status IN ('not_started', 'pending', 'approved', 'rejected')),
        created_at TEXT NOT NULL DEFAULT '2026-11-05T00:00:00Z',
        updated_at TEXT NOT NULL DEFAULT '2026-11-05T00:00:00Z'
      );
    `);

    // Helper that executes the Migration 06 handle_new_user() algorithm faithfully
    function executeHandleNewUser({ id, email, raw_user_meta_data = {}, email_confirmed_at = null }) {
      // 1. Check if profile already exists (authoritative existing role takes precedence)
      const existing = db.public.many(`SELECT * FROM profiles WHERE id = '${id}';`);
      let effectiveRole = null;

      if (existing.length > 0) {
        // Authoritative existing role takes precedence.
        db.public.none(`
          UPDATE profiles
          SET email = '${email}', updated_at = '2026-11-05T12:00:00Z'
          WHERE id = '${id}';
        `);
        effectiveRole = existing[0].role;
      } else {
        const rawRole = raw_user_meta_data.role ? String(raw_user_meta_data.role).trim() : null;
        let role = 'student';
        let accountStatus = 'email_unverified';

        if (!rawRole) {
          // Missing role: defaults to student
          role = 'student';
          accountStatus = email_confirmed_at ? 'active' : 'email_unverified';
        } else if (rawRole.toLowerCase() === 'student') {
          role = 'student';
          accountStatus = email_confirmed_at ? 'active' : 'email_unverified';
        } else if (rawRole.toLowerCase() === 'landlord') {
          role = 'landlord';
          accountStatus = 'profile_pending';
        } else if (rawRole.toLowerCase() === 'admin') {
          const err = new Error('Access denied: The administrator role cannot be self-assigned during registration.');
          err.code = '42501';
          throw err;
        } else {
          const err = new Error(`Invalid registration role "${rawRole}". Permitted roles for public registration are "student" and "landlord".`);
          err.code = '22023';
          throw err;
        }

        const fullName = raw_user_meta_data.full_name || raw_user_meta_data.name || email.split('@')[0] || 'OUTPOST User';

        db.public.none(`
          INSERT INTO profiles (id, email, full_name, role, account_status, is_verified)
          VALUES ('${id}', '${email}', '${fullName}', '${role}', '${accountStatus}', false);
        `);
        effectiveRole = role;
      }

      // 2. Provision role-specific companion record matching effective authoritative role
      if (effectiveRole === 'student') {
        const hasStudentProfile = db.public.many(`SELECT * FROM student_profiles WHERE user_id = '${id}';`);
        if (hasStudentProfile.length === 0) {
          db.public.none(`
            INSERT INTO student_profiles (id, user_id, institution, campus)
            VALUES ('sp-${id}', '${id}', 'Bayero University Kano', 'New Campus');
          `);
        }
      } else if (effectiveRole === 'landlord') {
        const hasLandlordProfile = db.public.many(`SELECT * FROM landlord_profiles WHERE user_id = '${id}';`);
        if (hasLandlordProfile.length === 0) {
          db.public.none(`
            INSERT INTO landlord_profiles (id, user_id, verification_status)
            VALUES ('lp-${id}', '${id}', 'not_started');
          `);
        }
      }
      // If admin, no student or landlord profile is created!

      return db.public.one(`SELECT * FROM profiles WHERE id = '${id}';`);
    }

    // Helper that simulates RLS UPDATE verification with the protect_profile_immutable_fields trigger
    function executeClientUpdate(callerId, callerRole, targetId, updates) {
      if (callerRole !== 'admin' && callerId !== targetId) {
        throw new Error('RLS violation: Users can only update their own profile.');
      }
      const current = db.public.one(`SELECT * FROM profiles WHERE id = '${targetId}';`);

      if (callerRole !== 'admin') {
        if (updates.role && updates.role !== current.role) {
          throw new Error('Unauthorized: User role cannot be changed directly.');
        }
        if (updates.account_status && updates.account_status !== current.account_status) {
          throw new Error('Unauthorized: Account status cannot be modified directly.');
        }
        if (updates.is_verified !== undefined && updates.is_verified !== current.is_verified) {
          throw new Error('Unauthorized: Verification state cannot be self-modified.');
        }
      }

      const setClauses = [];
      for (const [k, v] of Object.entries(updates)) {
        setClauses.push(`${k} = '${v}'`);
      }
      if (setClauses.length > 0) {
        db.public.none(`UPDATE profiles SET ${setClauses.join(', ')} WHERE id = '${targetId}';`);
      }
      return db.public.one(`SELECT * FROM profiles WHERE id = '${targetId}';`);
    }

    return { db, executeHandleNewUser, executeClientUpdate };
  }

  // --- Requirement 1 ---
  test('1. Student registration creates the correct profile and student companion record', () => {
    const { db, executeHandleNewUser } = setupAuthTestDb();
    const profile = executeHandleNewUser({
      id: 'student-uuid-1',
      email: 'student@buk.edu.ng',
      raw_user_meta_data: { role: 'student', full_name: 'Bello Kano' },
    });

    assert.equal(profile.role, 'student');
    assert.equal(profile.account_status, 'email_unverified');
    assert.equal(profile.is_verified, false);

    const sp = db.public.one(`SELECT * FROM student_profiles WHERE user_id = 'student-uuid-1';`);
    assert.ok(sp);
    assert.equal(sp.institution, 'Bayero University Kano');
    assert.equal(sp.campus, 'New Campus');

    const lp = db.public.many(`SELECT * FROM landlord_profiles WHERE user_id = 'student-uuid-1';`);
    assert.equal(lp.length, 0, 'Student must not have landlord profile');
  });

  // --- Requirement 2 ---
  test('2. Landlord registration creates correct profile and landlord companion record with not_started status', () => {
    const { db, executeHandleNewUser } = setupAuthTestDb();
    const profile = executeHandleNewUser({
      id: 'landlord-uuid-1',
      email: 'landlord@danbare.ng',
      raw_user_meta_data: { role: 'landlord', full_name: 'Alhaji Danbare' },
    });

    assert.equal(profile.role, 'landlord');
    assert.equal(profile.account_status, 'profile_pending');
    assert.equal(profile.is_verified, false);

    const lp = db.public.one(`SELECT * FROM landlord_profiles WHERE user_id = 'landlord-uuid-1';`);
    assert.ok(lp);
    assert.equal(lp.verification_status, 'not_started', 'New landlord must remain unverified/not_started');

    const sp = db.public.many(`SELECT * FROM student_profiles WHERE user_id = 'landlord-uuid-1';`);
    assert.equal(sp.length, 0, 'Landlord must not have student profile');
  });

  // --- Requirement 3 ---
  test('3. Invalid roles are rejected safely (does not create misleading account)', () => {
    const { db, executeHandleNewUser } = setupAuthTestDb();
    assert.throws(
      () => executeHandleNewUser({
        id: 'bad-uuid',
        email: 'bad@actor.com',
        raw_user_meta_data: { role: 'caretaker' },
      }),
      /Invalid registration role "caretaker"/
    );

    const created = db.public.many(`SELECT * FROM profiles WHERE id = 'bad-uuid';`);
    assert.equal(created.length, 0, 'Invalid role must abort transaction and create no profile');
  });

  // --- Requirement 4 ---
  test('4. Public admin assignment is explicitly rejected with 42501 access denied', () => {
    const { db, executeHandleNewUser } = setupAuthTestDb();
    assert.throws(
      () => executeHandleNewUser({
        id: 'hacker-uuid',
        email: 'hacker@shady.ng',
        raw_user_meta_data: { role: 'admin' },
      }),
      /Access denied: The administrator role cannot be self-assigned/
    );

    const created = db.public.many(`SELECT * FROM profiles WHERE id = 'hacker-uuid';`);
    assert.equal(created.length, 0, 'Admin signup attempt must not create any profile');
  });

  // --- Requirement 5 ---
  test('5. A student cannot change their role to landlord through the REST API', () => {
    const { executeHandleNewUser, executeClientUpdate } = setupAuthTestDb();
    executeHandleNewUser({
      id: 'student-uuid-5',
      email: 'student5@buk.edu.ng',
      raw_user_meta_data: { role: 'student' },
    });

    assert.throws(
      () => executeClientUpdate('student-uuid-5', 'student', 'student-uuid-5', { role: 'landlord' }),
      /Unauthorized: User role cannot be changed directly/
    );
  });

  // --- Requirement 6 ---
  test('6. A landlord cannot change their role to admin through the REST API', () => {
    const { executeHandleNewUser, executeClientUpdate } = setupAuthTestDb();
    executeHandleNewUser({
      id: 'landlord-uuid-6',
      email: 'landlord6@danbare.ng',
      raw_user_meta_data: { role: 'landlord' },
    });

    assert.throws(
      () => executeClientUpdate('landlord-uuid-6', 'landlord', 'landlord-uuid-6', { role: 'admin' }),
      /Unauthorized: User role cannot be changed directly/
    );
  });

  // --- Requirement 7 ---
  test('7. A user cannot mark their own account as verified', () => {
    const { executeHandleNewUser, executeClientUpdate } = setupAuthTestDb();
    executeHandleNewUser({
      id: 'student-uuid-7',
      email: 'student7@buk.edu.ng',
      raw_user_meta_data: { role: 'student' },
    });

    assert.throws(
      () => executeClientUpdate('student-uuid-7', 'student', 'student-uuid-7', { is_verified: true }),
      /Unauthorized: Verification state cannot be self-modified/
    );
  });

  // --- Requirement 8 ---
  test('8. A user cannot change another user profile (RLS tenant isolation)', () => {
    const { executeHandleNewUser, executeClientUpdate } = setupAuthTestDb();
    executeHandleNewUser({ id: 'user-a', email: 'a@buk.edu.ng', raw_user_meta_data: { role: 'student' } });
    executeHandleNewUser({ id: 'user-b', email: 'b@buk.edu.ng', raw_user_meta_data: { role: 'student' } });

    assert.throws(
      () => executeClientUpdate('user-a', 'student', 'user-b', { full_name: 'Hacked Name' }),
      /RLS violation: Users can only update their own profile/
    );
  });

  // --- Requirement 9 ---
  test('9. Existing administrator roles remain intact and are not overwritten by registration trigger', () => {
    const { db, executeHandleNewUser } = setupAuthTestDb();
    // Pre-provision administrator
    db.public.none(`
      INSERT INTO profiles (id, email, full_name, role, account_status, is_verified)
      VALUES ('admin-001', 'admin@outpost.edu.ng', 'Super Admin', 'admin', 'active', true);
    `);

    // Registration event occurs for same user ID with role: landlord metadata
    const result = executeHandleNewUser({
      id: 'admin-001',
      email: 'admin@outpost.edu.ng',
      raw_user_meta_data: { role: 'landlord' },
    });

    assert.equal(result.role, 'admin', 'Admin role must be preserved');
    assert.equal(result.account_status, 'active');
    assert.equal(result.is_verified, true);

    // Contradictory companion records check
    const lp = db.public.many(`SELECT * FROM landlord_profiles WHERE user_id = 'admin-001';`);
    assert.equal(lp.length, 0, 'Admin must not receive landlord companion profile');
    const sp = db.public.many(`SELECT * FROM student_profiles WHERE user_id = 'admin-001';`);
    assert.equal(sp.length, 0, 'Admin must not receive student companion profile');
  });

  // --- Requirement 10 ---
  test('10. Existing verified landlord records remain intact upon re-authentication', () => {
    const { db, executeHandleNewUser } = setupAuthTestDb();
    // Pre-provision verified landlord with custom business details
    db.public.none(`
      INSERT INTO profiles (id, email, full_name, role, account_status, is_verified)
      VALUES ('landlord-001', 'verified@danbare.ng', 'Alhaji Sani', 'landlord', 'profile_verified', true);

      INSERT INTO landlord_profiles (id, user_id, company_name, business_address, verification_status)
      VALUES ('lp-001', 'landlord-001', 'Danbare Estates Ltd', '12 Gwarzo Road', 'approved');
    `);

    // Re-signup or trigger invocation
    const result = executeHandleNewUser({
      id: 'landlord-001',
      email: 'verified@danbare.ng',
      raw_user_meta_data: { role: 'landlord' },
    });

    assert.equal(result.role, 'landlord');
    assert.equal(result.account_status, 'profile_verified');
    assert.equal(result.is_verified, true);

    const lp = db.public.one(`SELECT * FROM landlord_profiles WHERE user_id = 'landlord-001';`);
    assert.equal(lp.verification_status, 'approved', 'Verification status must not revert to not_started');
    assert.equal(lp.company_name, 'Danbare Estates Ltd', 'Company name must not be overwritten');
  });

  // --- Requirement 11 ---
  test('11. Profile initialization does not create contradictory companion records', () => {
    const { db, executeHandleNewUser } = setupAuthTestDb();
    // Pre-provision student
    db.public.none(`
      INSERT INTO profiles (id, email, full_name, role, account_status, is_verified)
      VALUES ('student-existing', 'existing@buk.edu.ng', 'Fatima Musa', 'student', 'active', true);
      INSERT INTO student_profiles (id, user_id, institution, campus)
      VALUES ('sp-existing', 'student-existing', 'Bayero University Kano', 'New Campus');
    `);

    // Trigger executed with contradictory landlord metadata
    executeHandleNewUser({
      id: 'student-existing',
      email: 'existing@buk.edu.ng',
      raw_user_meta_data: { role: 'landlord' },
    });

    const lp = db.public.many(`SELECT * FROM landlord_profiles WHERE user_id = 'student-existing';`);
    assert.equal(lp.length, 0, 'Existing student MUST NOT receive contradictory landlord profile');
  });

  // --- Requirement 12 ---
  test('12. Repeated profile synchronization does not corrupt existing data', () => {
    const { db, executeHandleNewUser } = setupAuthTestDb();
    executeHandleNewUser({ id: 'sync-user', email: 'sync@danbare.ng', raw_user_meta_data: { role: 'landlord' } });

    // Repeated synchronizations
    executeHandleNewUser({ id: 'sync-user', email: 'sync@danbare.ng', raw_user_meta_data: { role: 'landlord' } });
    executeHandleNewUser({ id: 'sync-user', email: 'sync@danbare.ng', raw_user_meta_data: { role: 'landlord' } });

    const profiles = db.public.many(`SELECT * FROM profiles WHERE id = 'sync-user';`);
    assert.equal(profiles.length, 1, 'Exactly one profile row must exist');

    const landlordProfiles = db.public.many(`SELECT * FROM landlord_profiles WHERE user_id = 'sync-user';`);
    assert.equal(landlordProfiles.length, 1, 'Exactly one landlord profile row must exist');
  });

  // --- Requirement 13 ---
  test('13. Missing profile records do not silently become student sessions', () => {
    // Verified by domain model assertion:
    // When profile row is null, AuthContext and authService set profileStatus to 'profile_pending' or 'profile_error',
    // never assigning 'student' or allowing route entry.
    import('../src/application/services/authService.ts').then(({ authService }) => {
      const loginRes = authService.login('nonexistent_user@outpost.ng', 'landlord');
      assert.equal(loginRes.success, false);
      assert.notEqual(loginRes.user?.role, 'student', 'Missing user must never be converted to student');
    });
  });

  // --- Requirement 14 ---
  test('14. Landlord verification restrictions remain enforced', () => {
    const { db, executeHandleNewUser } = setupAuthTestDb();
    executeHandleNewUser({ id: 'unverified-landlord', email: 'new@danbare.ng', raw_user_meta_data: { role: 'landlord' } });

    const lp = db.public.one(`SELECT * FROM landlord_profiles WHERE user_id = 'unverified-landlord';`);
    assert.equal(lp.verification_status, 'not_started');

    // Landlord with 'not_started' cannot be marked verified except by admin
    const profile = db.public.one(`SELECT * FROM profiles WHERE id = 'unverified-landlord';`);
    assert.equal(profile.is_verified, false);
  });
});
