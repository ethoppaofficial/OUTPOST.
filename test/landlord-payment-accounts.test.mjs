import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  maskAccountNumber,
  validateLandlordPaymentDetails,
  normalizeBankAccountNumber,
} from '../src/application/utils/validation.ts';
import { paymentAccountService } from '../src/application/services/paymentAccountService.ts';
import { reservationService } from '../src/application/services/reservationService.ts';
import { repository } from '../src/infrastructure/repositories/index.ts';
import { createAdminService } from '../src/application/services/adminService.ts';

const read = (relPath) => fs.readFileSync(path.resolve(relPath), 'utf8');

function createMockAdminSupabaseClient({
  authUser = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'admin@outpost.ng' },
  tables = {},
} = {}) {
  return {
    auth: {
      async getUser() {
        return { data: { user: authUser }, error: null };
      },
    },
    from(tableName) {
      const filters = [];
      const builder = {
        select() {
          return builder;
        },
        eq(col, val) {
          filters.push((row) => row?.[col] === val);
          return builder;
        },
        in(col, vals) {
          filters.push((row) => Array.isArray(vals) && vals.includes(row?.[col]));
          return builder;
        },
        order() {
          return builder;
        },
        async maybeSingle() {
          const rows = Array.isArray(tables[tableName]) ? tables[tableName] : [];
          const matched = rows.filter((row) => filters.every((fn) => fn(row)));
          return { data: matched[0] ?? null, error: null };
        },
        then(resolve) {
          const rows = Array.isArray(tables[tableName]) ? tables[tableName] : [];
          const matched = rows.filter((row) => filters.every((fn) => fn(row)));
          resolve({ data: matched, error: null });
        },
      };
      return builder;
    },
  };
}

