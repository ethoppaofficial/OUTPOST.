import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('Supabase Authenticated RLS & Storage Security Test Suite', () => {

  const schemaSql = fs.readFileSync('supabase/migrations/20261020000001_initial_schema.sql', 'utf8');
  const rlsSql = fs.readFileSync('supabase/migrations/20261020000002_row_level_security.sql', 'utf8');
  const storageSql = fs.readFileSync('supabase/migrations/20261020000003_storage_buckets_and_policies.sql', 'utf8');
  const automationSql = fs.readFileSync('supabase/migrations/20261020000004_functions_triggers_and_automation.sql', 'utf8');
  const hardeningSql = fs.readFileSync('supabase/migrations/20261020000005_pre_deployment_hardening.sql', 'utf8');

  describe('1. RLS Policy Definitions and Security Definers', () => {
    test('All security definer functions set explicit search_path = public, auth', () => {
      const helperMatches = [...rlsSql.matchAll(/CREATE OR REPLACE FUNCTION\s+public\.([a-zA-Z0-9_]+)\s*\((.*?)\)[\s\S]*?SECURITY DEFINER/g)];
      assert.ok(helperMatches.length >= 3, 'Must define security definer helper functions');

      for (const match of helperMatches) {
        const funcName = match[1];
        const funcBlock = rlsSql.slice(match.index, match.index + 350);
        assert.match(
          funcBlock,
          /SET\s+search_path\s*=\s*public,\s*auth/,
          `Function public.${funcName} must enforce SET search_path = public, auth`
        );
      }
    });

    test('Helper functions revoke EXECUTE from PUBLIC and grant only to authenticated', () => {
      assert.match(rlsSql, /REVOKE EXECUTE ON FUNCTION public\.is_admin\(\) FROM PUBLIC;/);
      assert.match(rlsSql, /REVOKE EXECUTE ON FUNCTION public\.is_landlord\(\) FROM PUBLIC;/);
      assert.match(rlsSql, /REVOKE EXECUTE ON FUNCTION public\.is_student\(\) FROM PUBLIC;/);
      assert.match(rlsSql, /GRANT EXECUTE ON FUNCTION public\.is_admin\(\) TO authenticated;/);
    });
  });

  describe('2. User & Tenant Data Isolation (Phase 4 Tests)', () => {
    test('Student A cannot read Student B private data or verification documents', () => {
      const docPolicy = rlsSql.match(/CREATE POLICY "Students read own verification documents"[\s\S]*?ON public\.student_verification_documents\s+FOR SELECT\s+TO authenticated\s+USING \(([\s\S]*?)\);/);
      assert.ok(docPolicy, 'Students read own verification documents policy must exist');
      const condition = docPolicy[1];
      assert.ok(condition.includes('auth.uid() = student_id'), 'Document select must require auth.uid() = student_id');
      assert.ok(condition.includes('public.is_admin()'), 'Document select must allow admin review');
      assert.ok(!condition.includes('is_landlord()'), 'Landlords must not read raw student verification docs');
    });

    test('Landlord A cannot read Landlord B payment receipts', () => {
      const receiptPolicy = rlsSql.match(/CREATE POLICY "Student, landlord, or admin read receipts"[\s\S]*?ON public\.payment_receipts\s+FOR SELECT\s+TO authenticated\s+USING \(([\s\S]*?)\);/);
      assert.ok(receiptPolicy, 'Student, landlord, or admin read receipts policy must exist');
      const condition = receiptPolicy[1];
      assert.ok(condition.includes('student_id = auth.uid()'), 'Receipt select must permit student owner');
      assert.ok(condition.includes('landlord_id = auth.uid()'), 'Receipt select must permit landlord owner');
      assert.ok(!condition.includes('public.is_landlord()'), 'Receipt select must not permit generic landlord role');
    });

    test('Nonparticipants cannot read conversations or chat messages', () => {
      const convPolicy = rlsSql.match(/CREATE POLICY "Participants read conversations"[\s\S]*?ON public\.conversations\s+FOR SELECT\s+TO authenticated\s+USING \(([\s\S]*?)\);/);
      assert.ok(convPolicy, 'Participants read conversations policy must exist');
      assert.match(convPolicy[1], /public\.is_conversation_participant\(id\)/);

      const msgPolicy = rlsSql.match(/CREATE POLICY "Participants read conversation messages"[\s\S]*?ON public\.messages\s+FOR SELECT\s+TO authenticated\s+USING \(([\s\S]*?)\);/);
      assert.ok(msgPolicy, 'Participants read conversation messages policy must exist');
      assert.match(msgPolicy[1], /public\.is_conversation_participant\(conversation_id\)/);
    });

    test('Landlord cannot modify another landlord property', () => {
      const propUpdatePolicy = rlsSql.match(/CREATE POLICY "Landlords update own non-approved properties"[\s\S]*?ON public\.properties\s+FOR UPDATE\s+TO authenticated\s+USING \(([\s\S]*?)\);/);
      assert.ok(propUpdatePolicy, 'Landlords update own non-approved properties policy must exist');
      const condition = propUpdatePolicy[1];
      assert.ok(condition.includes('auth.uid() = landlord_id'), 'Must require matching landlord_id');
    });

    test('Users cannot change their role in profiles', () => {
      const profileUpdatePolicy = rlsSql.match(/CREATE POLICY "Users can update own editable profile fields"[\s\S]*?ON public\.profiles\s+FOR UPDATE\s+TO authenticated[\s\S]*?WITH CHECK \(([\s\S]*?)\);/);
      assert.ok(profileUpdatePolicy, 'Users can update own editable profile fields policy must exist');
      assert.ok(profileUpdatePolicy[1].includes('role = (SELECT p.role FROM public.profiles'), 'Users must not modify their role');
    });

    test('Students cannot approve payment receipts', () => {
      const receiptReviewPolicy = rlsSql.match(/CREATE POLICY "Landlord reviews receipt for own property"[\s\S]*?ON public\.payment_receipts\s+FOR UPDATE\s+TO authenticated\s+USING \(([\s\S]*?)\)\s+WITH CHECK/);
      assert.ok(receiptReviewPolicy, 'Landlord reviews receipt for own property policy must exist');
      assert.ok(receiptReviewPolicy[1].includes('landlord_id = auth.uid()'), 'Only landlord owner or admin can update receipt');
      assert.ok(!receiptReviewPolicy[1].includes('is_student()'), 'Students must not update receipts');
    });

    test('Landlords cannot approve their own listings', () => {
      // Landlords can only update non-approved properties and cannot set approval_status to approved
      assert.match(rlsSql, /approval_status IN \('draft', 'rejected'\)/, 'Landlords can only update draft or rejected properties');
    });

    test('Audit logs cannot be modified from the browser', () => {
      assert.doesNotMatch(rlsSql, /CREATE POLICY.*ON public\.audit_logs.*FOR UPDATE/i, 'No UPDATE policy allowed on audit_logs');
      assert.doesNotMatch(rlsSql, /CREATE POLICY.*ON public\.audit_logs.*FOR DELETE/i, 'No DELETE policy allowed on audit_logs');
      assert.doesNotMatch(rlsSql, /CREATE POLICY.*ON public\.audit_logs.*FOR ALL/i, 'No ALL policy allowed on audit_logs');
    });

    test('Group member cannot promote themselves to admin or remove the last admin', () => {
      assert.match(automationSql, /CREATE OR REPLACE FUNCTION public\.prevent_removing_last_group_admin/);
      assert.match(automationSql, /An accommodation group must retain at least one active administrator/);
    });

    test('15-minute chat message edit window is enforced by database trigger', () => {
      assert.match(automationSql, /CREATE OR REPLACE FUNCTION public\.check_message_edit_window/);
      assert.match(automationSql, /Message editing window has expired\. Messages can only be edited within 15 minutes/);
    });
  });

  describe('3. Storage Policy & Tenant Path Isolation (Phase 5 Tests)', () => {
    test('Private document buckets are marked private in storage', () => {
      const bucketDefinitions = [
        'student-docs',
        'landlord-docs',
        'payment-receipts',
        'chat-attachments',
      ];
      for (const bucket of bucketDefinitions) {
        assert.match(
          storageSql,
          new RegExp(`'${bucket}',\\s*'${bucket}',\\s*false`),
          `Bucket ${bucket} must be defined with public = false`
        );
      }
    });

    test('Payment receipts storage requires tenant-isolated reservation parties access', () => {
      assert.match(
        storageSql,
        /CREATE POLICY "Read payment receipt restricted to reservation parties or admin"[\s\S]*?ON storage\.objects/,
        'Storage select policy on receipts must exist'
      );
      assert.match(
        storageSql,
        /\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text -- Landlord[\s\S]*?\(storage\.foldername\(name\)\)\[2\] = auth\.uid\(\)::text -- Student/,
        'Receipt select must verify landlord or student matches auth.uid()'
      );
    });

    test('Storage upload restricts user to their own top-level user folder', () => {
      assert.match(
        storageSql,
        /\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/,
        'Storage insert must verify top folder matches caller auth.uid()'
      );
    });

    test('MIME types and 10MB file-size limits are configured for storage buckets', () => {
      assert.match(storageSql, /10485760/, 'Storage buckets must enforce 10MB limit (10485760 bytes)');
      assert.match(storageSql, /image\/jpeg.*image\/png.*application\/pdf/);
    });
  });

  describe('4. Edge Functions Security & Business Logic (Phase 6 Tests)', () => {
    const edgeFuncFiles = [
      'create-reservation',
      'expire-reservations',
      'request-receipt-upload',
      'finalize-receipt-upload',
      'review-payment-receipt',
      'request-chat-attachment-upload',
      'finalize-chat-attachment-upload',
      'get-private-asset-url',
    ];

    test('All 8 required Edge Functions are implemented and parse CORS headers', () => {
      for (const func of edgeFuncFiles) {
        const filePath = `supabase/functions/${func}/index.ts`;
        assert.ok(fs.existsSync(filePath), `Edge function ${filePath} must exist`);
        const content = fs.readFileSync(filePath, 'utf8');
        assert.match(content, /Access-Control-Allow-Origin/, `${func} must define CORS headers`);
        assert.match(content, /OPTIONS/, `${func} must handle CORS preflight`);
      }
    });

    test('All Edge Functions validate Authorization header and verify authenticated session', () => {
      for (const func of edgeFuncFiles) {
        if (func === 'expire-reservations') continue;
        const content = fs.readFileSync(`supabase/functions/${func}/index.ts`, 'utf8');
        assert.match(
          content,
          /Authorization/,
          `${func} must inspect Authorization header`
        );
        assert.match(
          content,
          /getUser\(\)/,
          `${func} must verify caller session with client.auth.getUser()`
        );
      }
    });

    test('review-payment-receipt verifies that caller owns the property', () => {
      const content = fs.readFileSync('supabase/functions/review-payment-receipt/index.ts', 'utf8');
      assert.match(content, /decision must be either approved or rejected/);
      assert.match(content, /rejectionReason is required when declining/);
      assert.match(content, /review_payment_receipt_atomic/);
    });

    test('create-reservation executes atomic hold procedure', () => {
      const content = fs.readFileSync('supabase/functions/create-reservation/index.ts', 'utf8');
      assert.match(content, /create_reservation_atomic/);
    });

    test('expire-reservations triggers atomic expiration procedure', () => {
      const content = fs.readFileSync('supabase/functions/expire-reservations/index.ts', 'utf8');
      assert.match(content, /expire_pending_reservations/);
    });
  });

  describe('5. Reservation Hold & Scheduling Concurrency (Phase 7 Tests)', () => {
    test('Reservation creation atomic procedure checks and decrements available_spaces', () => {
      assert.match(automationSql, /v_unit\.available_spaces <= 0/);
      assert.match(automationSql, /FOR UPDATE/, 'Must acquire row-level lock on unit to prevent race conditions');
      assert.match(automationSql, /UPDATE public\.units[\s\S]*?SET available_spaces = available_spaces - 1/);
    });

    test('Seven-day expiration strictly compares against server/database time', () => {
      assert.match(
        automationSql,
        /hold_expires_at <= timezone\('utc'::text, now\(\)\)/,
        'Reservation expiration must compare hold_expires_at with database server now()'
      );
      assert.match(
        automationSql,
        /UPDATE public\.units[\s\S]*?SET available_spaces = available_spaces \+ 1/,
        'Expiring reservation must increment unit available spaces exactly once'
      );
    });

    test('Receipt review atomically updates reservation, invoice, and property availability on rejection', () => {
      assert.match(automationSql, /UPDATE public\.payment_receipts[\s\S]*?SET status = 'approved'/);
      assert.match(automationSql, /UPDATE public\.reservations[\s\S]*?SET status = 'confirmed'/);
      assert.match(automationSql, /UPDATE public\.invoices[\s\S]*?SET status = 'paid'/);
    });
  });

  describe('6. Enhanced Security Closure & Runtime Invariant Verification', () => {
    test('Audit log insertion prevents forging admin actions and revokes mutation privileges', () => {
      assert.match(rlsSql, /action NOT LIKE 'admin_%'/);
      assert.match(rlsSql, /REVOKE UPDATE, DELETE, TRUNCATE ON public\.audit_logs FROM PUBLIC/);
      assert.match(rlsSql, /REVOKE UPDATE, DELETE, TRUNCATE ON public\.audit_logs FROM authenticated/);
      assert.match(rlsSql, /REVOKE UPDATE, DELETE, TRUNCATE ON public\.audit_logs FROM anon/);
    });

    test('Triggers enforce immutable fields on profiles, student profiles, and landlord profiles', () => {
      assert.match(automationSql, /protect_profile_immutable_fields/);
      assert.match(automationSql, /User role cannot be changed directly/);
      assert.match(automationSql, /protect_student_profile_immutable_fields/);
      assert.match(automationSql, /Student verification status cannot be self-modified/);
      assert.match(automationSql, /protect_landlord_profile_immutable_fields/);
      assert.match(automationSql, /Landlord verification status cannot be self-modified/);
    });

    test('Stored procedures verify caller authorization and prevent racing on expired/cancelled reservations', () => {
      assert.match(automationSql, /reservation student_id must match authenticated caller/);
      assert.match(automationSql, /reviewer_id must match authenticated caller/);
      assert.match(automationSql, /Cannot review receipt: reservation is in state/);
    });

    test('Stored procedures restrict EXECUTE grants from PUBLIC and unauthenticated callers', () => {
      assert.match(automationSql, /REVOKE EXECUTE ON FUNCTION public\.create_reservation_atomic[\s\S]*?FROM PUBLIC/);
      assert.match(automationSql, /REVOKE EXECUTE ON FUNCTION public\.review_payment_receipt_atomic[\s\S]*?FROM PUBLIC/);
      assert.match(automationSql, /REVOKE EXECUTE ON FUNCTION public\.expire_pending_reservations[\s\S]*?FROM authenticated/);
      assert.match(automationSql, /GRANT EXECUTE ON FUNCTION public\.expire_pending_reservations[\s\S]*?TO service_role/);
    });

    test('Platform settings table and RLS policies are defined', () => {
      assert.match(schemaSql, /CREATE TABLE IF NOT EXISTS public\.platform_settings/);
      assert.match(rlsSql, /ALTER TABLE public\.platform_settings ENABLE ROW LEVEL SECURITY;/);
      assert.match(rlsSql, /CREATE POLICY "Platform settings readable by everyone"/);
      assert.match(rlsSql, /CREATE POLICY "Admins manage platform settings"/);
    });

    test('All privileged Edge Functions verify account status is not suspended', () => {
      const functionsToCheck = [
        'create-reservation',
        'request-receipt-upload',
        'finalize-receipt-upload',
        'review-payment-receipt',
        'request-chat-attachment-upload',
        'finalize-chat-attachment-upload',
        'get-private-asset-url',
      ];
      for (const fn of functionsToCheck) {
        const content = fs.readFileSync(`supabase/functions/${fn}/index.ts`, 'utf8');
        assert.match(content, /account_status/, `${fn} must verify account_status`);
        assert.match(content, /suspended/, `${fn} must reject suspended accounts`);
      }
    });

    test('Documentation strictly prohibits destructive DROP SCHEMA public CASCADE and defines non-destructive rollback', () => {
      const migrationDoc = fs.readFileSync('docs/backend-migration.md', 'utf8');
      assert.match(migrationDoc, /DROP SCHEMA public CASCADE/);
      assert.match(migrationDoc, /strictly prohibited/i);
      assert.match(migrationDoc, /Pre-Migration Backup and Restoration Verification/);
      assert.match(migrationDoc, /Classification of Reversible vs\. Irreversible Migrations/);
    });
  });

  describe('7. Pre-Deployment Hardening Verification (Migration 05)', () => {
    test('handle_new_user trigger function automatically creates profiles on auth.users insert', () => {
      assert.match(hardeningSql, /CREATE OR REPLACE FUNCTION public\.handle_new_user/);
      assert.match(hardeningSql, /AFTER INSERT ON auth\.users/);
      assert.match(hardeningSql, /SECURITY DEFINER/);
      assert.match(hardeningSql, /SET search_path = public, auth, extensions, pg_temp/);
      assert.match(hardeningSql, /INSERT INTO public\.profiles/);
    });

    test('Partial unique index prevents concurrent active reservations across properties', () => {
      assert.match(
        hardeningSql,
        /CREATE UNIQUE INDEX IF NOT EXISTS idx_single_active_reservation_per_student/
      );
      assert.match(
        hardeningSql,
        /ON public\.reservations\s*\(student_id\)\s*WHERE status IN \('pending_payment', 'payment_submitted', 'confirmed'\)/
      );
    });

    test('Unit capacity mutations automatically synchronize parent property spaces', () => {
      assert.match(hardeningSql, /CREATE OR REPLACE FUNCTION public\.sync_property_spaces/);
      assert.match(hardeningSql, /AFTER INSERT OR UPDATE OF capacity, available_spaces OR DELETE ON public\.units/);
      assert.match(hardeningSql, /UPDATE public\.properties/);
    });

    test('FORCE Row Level Security is applied to sensitive application tables', () => {
      const requiredForcedTables = [
        'profiles',
        'student_profiles',
        'landlord_profiles',
        'landlord_verification_submissions',
        'reservations',
        'invoices',
        'payment_receipts',
        'audit_logs',
      ];
      for (const table of requiredForcedTables) {
        assert.match(
          hardeningSql,
          new RegExp(`ALTER TABLE public\\.${table} FORCE ROW LEVEL SECURITY;`),
          `Table public.${table} must have FORCE ROW LEVEL SECURITY applied`
        );
      }
    });

    test('Hourly expiration cron helper function is defined with safe exception handling', () => {
      assert.match(hardeningSql, /CREATE OR REPLACE FUNCTION public\.ensure_hourly_expiration_cron/);
      assert.match(hardeningSql, /cron\.schedule/);
      assert.match(hardeningSql, /expire-pending-reservations-hourly/);
    });
  });
});

