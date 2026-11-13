import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  createAdminService,
  AdminServiceError,
} from '../src/application/services/adminService.ts';

function createMockSupabaseClient({
  authUser = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'admin@outpost.ng' },
  tables = {},
  tableErrors = {},
  rpcHandlers = {},
} = {}) {
  return {
    auth: {
      async getUser() {
        return { data: { user: authUser }, error: null };
      },
    },
    from(tableName) {
      const filters = [];
      let selectOpts = {};

      const execute = () => {
        if (tableErrors[tableName]) {
          return { data: null, count: null, error: tableErrors[tableName] };
        }
        const rows = Array.isArray(tables[tableName]) ? tables[tableName] : [];
        const matched = rows.filter((row) => filters.every((fn) => fn(row)));
        if (selectOpts?.head) {
          return { data: null, count: matched.length, error: null };
        }
        return { data: matched, count: matched.length, error: null };
      };

      const builder = {
        select(_cols = '*', opts = {}) {
          selectOpts = opts;
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
        gt(col, val) {
          filters.push((row) => String(row?.[col] ?? '') > String(val));
          return builder;
        },
        lte(col, val) {
          filters.push((row) => String(row?.[col] ?? '') <= String(val));
          return builder;
        },
        async maybeSingle() {
          const res = execute();
          if (res.error) return { data: null, error: res.error };
          return { data: res.data?.[0] ?? null, error: null };
        },
        async single() {
          const res = execute();
          if (res.error) return { data: null, error: res.error };
          return { data: res.data?.[0] ?? null, error: null };
        },
        then(resolve, reject) {
          try {
            resolve(execute());
          } catch (err) {
            if (reject) reject(err);
          }
        },
      };

      return builder;
    },
    async rpc(fnName, params) {
      if (rpcHandlers[fnName]) return rpcHandlers[fnName](params);
      return { data: null, error: { code: 'PGRST202', message: `Missing RPC ${fnName}` } };
    },
  };
}

describe('OUTPOST: Corrective Migration 09 & End-to-End Upload Integrity Suite', () => {
  const read = (rel) => fs.readFileSync(path.resolve(rel), 'utf8');

  describe('1. Migration Preservation & Corrective Migration 09', () => {
    test('Existing migrations 01 through 08 are preserved and Migration 09 exists', () => {
      const migrationFiles = fs.readdirSync(path.resolve('supabase/migrations')).sort();
      for (const prefix of [
        '20261020000001',
        '20261020000002',
        '20261020000003',
        '20261020000004',
        '20261020000005',
        '20261020000006',
        '20261112000007',
        '20261112000008',
        '20261113000009',
      ]) {
        assert.ok(
          migrationFiles.some((f) => f.startsWith(prefix)),
          `Expected migration starting with ${prefix} to exist`
        );
      }
    });

    test('Migration 09 idempotently reconciles schema drift, 19-metric RPC, 6 buckets, triggers, and atomic cancel RPC', () => {
      const m09 = read('supabase/migrations/20261113000009_corrective_schema_sync_and_media_integrity.sql');

      // Schema drift & Migration 06/07 reconciliations
      assert.match(m09, /ADD COLUMN IF NOT EXISTS tax_id TEXT/i);
      assert.match(m09, /CREATE OR REPLACE FUNCTION public\.handle_new_user\(\)/i);
      assert.match(m09, /CREATE TRIGGER on_auth_user_created/i);
      assert.match(m09, /CREATE OR REPLACE FUNCTION public\.is_admin\(\)/i);
      assert.match(m09, /CREATE OR REPLACE FUNCTION public\.protect_landlord_profile_immutable_fields\(\)/i);
      assert.match(m09, /CREATE OR REPLACE FUNCTION public\.submit_landlord_verification_submission\(/i);

      // 5 admin governance RPCs from Migration 07
      for (const rpcName of [
        'admin_review_student_verification',
        'admin_review_landlord_verification',
        'admin_review_property',
        'admin_review_property_location',
        'admin_set_user_status',
      ]) {
        assert.match(m09, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${rpcName}\\(`, 'i'));
      }

      // Migration 08 property_images & 19-metric dashboard RPC preserved (not downgraded to 14)
      assert.match(m09, /CREATE TABLE IF NOT EXISTS public\.property_images/i);
      assert.match(m09, /CREATE OR REPLACE FUNCTION public\.admin_get_dashboard_metrics\(\)/i);
      for (const metricKey of [
        "'totalUsers'",
        "'totalNonAdminUsers'",
        "'approvedLandlordVerifications'",
        "'rejectedLandlordVerifications'",
        "'totalProperties'",
        "'approvedProperties'",
        "'activeReservations'",
        "'pendingReceiptVerifications'",
        "'expiredReservations'",
      ]) {
        assert.ok(m09.includes(metricKey), `19-metric RPC must include ${metricKey}`);
      }

      // All 6 Storage buckets reconciled
      for (const bucket of [
        "'student-docs'",
        "'landlord-docs'",
        "'payment-receipts'",
        "'chat-attachments'",
        "'property-images'",
        "'profile-pictures'",
      ]) {
        assert.ok(m09.includes(bucket), `Migration 09 must reconcile Storage bucket ${bucket}`);
      }

      // Trigger guards & atomic reservation cancellation
      assert.match(m09, /CREATE OR REPLACE FUNCTION public\.reject_ephemeral_media_urls\(\)/i);
      assert.match(m09, /tr_properties_reject_ephemeral_urls/i);
      assert.match(m09, /tr_profiles_reject_ephemeral_urls/i);
      assert.match(m09, /CREATE OR REPLACE FUNCTION public\.cancel_reservation_atomic\(/i);
    });
  });

  describe('2. Edge Functions: Metadata Integrity & Orphan Storage Cleanup', () => {
    test('finalize-receipt-upload validates size/amount, resolves invoice_id, and deletes Storage orphan on DB failure', () => {
      const fn = read('supabase/functions/finalize-receipt-upload/index.ts');
      assert.match(fn, /parsedSize <= 0 \|\| parsedSize > 10 \* 1024 \* 1024/, 'Must validate positive file size up to 10MB');
      assert.match(fn, /!Number\.isFinite\(numericAmount\) \|\| numericAmount <= 0/, 'Must validate positive amountPaid');
      assert.match(fn, /\.from\('invoices'\)/, 'Must resolve matching invoice row');
      assert.match(fn, /invoice_id:\s*invoiceRow\?\.id \?\? null/, 'Must persist invoice_id on payment_receipts');
      assert.match(fn, /adminClient\.storage\.from\('payment-receipts'\)\.remove\(\[storagePath\]\)/, 'Must remove orphan payment-receipts file on DB write failure');
      assert.match(fn, /status:\s*'processing'/, 'Must advance linked invoice status to processing');
    });

    test('finalize-chat-attachment-upload validates size and deletes Storage orphan on DB failure', () => {
      const fn = read('supabase/functions/finalize-chat-attachment-upload/index.ts');
      assert.match(fn, /parsedSize <= 0 \|\| parsedSize > 10 \* 1024 \* 1024/, 'Must validate positive file size up to 10MB');
      assert.match(fn, /adminClient\.storage\.from\('chat-attachments'\)\.remove\(\[storagePath\]\)/, 'Must remove orphan chat-attachments file on DB write failure');
    });
  });

  describe('3. Client Storage, Avatar, Property & Reservation Repositories', () => {
    test('ProfileAvatarUploader pairs profile-pictures upload with orphan cleanup & profile refresh', () => {
      const cmp = read('src/components/common/ProfileAvatarUploader.tsx');
      assert.match(cmp, /PROFILE_PICTURE_UPLOAD_RULES/);
      assert.match(cmp, /uploadProfilePicture/);
      assert.match(cmp, /updateUserAvatarPersisted/);
      assert.match(cmp, /deletePublicMediaAsset\('profile-pictures'/);
      assert.match(cmp, /refreshAuthProfile/);
    });

    test('supabaseRepository cleans up property-images orphans, resolves resilient selects, and persists avatars & reservations', () => {
      const repo = read('src/infrastructure/supabase/supabaseRepository.ts');
      assert.match(repo, /PROPERTY_SELECT_WITH_IMAGES/);
      assert.match(repo, /PROPERTY_SELECT_BASE/);
      assert.match(repo, /selectPropertiesResilient/);
      assert.match(repo, /updateUserAvatarPersisted/);
      assert.match(repo, /createPropertyPersisted/);
      assert.match(repo, /deletePublicMediaAsset\('property-images'/);
      assert.match(repo, /createReservationPersisted/);
      assert.match(repo, /cancelReservationPersisted/);
      assert.match(repo, /reviewPaymentReceiptPersisted/);
      assert.doesNotMatch(repo, /3012948571|First Bank Nigeria/, 'Must not hardcode fake bank details in createReservation');
    });

    test('reservationService delegates persisted reservations & receipt uploads without hardcoded student matric fallbacks', () => {
      const svc = read('src/application/services/reservationService.ts');
      assert.match(svc, /loadStudentReservations/);
      assert.match(svc, /loadReservationDetail/);
      assert.match(svc, /loadLandlordReceipts/);
      assert.match(svc, /createReservationPersisted/);
      assert.match(svc, /cancelReservationPersisted/);
      assert.match(svc, /submitPaymentReceiptWithStorage/);
      assert.match(svc, /reviewPaymentReceiptPersisted/);
      assert.doesNotMatch(svc, /STU-2026-4821/, 'Must not hardcode fake student matric number');
    });

    test('UI pages wire live persistence, refresh triggers, signed URLs, ProfileAvatarUploader, and zero Unsplash avatars', () => {
      const roommates = read('src/pages/student/RoommatesPage.tsx');
      const reports = read('src/pages/admin/AdminReportsPage.tsx');
      const propDetail = read('src/pages/public/PropertyDetailPage.tsx');
      const resDetail = read('src/pages/student/ReservationDetailPage.tsx');
      const resList = read('src/pages/student/ReservationsPage.tsx');
      const invoice = read('src/pages/student/InvoicePage.tsx');
      const stuDash = read('src/pages/student/StudentDashboard.tsx');
      const landlordReceipts = read('src/pages/landlord/LandlordReceiptsPage.tsx');
      const manageAvail = read('src/pages/landlord/ManageAvailabilityPage.tsx');

      assert.doesNotMatch(roommates, /images\.unsplash\.com/, 'RoommatesPage must not fall back to Unsplash avatars');
      assert.match(reports, /realtimeTables/, 'AdminReportsPage must subscribe to realtime tables');
      assert.match(propDetail, /createReservationPersisted/, 'PropertyDetailPage must await persisted reservation creation');
      assert.match(resDetail, /submitPaymentReceiptWithStorage/, 'ReservationDetailPage must use Edge-backed receipt submission');
      assert.match(resDetail, /getPrivateAssetDownloadUrl\('payment-receipt'/, 'ReservationDetailPage must inspect private receipts via signed URLs');
      assert.match(resDetail, /cancelReservationPersisted/, 'ReservationDetailPage must persist cancellations');
      assert.match(resList, /loadStudentReservations/, 'ReservationsPage must hydrate from Supabase');
      assert.match(invoice, /loadInvoiceById/, 'InvoicePage must hydrate invoice details from Supabase');
      assert.match(stuDash, /loadStudentReservations/, 'StudentDashboard must hydrate live student reservations');
      assert.match(landlordReceipts, /reviewPaymentReceiptPersisted/, 'LandlordReceiptsPage must persist receipt approvals/rejections');
      assert.match(landlordReceipts, /disabled=\{Boolean\(processingId\)\}/, 'LandlordReceiptsPage must prevent duplicate submission');
      assert.match(manageAvail, /fetchPropertyByIdOrSlug/, 'ManageAvailabilityPage must refresh live property state from Supabase');
      assert.match(manageAvail, /loadLandlordReservations/, 'ManageAvailabilityPage must refresh live landlord holds from Supabase');

      for (const rel of [
        'src/pages/student/StudentVerificationPage.tsx',
        'src/pages/landlord/LandlordVerificationPage.tsx',
        'src/pages/admin/AdminAccountPage.tsx',
      ]) {
        assert.match(read(rel), /ProfileAvatarUploader/, `${rel} must embed ProfileAvatarUploader`);
      }
    });
  });

  describe('4. AdminService Runtime Property Image & RLS Error Behavior', () => {
    test('adminService.getProperties sorts property_images cover-first and filters ephemeral data:/blob: URLs', async () => {
      const client = createMockSupabaseClient({
        tables: {
          profiles: [
            {
              id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              email: 'admin@outpost.ng',
              role: 'admin',
              account_status: 'active',
              full_name: 'Admin User',
            },
          ],
          properties: [
            {
              id: 'prop-1',
              title: 'Danbare Suites',
              approval_status: 'approved',
              is_published: true,
              images: ['data:image/png;base64,bad', 'https://proj.supabase.co/storage/v1/object/public/property-images/legacy.jpg'],
              featured_image_url: 'blob:http://localhost:3000/ephemeral',
              created_at: '2026-11-12T10:00:00.000Z',
            },
          ],
          property_images: [
            {
              property_id: 'prop-1',
              public_url: 'https://proj.supabase.co/storage/v1/object/public/property-images/room.jpg',
              is_cover: false,
              sort_order: 2,
            },
            {
              property_id: 'prop-1',
              public_url: 'https://proj.supabase.co/storage/v1/object/public/property-images/cover.jpg',
              is_cover: true,
              sort_order: 1,
            },
            {
              property_id: 'prop-1',
              public_url: 'data:image/jpeg;base64,invalid',
              is_cover: false,
              sort_order: 0,
            },
          ],
        },
      });

      const svc = createAdminService({ client });
      const props = await svc.getProperties();

      assert.equal(props.length, 1);
      assert.deepEqual(props[0].images, [
        'https://proj.supabase.co/storage/v1/object/public/property-images/cover.jpg',
        'https://proj.supabase.co/storage/v1/object/public/property-images/room.jpg',
        'https://proj.supabase.co/storage/v1/object/public/property-images/legacy.jpg',
      ]);
      assert.equal(
        props[0].featuredImageUrl,
        'https://proj.supabase.co/storage/v1/object/public/property-images/cover.jpg'
      );
    });

    test('adminService.getProperties degrades gracefully only when property_images table does not exist (42P01), but throws on RLS denial (42501)', async () => {
      const missingTableClient = createMockSupabaseClient({
        tables: {
          profiles: [
            {
              id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              email: 'admin@outpost.ng',
              role: 'admin',
              account_status: 'active',
              full_name: 'Admin User',
            },
          ],
          properties: [
            {
              id: 'prop-2',
              title: 'Rimin Gata Lodge',
              approval_status: 'pending',
              images: ['https://proj.supabase.co/storage/v1/object/public/property-images/front.jpg'],
            },
          ],
        },
        tableErrors: {
          property_images: { code: '42P01', message: 'relation "public.property_images" does not exist' },
        },
      });

      const okProps = await createAdminService({ client: missingTableClient }).getProperties();
      assert.equal(okProps.length, 1);
      assert.equal(okProps[0].images[0], 'https://proj.supabase.co/storage/v1/object/public/property-images/front.jpg');

      const rlsDeniedClient = createMockSupabaseClient({
        tables: {
          profiles: [
            {
              id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              email: 'admin@outpost.ng',
              role: 'admin',
              account_status: 'active',
              full_name: 'Admin User',
            },
          ],
          properties: [{ id: 'prop-2', title: 'Rimin Gata Lodge' }],
        },
        tableErrors: {
          property_images: { code: '42501', message: 'permission denied for table property_images' },
        },
      });

      await assert.rejects(
        () => createAdminService({ client: rlsDeniedClient }).getProperties(),
        (err) => err instanceof AdminServiceError && err.code === 'SCHEMA_OR_RLS_ERROR'
      );
    });
  });
});
