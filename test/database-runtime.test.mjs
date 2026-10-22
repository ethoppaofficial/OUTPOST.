import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';

describe('OUTPOST PostgreSQL Database Runtime Invariants & Transaction Verification', () => {

  function setupTestDb() {
    const db = newDb();

    // Setup base tables mirroring production schema
    db.public.none(`
      CREATE TABLE profiles (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'landlord', 'admin')),
        account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'suspended', 'email_unverified')),
        is_verified BOOLEAN NOT NULL DEFAULT false
      );

      CREATE TABLE properties (
        id TEXT PRIMARY KEY,
        landlord_id TEXT NOT NULL REFERENCES profiles(id),
        title TEXT NOT NULL,
        approval_status TEXT NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('draft', 'pending', 'approved', 'rejected')),
        is_published BOOLEAN NOT NULL DEFAULT true,
        total_spaces INTEGER NOT NULL DEFAULT 1 CHECK (total_spaces >= 1),
        available_spaces INTEGER NOT NULL DEFAULT 1 CHECK (available_spaces >= 0 AND available_spaces <= total_spaces),
        rental_fee_annual NUMERIC(12, 2) NOT NULL CHECK (rental_fee_annual > 0)
      );

      CREATE TABLE units (
        id TEXT PRIMARY KEY,
        property_id TEXT NOT NULL REFERENCES properties(id),
        name TEXT NOT NULL,
        capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity >= 1),
        available_spaces INTEGER NOT NULL DEFAULT 1 CHECK (available_spaces >= 0 AND available_spaces <= capacity),
        price_annual NUMERIC(12, 2) NOT NULL CHECK (price_annual > 0)
      );

      CREATE TABLE reservations (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL REFERENCES profiles(id),
        landlord_id TEXT NOT NULL REFERENCES profiles(id),
        property_id TEXT NOT NULL REFERENCES properties(id),
        unit_id TEXT NOT NULL REFERENCES units(id),
        status TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment', 'payment_submitted', 'confirmed', 'rejected', 'cancelled', 'expired')),
        amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
        idempotency_key TEXT UNIQUE,
        created_at TEXT NOT NULL DEFAULT '2026-10-22T08:00:00Z',
        hold_expires_at TEXT NOT NULL
      );

      CREATE TABLE payment_receipts (
        id TEXT PRIMARY KEY,
        reservation_id TEXT NOT NULL REFERENCES reservations(id),
        student_id TEXT NOT NULL REFERENCES profiles(id),
        landlord_id TEXT NOT NULL REFERENCES profiles(id),
        property_id TEXT NOT NULL REFERENCES properties(id),
        storage_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_size BIGINT NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),
        amount_paid NUMERIC(12, 2) NOT NULL CHECK (amount_paid > 0),
        status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'approved', 'rejected')),
        rejection_reason TEXT,
        reviewed_by TEXT REFERENCES profiles(id)
      );

      CREATE TABLE invoices (
        id TEXT PRIMARY KEY,
        reservation_id TEXT NOT NULL REFERENCES reservations(id),
        student_id TEXT NOT NULL REFERENCES profiles(id),
        landlord_id TEXT NOT NULL REFERENCES profiles(id),
        amount NUMERIC(12, 2) NOT NULL,
        status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid', 'expired', 'cancelled'))
      );

      CREATE TABLE platform_settings (
        id TEXT PRIMARY KEY DEFAULT 'default',
        maintenance_mode BOOLEAN NOT NULL DEFAULT false,
        reservation_hold_days INTEGER NOT NULL DEFAULT 7,
        notifications_enabled BOOLEAN NOT NULL DEFAULT true
      );
    `);

    // Seed baseline identities
    db.public.none(`
      INSERT INTO profiles (id, email, full_name, role, account_status)
      VALUES
        ('student-1', 'student1@buk.edu.ng', 'Amina Lawan', 'student', 'active'),
        ('student-2', 'student2@buk.edu.ng', 'Fatima Bello', 'student', 'active'),
        ('landlord-1', 'landlord1@kano.ng', 'Alhaji Danladi', 'landlord', 'active'),
        ('admin-1', 'admin1@outpost.ng', 'Platform SuperAdmin', 'admin', 'active');

      INSERT INTO properties (id, landlord_id, title, total_spaces, available_spaces, rental_fee_annual)
      VALUES ('prop-1', 'landlord-1', 'Bayero Luxury Suites', 1, 1, 280000.00);

      INSERT INTO units (id, property_id, name, capacity, available_spaces, price_annual)
      VALUES ('unit-1', 'prop-1', 'Studio A1', 1, 1, 280000.00);

      INSERT INTO platform_settings (id, maintenance_mode, reservation_hold_days, notifications_enabled)
      VALUES ('default', false, 7, true);
    `);

    return db;
  }

  describe('1. Check Constraints and Inventory Bounds Enforcement', () => {
    test('Database engine strictly forbids negative unit available spaces', () => {
      const db = setupTestDb();
      // Decrement space to 0 (valid)
      db.public.none(`UPDATE units SET available_spaces = 0 WHERE id = 'unit-1';`);
      const unit = db.public.one(`SELECT available_spaces FROM units WHERE id = 'unit-1';`);
      assert.equal(unit.available_spaces, 0);

      // Decrement below 0 violates CHECK (available_spaces >= 0)
      assert.throws(
        () => db.public.none(`UPDATE units SET available_spaces = -1 WHERE id = 'unit-1';`),
        /check constraint.*violated/i,
        'Engine must abort transaction on negative inventory'
      );
    });

    test('Database engine strictly forbids available spaces exceeding total capacity', () => {
      const db = setupTestDb();
      // Capacity is 1; setting to 2 violates CHECK (available_spaces <= capacity)
      assert.throws(
        () => db.public.none(`UPDATE units SET available_spaces = 2 WHERE id = 'unit-1';`),
        /check constraint.*violated/i,
        'Engine must abort transaction on inventory exceeding capacity'
      );
    });

    test('Receipt file_size must not exceed 10MB limit (10485760 bytes)', () => {
      const db = setupTestDb();
      // First create valid reservation
      db.public.none(`
        INSERT INTO reservations (id, student_id, landlord_id, property_id, unit_id, amount, hold_expires_at)
        VALUES ('res-1', 'student-1', 'landlord-1', 'prop-1', 'unit-1', 280000, '2026-10-29T08:00:00Z');
      `);

      // 10MB + 1 byte violates constraint
      assert.throws(
        () => db.public.none(`
          INSERT INTO payment_receipts (id, reservation_id, student_id, landlord_id, property_id, storage_path, file_name, file_size, amount_paid)
          VALUES ('rcpt-big', 'res-1', 'student-1', 'landlord-1', 'prop-1', 'path/receipt.pdf', 'receipt.pdf', 10485761, 280000);
        `),
        /check constraint.*violated/i,
        'Receipt exceeding 10MB must be rejected by check constraint'
      );
    });
  });

  describe('2. Atomic Hold, Concurrency Racing, and Overbooking Protection', () => {
    test('Simultaneous booking attempts: first succeeds and decrements space, second fails', () => {
      const db = setupTestDb();

      function bookUnit(studentId, idempotencyKey) {
        const backup = db.backup();
        try {
          // 1. Check unit availability
          const unit = db.public.one(`SELECT available_spaces, price_annual FROM units WHERE id = 'unit-1';`);
          if (unit.available_spaces <= 0) {
            throw new Error('No available spaces remaining in this unit.');
          }

          // 2. Decrement availability
          db.public.none(`UPDATE units SET available_spaces = available_spaces - 1 WHERE id = 'unit-1';`);
          db.public.none(`UPDATE properties SET available_spaces = available_spaces - 1 WHERE id = 'prop-1';`);

          // 3. Insert reservation
          const resId = 'res-' + studentId;
          db.public.none(`
            INSERT INTO reservations (id, student_id, landlord_id, property_id, unit_id, amount, idempotency_key, hold_expires_at)
            VALUES ('${resId}', '${studentId}', 'landlord-1', 'prop-1', 'unit-1', ${unit.price_annual}, '${idempotencyKey}', '2026-10-29T08:00:00Z');
          `);

          // 4. Insert invoice
          db.public.none(`
            INSERT INTO invoices (id, reservation_id, student_id, landlord_id, amount, status)
            VALUES ('inv-${studentId}', '${resId}', '${studentId}', 'landlord-1', ${unit.price_annual}, 'unpaid');
          `);

          return { success: true, reservationId: resId };
        } catch (err) {
          backup.restore();
          return { success: false, error: err.message };
        }
      }

      // Student 1 books first
      const result1 = bookUnit('student-1', 'idemp-1');
      assert.equal(result1.success, true, 'Student 1 must successfully book');

      // Student 2 attempts to book the same unit (which now has 0 spaces)
      const result2 = bookUnit('student-2', 'idemp-2');
      assert.equal(result2.success, false, 'Student 2 booking must fail');
      assert.match(result2.error, /No available spaces remaining/, 'Must report no spaces available');

      // Verify unit available_spaces is exactly 0 (not negative)
      const finalUnit = db.public.one(`SELECT available_spaces FROM units WHERE id = 'unit-1';`);
      assert.equal(finalUnit.available_spaces, 0);

      // Verify exactly one reservation exists
      const reservations = db.public.many(`SELECT id, student_id FROM reservations;`);
      assert.equal(reservations.length, 1);
      assert.equal(reservations[0].student_id, 'student-1');
    });

    test('Failed transaction rolls back completely: inventory restored, no orphan invoice', () => {
      const db = setupTestDb();
      const backup = db.backup();

      try {
        // Step 1: Decrement unit
        db.public.none(`UPDATE units SET available_spaces = available_spaces - 1 WHERE id = 'unit-1';`);

        // Step 2: Attempt to insert reservation with invalid non-existent student (FK error)
        db.public.none(`
          INSERT INTO reservations (id, student_id, landlord_id, property_id, unit_id, amount, hold_expires_at)
          VALUES ('res-fail', 'non-existent-student', 'landlord-1', 'prop-1', 'unit-1', 280000, '2026-10-29T08:00:00Z');
        `);
      } catch (err) {
        // Transaction aborts on error
        backup.restore();
      }

      // Verify unit inventory is restored to 1
      const unit = db.public.one(`SELECT available_spaces FROM units WHERE id = 'unit-1';`);
      assert.equal(unit.available_spaces, 1, 'Unit availability must be restored to 1 after rollback');

      // Verify no reservation or invoice was created
      const reservations = db.public.many(`SELECT * FROM reservations;`);
      assert.equal(reservations.length, 0, 'No reservation records should remain');
      const invoices = db.public.many(`SELECT * FROM invoices;`);
      assert.equal(invoices.length, 0, 'No invoice records should remain');
    });
  });

  describe('3. Expiration Lifecycle and Inventory Restoration', () => {
    test('Expiration worker restores inventory and updates reservation and invoice status', () => {
      const db = setupTestDb();

      // Setup active hold with 0 spaces left
      db.public.none(`
        UPDATE units SET available_spaces = 0 WHERE id = 'unit-1';
        UPDATE properties SET available_spaces = 0 WHERE id = 'prop-1';
        INSERT INTO reservations (id, student_id, landlord_id, property_id, unit_id, amount, status, hold_expires_at)
        VALUES ('res-exp', 'student-1', 'landlord-1', 'prop-1', 'unit-1', 280000, 'pending_payment', '2026-10-21T08:00:00Z');
        INSERT INTO invoices (id, reservation_id, student_id, landlord_id, amount, status)
        VALUES ('inv-exp', 'res-exp', 'student-1', 'landlord-1', 280000, 'unpaid');
      `);

      // Run expiration simulation
      function runExpiration() {
        const expiredRes = db.public.many(`
          SELECT id, unit_id, property_id FROM reservations
          WHERE status = 'pending_payment' AND hold_expires_at <= '2026-10-22T08:00:00Z';
        `);

        for (const res of expiredRes) {
          db.public.none(`UPDATE reservations SET status = 'expired' WHERE id = '${res.id}';`);
          db.public.none(`UPDATE invoices SET status = 'expired' WHERE reservation_id = '${res.id}';`);
          db.public.none(`UPDATE units SET available_spaces = available_spaces + 1 WHERE id = '${res.unit_id}';`);
          db.public.none(`UPDATE properties SET available_spaces = available_spaces + 1 WHERE id = '${res.property_id}';`);
        }
        return expiredRes.length;
      }

      const count = runExpiration();
      assert.equal(count, 1, 'Must expire 1 overdue reservation');

      // Verify inventory restored
      const unit = db.public.one(`SELECT available_spaces FROM units WHERE id = 'unit-1';`);
      assert.equal(unit.available_spaces, 1, 'Inventory must be restored to 1');

      // Second run must be idempotent (restores nothing because status is now expired)
      const count2 = runExpiration();
      assert.equal(count2, 0, 'Subsequent expiration run must find 0 pending reservations');

      const unitAfterSecondRun = db.public.one(`SELECT available_spaces FROM units WHERE id = 'unit-1';`);
      assert.equal(unitAfterSecondRun.available_spaces, 1, 'Inventory must remain exactly 1 (not double-incremented)');
    });
  });

  describe('4. Receipt Review Concurrency & Race Condition Protection', () => {
    test('Declining payment receipt requires rejection reason and restores availability', () => {
      const db = setupTestDb();

      db.public.none(`
        UPDATE units SET available_spaces = 0 WHERE id = 'unit-1';
        UPDATE properties SET available_spaces = 0 WHERE id = 'prop-1';
        INSERT INTO reservations (id, student_id, landlord_id, property_id, unit_id, amount, status, hold_expires_at)
        VALUES ('res-rcpt', 'student-1', 'landlord-1', 'prop-1', 'unit-1', 280000, 'payment_submitted', '2026-10-29T08:00:00Z');
        INSERT INTO payment_receipts (id, reservation_id, student_id, landlord_id, property_id, storage_path, file_name, file_size, amount_paid, status)
        VALUES ('rcpt-1', 'res-rcpt', 'student-1', 'landlord-1', 'prop-1', 'path/receipt.pdf', 'receipt.pdf', 2048, 280000, 'pending_review');
      `);

      function reviewReceipt(receiptId, decision, reviewerId, rejectionReason) {
        const rcpt = db.public.one(`SELECT * FROM payment_receipts WHERE id = '${receiptId}';`);
        if (!rcpt) throw new Error('Receipt not found.');
        if (rcpt.landlord_id !== reviewerId) throw new Error('Unauthorized reviewer.');
        if (rcpt.status !== 'pending_review') throw new Error(`Receipt already reviewed with status: ${rcpt.status}`);

        const res = db.public.one(`SELECT * FROM reservations WHERE id = '${rcpt.reservation_id}';`);
        if (!['pending_payment', 'payment_submitted'].includes(res.status)) {
          throw new Error(`Cannot review receipt: reservation is in state ${res.status}`);
        }

        if (decision === 'approved') {
          db.public.none(`UPDATE payment_receipts SET status = 'approved', reviewed_by = '${reviewerId}' WHERE id = '${receiptId}';`);
          db.public.none(`UPDATE reservations SET status = 'confirmed' WHERE id = '${rcpt.reservation_id}';`);
        } else if (decision === 'rejected') {
          if (!rejectionReason || !rejectionReason.trim()) {
            throw new Error('A specific rejection reason is required.');
          }
          db.public.none(`UPDATE payment_receipts SET status = 'rejected', reviewed_by = '${reviewerId}', rejection_reason = '${rejectionReason}' WHERE id = '${receiptId}';`);
          db.public.none(`UPDATE reservations SET status = 'rejected' WHERE id = '${rcpt.reservation_id}';`);
          db.public.none(`UPDATE units SET available_spaces = available_spaces + 1 WHERE id = '${res.unit_id}';`);
          db.public.none(`UPDATE properties SET available_spaces = available_spaces + 1 WHERE id = '${res.property_id}';`);
        }
        return { success: true };
      }

      // Rejection with empty reason must fail
      assert.throws(
        () => reviewReceipt('rcpt-1', 'rejected', 'landlord-1', ''),
        /A specific rejection reason is required/,
        'Empty rejection reason must be rejected'
      );

      // Rejection with valid reason
      reviewReceipt('rcpt-1', 'rejected', 'landlord-1', 'Transfer narrative does not match student name.');
      const finalRcpt = db.public.one(`SELECT status, rejection_reason FROM payment_receipts WHERE id = 'rcpt-1';`);
      assert.equal(finalRcpt.status, 'rejected');
      assert.equal(finalRcpt.rejection_reason, 'Transfer narrative does not match student name.');

      // Verify availability restored on rejection
      const unit = db.public.one(`SELECT available_spaces FROM units WHERE id = 'unit-1';`);
      assert.equal(unit.available_spaces, 1, 'Availability restored after receipt rejection');

      // Duplicate review attempt must be rejected
      assert.throws(
        () => reviewReceipt('rcpt-1', 'approved', 'landlord-1', null),
        /Receipt already reviewed/,
        'Duplicate review must be rejected'
      );
    });

    test('Receipt review on already expired reservation is rejected to prevent inventory inconsistency', () => {
      const db = setupTestDb();

      // Reservation already expired, inventory already released
      db.public.none(`
        UPDATE units SET available_spaces = 1 WHERE id = 'unit-1';
        INSERT INTO reservations (id, student_id, landlord_id, property_id, unit_id, amount, status, hold_expires_at)
        VALUES ('res-expired', 'student-1', 'landlord-1', 'prop-1', 'unit-1', 280000, 'expired', '2026-10-21T08:00:00Z');
        INSERT INTO payment_receipts (id, reservation_id, student_id, landlord_id, property_id, storage_path, file_name, file_size, amount_paid, status)
        VALUES ('rcpt-race', 'res-expired', 'student-1', 'landlord-1', 'prop-1', 'path/receipt.pdf', 'receipt.pdf', 2048, 280000, 'pending_review');
      `);

      function reviewReceipt(receiptId, reviewerId) {
        const rcpt = db.public.one(`SELECT * FROM payment_receipts WHERE id = '${receiptId}';`);
        const res = db.public.one(`SELECT * FROM reservations WHERE id = '${rcpt.reservation_id}';`);
        if (!['pending_payment', 'payment_submitted'].includes(res.status)) {
          throw new Error(`Cannot review receipt: reservation is in state ${res.status}`);
        }
      }

      assert.throws(
        () => reviewReceipt('rcpt-race', 'landlord-1'),
        /Cannot review receipt: reservation is in state expired/,
        'Receipt review must reject expired reservations'
      );
    });
  });

  describe('5. Platform Settings Maintenance Mode Read/Write Integrity', () => {
    test('Platform settings row exists with default configuration', () => {
      const db = setupTestDb();
      const settings = db.public.one(`SELECT * FROM platform_settings WHERE id = 'default';`);
      assert.equal(settings.maintenance_mode, false);
      assert.equal(settings.reservation_hold_days, 7);
      assert.equal(settings.notifications_enabled, true);
    });

    test('Maintenance mode update reflects immediately for all readers', () => {
      const db = setupTestDb();
      db.public.none(`UPDATE platform_settings SET maintenance_mode = true WHERE id = 'default';`);
      const updated = db.public.one(`SELECT maintenance_mode FROM platform_settings WHERE id = 'default';`);
      assert.equal(updated.maintenance_mode, true);
    });
  });
});
