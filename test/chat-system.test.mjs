import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

function readFile(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('Chat, Group Sync & Role Routing Regression Suite', () => {
  it('ChatPage uses role-aware base paths and avoids iframe-blocked alert/confirm/window.open', () => {
    const chatPage = readFile('src/pages/student/ChatPage.tsx');

    assert.match(chatPage, /export function getChatBasePathForRole/);
    assert.match(chatPage, /role === 'landlord'\s*\)\s*return '\/landlord\/chat'/);
    assert.match(chatPage, /role === 'admin'\s*\)\s*return '\/admin\/chat'/);
    assert.match(chatPage, /navigate\(`\$\{chatBasePath\}\/\$\{id\}`\)/);

    assert.doesNotMatch(chatPage, /navigate\(`?\/student\/chat/);
    assert.doesNotMatch(chatPage, /\balert\s*\(/);
    assert.doesNotMatch(chatPage, /\bwindow\.open\s*\(/);
  });

  it('GroupDetailPage and GroupsPage use AuthContext, persisted DMs, and inline confirmations', () => {
    const groupDetail = readFile('src/pages/student/GroupDetailPage.tsx');
    const groupsPage = readFile('src/pages/student/GroupsPage.tsx');

    assert.match(groupDetail, /useAuth/);
    assert.match(groupDetail, /startDirectConversationPersisted/);
    assert.match(groupDetail, /loadUserConversations/);
    assert.doesNotMatch(groupDetail, /\bconfirm\s*\(/);
    assert.doesNotMatch(groupDetail, /\balert\s*\(/);

    assert.match(groupsPage, /useAuth/);
    assert.match(groupsPage, /loadUserConversations/);
    assert.doesNotMatch(groupsPage, /\bconfirm\s*\(/);
    assert.doesNotMatch(groupsPage, /\balert\s*\(/);
  });

  it('SupabaseRepository hydrates live chat, inserts participants sequentially for RLS, and isolates seed data to Node tests', () => {
    const repo = readFile('src/infrastructure/supabase/supabaseRepository.ts');

    assert.match(repo, /if\s*\(!IS_PROD\s*&&\s*typeof window === 'undefined'\)\s*\{\s*this\.loadSeedProfiles\(\)/);
    assert.match(repo, /async hydrateUserConversationsAndMessages\(/);
    assert.match(repo, /async fetchConversationMessagesFromSupabase\(/);
    assert.match(repo, /async searchProfilesForChat\(/);
    assert.match(repo, /async startDirectConversationPersisted\(/);
    assert.match(repo, /recordAttachmentMessage\(/);

    // Ensure conversation_participants inserts self before peer so RLS is_conversation_participant passes
    const idxSelf = repo.indexOf("from('conversation_participants')\n      .upsert({ conversation_id: conv.id, user_id: userIdA }");
    const idxPeer = repo.indexOf("from('conversation_participants')\n      .upsert({ conversation_id: conv.id, user_id: userIdB }");
    assert.ok(idxSelf > 0 && idxPeer > idxSelf, 'userIdA must be inserted before userIdB in conversation_participants');
  });

  it('chatService.sendAttachmentMessage records authoritative server messageId without duplicating message insert', () => {
    const chatService = readFile('src/application/services/chatService.ts');
    const storageService = readFile('src/infrastructure/supabase/supabaseStorageService.ts');

    assert.match(storageService, /finalize-chat-attachment-upload/);
    assert.match(storageService, /finalizeData\?\.message\?\.id\s*\|\|\s*messageId/);
    assert.match(chatService, /repository\.recordAttachmentMessage\(/);
    assert.match(chatService, /res\.messageId/);
  });

  it('App.tsx registers chat routes for student, landlord, and admin roles plus /reset-password handler', () => {
    const appTsx = readFile('src/App.tsx');

    for (const routePath of [
      '/student/chat',
      '/student/chat/:conversationId',
      '/landlord/chat',
      '/landlord/chat/:conversationId',
      '/admin/chat',
      '/admin/chat/:conversationId',
      '/reset-password',
    ]) {
      assert.ok(appTsx.includes(`path="${routePath}"`), `Missing route ${routePath} in App.tsx`);
    }
  });
});