describe('OUTPOST: Landlord Payment Account Details & Student Payment Integration', () => {
  describe('1. Migration 10 Schema, Constraints, RLS & Snapshot Integrity', () => {
    const m10 = read('supabase/migrations/20261114000010_landlord_payment_accounts.sql');

    test('Preserves existing migrations 01-09 and introduces Migration 10', () => {
      const files = fs.readdirSync(path.resolve('supabase/migrations')).sort();
      assert.ok(files.some((f) => f.startsWith('20261113000009')), 'Migration 09 must exist');
      assert.ok(files.some((f) => f.startsWith('20261114000010')), 'Migration 10 must exist');
    });

    test('Defines landlord_payment_accounts with FK, Nigerian format CHECK, and one-active-account index', () => {
      assert.match(m10, /CREATE TABLE IF NOT EXISTS public\.landlord_payment_accounts/i);
      assert.match(m10, /landlord_id UUID NOT NULL REFERENCES public\.profiles\(id\) ON DELETE CASCADE/i);
      assert.match(m10, /account_number ~ '\^\[0-9\]\{10,12\}\$'/i);
      assert.match(m10, /account_type IN \('savings', 'current', 'corporate'\)/i);
      assert.match(m10, /CREATE UNIQUE INDEX IF NOT EXISTS uq_landlord_payment_accounts_one_active[\s\S]*WHERE \(is_active = true\)/i);
      assert.match(m10, /CREATE TRIGGER tr_landlord_payment_accounts_updated_at/i);
      assert.match(m10, /CREATE TRIGGER tr_landlord_payment_accounts_normalize/i);
    });

    test('Enforces strict RLS on landlord_payment_accounts (landlord own R/W, admin read-only, student scoped)', () => {
      assert.match(m10, /ALTER TABLE public\.landlord_payment_accounts ENABLE ROW LEVEL SECURITY/i);
      assert.match(m10, /ALTER TABLE public\.landlord_payment_accounts FORCE ROW LEVEL SECURITY/i);

      // Landlords manage only their own rows
      assert.match(m10, /CREATE POLICY "Landlords read own payment accounts"[\s\S]*auth\.uid\(\) = landlord_id AND public\.is_landlord\(\)/i);
      assert.match(m10, /CREATE POLICY "Landlords insert own payment account"[\s\S]*auth\.uid\(\) = landlord_id AND public\.is_landlord\(\)/i);
      assert.match(m10, /CREATE POLICY "Landlords update own payment account"[\s\S]*auth\.uid\(\) = landlord_id AND public\.is_landlord\(\)/i);

      // Admin strictly SELECT only — zero INSERT/UPDATE/DELETE policies for admins
      assert.match(m10, /CREATE POLICY "Admins read landlord payment accounts"\s+ON public\.landlord_payment_accounts FOR SELECT/i);
      assert.doesNotMatch(m10, /ON public\.landlord_payment_accounts FOR (INSERT|UPDATE|DELETE|ALL)[^;]*public\.is_admin\(\)/i);

      // Student SELECT restricted strictly to active accounts for their own eligible reservations
      assert.match(
        m10,
        /CREATE POLICY "Students read active payment account for eligible reservation"[\s\S]*is_active = true[\s\S]*r\.landlord_id = landlord_payment_accounts\.landlord_id[\s\S]*r\.student_id = auth\.uid\(\)/i
      );
    });

    test('Adds payment_account_snapshot to invoices, updates create_reservation_atomic, and masks audit logs', () => {
      assert.match(m10, /ALTER TABLE public\.invoices\s+ADD COLUMN IF NOT EXISTS payment_account_snapshot JSONB/i);
      assert.match(m10, /CREATE OR REPLACE FUNCTION public\.create_reservation_atomic\(/i);
      assert.match(m10, /INSERT INTO public\.invoices\s*\([\s\S]*payment_account_snapshot/i);
      assert.match(m10, /CREATE OR REPLACE FUNCTION public\.upsert_landlord_payment_account\(/i);
      assert.match(m10, /'masked_account_number',\s*'\*\*\*\*\*\*' \|\| right\(v_saved\.account_number, 4\)/i);
      assert.match(m10, /CREATE OR REPLACE FUNCTION public\.get_reservation_payment_details\(/i);
    });
  });

  describe('2. Nigerian Bank Account Validation, Normalization & Masking', () => {
    test('Normalizes whitespace and strips spaces/hyphens from 10-digit NUBAN & 11-12 digit accounts', () => {
      const valid10 = validateLandlordPaymentDetails({
        accountHolderName: '  Alhaji   Danladi  Properties  ',
        bankName: '  Guaranty Trust Bank (GTBank) ',
        accountNumber: ' 0123-456 789 ',
        accountType: 'current',
        paymentInstructions: '  Use invoice number in narration.  ',
      });
      assert.equal(valid10.isValid, true);
      assert.equal(valid10.normalized.accountHolderName, 'Alhaji Danladi Properties');
      assert.equal(valid10.normalized.bankName, 'Guaranty Trust Bank (GTBank)');
      assert.equal(valid10.normalized.accountNumber, '0123456789');
      assert.equal(valid10.normalized.accountType, 'current');
      assert.equal(valid10.normalized.paymentInstructions, 'Use invoice number in narration.');

      const valid11 = validateLandlordPaymentDetails({
        accountHolderName: 'Rimin Gata Ventures',
        bankName: 'Community Microfinance Bank',
        accountNumber: '12345678901',
      });
      assert.equal(valid11.isValid, true);
      assert.equal(valid11.normalized.accountNumber, '12345678901');
    });

    test('Rejects invalid formats without exposing raw account number inside error messages', () => {
      const badShort = validateLandlordPaymentDetails({
        accountHolderName: 'Amina Hostel',
        bankName: 'Zenith Bank',
        accountNumber: '123456',
      });
      assert.equal(badShort.isValid, false);
      assert.ok(badShort.fieldErrors.accountNumber);
      assert.ok(!badShort.error?.includes('123456'), 'Error message must not echo raw account number');

      const badChars = validateLandlordPaymentDetails({
        accountHolderName: 'Amina Hostel',
        bankName: 'Zenith Bank',
        accountNumber: '01234ABCD9',
      });
      assert.equal(badChars.isValid, false);
      assert.ok(!badChars.error?.includes('01234ABCD9'), 'Error message must not echo invalid account input');

      const missingRequired = validateLandlordPaymentDetails({
        accountHolderName: '',
        bankName: '',
        accountNumber: '',
      });
      assert.equal(missingRequired.isValid, false);
      assert.ok(missingRequired.fieldErrors.accountHolderName);
      assert.ok(missingRequired.fieldErrors.bankName);
      assert.ok(missingRequired.fieldErrors.accountNumber);
    });

    test('Masks account numbers cleanly preserving only last 4 digits', () => {
      assert.equal(maskAccountNumber('0123456789'), '••••••6789');
      assert.equal(maskAccountNumber(''), 'Not configured');
      assert.equal(normalizeBankAccountNumber(' 012-345 6789 '), '0123456789');
    });
  });

  describe('3. Landlord Upsert, Historical Invoice Snapshot Preservation & Student Retrieval', () => {
    test('Landlord can save & update payment details without duplicates while historical invoices preserve original snapshot', async () => {
      repository.resetToSeed();
      const landlordId = 'local-landlord-1';
      const studentId = 'local-student-1';

      // Create property owned by landlord-1
      const createdProp = repository.createProperty({
        landlordId,
        landlordName: 'Alhaji Danladi',
        landlordVerified: true,
        title: 'Danladi Prestige Suites',
        description: 'Secure student rooms in Dambare.',
        propertyType: 'Hostel',
        accommodationType: 'Single Room',
        genderPolicy: 'Mixed',
        address: 'Plot 12 Dambare Road',
        city: 'Kano',
        neighbourhood: 'Dambare',
        campus: 'New Campus',
        university: 'Bayero University Kano',
        distanceKm: 0.6,
        pricePerSession: 240000,
        billingPeriod: 'Academic Session (1 Year)',
        depositAmount: 20000,
        utilitiesIncluded: true,
        amenities: ['WiFi'],
        houseRules: ['Quiet hours after 10pm'],
        images: ['https://example.com/room.jpg'],
        totalCapacity: 2,
        availableSpaces: 2,
        rooms: [
          {
            id: 'unit-101',
            propertyId: 'temp',
            name: 'Room A1',
            type: 'Single',
            totalCapacity: 2,
            availableSpaces: 2,
            pricePerSession: 240000,
          },
        ],
      });

      // Step 1: Unconfigured initially -> reservation creates invoice without fake bank details
      const earlyRes = reservationService.createReservation(studentId, createdProp.id, 'unit-101');
      assert.equal(earlyRes.success, true);
      assert.equal(earlyRes.invoice?.bankDetails.bankName, '');
      assert.equal(earlyRes.invoice?.bankDetails.accountNumber, '');
      assert.equal(earlyRes.invoice?.bankDetails.configured, false);

      // Step 2: Landlord saves initial active bank details
      const firstSave = await paymentAccountService.saveMyPaymentAccount(landlordId, {
        accountHolderName: 'Danladi Properties Ltd',
        bankName: 'Zenith Bank',
        accountNumber: '1012345678',
        accountType: 'corporate',
        paymentInstructions: 'Quote reservation ref in transfer narration.',
      });
      assert.equal(firstSave.success, true);
      assert.equal(firstSave.account?.accountNumber, '1012345678');

      // Step 3: Student places a reservation after landlord configured details -> invoice snapshots Bank #1
      const snapshotRes = reservationService.createReservation(studentId, createdProp.id, 'unit-101');
      assert.equal(snapshotRes.success, true);
      assert.equal(snapshotRes.invoice?.bankDetails.configured, true);
      assert.equal(snapshotRes.invoice?.bankDetails.bankName, 'Zenith Bank');
      assert.equal(snapshotRes.invoice?.bankDetails.accountNumber, '1012345678');
      assert.equal(snapshotRes.invoice?.bankDetails.accountType, 'corporate');
      assert.equal(snapshotRes.invoice?.bankDetails.source, 'snapshot');

      // Step 4: Landlord updates payment account to Bank #2 (same landlord, single active account)
      const secondSave = await paymentAccountService.saveMyPaymentAccount(landlordId, {
        accountHolderName: 'Danladi Properties Ltd',
        bankName: 'Guaranty Trust Bank (GTBank)',
        accountNumber: '0987654321',
        accountType: 'current',
        paymentInstructions: 'Updated account instructions.',
      });
      assert.equal(secondSave.success, true);
      assert.equal(paymentAccountService.getCachedPaymentAccount(landlordId)?.accountNumber, '0987654321');

      // Previously issued invoice STILL preserves Bank #1 snapshot cleanly
      const preserved = await paymentAccountService.resolvePaymentDetailsForReservation(
        snapshotRes.reservation.id,
        snapshotRes.invoice
      );
      assert.equal(preserved.configured, true);
      assert.equal(preserved.bankName, 'Zenith Bank');
      assert.equal(preserved.accountNumber, '1012345678');
      assert.equal(preserved.source, 'snapshot');

      // Earlier unpaid reservation created before any account existed resolves active Bank #2 once configured
      const resolvedEarly = await paymentAccountService.resolvePaymentDetailsForReservation(
        earlyRes.reservation.id,
        earlyRes.invoice
      );
      assert.equal(resolvedEarly.configured, true);
      assert.equal(resolvedEarly.bankName, 'Guaranty Trust Bank (GTBank)');
      assert.equal(resolvedEarly.accountNumber, '0987654321');
      assert.equal(resolvedEarly.source, 'active_account');
    });
  });

  describe('4. Repository Schema Alignment & UI Safety', () => {
    const repoSrc = read('src/infrastructure/supabase/supabaseRepository.ts');
    const landlordSectionSrc = read('src/components/landlord/PaymentAccountDetailsSection.tsx');
    const resDetailSrc = read('src/pages/student/ReservationDetailPage.tsx');
    const invoicePageSrc = read('src/pages/student/InvoicePage.tsx');
    const usersPageSrc = read('src/pages/admin/UsersPage.tsx');

    test('supabaseRepository queries canonical invoice & receipt columns and never exposes broad landlord_profiles bank columns', () => {
      assert.doesNotMatch(repoSrc, /invoices\s*\([^)]*amount_due/i);
      assert.doesNotMatch(repoSrc, /invoices\s*\([^)]*due_at/i);
      assert.doesNotMatch(repoSrc, /landlord_profiles[^;]*bank_account_number/i);
      assert.match(repoSrc, /payment_account_snapshot/);
      assert.match(repoSrc, /upsert_landlord_payment_account/);
      assert.match(repoSrc, /get_reservation_payment_details/);
    });

    test('Landlord form never asks for sensitive credentials (PIN, password, OTP, CVV, card)', () => {
      assert.match(landlordSectionSrc, /Payment Account Details/);
      assert.match(landlordSectionSrc, /maskAccountNumber/);
      assert.match(landlordSectionSrc, /Reveal account number/);
      assert.match(landlordSectionSrc, /Never share a PIN, password, OTP, card number, or CVV/);
      assert.doesNotMatch(landlordSectionSrc, /<input[^>]*type=["']password["']/i);
      assert.doesNotMatch(
        landlordSectionSrc,
        /<label[\s\S]{0,160}>[\s\S]{0,80}\b(bank\s*pin|password|otp|cvv|card\s*number)\b/i
      );
    });

    test('Student payment pages remove fake fallback strings and include Copy Account Number + verification warning', () => {
      assert.doesNotMatch(invoicePageSrc, /['"`]Direct Landlord Bank['"`]/);
      assert.doesNotMatch(invoicePageSrc, /['"`]Contact Landlord['"`]/);
      assert.match(invoicePageSrc, /Payment Account Not Yet Configured/);
      assert.match(invoicePageSrc, /handleCopyAccountNumber/);
      assert.match(resDetailSrc, /handleCopyText/);
      assert.match(resDetailSrc, /Verify that the beneficiary name/);
    });

    test('Admin profile inspection returns masked read-only payment summary without edit controls', async () => {
      const mockClient = createMockAdminSupabaseClient({
        tables: {
          profiles: [
            {
              id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              email: 'admin@outpost.ng',
              full_name: 'Super Admin',
              role: 'admin',
              account_status: 'active',
            },
            {
              id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              email: 'host@outpost.ng',
              full_name: 'Host Landlord',
              role: 'landlord',
              account_status: 'active',
            },
          ],
          landlord_profiles: [
            {
              id: 'lp-1',
              user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              company_name: 'Danbare Suites',
              verification_status: 'approved',
            },
          ],
          landlord_payment_accounts: [
            {
              id: 'lpa-1',
              landlord_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              account_holder_name: 'Danbare Suites Ltd',
              bank_name: 'Zenith Bank',
              account_number: '2012349876',
              account_type: 'corporate',
              is_active: true,
              updated_at: '2026-11-13T10:00:00Z',
            },
          ],
          landlord_verification_submissions: [],
          properties: [],
          reservations: [],
        },
      });

      const svc = createAdminService({ client: mockClient });
      const details = await svc.getUserProfileDetails('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
      assert.equal(details.landlordPaymentAccount?.configured, true);
      assert.equal(details.landlordPaymentAccount?.bankName, 'Zenith Bank');
      assert.equal(details.landlordPaymentAccount?.maskedAccountNumber, '••••••9876');
      assert.ok(!JSON.stringify(details.landlordPaymentAccount).includes('2012349876'));
      assert.match(usersPageSrc, /Payment Account Status/);
    });
  });
});
