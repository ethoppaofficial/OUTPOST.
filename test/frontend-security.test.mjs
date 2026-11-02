import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Import frontend security utilities
import {
  validateEmail,
  validatePassword,
  validatePhoneNumber,
  validateRegistrationNumber,
  validateAmount,
  validateTextLength,
  validateQueryParams,
} from '../src/application/utils/validation.ts';

import {
  normalizeError,
  redactSensitiveData,
} from '../src/application/utils/errorUtils.ts';

import {
  getSafeInternalRedirect,
  isSafeExternalHttpUrl,
  SAFE_EXTERNAL_LINK_PROPS,
} from '../src/application/utils/urlUtils.ts';

import {
  validateUploadFile,
  sanitizeFileName,
  STUDENT_DOCUMENT_UPLOAD_RULES,
  PAYMENT_RECEIPT_UPLOAD_RULES,
  PROPERTY_IMAGE_UPLOAD_RULES,
} from '../src/application/utils/uploadValidation.ts';

import { SupabaseRepository } from '../src/infrastructure/supabase/supabaseRepository.ts';

describe('OUTPOST Frontend Security & Stability Regression Suite', () => {

  describe('1. Anti-Fake Data & Storage Integrity Verification', () => {
    test('Zero occurrences of fake domain "outpost-storage.ng" in source code', () => {
      function scanDir(dir, matches = []) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== '.git') {
              scanDir(fullPath, matches);
            }
          } else if (entry.isFile() && /\.(tsx?|jsx?|mjs|html)$/.test(entry.name)) {
            const content = fs.readFileSync(fullPath, 'utf8');
            if (content.includes('outpost-storage.ng')) {
              matches.push(fullPath);
            }
          }
        }
        return matches;
      }

      const srcMatches = scanDir(path.resolve('src'));
      assert.deepEqual(
        srcMatches,
        [],
        `Detected forbidden fake storage domain 'outpost-storage.ng' in: ${srcMatches.join(', ')}`
      );
    });

    test('Zero hardcoded fake bank account "0249182391" in user-facing pages', () => {
      const reservationPage = fs.readFileSync('src/pages/student/ReservationDetailPage.tsx', 'utf8');
      const invoicePage = fs.readFileSync('src/pages/student/InvoicePage.tsx', 'utf8');
      const propertyPage = fs.readFileSync('src/pages/public/PropertyDetailPage.tsx', 'utf8');

      assert.doesNotMatch(reservationPage, /0249182391/, 'ReservationDetailPage must not hardcode GTBank account 0249182391');
      assert.doesNotMatch(invoicePage, /0249182391/, 'InvoicePage must not hardcode GTBank account 0249182391');
      assert.doesNotMatch(propertyPage, /0249182391/, 'PropertyDetailPage must not hardcode GTBank account 0249182391');
    });

    test('Zero hardcoded "OUTPOST HOUSING ESCROW" claims in payment pages', () => {
      const reservationPage = fs.readFileSync('src/pages/student/ReservationDetailPage.tsx', 'utf8');
      const invoicePage = fs.readFileSync('src/pages/student/InvoicePage.tsx', 'utf8');

      assert.doesNotMatch(reservationPage, /OUTPOST HOUSING ESCROW/i, 'Must not mislead students with escrow custody claims');
      assert.doesNotMatch(invoicePage, /OUTPOST HOUSING ESCROW/i, 'Invoice must reflect direct landlord payment');
    });

    test('PropertyService does not fabricate fake coordinates from AREA_CENTERS when omitted', () => {
      const propService = fs.readFileSync('src/application/services/propertyService.ts', 'utf8');
      assert.doesNotMatch(
        propService,
        /AREA_CENTERS\[data\.area\]/,
        'PropertyService must not substitute AREA_CENTERS coordinates for missing property coordinates'
      );
    });
  });

  describe('2. Input Validation Runtime Suite', () => {
    test('validateEmail accepts valid RFC 5322 emails and rejects invalid formats', () => {
      assert.equal(validateEmail('student@buk.edu.ng').isValid, true);
      assert.equal(validateEmail('landlord.kano@gmail.com').isValid, true);
      assert.equal(validateEmail('admin@outpost.ng').isValid, true);

      assert.equal(validateEmail('').isValid, false);
      assert.equal(validateEmail('not-an-email').isValid, false);
      assert.equal(validateEmail('missing@domain').isValid, false);
      assert.equal(validateEmail('@missinguser.com').isValid, false);
      assert.equal(validateEmail('user@.com').isValid, false);
      assert.equal(validateEmail('a'.repeat(250) + '@example.com').isValid, false);
    });

    test('validatePassword enforces 8+ chars, upper, lower, and digit', () => {
      assert.equal(validatePassword('P@ssword123').isValid, true);
      assert.equal(validatePassword('KanoDambare2026').isValid, true);

      assert.equal(validatePassword('short1A').isValid, false); // <8 chars
      assert.equal(validatePassword('alllowercase1').isValid, false); // missing upper
      assert.equal(validatePassword('ALLUPPERCASE1').isValid, false); // missing lower
      assert.equal(validatePassword('NoDigitsHere!').isValid, false); // missing digit
    });

    test('validatePhoneNumber validates Nigerian numbers with country code or leading zero', () => {
      assert.equal(validatePhoneNumber('08012345678').isValid, true);
      assert.equal(validatePhoneNumber('+2348012345678').isValid, true);
      assert.equal(validatePhoneNumber('2349012345678').isValid, true);
      assert.equal(validatePhoneNumber('07031234567').isValid, true);
      assert.equal(validatePhoneNumber('09123456789').isValid, true);

      assert.equal(validatePhoneNumber('12345').isValid, false);
      assert.equal(validatePhoneNumber('+15551234567').isValid, false); // US number
      assert.equal(validatePhoneNumber('06012345678').isValid, false); // Invalid prefix
      assert.equal(validatePhoneNumber('').isValid, false);
    });

    test('validateRegistrationNumber allows valid BUK formats and rejects injection', () => {
      assert.equal(validateRegistrationNumber('UG19/COMS/1001').isValid, true);
      assert.equal(validateRegistrationNumber('SPS/22/MCM/00045').isValid, true);
      assert.equal(validateRegistrationNumber('CST-2024-001').isValid, true);

      assert.equal(validateRegistrationNumber('AB').isValid, false); // Too short
      assert.equal(validateRegistrationNumber('<script>alert(1)</script>').isValid, false);
      assert.equal(validateRegistrationNumber('DROP TABLE students;--').isValid, false);
    });

    test('validateAmount enforces positive finite numbers and minimum thresholds', () => {
      assert.equal(validateAmount(250000).isValid, true);
      assert.equal(validateAmount('150000').isValid, true);
      assert.equal(validateAmount(5000, 'Rent', 1000).isValid, true);

      assert.equal(validateAmount(-500).isValid, false);
      assert.equal(validateAmount(0, 'Caution Fee', 100).isValid, false);
      assert.equal(validateAmount(NaN).isValid, false);
      assert.equal(validateAmount(Infinity).isValid, false);
      assert.equal(validateAmount('abc').isValid, false);
    });

    test('validateTextLength enforces min and max string bounds', () => {
      assert.equal(validateTextLength('Adequate feedback text', 5, 100, 'Feedback').isValid, true);
      assert.equal(validateTextLength('Too', 5, 100, 'Feedback').isValid, false);
      assert.equal(validateTextLength('A'.repeat(101), 5, 100, 'Feedback').isValid, false);
    });

    test('validateQueryParams strips illegal or excessively long query values', () => {
      const safeParams = validateQueryParams({
        area: 'Dambare',
        sort: 'price_asc',
        dangerous: '<script>evil()</script>',
        nested: 'normal text',
      }, ['area', 'sort', 'dangerous']);

      assert.equal(safeParams.area, 'Dambare');
      assert.equal(safeParams.sort, 'price_asc');
      assert.equal(safeParams.dangerous, undefined); // sanitized out because of illegal chars
      assert.equal(safeParams.nested, undefined); // not in allowed keys
    });
  });

  describe('3. Error Normalization & Information Disclosure Defense', () => {
    test('normalizeError masks PostgreSQL syntax and relation details', () => {
      const sqlError = new Error('syntax error at or near "SELECT * FROM profiles" at character 1');
      const normalized = normalizeError(sqlError);

      assert.equal(normalized.category, 'UNEXPECTED');
      assert.equal(normalized.code, 'ERR_DB_INTERNAL');
      assert.doesNotMatch(normalized.userMessage, /SELECT/i);
      assert.doesNotMatch(normalized.userMessage, /syntax error/i);
      assert.match(normalized.userMessage, /database error occurred/i);
    });

    test('normalizeError handles authentication expired JWT cleanly', () => {
      const jwtError = new Error('JWT expired at 1729000000');
      const normalized = normalizeError(jwtError);

      assert.equal(normalized.category, 'UNAUTHORIZED');
      assert.equal(normalized.code, 'ERR_AUTH_SESSION_EXPIRED');
      assert.match(normalized.userMessage, /session has expired/i);
    });

    test('normalizeError classifies account suspension and forbidden actions', () => {
      const forbiddenError = new Error('Action forbidden: user account_status is suspended');
      const normalized = normalizeError(forbiddenError);

      assert.equal(normalized.category, 'FORBIDDEN');
      assert.equal(normalized.code, 'ERR_FORBIDDEN');
      assert.equal(normalized.canRetry, false);
    });

    test('redactSensitiveData redacts Bearer tokens, passwords, and service keys', () => {
      const rawText = 'Request header: Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret and password="mySecretPassword123"';
      const redacted = redactSensitiveData(rawText);

      assert.doesNotMatch(redacted, /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.secret/);
      assert.doesNotMatch(redacted, /mySecretPassword123/);
      assert.match(redacted, /\[REDACTED_TOKEN\]/);
      assert.match(redacted, /password="\[REDACTED\]"/);
    });
  });

  describe('4. URL Sanitization & Open Redirect Defense', () => {
    test('getSafeInternalRedirect permits legitimate internal paths', () => {
      assert.equal(getSafeInternalRedirect('/student/properties'), '/student/properties');
      assert.equal(getSafeInternalRedirect('/dashboard'), '/dashboard');
      assert.equal(getSafeInternalRedirect('/landlord/properties/new'), '/landlord/properties/new');
    });

    test('getSafeInternalRedirect blocks protocol-relative open redirect attacks', () => {
      assert.equal(getSafeInternalRedirect('//evil.com/phish', '/default'), '/default');
      assert.equal(getSafeInternalRedirect('///evil.com', '/default'), '/default');
    });

    test('getSafeInternalRedirect blocks absolute external URLs and schemes', () => {
      assert.equal(getSafeInternalRedirect('https://attacker.com/login', '/login'), '/login');
      assert.equal(getSafeInternalRedirect('http://attacker.com', '/'), '/');
      assert.equal(getSafeInternalRedirect('javascript:alert(1)', '/'), '/');
      assert.equal(getSafeInternalRedirect('data:text/html,<script>alert(1)</script>', '/'), '/');
    });

    test('getSafeInternalRedirect blocks backslash evasion attacks', () => {
      assert.equal(getSafeInternalRedirect('/\\attacker.com', '/fallback'), '/fallback');
    });

    test('isSafeExternalHttpUrl permits HTTPS and rejects insecure or javascript protocols', () => {
      assert.equal(isSafeExternalHttpUrl('https://maps.google.com/?q=Dambare'), true);
      assert.equal(isSafeExternalHttpUrl('https://openstreetmap.org'), true);
      assert.equal(isSafeExternalHttpUrl('http://insecure-site.com'), false);
      assert.equal(isSafeExternalHttpUrl('javascript:steal()'), false);
    });

    test('SAFE_EXTERNAL_LINK_PROPS includes rel="noopener noreferrer"', () => {
      assert.equal(SAFE_EXTERNAL_LINK_PROPS.target, '_blank');
      assert.equal(SAFE_EXTERNAL_LINK_PROPS.rel, 'noopener noreferrer');
    });
  });

  describe('5. Upload Validation & File Sanitization Suite', () => {
    test('sanitizeFileName removes path traversal and dangerous characters', () => {
      assert.equal(sanitizeFileName('../../etc/passwd'), 'passwd');
      assert.equal(sanitizeFileName('..\\..\\windows\\system32.dll'), 'system32.dll');
      assert.equal(sanitizeFileName('student document #1 (final).pdf'), 'student_document__1__final_.pdf');
      assert.equal(sanitizeFileName('...test.png'), 'test.png');
      assert.equal(sanitizeFileName(''), 'unnamed_file');
    });

    test('validateUploadFile rejects null, undefined, and empty 0-byte files', () => {
      assert.equal(validateUploadFile(null, STUDENT_DOCUMENT_UPLOAD_RULES).isValid, false);
      assert.equal(validateUploadFile(undefined, STUDENT_DOCUMENT_UPLOAD_RULES).isValid, false);

      const emptyFile = { name: 'empty.pdf', size: 0, type: 'application/pdf' };
      assert.equal(validateUploadFile(emptyFile, STUDENT_DOCUMENT_UPLOAD_RULES).isValid, false);
    });

    test('validateUploadFile enforces 5MB limit for student verification documents', () => {
      const validDoc = { name: 'id_card.pdf', size: 2 * 1024 * 1024, type: 'application/pdf' };
      assert.equal(validateUploadFile(validDoc, STUDENT_DOCUMENT_UPLOAD_RULES).isValid, true);

      const oversizedDoc = { name: 'huge_scan.pdf', size: 6 * 1024 * 1024, type: 'application/pdf' };
      const res = validateUploadFile(oversizedDoc, STUDENT_DOCUMENT_UPLOAD_RULES);
      assert.equal(res.isValid, false);
      assert.match(res.error, /exceeds the maximum allowed limit/i);
    });

    test('validateUploadFile enforces 10MB limit and image/pdf MIME for payment receipts', () => {
      const validReceipt = { name: 'bank_transfer.jpg', size: 1.5 * 1024 * 1024, type: 'image/jpeg' };
      assert.equal(validateUploadFile(validReceipt, PAYMENT_RECEIPT_UPLOAD_RULES).isValid, true);

      const disallowedDoc = { name: 'script.exe', size: 500, type: 'application/x-msdownload' };
      const res = validateUploadFile(disallowedDoc, PAYMENT_RECEIPT_UPLOAD_RULES);
      assert.equal(res.isValid, false);
      assert.match(res.error, /file type/i);
    });

    test('validateUploadFile rejects executable and script uploads in property images', () => {
      const scriptFile = { name: 'exploit.js', size: 1024, type: 'application/javascript' };
      const res = validateUploadFile(scriptFile, PROPERTY_IMAGE_UPLOAD_RULES);
      assert.equal(res.isValid, false);
    });
  });

  describe('6. Supabase Client & Configuration Security Guard', () => {
    test('appConfig.ts defines robust Supabase configuration with fail-closed production mode', () => {
      const appConfigContent = fs.readFileSync('src/infrastructure/config/appConfig.ts', 'utf8');
      assert.match(
        appConfigContent,
        /isSupabaseConfigured/,
        'appConfig must export isSupabaseConfigured'
      );
      assert.match(
        appConfigContent,
        /service-role key detected/i,
        'appConfig must check for accidental leak of service role key'
      );
      assert.doesNotMatch(
        appConfigContent,
        /firebaseConfig/i,
        'appConfig must not import or embed firebaseConfig JSON'
      );
    });

    test('supabaseClient initializes with validated appConfig settings', () => {
      const clientContent = fs.readFileSync('src/infrastructure/supabase/supabaseClient.ts', 'utf8');
      assert.match(
        clientContent,
        /appConfig\.supabase\.url/,
        'supabaseClient must initialize with validated appConfig.supabase.url'
      );
      assert.match(
        clientContent,
        /appConfig\.supabase\.anonKey/,
        'supabaseClient must initialize with validated appConfig.supabase.anonKey'
      );
    });
  });

  describe('7. Repository Session Isolation on Logout', () => {
    test('clearActiveSession() scrubs user-specific in-memory collections', () => {
      const repo = new SupabaseRepository();

      // Seed a user and an active session
      repo.setActiveUserId('test-student-123');
      assert.equal(repo.getActiveUserId(), 'test-student-123');

      // Add a student doc and verify retrieval
      repo.addStudentDocument({
        studentId: 'test-student-123',
        studentName: 'Amina Danbare',
        documentType: 'admission_letter',
        fileName: 'admission.pdf',
        fileSize: 1024 * 50,
        documentUrl: 'https://supabase.co/storage/v1/object/public/student-docs/test.pdf',
      });
      assert.equal(repo.getStudentDocs('test-student-123').length, 1);

      // Now clear active session (simulate logout)
      repo.clearActiveSession();

      // Active user ID must be empty
      assert.equal(repo.getActiveUserId(), '');

      // User-specific collections must be scrubbed
      assert.equal(repo.getStudentDocs('test-student-123').length, 0);
      assert.equal(repo.getPaymentReceipts().length, 0);
      assert.equal(repo.getReservations().length, 0);
      assert.equal(repo.getInvoices().length, 0);
    });
  });

  describe('8. Supabase-Only Final Cutover Validation (Phase 13)', () => {
    test('Zero source files in src/ import from firebase client SDK', () => {
      function scanDirForFirebase(dir, violations = []) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== '.git') {
              scanDirForFirebase(fullPath, violations);
            }
          } else if (entry.isFile() && /\.(tsx?|jsx?)$/.test(entry.name)) {
            const content = fs.readFileSync(fullPath, 'utf8');
            if (/(?:from|import)\s+['"]firebase(\/.*)?['"]/.test(content)) {
              violations.push(fullPath);
            }
          }
        }
        return violations;
      }
      const violations = scanDirForFirebase(path.resolve('src'));
      assert.deepEqual(violations, [], `No src files should import firebase: found ${violations.join(', ')}`);
    });

    test('Authoritative production repository is SupabaseRepository', async () => {
      const { repository, getActiveRepository, SupabaseRepository } = await import('../src/infrastructure/repositories/index.ts');
      assert.ok(repository instanceof SupabaseRepository, 'repository export must be an instance of SupabaseRepository');
      assert.ok(getActiveRepository() instanceof SupabaseRepository, 'getActiveRepository() must return SupabaseRepository');
    });

    test('Authoritative storage service is SupabaseStorageService', async () => {
      const { storageService, StorageService } = await import('../src/application/services/storageService.ts');
      const { SupabaseStorageService } = await import('../src/infrastructure/supabase/supabaseStorageService.ts');
      assert.ok(storageService instanceof SupabaseStorageService, 'storageService must be instance of SupabaseStorageService');
      assert.equal(StorageService, SupabaseStorageService, 'StorageService must export SupabaseStorageService');
    });

    test('appConfig is configured exclusively for Supabase mode', async () => {
      const { appConfig, isSupabaseMode, isFirebaseMode } = await import('../src/infrastructure/config/appConfig.ts');
      assert.equal(appConfig.backendMode, 'supabase', 'backendMode must be strictly supabase');
      assert.equal(isSupabaseMode(), true, 'isSupabaseMode() must be true');
      assert.equal(isFirebaseMode(), false, 'isFirebaseMode() must be false');
    });

    test('No unmanaged SUPABASE_SERVICE_ROLE_KEY or raw secret tokens in src/', () => {
      function scanDirForSecrets(dir, violations = []) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== '.git') {
              scanDirForSecrets(fullPath, violations);
            }
          } else if (entry.isFile() && /\.(tsx?|jsx?|json)$/.test(entry.name)) {
            const content = fs.readFileSync(fullPath, 'utf8');
            if (/service_role.*eyJhbGciOi/i.test(content) || /sbp_[a-zA-Z0-9]{30,}/.test(content)) {
              violations.push(fullPath);
            }
          }
        }
        return violations;
      }
      const violations = scanDirForSecrets(path.resolve('src'));
      assert.deepEqual(violations, [], `No frontend source files should embed secret keys: found ${violations.join(', ')}`);
    });

    test('.gitignore explicitly ignores .env.local and private environment files', () => {
      const gitignore = fs.readFileSync('.gitignore', 'utf8');
      assert.ok(gitignore.includes('.env*'), '.gitignore must ignore environment files');
      assert.ok(gitignore.includes('.env.local'), '.gitignore must ignore .env.local explicitly');
    });
  });

  describe('9. MapTiler Configuration & Device Geolocation Privacy Suite', () => {
    test('MapTiler key is read via import.meta.env.VITE_MAPTILER_API_KEY without hardcoded credentials', () => {
      const mapConfigSrc = fs.readFileSync('src/infrastructure/config/mapConfig.ts', 'utf8');
      assert.ok(
        mapConfigSrc.includes('import.meta.env.VITE_MAPTILER_API_KEY'),
        'mapConfig must read VITE_MAPTILER_API_KEY from import.meta.env'
      );
      assert.doesNotMatch(
        mapConfigSrc,
        /(?:apiKey|api_key|maptilerKey)\s*[:=]\s*['"][a-zA-Z0-9]{15,}['"]/i,
        'mapConfig must not contain hardcoded private API keys'
      );
    });

    test('.env.example includes VITE_MAPTILER_API_KEY placeholder and comments', () => {
      const envExample = fs.readFileSync('.env.example', 'utf8');
      assert.ok(
        envExample.includes('VITE_MAPTILER_API_KEY'),
        '.env.example must declare VITE_MAPTILER_API_KEY'
      );
    });

    test('Geolocation service strictly forbids watchPosition and requires user action', () => {
      const geoSrc = fs.readFileSync('src/application/services/geolocationService.ts', 'utf8');
      assert.ok(
        geoSrc.includes('navigator.geolocation.getCurrentPosition'),
        'Must use single-shot navigator.geolocation.getCurrentPosition'
      );
      assert.doesNotMatch(
        geoSrc,
        /\.watchPosition\(/,
        'Must never use watchPosition to track students continuously'
      );
      assert.ok(
        geoSrc.includes('maximumAge: 0'),
        'Must set maximumAge: 0 to prevent stale cached positions'
      );
      assert.ok(
        geoSrc.includes('timeout: 10000'),
        'Must set reasonable 10s timeout'
      );
    });

    test('Both PropertyMap and StudentVerifiedPropertiesMap provide "Use my current location" buttons', () => {
      const propMapSrc = fs.readFileSync('src/components/map/PropertyMap.tsx', 'utf8');
      const studentMapSrc = fs.readFileSync('src/components/map/StudentVerifiedPropertiesMap.tsx', 'utf8');

      assert.ok(
        propMapSrc.includes('Use my current location'),
        'PropertyMap must provide "Use my current location" button'
      );
      assert.ok(
        studentMapSrc.includes('Use my current location'),
        'StudentVerifiedPropertiesMap must provide "Use my current location" button'
      );
      assert.ok(
        propMapSrc.includes('requestCurrentDevicePosition'),
        'PropertyMap must invoke requestCurrentDevicePosition only on user click'
      );
      assert.ok(
        studentMapSrc.includes('requestCurrentDevicePosition'),
        'StudentVerifiedPropertiesMap must invoke requestCurrentDevicePosition only on user click'
      );
    });

    test('Device GPS coordinates are never stored in Supabase or persistent storage', () => {
      const geoSrc = fs.readFileSync('src/application/services/geolocationService.ts', 'utf8');
      assert.doesNotMatch(
        geoSrc,
        /supabase\s*\.\s*from/,
        'geolocationService must never persist device coordinates to Supabase'
      );
      assert.doesNotMatch(
        geoSrc,
        /localStorage\s*\.\s*setItem\s*\(\s*['"][^'"]*location/,
        'geolocationService must never save raw GPS coordinates to localStorage'
      );
    });
  });
});
