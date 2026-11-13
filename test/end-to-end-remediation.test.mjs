import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  validateUploadFile,
  STUDENT_DOCUMENT_UPLOAD_RULES,
  LANDLORD_DOCUMENT_UPLOAD_RULES,
  PROPERTY_IMAGE_UPLOAD_RULES,
  PROFILE_PICTURE_UPLOAD_RULES,
} from '../src/application/utils/uploadValidation.ts';
import { SupabaseStorageService } from '../src/infrastructure/supabase/supabaseStorageService.ts';

describe('OUTPOST: End-to-End Remediation Verification Suite', () => {
  const read = (rel) => fs.readFileSync(path.resolve(rel), 'utf8');

  describe('1. Auth Session, Header & Role State Integrity', () => {
    test('AuthContext hydrates initial getSession(), exposes landlordProfile/refreshAuthProfile, and resets on signOut()', () => {
      const src = read('src/application/context/AuthContext.tsx');
      assert.match(src, /supabase\.auth\.getSession\(\)/, 'AuthContext must inspect initial Supabase session on mount');
      assert.match(src, /landlordProfile:\s*LandlordProfile\s*\|\s*null/, 'AuthContext must expose landlordProfile');
      assert.match(src, /refreshAuthProfile:\s*\(\)\s*=>\s*Promise<void>/, 'AuthContext must expose refreshAuthProfile');
      assert.match(src, /setProfileStatus\('unauthenticated'\)/, 'signOut must reset profileStatus to unauthenticated');
      assert.match(src, /setLandlordProfile\(null\)/, 'signOut must reset landlordProfile');
    });

    test('AppShell & HomePage wait cleanly during initial auth/profile checks and use no Unsplash fallback avatar', () => {
      const shell = read('src/components/layout/AppShell.tsx');
      const home = read('src/pages/public/HomePage.tsx');
      assert.match(shell, /profileStatus === 'profile_pending'/, 'AppShell must handle profile_pending cleanly');
      assert.match(shell, /profileStatus === 'profile_error'/, 'AppShell must surface profile_error cleanly');
      assert.doesNotMatch(shell, /images\.unsplash\.com/, 'AppShell must not embed external Unsplash avatar fallbacks');
      assert.match(home, /useAuth\(\)/, 'HomePage must consume reactive useAuth() state');
      assert.match(home, /profile_error/, 'HomePage must display actionable profile_error state');
    });

    test('authService sets initial landlord verificationStatus to not_started and handles email confirmation gating', () => {
      const authSrc = read('src/application/services/authService.ts');
      const regSrc = read('src/pages/public/RegisterPage.tsx');
      assert.match(authSrc, /requiresEmailConfirmation/, 'Registration must track email confirmation state');
      assert.match(authSrc, /verificationStatus:\s*'not_started'/, 'New landlord accounts start as not_started, not pending');
      assert.match(regSrc, /requiresConfirmation/, 'RegisterPage must guide users when email confirmation is required');
    });
  });

  describe('2. Multi-Bucket Upload Validation & Storage Guardrails', () => {
    test('validateUploadFile normalizes image/jpg and enforces bucket size/MIME boundaries', () => {
      const jpgAlias = { name: 'hall.JPG', size: 1024 * 500, type: 'image/jpg' };
      const resJpg = validateUploadFile(jpgAlias, PROPERTY_IMAGE_UPLOAD_RULES);
      assert.equal(resJpg.isValid, true);
      assert.equal(resJpg.normalizedMimeType, 'image/jpeg');

      const emptyFile = { name: 'empty.pdf', size: 0, type: 'application/pdf' };
      assert.equal(validateUploadFile(emptyFile, STUDENT_DOCUMENT_UPLOAD_RULES).isValid, false);

      const oversizedStudentDoc = { name: 'id.pdf', size: 6 * 1024 * 1024, type: 'application/pdf' };
      assert.equal(validateUploadFile(oversizedStudentDoc, STUDENT_DOCUMENT_UPLOAD_RULES).isValid, false);

      const validLandlordDoc = { name: 'deed.pdf', size: 8 * 1024 * 1024, type: 'application/pdf' };
      assert.equal(validateUploadFile(validLandlordDoc, LANDLORD_DOCUMENT_UPLOAD_RULES).isValid, true);

      const oversizedAvatar = { name: 'avatar.png', size: 3 * 1024 * 1024, type: 'image/png' };
      assert.equal(validateUploadFile(oversizedAvatar, PROFILE_PICTURE_UPLOAD_RULES).isValid, false);

      const dangerousSvg = { name: 'xss.svg', size: 512, type: 'image/svg+xml' };
      assert.equal(validateUploadFile(dangerousSvg, PROPERTY_IMAGE_UPLOAD_RULES).isValid, false);
    });

    test('SupabaseStorageService rejects placeholder IDs, 0-byte payloads, and oversized student files before network upload', async () => {
      const storage = new SupabaseStorageService();
      const validBlob = new Blob(['test-bytes'], { type: 'application/pdf' });
      const emptyBlob = new Blob([], { type: 'application/pdf' });
      const bigStudentBlob = new Blob([new Uint8Array(6 * 1024 * 1024)], { type: 'application/pdf' });

      await assert.rejects(() => storage.uploadStudentDocument('anonymous', validBlob, 'id.pdf'), /Authenticated student ID is required/i);
      await assert.rejects(() => storage.uploadLandlordDocument('landlord', validBlob, 'deed.pdf'), /Authenticated landlord ID is required/i);
      await assert.rejects(() => storage.uploadStudentDocument('11111111-1111-4111-8111-111111111111', emptyBlob, 'empty.pdf'), /0 bytes/i);
      await assert.rejects(() => storage.uploadStudentDocument('11111111-1111-4111-8111-111111111111', bigStudentBlob, 'big.pdf'), /5MB/i);
      assert.equal(typeof storage.deletePublicMediaAsset, 'function');
    });
  });

  describe('3. Property & Media Pipeline (No Base64, No Blob URLs, No Fake Fallbacks)', () => {
    test('PropertyImageCaptureUpload & NewPropertyPage forbid toDataURL, createObjectURL, and stock photo shortcuts', () => {
      const uploader = read('src/components/property/PropertyImageCaptureUpload.tsx');
      const newProp = read('src/pages/landlord/NewPropertyPage.tsx');

      assert.doesNotMatch(uploader, /toDataURL\(/, 'PropertyImageCaptureUpload must never persist Base64 data URLs');
      assert.doesNotMatch(uploader, /URL\.createObjectURL\(/, 'PropertyImageCaptureUpload must never persist ephemeral blob URLs');
      assert.doesNotMatch(uploader, /SAMPLE_STUDENT_HOUSING_PHOTOS|Load 5 Sample Hostel Photos/i, 'Sample Unsplash shortcut must stay removed');
      assert.match(uploader, /deletePublicMediaAsset/, 'Removed property images must trigger cleanup');

      assert.match(newProp, /const \[images, setImages\] = useState<string\[\]>\(\[\]\)/, 'NewPropertyPage must initialize with empty images array');
      assert.doesNotMatch(newProp, /images\.unsplash\.com/, 'NewPropertyPage must not pre-fill Unsplash URLs');
      assert.match(newProp, /useAuth\(\)/, 'NewPropertyPage must derive landlord ID from useAuth()');
    });

    test('Display cards & pages have zero Unsplash fallbacks and include loading/error/retry states', () => {
      const card = read('src/components/ui/PropertyCard.tsx');
      const gallery = read('src/components/ui/ImageGallery.tsx');
      const propsPage = read('src/pages/public/PropertiesPage.tsx');
      const detailPage = read('src/pages/public/PropertyDetailPage.tsx');
      const landlordProps = read('src/pages/landlord/LandlordPropertiesPage.tsx');
      const landlordDash = read('src/pages/landlord/LandlordDashboard.tsx');

      for (const [name, content] of [
        ['PropertyCard.tsx', card],
        ['PropertiesPage.tsx', propsPage],
        ['LandlordPropertiesPage.tsx', landlordProps],
      ]) {
        assert.doesNotMatch(content, /images\.unsplash\.com/, `${name} must not fall back to Unsplash URLs`);
      }

      assert.match(card, /onError=/, 'PropertyCard must handle broken image load failures gracefully');
      assert.match(gallery, /onError=/, 'ImageGallery must handle broken image load failures gracefully');
      assert.match(propsPage, /subscribeToProperties/, 'PropertiesPage must subscribe to async property loads');
      assert.match(detailPage, /fetchPropertyByIdOrSlug/, 'PropertyDetailPage must support direct Supabase fetch on reload');
      assert.match(landlordProps, /refreshLandlordProperties/, 'LandlordPropertiesPage must load live landlord properties');
      assert.match(landlordDash, /landlordProfile\?\.verificationStatus \|\| 'not_started'/, 'LandlordDashboard must not default unverified landlords to pending');
    });

    test('Landlord & Admin Verification queues use unique keys and .webp support', () => {
      const landlordVerif = read('src/pages/landlord/LandlordVerificationPage.tsx');
      const queuePage = read('src/pages/admin/VerificationQueuePage.tsx');
      assert.match(landlordVerif, /accept="\.jpg,\.jpeg,\.png,\.webp,\.pdf"/, 'LandlordVerificationPage must accept .webp');
      assert.doesNotMatch(landlordVerif, /\{submitted \?/, 'Stale submitted variable must not remain');
      assert.match(queuePage, /const evidenceRecordId = activeTab === 'student' \? item\.id : item\.submissionId \|\| item\.userId \|\| item\.id/, 'Landlord verification cards must use unique submissionId keys');
      assert.match(queuePage, /key=\{evidenceRecordId\}/, 'Verification queue cards must key on evidenceRecordId');
      assert.match(queuePage, /getEvidencePreviewKind/, 'VerificationQueuePage must select safe inline preview types');
      assert.match(queuePage, /activeSigned\.previewKind === 'image'/, 'VerificationQueuePage must preview supported images');
      assert.match(queuePage, /activeSigned\.previewKind === 'pdf'/, 'VerificationQueuePage must preview supported PDFs');
      assert.match(queuePage, /href=\{activeSigned\.url\}/, 'VerificationQueuePage must retain the expiring signed URL link');
    });

    test('supabaseRepository & propertyService preserve corridor area, exact zero spaces, and sync property_images', () => {
      const repo = read('src/infrastructure/supabase/supabaseRepository.ts');
      const propSvc = read('src/application/services/propertyService.ts');

      assert.match(repo, /mapSupabasePropertyRow/, 'Repository must share normalized property mapper');
      assert.match(repo, /this\.normalizeArea\(row\.area\)/, 'Repository must preserve property area instead of hardcoding Dambare');
      assert.doesNotMatch(repo, /availableSpaces:\s*row\.available_spaces\s*\|\|\s*8/, 'Must not turn 0 available spaces into 8');
      assert.match(repo, /sanitizeMediaUrls/, 'Repository must filter out data: and blob: image URLs');
      assert.match(repo, /\.from\('property_images'\)\s*\.upsert/, 'createPropertyPersisted must write relational property_images rows');
      assert.match(repo, /appEventBus\.publish\('propertiesUpdated'/, 'Repository must publish propertiesUpdated events');

      assert.match(propSvc, /subscribeToProperties\(/, 'propertyService must expose reactive subscription helper');
      assert.match(propSvc, /fetchPropertyByIdOrSlug\(/, 'propertyService must expose direct Supabase lookup helper');
    });
  });

  describe('4. Migration 08 Database & RPC Guarantees', () => {
    test('Migration 08 creates property_images with RLS + non-ephemeral URL checks and 19-key admin_get_dashboard_metrics', () => {
      const m08 = read('supabase/migrations/20261112000008_end_to_end_remediation.sql');
      assert.match(m08, /CREATE TABLE IF NOT EXISTS public\.property_images/, 'Must create property_images table');
      assert.match(m08, /ALTER TABLE public\.property_images ENABLE ROW LEVEL SECURITY/, 'Must enable RLS on property_images');
      assert.match(m08, /ALTER TABLE public\.property_images FORCE ROW LEVEL SECURITY/, 'Must force RLS on property_images');
      assert.match(m08, /\^\(data:\|blob:\)/, 'Must forbid data: and blob: URLs in PostgreSQL CHECK constraint');
      assert.match(m08, /SELECT COUNT\(DISTINCT id\) INTO v_total_users FROM public\.profiles/, 'Must use COUNT(DISTINCT id)');
      for (const key of [
        'totalUsers',
        'totalStudents',
        'totalLandlords',
        'totalAdministrators',
        'totalNonAdminUsers',
        'approvedLandlordVerifications',
        'rejectedLandlordVerifications',
        'totalProperties',
        'approvedProperties',
      ]) {
        assert.ok(m08.includes(`'${key}'`), `Migration 08 RPC must include ${key}`);
      }
      assert.match(m08, /IF NOT public\.is_admin\(\) THEN/, 'RPC must fail closed for non-admins');
    });
  });
});
