import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  createAdminService,
  AdminServiceError,
  ADMIN_METRICS_METADATA,
} from '../src/application/services/adminService.ts';

/**
 * Builds a minimal mock Supabase client that supports:
 * - auth.getUser()
 * - from(table).select(..., { count, head }) + chained .eq / .in / .gt / .lte / .maybeSingle
 * - rpc(fnName, args)
 */
function createMockSupabaseClient({
  authUser = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'admin@outpost.ng' },
  authError = null,
  tables = {},
  tableErrors = {},
  rpcHandlers = {},
} = {}) {
  const queriesRecorded = [];

  return {
    queriesRecorded,
    auth: {
      async getUser() {
        if (authError) return { data: { user: null }, error: authError };
        return { data: { user: authUser }, error: null };
      },
    },
    from(tableName) {
      const filters = [];
      let selectCols = '*';
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
        select(cols = '*', opts = {}) {
          selectCols = cols;
          selectOpts = opts;
          queriesRecorded.push({ table: tableName, cols, opts });
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
        update() {
          return {
            eq() {
              return {
                select() {
                  return {
                    async single() {
                      return { data: null, error: null };
                    },
                  };
                },
                async then(resolve) {
                  resolve({ data: null, error: null });
                },
              };
            },
          };
        },
        upsert: async () => ({ error: null }),
        insert: async () => ({ error: null }),
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
      if (rpcHandlers[fnName]) {
        return rpcHandlers[fnName](params);
      }
      return { data: null, error: { code: 'PGRST202', message: `Could not find the function ${fnName}` } };
    },
  };
}

const ACTIVE_ADMIN_ROW = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  email: 'admin@outpost.ng',
  role: 'admin',
  account_status: 'active',
  full_name: 'Primary Admin',
};

