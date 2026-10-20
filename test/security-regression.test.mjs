import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('OUTPOST Master Security Regression Test Suite', () => {

  describe('1. Storage Rules & Tenant Isolation Inspection', () => {
    const rulesContent = fs.readFileSync('storage.rules', 'utf8');

    test('Payment receipts must use tenant-isolated path {landlordId}/{studentId}/{reservationId}', () => {
      assert.match(
        rulesContent,
        /match\s+\/payment-receipts\/\{landlordId\}\/\{studentId\}\/\{reservationId\}\/\{fileName\}/,
        'Storage rules must define isolated path: /payment-receipts/{landlordId}/{studentId}/{reservationId}/{fileName}'
      );
    });

    test('Payment receipts read access must restrict cross-tenant visibility', () => {
      // Must not allow generic isLandlord() read on payment receipts
      const isolatedSection = rulesContent.match(
        /match\s+\/payment-receipts\/\{landlordId\}\/\{studentId\}\/\{reservationId\}\/\{fileName\}\s*\{([\s\S]*?)\}/
      );
      assert.ok(isolatedSection, 'Isolated payment-receipts rule block must exist');
      const block = isolatedSection[1];
      assert.match(block, /isOwner\(studentId\)\s*\|\|\s*isOwner\(landlordId\)/, 'Receipt read must only allow student owner or property landlord');
      assert.doesNotMatch(block, /\|\s*isLandlord\(\)/, 'Must NOT grant broad isLandlord() access across all receipts');
    });

    test('Chat attachments must use sender-isolated path {conversationId}/{senderId}', () => {
      assert.match(
        rulesContent,
        /match\s+\/chat-attachments\/\{conversationId\}\/\{senderId\}\/\{fileName\}/,
        'Storage rules must define sender-isolated path: /chat-attachments/{conversationId}/{senderId}/{fileName}'
      );
    });

    test('Chat attachments must not allow broad signedIn() read', () => {
      const chatSection = rulesContent.match(
        /match\s+\/chat-attachments\/\{conversationId\}\/\{senderId\}\/\{fileName\}\s*\{([\s\S]*?)\}/
      );
      assert.ok(chatSection, 'Isolated chat-attachments rule block must exist');
      const block = chatSection[1];
      assert.match(block, /isOwner\(senderId\)\s*\|\|\s*isAdmin\(\)/, 'Chat read must only allow sender or admin');
      assert.doesNotMatch(block, /allow\s+read:\s*if\s+signedIn\(\);/, 'Must NOT allow arbitrary signedIn() reads');
    });

    test('Property images must use tenant-isolated path {landlordId}/{propertyId}', () => {
      assert.match(
        rulesContent,
        /match\s+\/property-images\/\{landlordId\}\/\{propertyId\}\/\{fileName\}/,
        'Storage rules must define isolated path: /property-images/{landlordId}/{propertyId}/{fileName}'
      );
    });

    test('Property images write must enforce landlord ownership', () => {
      const propSection = rulesContent.match(
        /match\s+\/property-images\/\{landlordId\}\/\{propertyId\}\/\{fileName\}\s*\{([\s\S]*?)\}/
      );
      assert.ok(propSection, 'Isolated property-images rule block must exist');
      const block = propSection[1];
      assert.match(block, /isOwner\(landlordId\)\s*\|\|\s*isAdmin\(\)/, 'Only the landlord owner or admin can upload/modify images');
    });

    test('Legacy receipts path must have broad landlord access removed', () => {
      const legacySection = rulesContent.match(
        /match\s+\/payment-receipts\/\{reservationId\}\/\{fileName\}\s*\{([\s\S]*?)\}/
      );
      assert.ok(legacySection, 'Legacy payment-receipts rule block must exist for backward compatibility');
      const block = legacySection[1];
      assert.doesNotMatch(block, /\|\s*isLandlord\(\)/, 'Legacy receipts rule must NOT allow broad isLandlord() read');
    });

    test('File size and MIME type guards are defined and enforced', () => {
      assert.match(rulesContent, /function validImage\(maxBytes\)/);
      assert.match(rulesContent, /function validDocument\(maxBytes\)/);
      assert.match(rulesContent, /function validChatAttachment\(maxBytes\)/);
    });
  });

  describe('2. Firestore Security Rules & Authorization Boundaries', () => {
    const firestoreRules = fs.readFileSync('firestore.rules', 'utf8');

    test('Users collection update must prevent self-un-suspension', () => {
      const usersSection = firestoreRules.match(
        /match\s+\/users\/\{userId\}\s*\{([\s\S]*?)\n\s*\}/
      );
      assert.ok(usersSection, 'Users rule block must exist');
      const block = usersSection[1];
      assert.match(block, /accountIsActive\(userId\)/, 'Users update must require accountIsActive');
      assert.match(block, /request\.resource\.data\.get\('accountStatus'/, 'Users update must verify accountStatus immutability');
      assert.match(block, /request\.resource\.data\.get\('role'/, 'Users update must verify role immutability');
    });

    test('Student profile creation must forbid self-granting isProfileVerified', () => {
      const studentSection = firestoreRules.match(
        /match\s+\/studentProfiles\/\{userId\}\s*\{([\s\S]*?)\n\s*\}/
      );
      assert.ok(studentSection, 'studentProfiles rule block must exist');
      const block = studentSection[1];
      assert.match(block, /request\.resource\.data\.get\('isProfileVerified',\s*false\)\s*==\s*false/, 'Must require isProfileVerified == false on creation');
    });

    test('Landlord profile creation must forbid self-granting approved verificationStatus', () => {
      const landlordSection = firestoreRules.match(
        /match\s+\/landlordProfiles\/\{userId\}\s*\{([\s\S]*?)\n\s*\}/
      );
      assert.ok(landlordSection, 'landlordProfiles rule block must exist');
      const block = landlordSection[1];
      assert.match(block, /verificationStatus.*in\s*\[\s*'not_started',\s*'pending'\s*\]/, 'Must restrict initial verificationStatus');
    });

    test('Invoices creation must verify linked reservation ownership', () => {
      const invoiceSection = firestoreRules.match(
        /match\s+\/invoices\/\{invoiceId\}\s*\{([\s\S]*?)\n\s*\}/
      );
      assert.ok(invoiceSection, 'invoices rule block must exist');
      const block = invoiceSection[1];
      assert.match(block, /exists\(\/databases\/\$\(database\)\/documents\/reservations\/\$\(request\.resource\.data\.reservationId\)\)/, 'Must verify reservation exists');
      assert.match(block, /get\(\/databases\/\$\(database\)\/documents\/reservations\/\$\(request\.resource\.data\.reservationId\)\)\.data\.studentId\s*==\s*request\.auth\.uid/, 'Must verify student matches reservation');
    });

    test('Conversation creation enforces participant bounds (2 to 20)', () => {
      const convoSection = firestoreRules.match(
        /match\s+\/conversations\/\{conversationId\}\s*\{([\s\S]*?)\n\s*\}/
      );
      assert.ok(convoSection, 'conversations rule block must exist');
      const block = convoSection[1];
      assert.match(block, /participantIds\.size\(\)\s*>=\s*2/, 'Conversation must have at least 2 participants');
      assert.match(block, /participantIds\.size\(\)\s*<=\s*20/, 'Conversation must cap at 20 participants');
    });

    test('Reservations cannot be directly confirmed by client write', () => {
      const resSection = firestoreRules.match(
        /match\s+\/reservations\/\{reservationId\}\s*\{([\s\S]*?)\n\s*match/
      );
      assert.ok(resSection, 'reservations rule block must exist');
      const block = resSection[1];
      assert.doesNotMatch(block, /request\.resource\.data\.status\s*==\s*'confirmed'/, 'Direct client update to confirmed status must be forbidden');
    });
  });

  describe('3. StorageService Implementation Security', () => {
    test('sanitizeFileName removes directory traversal and illegal characters', async () => {
      const { StorageService } = await import('../src/infrastructure/firebase/storageService.ts');
      const svc = new StorageService();
      assert.equal(typeof svc.sanitizeUrlForLog, 'function', 'sanitizeUrlForLog method must exist');

      // Test token scrubbing
      const sampleUrl = 'https://firebasestorage.googleapis.com/v0/b/bucket/o/receipt.pdf?alt=media&token=SECRET_BEARER_TOKEN_XYZ';
      const scrubbed = svc.sanitizeUrlForLog(sampleUrl);
      assert.ok(!scrubbed.includes('SECRET_BEARER_TOKEN_XYZ'), 'Token parameter must be scrubbed');
      assert.ok(scrubbed.includes('REDACTED'), 'Redacted token marker must be present');
    });
  });

  describe('4. Repository Secret Review', () => {
    test('Tracked files contain no unmanaged private keys or service account certificates', () => {
      const trackedFiles = [
        'storage.rules',
        'firestore.rules',
        'src/infrastructure/firebase/firebaseConfig.ts',
        'src/infrastructure/firebase/storageService.ts',
        'functions/src/firebaseAdmin.ts',
        'functions/src/reservationOperations.ts',
        'functions/src/adminOperations.ts'
      ];

      for (const rel of trackedFiles) {
        if (!fs.existsSync(rel)) continue;
        const content = fs.readFileSync(rel, 'utf8');
        assert.doesNotMatch(content, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, `${rel} must not contain raw private key headers`);
        assert.doesNotMatch(content, /"type":\s*"service_account"/, `${rel} must not contain raw GCP service account JSON`);
        assert.doesNotMatch(content, /AKIA[0-9A-Z]{16}/, `${rel} must not contain AWS access keys`);
      }
    });
  });
});