describe('OUTPOST: Administrator Live Metrics, Fail-Closed Auth & Regression Suite', () => {
  describe('1. Active Admin Authorization (Fail-Closed)', () => {
    test('Unauthenticated session fails closed with UNAUTHENTICATED AdminServiceError', async () => {
      const client = createMockSupabaseClient({
        authUser: null,
        authError: { message: 'JWT expired' },
      });
      const service = createAdminService({ client });

      await assert.rejects(
        () => service.getAdminMetrics(),
        (err) => err instanceof AdminServiceError && err.code === 'UNAUTHENTICATED'
      );
    });

    test('Student or Landlord user fails closed with FORBIDDEN_ROLE', async () => {
      for (const role of ['student', 'landlord']) {
        const uid = '11111111-1111-4111-8111-111111111111';
        const client = createMockSupabaseClient({
          authUser: { id: uid, email: `${role}@buk.edu.ng` },
          tables: {
            profiles: [{ id: uid, email: `${role}@buk.edu.ng`, role, account_status: 'active', full_name: role }],
          },
        });
        const service = createAdminService({ client });

        await assert.rejects(
          () => service.getAdminMetrics(),
          (err) => err instanceof AdminServiceError && err.code === 'FORBIDDEN_ROLE'
        );
      }
    });

    test('Missing public.profiles row fails closed with FORBIDDEN_ROLE', async () => {
      const uid = '22222222-2222-4222-8222-222222222222';
      const client = createMockSupabaseClient({
        authUser: { id: uid, email: 'ghost@outpost.ng' },
        tables: { profiles: [] },
      });
      const service = createAdminService({ client });

      await assert.rejects(
        () => service.getUsers(),
        (err) => err instanceof AdminServiceError && err.code === 'FORBIDDEN_ROLE'
      );
    });

    test('Suspended or non-active admin account fails closed with ADMIN_SUSPENDED_OR_INACTIVE', async () => {
      for (const accountStatus of ['suspended', 'email_unverified', 'profile_pending', 'rejected']) {
        const client = createMockSupabaseClient({
          tables: {
            profiles: [{ ...ACTIVE_ADMIN_ROW, account_status: accountStatus }],
          },
        });
        const service = createAdminService({ client });

        await assert.rejects(
          () => service.getAdminMetrics(),
          (err) => err instanceof AdminServiceError && err.code === 'ADMIN_SUSPENDED_OR_INACTIVE'
        );
      }
    });
  });

  describe('2. Live Metrics Accuracy, Head-Only DB Counts & Zero Demo Fallback', () => {
    test('Empty PostgreSQL database returns exact 0 counts and [] lists — never seed/demo users', async () => {
      const client = createMockSupabaseClient({
        tables: {
          profiles: [ACTIVE_ADMIN_ROW],
          student_verification_documents: [],
          landlord_verification_submissions: [],
          landlord_profiles: [],
          payment_receipts: [],
          properties: [],
          reservations: [],
        },
      });
      const service = createAdminService({ client });

      const metrics = await service.getAdminMetrics();
      assert.equal(metrics.totalUsers, 1);
      assert.equal(metrics.totalStudents, 0);
      assert.equal(metrics.totalLandlords, 0);
      assert.equal(metrics.totalAdministrators, 1);
      assert.equal(metrics.totalUploadedStudentDocuments, 0);
      assert.equal(metrics.totalLandlordVerificationSubmissions, 0);
      assert.equal(metrics.totalPaymentReceipts, 0);
      assert.equal(metrics.pendingStudentVerifications, 0);
      assert.equal(metrics.pendingLandlordVerifications, 0);
      assert.equal(metrics.pendingPropertyVerifications, 0);
      assert.equal(metrics.activeProperties, 0);
      assert.equal(metrics.activeReservations, 0);
      assert.equal(metrics.pendingReceiptVerifications, 0);
      assert.equal(metrics.expiredReservations, 0);

      const queues = await service.getVerificationQueues();
      assert.deepEqual(queues.students, []);
      assert.deepEqual(queues.landlords, []);

      const users = await service.getUsers();
      assert.equal(users.length, 1);
      assert.equal(users[0].email, 'admin@outpost.ng');
      assert.ok(!users.some((u) => u.email === 'student1@outpost.edu.ng'));
    });

    test('Active admin uses admin_get_dashboard_metrics RPC when available', async () => {
      const expectedMetrics = {
        totalUsers: 42,
        totalStudents: 30,
        totalLandlords: 10,
        totalAdministrators: 2,
        totalUploadedStudentDocuments: 18,
        totalLandlordVerificationSubmissions: 9,
        totalPaymentReceipts: 14,
        pendingStudentVerifications: 5,
        pendingLandlordVerifications: 3,
        pendingPropertyVerifications: 4,
        activeProperties: 12,
        activeReservations: 7,
        pendingReceiptVerifications: 2,
        expiredReservations: 3,
      };

      const client = createMockSupabaseClient({
        tables: { profiles: [ACTIVE_ADMIN_ROW] },
        rpcHandlers: {
          admin_get_dashboard_metrics: () => ({ data: expectedMetrics, error: null }),
        },
      });
      const service = createAdminService({ client });

      const result = await service.getAdminMetrics();
      assert.deepEqual(result, expectedMetrics);
    });

    test('Fallback when RPC is missing uses head-only count queries and strictly separates uploaded evidence', async () => {
      const futureIso = new Date(Date.now() + 86400000).toISOString();
      const pastIso = new Date(Date.now() - 86400000).toISOString();

      const client = createMockSupabaseClient({
        tables: {
          profiles: [
            ACTIVE_ADMIN_ROW,
            { id: 's-1', role: 'student', account_status: 'active' },
            { id: 's-2', role: 'student', account_status: 'active' },
            { id: 'l-1', role: 'landlord', account_status: 'active' },
          ],
          student_verification_documents: [
            { id: 'sd-1', student_id: 's-1', status: 'pending' },
            { id: 'sd-2', student_id: 's-2', status: 'approved' },
          ],
          landlord_verification_submissions: [
            { id: 'ls-1', landlord_id: 'l-1', status: 'pending' },
          ],
          landlord_profiles: [
            { id: 'lp-1', user_id: 'l-1', verification_status: 'pending' },
          ],
          payment_receipts: [
            { id: 'pr-1', status: 'pending_review' },
            { id: 'pr-2', status: 'approved' },
          ],
          properties: [
            { id: 'p-1', approval_status: 'pending', is_published: false, images: ['img1.jpg', 'img2.jpg'] },
            { id: 'p-2', approval_status: 'approved', is_published: true, images: ['img3.jpg'] },
          ],
          // Extra tables like messages/chat attachments should never pollute identity/receipt counts
          messages: [
            { id: 'm-1', attachment: { storage_path: 'conv/user/file.pdf' } },
          ],
          reservations: [
            { id: 'r-1', status: 'pending_payment', hold_expires_at: futureIso },
            { id: 'r-2', status: 'confirmed', hold_expires_at: futureIso },
            { id: 'r-3', status: 'expired', hold_expires_at: pastIso },
            { id: 'r-4', status: 'pending_payment', hold_expires_at: pastIso },
          ],
        },
      });
      const service = createAdminService({ client });
      const metrics = await service.getAdminMetrics();

      // Verify head-only count queries were used for tables beyond initial verifyActiveAdmin() profile check
      const metricQueries = client.queriesRecorded.slice(1);
      assert.ok(metricQueries.length > 0);
      assert.ok(
        metricQueries.every((q) => q.opts?.head === true && q.opts?.count === 'exact'),
        'All metric count fallback queries must use count: exact, head: true'
      );

      assert.equal(metrics.totalUsers, 4);
      assert.equal(metrics.totalStudents, 2);
      assert.equal(metrics.totalLandlords, 1);
      assert.equal(metrics.totalAdministrators, 1);
      assert.equal(metrics.totalUploadedStudentDocuments, 2);
      assert.equal(metrics.totalLandlordVerificationSubmissions, 1);
      assert.equal(metrics.totalPaymentReceipts, 2);
      assert.equal(metrics.pendingStudentVerifications, 1);
      assert.equal(metrics.pendingLandlordVerifications, 1);
      assert.equal(metrics.pendingPropertyVerifications, 1);
      assert.equal(metrics.activeProperties, 1);
      assert.equal(metrics.activeReservations, 2);
      assert.equal(metrics.pendingReceiptVerifications, 1);
      assert.equal(metrics.expiredReservations, 2);
    });

    test('Uploading student doc, landlord submission, and receipt increments metrics cleanly', async () => {
      const dbTables = {
        profiles: [ACTIVE_ADMIN_ROW, { id: 's-1', role: 'student' }, { id: 'l-1', role: 'landlord' }],
        student_verification_documents: [],
        landlord_verification_submissions: [],
        landlord_profiles: [{ id: 'lp-1', user_id: 'l-1', verification_status: 'not_started' }],
        payment_receipts: [],
        properties: [],
        reservations: [],
      };
      const client = createMockSupabaseClient({ tables: dbTables });
      const service = createAdminService({ client });

      const before = await service.getAdminMetrics();
      assert.equal(before.totalUploadedStudentDocuments, 0);
      assert.equal(before.totalLandlordVerificationSubmissions, 0);
      assert.equal(before.totalPaymentReceipts, 0);

      // Simulate persisted student doc, landlord submission, and payment receipt
      dbTables.student_verification_documents.push({ id: 'sd-1', student_id: 's-1', status: 'pending', storage_path: 's-1/doc.pdf' });
      dbTables.landlord_verification_submissions.push({ id: 'ls-1', landlord_id: 'l-1', status: 'pending', storage_path: 'l-1/deed.pdf' });
      dbTables.landlord_profiles[0].verification_status = 'pending';
      dbTables.payment_receipts.push({ id: 'pr-1', status: 'pending_review', storage_path: 'l-1/s-1/res/rcp.jpg' });

      const afterUpload = await service.getAdminMetrics();
      assert.equal(afterUpload.totalUploadedStudentDocuments, 1);
      assert.equal(afterUpload.pendingStudentVerifications, 1);
      assert.equal(afterUpload.totalLandlordVerificationSubmissions, 1);
      assert.equal(afterUpload.pendingLandlordVerifications, 1);
      assert.equal(afterUpload.totalPaymentReceipts, 1);
      assert.equal(afterUpload.pendingReceiptVerifications, 1);

      // Simulate admin approval transitions
      dbTables.student_verification_documents[0].status = 'approved';
      dbTables.landlord_verification_submissions[0].status = 'approved';
      dbTables.landlord_profiles[0].verification_status = 'approved';
      dbTables.payment_receipts[0].status = 'approved';

      const afterApprove = await service.getAdminMetrics();
      assert.equal(afterApprove.totalUploadedStudentDocuments, 1);
      assert.equal(afterApprove.pendingStudentVerifications, 0);
      assert.equal(afterApprove.pendingLandlordVerifications, 0);
      assert.equal(afterApprove.pendingReceiptVerifications, 0);
    });
  });

  describe('3. Error Propagation (Never Converted Into Success Or Zeros)', () => {
    test('RLS 42501 permission denied propagates as SCHEMA_OR_RLS_ERROR', async () => {
      const client = createMockSupabaseClient({
        tables: { profiles: [ACTIVE_ADMIN_ROW] },
        rpcHandlers: {
          admin_get_dashboard_metrics: () => ({
            data: null,
            error: { code: '42501', message: 'permission denied for table payment_receipts' },
          }),
        },
      });
      const service = createAdminService({ client });

      await assert.rejects(
        () => service.getAdminMetrics(),
        (err) => err instanceof AdminServiceError && err.code === 'SCHEMA_OR_RLS_ERROR'
      );
    });

    test('Network failure during table query propagates as NETWORK_ERROR instead of fallback data', async () => {
      const client = createMockSupabaseClient({
        tables: { profiles: [ACTIVE_ADMIN_ROW] },
        tableErrors: {
          student_verification_documents: { message: 'TypeError: Failed to fetch' },
        },
      });
      const service = createAdminService({ client });

      await assert.rejects(
        () => service.getVerificationQueues(),
        (err) => err instanceof AdminServiceError && err.code === 'NETWORK_ERROR'
      );
    });

    test('Validation errors in governance actions fail fast with VALIDATION_ERROR', async () => {
      const client = createMockSupabaseClient({
        tables: { profiles: [ACTIVE_ADMIN_ROW] },
      });
      const service = createAdminService({ client });

      await assert.rejects(
        () => service.setUserStatus('11111111-1111-4111-8111-111111111111', 'suspended', 'no'),
        (err) => err instanceof AdminServiceError && err.code === 'VALIDATION_ERROR'
      );

      await assert.rejects(
        () => service.reviewVerification({ kind: 'student', targetId: '11111111-1111-4111-8111-111111111111', decision: 'rejected', reason: '' }),
        (err) => err instanceof AdminServiceError && err.code === 'VALIDATION_ERROR'
      );
    });

    test('ADMIN_METRICS_METADATA covers all 14 AdminMetrics keys without omissions', () => {
      const expectedKeys = [
        'totalUsers',
        'totalStudents',
        'totalLandlords',
        'totalAdministrators',
        'totalUploadedStudentDocuments',
        'totalLandlordVerificationSubmissions',
        'totalPaymentReceipts',
        'pendingStudentVerifications',
        'pendingLandlordVerifications',
        'pendingPropertyVerifications',
        'activeProperties',
        'activeReservations',
        'pendingReceiptVerifications',
        'expiredReservations',
      ];
      const metadataKeys = ADMIN_METRICS_METADATA.map((item) => item.key);
      assert.deepEqual(metadataKeys, expectedKeys);
    });
  });

  describe('4. Codebase & Architecture Invariants (Zero Fallbacks, Zero Secrets, Zero window.alert)', () => {
    const stripComments = (src) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

    test('adminService.ts has zero imports of local repository or localStorage', () => {
      const content = stripComments(fs.readFileSync(path.resolve('src/application/services/adminService.ts'), 'utf8'));
      assert.doesNotMatch(content, /from\s+['"][^'"]*repositories['"]/, 'adminService must not import repository');
      assert.doesNotMatch(content, /\blocalStorage\b/, 'adminService must not read or write localStorage');
      assert.doesNotMatch(content, /readSupabaseTable/, 'Legacy local-fallback readSupabaseTable helper must remain deleted');
    });

    test('Admin UI pages contain no window.alert, no window.open, and no fallback disclaimers', () => {
      const adminDir = path.resolve('src/pages/admin');
      const files = fs.readdirSync(adminDir).filter((f) => f.endsWith('.tsx'));
      for (const file of files) {
        const raw = fs.readFileSync(path.join(adminDir, file), 'utf8');
        const codeOnly = stripComments(raw);
        assert.doesNotMatch(codeOnly, /\bwindow\.alert\s*\(/, `${file} must not call window.alert`);
        assert.doesNotMatch(codeOnly, /\bwindow\.open\s*\(/, `${file} must not call window.open`);
        assert.doesNotMatch(codeOnly, /fallback local|simulated data/i, `${file} must not claim local/simulated fallback`);
      }
    });

    test('AdminLoginPage does not pre-fill hardcoded credentials or offer Quick-Fill Admin button', () => {
      const content = fs.readFileSync(path.resolve('src/pages/public/AdminLoginPage.tsx'), 'utf8');
      assert.doesNotMatch(content, /ethoppaofficial@gmail\.com/, 'AdminLoginPage must not embed hardcoded admin email');
      assert.doesNotMatch(content, /Quick-Fill Admin/i, 'AdminLoginPage must not include demo credential auto-fill buttons');
    });

    test('AuthContext does not restore stale repository user ID when Supabase session is absent', () => {
      const content = fs.readFileSync(path.resolve('src/application/context/AuthContext.tsx'), 'utf8');
      assert.doesNotMatch(content, /repository\.getActiveUserId\(\)/, 'AuthContext must not restore session from repository cache');
    });

    test('NewPropertyPage uses UUID IDs (never Date.now() string prefix)', () => {
      const content = fs.readFileSync(path.resolve('src/pages/landlord/NewPropertyPage.tsx'), 'utf8');
      assert.match(content, /crypto\.randomUUID\(\)/, 'NewPropertyPage must generate UUID property IDs');
      assert.doesNotMatch(content, /`prop-\$\{Date\.now\(\)\}`/, 'Must not generate non-UUID prop- IDs');
    });

    test('get-private-asset-url Edge Function enforces UUIDs, active admin, safe queries, and audit logging', () => {
      const fnPath = path.resolve('supabase/functions/get-private-asset-url/index.ts');
      const content = fs.readFileSync(fnPath, 'utf8');
      assert.match(content, /UUID_REGEX/, 'Must validate recordId against UUID regex');
      assert.match(content, /profile\.role === 'admin' && profile\.account_status === 'active'/, 'Must require active admin');
      assert.doesNotMatch(content, /\.or\(`id\.eq\.\$\{recordId\}/, 'Must not interpolate recordId into .or() string');
      assert.match(content, /from\('audit_logs'\)\.insert/, 'Must audit private evidence signed URL generation');
    });

    test('Migration 07 defines hardened is_admin(), admin_get_dashboard_metrics, and atomic governance RPCs', () => {
      const m07Path = path.resolve('supabase/migrations/20261112000007_admin_live_metrics_and_rls_fixes.sql');
      assert.ok(fs.existsSync(m07Path), 'Migration 07 must exist');
      const content = fs.readFileSync(m07Path, 'utf8');
      for (const symbol of [
        'CREATE OR REPLACE FUNCTION public.is_admin()',
        'CREATE OR REPLACE FUNCTION public.admin_get_dashboard_metrics()',
        'CREATE OR REPLACE FUNCTION public.submit_landlord_verification_submission(',
        'CREATE OR REPLACE FUNCTION public.admin_review_student_verification(',
        'CREATE OR REPLACE FUNCTION public.admin_review_landlord_verification(',
        'CREATE OR REPLACE FUNCTION public.admin_review_property(',
        'CREATE OR REPLACE FUNCTION public.admin_review_property_location(',
        'CREATE OR REPLACE FUNCTION public.admin_set_user_status(',
      ]) {
        assert.ok(content.includes(symbol), `Migration 07 must define ${symbol}`);
      }
    });
  });
});
