/**
 * @file ChatPage.tsx
 * @module pages/student/ChatPage
 * @description Full-featured real-time chat interface for peer-to-peer and accommodation group conversations.
 *
 * Capabilities & Boundaries:
 * - Conversation Scoping: Direct 1-on-1 messages between students/landlords and group channels for accommodation groups.
 * - Real-Time Push: Subscribes to Supabase Realtime broadcast channels for incoming messages and read receipts.
 * - Message Replies & Mentions: Inline citation bubbles for targeted replies and `@mention` notifications.
 * - 15-Minute Edit Enforcement: Allows message editing within 15 minutes of sending; blocked thereafter by UI and PostgreSQL trigger.
 * - Private Attachments: Sends images and documents via Supabase Storage private bucket `chat-attachments`.
 */

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Send,
  MessageSquare,
  Users,
  Search,
  Check,
  CheckCheck,
  AlertCircle,
  Clock,
  RotateCw,
  Edit2,
  Reply,
  X,
  AtSign,
  Bell,
  BellOff,
  Plus,
  User,
  Crown,
  ShieldCheck,
  ArrowLeft,
  ChevronRight,
  MoreVertical,
  Paperclip,
  FileText,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { authService } from '../../application/services/authService';
import { useAuth } from '../../application/context/AuthContext';
import { chatService } from '../../application/services/chatService';
import {
  Conversation,
  ChatMessage,
  MessageReplyReference,
  MessageMention,
} from '../../domain/types';
import { Modal } from '../../components/ui/Modal';

export function getChatBasePathForRole(role?: string | null): string {
  if (role === 'landlord') return '/landlord/chat';
  if (role === 'admin') return '/admin/chat';
  return '/student/chat';
}

export const ChatPage: React.FC = () => {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const fallbackSession = authService.getSession();
  const activeUserId = currentUser?.id || (fallbackSession.user.id !== 'anonymous' ? fallbackSession.user.id : '');
  const activeUserRole = currentUser?.role || fallbackSession.user.role || 'student';
  const activeDisplayName = currentUser?.fullName || fallbackSession.displayName || 'User';
  const chatBasePath = getChatBasePathForRole(activeUserRole);

  const [conversations, setConversations] = useState<Conversation[]>(() =>
    activeUserId ? chatService.getUserConversations(activeUserId) : []
  );
  const [loadingConversations, setLoadingConversations] = useState<boolean>(true);
  const [chatError, setChatError] = useState<string | null>(null);

  const [activeConvId, setActiveConvId] = useState<string>(
    conversationId || conversations[0]?.id || ''
  );

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState<boolean>(false);
  const [inputText, setInputText] = useState('');
  const [activeReply, setActiveReply] = useState<MessageReplyReference | null>(null);

  // Inline Message Editing State
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  // In-Conversation Search
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Mentions Popover
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionPosition, setMentionPosition] = useState<number>(0);

  // Typing state
  const [remoteTypingUser, setRemoteTypingUser] = useState<string | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Group Details / Member Drawer
  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false);

  // New Direct Chat Modal
  const [newChatModalOpen, setNewChatModalOpen] = useState(false);
  const [userSearchTerm, setUserSearchTerm] = useState('');
  const [peerResults, setPeerResults] = useState<Array<{ id: string; fullName: string; email: string; role: string }>>([]);
  const [searchingPeers, setSearchingPeers] = useState(false);
  const [startingChatId, setStartingChatId] = useState<string | null>(null);

  // Private attachment signed URL preview card
  const [signedAttachmentLinks, setSignedAttachmentLinks] = useState<Record<string, { url: string; fileName: string }>>({});
  const [loadingAttachmentId, setLoadingAttachmentId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  const activeConv = conversations.find((c) => c.id === activeConvId);

  const hydrateConversations = async () => {
    if (!activeUserId) {
      setConversations([]);
      setLoadingConversations(false);
      return;
    }
    setLoadingConversations(true);
    setChatError(null);
    try {
      const liveConvos = await chatService.loadUserConversations(activeUserId);
      setConversations(liveConvos);
      if (!activeConvId && !conversationId && liveConvos.length > 0) {
        setActiveConvId(liveConvos[0].id);
      }
    } catch (err: any) {
      setChatError(err?.message || 'Unable to load conversations from Supabase.');
    } finally {
      setLoadingConversations(false);
    }
  };

  // Hydrate live conversations when authenticated user becomes ready or changes
  useEffect(() => {
    void hydrateConversations();
    if (!activeUserId) return;
    const unsubConvos = chatService.subscribeToConversations(() => {
      setConversations(chatService.getUserConversations(activeUserId));
    });
    return () => unsubConvos();
  }, [activeUserId]);

  // Sync activeConvId if URL param changes
  useEffect(() => {
    if (conversationId && conversationId !== activeConvId) {
      setActiveConvId(conversationId);
    }
  }, [conversationId]);

  // Live user search inside New Direct Chat modal
  useEffect(() => {
    if (!newChatModalOpen || !activeUserId) return;
    const term = userSearchTerm.trim();
    if (!term) {
      setPeerResults([]);
      return;
    }

    let cancelled = false;
    setSearchingPeers(true);
    const timer = setTimeout(async () => {
      try {
        const results = await chatService.searchChatUsers(term, activeUserId);
        if (!cancelled) setPeerResults(results);
      } catch (err: any) {
        if (!cancelled) setChatError(err?.message || 'Could not search users.');
      } finally {
        if (!cancelled) setSearchingPeers(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [newChatModalOpen, userSearchTerm, activeUserId]);

  // Load and subscribe to active conversation messages
  useEffect(() => {
    if (!activeConvId || !activeUserId) return;
    let cancelled = false;

    // Mark messages as read
    chatService.markMessagesAsRead(activeConvId, activeUserId);

    const cachedMsgs = chatService.getConversationMessages(activeConvId);
    setMessages(cachedMsgs);
    setLoadingMessages(cachedMsgs.length === 0);

    chatService
      .loadConversationMessages(activeConvId)
      .then((liveMsgs) => {
        if (!cancelled) {
          setMessages(liveMsgs);
          setLoadingMessages(false);
        }
      })
      .catch((err: any) => {
        if (!cancelled) {
          setChatError(err?.message || 'Unable to load messages.');
          setLoadingMessages(false);
        }
      });

    // Refresh conversation list
    setConversations(chatService.getUserConversations(activeUserId));

    // Subscribe to new incoming messages
    const unsubMsg = chatService.subscribeToMessages(activeConvId, (newMsg) => {
      setMessages((prev) => {
        const exists = prev.some((m) => m.id === newMsg.id);
        if (exists) {
          return prev.map((m) => (m.id === newMsg.id ? newMsg : m));
        }
        return [...prev, newMsg];
      });
      if (newMsg.senderId !== activeUserId) {
        chatService.markMessagesAsRead(activeConvId, activeUserId);
      }
      setConversations(chatService.getUserConversations(activeUserId));
    });

    // Subscribe to typing notifications
    const unsubTyping = chatService.subscribeToTyping(activeConvId, (state) => {
      if (state.userId !== activeUserId) {
        if (state.isTyping) {
          setRemoteTypingUser(state.userName);
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = setTimeout(() => setRemoteTypingUser(null), 3000);
        } else {
          setRemoteTypingUser(null);
        }
      }
    });

    // Subscribe to read receipts
    const unsubRead = chatService.subscribeToReadReceipts(activeConvId, () => {
      const refreshed = chatService.getConversationMessages(activeConvId);
      setMessages(refreshed);
    });

    return () => {
      cancelled = true;
      unsubMsg();
      unsubTyping();
      unsubRead();
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, [activeConvId, activeUserId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Handle switching conversations using current persona's base route
  const handleSelectConversation = (id: string) => {
    setActiveConvId(id);
    navigate(`${chatBasePath}/${id}`);
    setActiveReply(null);
    setEditingMessageId(null);
    setChatError(null);
    setSearchOpen(false);
    setSearchQuery('');
  };

  // Broadcast typing on input change
  const handleInputChange = (val: string) => {
    setInputText(val);

    if (activeConv && activeUserId) {
      chatService.setTypingState(activeConv.id, activeUserId, activeDisplayName, true);
    }

    // Check for '@' mention trigger
    const lastAtIndex = val.lastIndexOf('@');
    if (lastAtIndex !== -1 && lastAtIndex === val.length - 1) {
      setMentionQuery('');
      setMentionPosition(lastAtIndex);
    } else if (lastAtIndex !== -1 && val.slice(lastAtIndex).indexOf(' ') === -1) {
      setMentionQuery(val.slice(lastAtIndex + 1));
      setMentionPosition(lastAtIndex);
    } else {
      setMentionQuery(null);
    }
  };

  // Insert mention from popover
  const handleSelectMention = (member: { userId: string; name: string }) => {
    if (mentionPosition === -1) return;
    const prefix = inputText.slice(0, mentionPosition);
    const suffix = inputText.slice(mentionPosition + (mentionQuery?.length || 0) + 1);
    const updated = `${prefix}@${member.name} ${suffix}`;
    setInputText(updated);
    setMentionQuery(null);
    inputRef.current?.focus();
  };

  // Send message
  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !activeConv || !activeUserId) return;
    setChatError(null);

    const mentions: MessageMention[] = [];
    if (activeConv.participants) {
      activeConv.participants.forEach((p) => {
        if (inputText.includes(`@${p.name}`)) {
          mentions.push({
            userId: p.userId,
            userName: p.name,
            indices: [inputText.indexOf(`@${p.name}`), inputText.indexOf(`@${p.name}`) + p.name.length + 1],
          });
        }
      });
    }

    try {
      chatService.sendMessage(activeConv.id, activeUserId, inputText.trim(), {
        replyTo: activeReply || undefined,
        mentions: mentions.length > 0 ? mentions : undefined,
      });

      setInputText('');
      setActiveReply(null);
      setMentionQuery(null);
      chatService.setTypingState(activeConv.id, activeUserId, activeDisplayName, false);
    } catch (err: any) {
      setChatError(err?.message || 'Failed to send message.');
    }
  };

  // Handle Chat Attachment Selection & Trusted Upload
  const handleAttachmentSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeConv || !activeUserId) return;
    if (file.size > 10 * 1024 * 1024) {
      setChatError('Attachment exceeds maximum allowed size of 10 MB.');
      return;
    }
    setChatError(null);
    setUploadingAttachment(true);
    try {
      const res = await chatService.sendAttachmentMessage(
        activeConv.id,
        activeUserId,
        file,
        file.name,
        inputText.trim() || undefined
      );
      if (!res.success) {
        setChatError(res.error || 'Failed to send attachment.');
      } else {
        setInputText('');
        setMessages(chatService.getMessages(activeConv.id));
      }
    } catch (err: any) {
      setChatError(err?.message || 'Error uploading chat attachment.');
    } finally {
      setUploadingAttachment(false);
      if (attachmentInputRef.current) attachmentInputRef.current.value = '';
    }
  };

  // Request short-lived (15m) signed download URL rendered inline
  const handleOpenAttachment = async (messageId: string, fileName: string) => {
    setLoadingAttachmentId(messageId);
    setChatError(null);
    try {
      const signedUrl = await chatService.getAttachmentSignedUrl(messageId);
      setSignedAttachmentLinks((prev) => ({
        ...prev,
        [messageId]: { url: signedUrl, fileName },
      }));
    } catch (err: any) {
      setChatError('Unable to load private chat attachment: ' + (err?.message || 'Unauthorized'));
    } finally {
      setLoadingAttachmentId(null);
    }
  };

  // Start Inline Editing with 15-minute rule verification
  const handleStartEdit = (msg: ChatMessage) => {
    const messageTime = new Date(msg.createdAt).getTime();
    const fifteenMinutesMs = 15 * 60 * 1000;
    if (Date.now() - messageTime > fifteenMinutesMs) {
      setChatError('This message can no longer be edited because the 15-minute window has expired.');
      return;
    }
    setEditingMessageId(msg.id);
    setEditingText(msg.text);
    setEditError(null);
  };

  // Submit Edited Message
  const handleSaveEdit = (msgId: string) => {
    if (!activeUserId) return;
    setEditError(null);
    const res = chatService.editMessage(msgId, activeUserId, editingText);
    if (res.success && res.message) {
      setEditingMessageId(null);
      setEditingText('');
      setMessages((prev) => prev.map((m) => (m.id === msgId ? res.message! : m)));
    } else {
      setEditError(res.error || 'Failed to edit message.');
    }
  };

  // Retry failed message
  const handleRetry = (msgId: string) => {
    if (!activeUserId) return;
    const res = chatService.retryFailedMessage(msgId, activeUserId);
    if (res.success && res.message) {
      setMessages((prev) => prev.map((m) => (m.id === msgId ? res.message! : m)));
    }
  };

  // Quoted Reply Action
  const handleInitiateReply = (msg: ChatMessage) => {
    setActiveReply({
      messageId: msg.id,
      senderId: msg.senderId,
      senderName: msg.senderName,
      textPreview: msg.text.length > 55 ? msg.text.substring(0, 52) + '...' : msg.text,
    });
    inputRef.current?.focus();
  };

  // Scroll to referenced message
  const scrollToMessage = (msgId: string) => {
    const el = messageRefs.current[msgId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-emerald-500');
      setTimeout(() => el.classList.remove('ring-2', 'ring-emerald-500'), 1800);
    }
  };

  // Start new direct chat with another live platform user
  const handleStartDirectChat = async (peer: { id: string; fullName?: string; role?: string }) => {
    if (!activeUserId) return;
    setStartingChatId(peer.id);
    setChatError(null);
    try {
      const conv = await chatService.startDirectConversationPersisted(activeUserId, peer.id, {
        fullName: peer.fullName,
        role: peer.role,
      });
      setNewChatModalOpen(false);
      setUserSearchTerm('');
      setConversations(chatService.getUserConversations(activeUserId));
      setActiveConvId(conv.id);
      navigate(`${chatBasePath}/${conv.id}`);
    } catch (err: any) {
      setChatError(err?.message || 'Could not start direct chat.');
    } finally {
      setStartingChatId(null);
    }
  };

  // Filter messages in search mode
  const displayedMessages = searchQuery.trim()
    ? messages.filter((m) => m.text.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : messages;

  return (
    <div className="h-[calc(100vh-10rem)] min-h-[550px] flex flex-col md:flex-row bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
      {/* -------------------- LEFT SIDEBAR: CONVERSATIONS -------------------- */}
      <div className="w-full md:w-80 border-r border-slate-100 dark:border-slate-800 flex flex-col bg-slate-50/40 dark:bg-slate-900/50">
        {/* Header with New Chat Button */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Messages & Cohorts</h2>
            <p className="text-[11px] text-slate-400">Direct conversations & squad chats</p>
          </div>
          <button
            onClick={() => setNewChatModalOpen(true)}
            className="p-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 transition"
            title="Start Direct Message"
            aria-label="New Chat"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60">
          {loadingConversations && conversations.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 space-y-2">
              <Loader2 className="w-6 h-6 animate-spin text-emerald-600 mx-auto" />
              <p>Loading conversations…</p>
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 space-y-2">
              <MessageSquare className="w-8 h-8 text-slate-300 mx-auto" />
              <p>No active conversations yet.</p>
              <button
                onClick={() => setNewChatModalOpen(true)}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold cursor-pointer"
              >
                Start a Message
              </button>
            </div>
          ) : (
            conversations.map((c) => {
              const isActive = c.id === activeConv?.id;
              const isGroup = c.type === 'group';
              const unread = c.unreadCount || 0;
              const lastTime = c.lastMessageTimestamp || c.lastMessageAt;

              return (
                <button
                  key={c.id}
                  onClick={() => handleSelectConversation(c.id)}
                  className={`w-full text-left p-3.5 flex items-start gap-3 transition cursor-pointer ${
                    isActive
                      ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-l-4 border-emerald-600'
                      : 'hover:bg-slate-100/60 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="w-10 h-10 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center flex-shrink-0 text-slate-700 dark:text-slate-200 font-bold text-xs relative">
                    {isGroup ? (
                      <Users className="w-5 h-5 text-emerald-600" />
                    ) : (
                      <span>{c.name?.[0] || 'U'}</span>
                    )}
                    {c.isMuted && (
                      <div className="absolute -bottom-1 -right-1 p-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-500">
                        <BellOff className="w-2.5 h-2.5" />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline mb-0.5">
                      <div className="flex items-center gap-1.5 truncate">
                        <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                          {c.name || c.title}
                        </h4>
                        {isGroup && (
                          <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-bold">
                            Cohort
                          </span>
                        )}
                      </div>
                      {lastTime && (
                        <span className="text-[10px] text-slate-400 flex-shrink-0 ml-1">
                          {new Date(lastTime).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-1">
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {c.lastMessageText || 'Tap to send a message'}
                      </p>
                      {unread > 0 && (
                        <span className="px-1.5 py-0.2 rounded-full bg-emerald-600 text-white font-bold text-[10px] flex-shrink-0">
                          {unread}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* -------------------- RIGHT AREA: ACTIVE CHAT -------------------- */}
      {activeConv ? (
        <div className="flex-1 flex flex-col justify-between bg-slate-50/20 dark:bg-slate-950/20">
          {/* Thread Header */}
          <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between">
            <div
              className="flex items-center gap-3 cursor-pointer"
              onClick={() => activeConv.type === 'group' && setGroupDrawerOpen(true)}
            >
              <div className="w-9 h-9 rounded-2xl bg-emerald-100 dark:bg-emerald-950/80 flex items-center justify-center font-bold text-xs text-emerald-800 dark:text-emerald-200">
                {activeConv.type === 'group' ? (
                  <Users className="w-4 h-4 text-emerald-600" />
                ) : (
                  <span>{activeConv.name?.[0] || 'U'}</span>
                )}
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                    {activeConv.name || activeConv.title}
                  </h3>
                  {activeConv.type === 'group' && (
                    <span className="text-[10px] text-emerald-600 font-semibold flex items-center">
                      • {activeConv.participantIds.length} Members
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-slate-400">
                  {remoteTypingUser ? (
                    <span className="text-emerald-600 dark:text-emerald-400 font-medium animate-pulse">
                      {remoteTypingUser} is typing...
                    </span>
                  ) : activeConv.type === 'group' ? (
                    'Accommodation Cohort Chat'
                  ) : (
                    'Direct Message'
                  )}
                </div>
              </div>
            </div>

            {/* Header Tool Actions */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setSearchOpen(!searchOpen)}
                className={`p-2 rounded-xl text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition ${
                  searchOpen ? 'bg-slate-100 dark:bg-slate-800 text-emerald-600' : ''
                }`}
                title="Search Messages"
                aria-label="Search Messages"
              >
                <Search className="w-4 h-4" />
              </button>

              <button
                onClick={() => {
                  if (!activeUserId) return;
                  chatService.toggleMuteConversation(activeConv.id, activeUserId);
                  setConversations(chatService.getUserConversations(activeUserId));
                }}
                className={`p-2 rounded-xl transition ${
                  activeConv.isMuted
                    ? 'text-amber-500 bg-amber-50 dark:bg-amber-950/40'
                    : 'text-slate-400 hover:text-slate-700'
                }`}
                title={activeConv.isMuted ? 'Unmute notifications' : 'Mute notifications'}
                aria-label="Toggle mute"
              >
                {activeConv.isMuted ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
              </button>

              {activeConv.type === 'group' && (
                <button
                  onClick={() => setGroupDrawerOpen(true)}
                  className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition flex items-center gap-1"
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>Members</span>
                </button>
              )}
            </div>
          </div>

          {chatError && (
            <div role="alert" className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
              <span className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{chatError}</span>
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void hydrateConversations()}
                  className="font-bold underline cursor-pointer"
                >
                  Retry
                </button>
                <button
                  type="button"
                  onClick={() => setChatError(null)}
                  className="p-0.5 text-rose-500 hover:text-rose-700 cursor-pointer"
                  aria-label="Dismiss chat error"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* In-Conversation Search Bar */}
          {searchOpen && (
            <div className="p-3 bg-emerald-50/50 dark:bg-emerald-950/20 border-b border-emerald-100 dark:border-emerald-900 flex items-center gap-2">
              <Search className="w-4 h-4 text-emerald-600" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search messages in this discussion..."
                className="flex-1 bg-transparent text-xs text-slate-900 dark:text-white focus:outline-none"
                autoFocus
              />
              {searchQuery && (
                <span className="text-[10px] text-emerald-700 dark:text-emerald-300 font-semibold mr-1">
                  {displayedMessages.length} match{displayedMessages.length === 1 ? '' : 'es'}
                </span>
              )}
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSearchOpen(false);
                }}
                className="p-1 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Messages Stream */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
            {loadingMessages && displayedMessages.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-400 gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                <span>Loading messages…</span>
              </div>
            ) : displayedMessages.length === 0 ? (
              <div className="h-full flex items-center justify-center text-center text-xs text-slate-400">
                {searchQuery.trim()
                  ? 'No matching messages found for this query.'
                  : 'No messages yet. Send a friendly hello to begin.'}
              </div>
            ) : (
              displayedMessages.map((msg) => {
                const isMe = msg.senderId === activeUserId;
                const messageAgeMs = Date.now() - new Date(msg.createdAt).getTime();
                const canEdit = isMe && messageAgeMs <= 15 * 60 * 1000;
                const isEditingThis = editingMessageId === msg.id;

                return (
                  <div
                    key={msg.id}
                    ref={(el) => {
                      messageRefs.current[msg.id] = el;
                    }}
                    className={`flex flex-col group transition ${isMe ? 'items-end' : 'items-start'}`}
                  >
                    {!isMe && activeConv.type === 'group' && (
                      <span className="text-[10px] text-slate-400 font-semibold mb-1 ml-1">
                        {msg.senderName}
                      </span>
                    )}

                    <div
                      className={`max-w-xs sm:max-w-md p-3.5 rounded-2xl text-xs leading-relaxed relative ${
                        isMe
                          ? 'bg-slate-900 text-white dark:bg-emerald-600 rounded-br-xs'
                          : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200/80 dark:border-slate-700/80 rounded-bl-xs shadow-2xs'
                      }`}
                    >
                      {/* Quoted Reply Snippet */}
                      {msg.replyTo && (
                        <div
                          onClick={() => scrollToMessage(msg.replyTo!.messageId)}
                          className={`mb-2 p-2 rounded-xl text-[11px] border-l-4 cursor-pointer transition ${
                            isMe
                              ? 'bg-white/10 border-emerald-400 text-slate-200 hover:bg-white/20'
                              : 'bg-slate-100 dark:bg-slate-700/60 border-emerald-600 text-slate-600 dark:text-slate-300 hover:bg-slate-200/60'
                          }`}
                        >
                          <span className="font-bold block text-[10px] text-emerald-400 dark:text-emerald-300">
                            {msg.replyTo.senderName}
                          </span>
                          <span className="line-clamp-1 italic">{msg.replyTo.textPreview}</span>
                        </div>
                      )}

                      {/* Message Content or Inline Edit Form */}
                      {isEditingThis ? (
                        <div className="space-y-2">
                          <input
                            type="text"
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white text-xs border border-slate-300 focus:outline-none"
                            autoFocus
                          />
                          {editError && <div className="text-[10px] text-rose-300">{editError}</div>}
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => setEditingMessageId(null)}
                              className="px-2 py-0.5 rounded text-[10px] bg-slate-700 text-slate-200 hover:bg-slate-600"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleSaveEdit(msg.id)}
                              className="px-2 py-0.5 rounded text-[10px] bg-emerald-500 text-white hover:bg-emerald-400 font-bold"
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="whitespace-pre-wrap break-words">
                          {/* Render text with highlighted @mentions */}
                          {msg.text.split(' ').map((word, i) => {
                            if (word.startsWith('@')) {
                              return (
                                <span
                                  key={i}
                                  className={`px-1 py-0.5 rounded font-bold ${
                                    isMe
                                      ? 'bg-emerald-500/40 text-emerald-100'
                                      : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                                  }`}
                                >
                                  {word}{' '}
                                </span>
                              );
                            }
                            return word + ' ';
                          })}
                        </div>
                      )}

                      {msg.attachment && (
                        <div className="mt-2 space-y-1.5">
                          <div
                            className={`p-2 rounded-xl border flex items-center justify-between gap-2 text-xs ${
                              isMe
                                ? 'bg-emerald-700/60 border-emerald-500/40 text-white'
                                : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 truncate">
                              <FileText className="w-3.5 h-3.5 flex-shrink-0" />
                              <span className="truncate font-medium">{msg.attachment.fileName}</span>
                              <span className="text-[10px] opacity-75">
                                ({(msg.attachment.fileSize / 1024).toFixed(0)} KB)
                              </span>
                            </div>
                            <button
                              type="button"
                              disabled={loadingAttachmentId === msg.id}
                              onClick={() => void handleOpenAttachment(msg.id, msg.attachment!.fileName)}
                              className="px-2 py-1 rounded-lg bg-white/20 hover:bg-white/30 text-[11px] font-semibold flex items-center gap-1 transition cursor-pointer disabled:opacity-60"
                              title="Generate 15-minute signed download link"
                            >
                              {loadingAttachmentId === msg.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <ExternalLink className="w-3 h-3" />
                              )}
                              <span>Link</span>
                            </button>
                          </div>
                          {signedAttachmentLinks[msg.id] && (
                            <a
                              href={signedAttachmentLinks[msg.id].url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500"
                            >
                              <ExternalLink className="w-3 h-3" />
                              Download {signedAttachmentLinks[msg.id].fileName} (15m link)
                            </a>
                          )}
                        </div>
                      )}

                      {/* Quick Action Toolbar (Pencil for 15-min edit, Reply button) */}
                      {!isEditingThis && (
                        <div
                          className={`absolute top-1 ${
                            isMe ? '-left-14' : '-right-14'
                          } opacity-0 group-hover:opacity-100 transition flex items-center gap-1 bg-white dark:bg-slate-800 p-1 rounded-xl shadow-md border border-slate-200 dark:border-slate-700`}
                        >
                          <button
                            onClick={() => handleInitiateReply(msg)}
                            className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-white"
                            title="Reply"
                          >
                            <Reply className="w-3.5 h-3.5" />
                          </button>
                          {canEdit && (
                            <button
                              onClick={() => handleStartEdit(msg)}
                              className="p-1 text-slate-500 hover:text-emerald-600"
                              title="Edit message (15-min rule)"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Metadata line: Timestamp + Edited badge + Delivery Ticks */}
                    <div className="flex items-center gap-1 mt-1 px-1 text-[9px] text-slate-400">
                      <span>
                        {new Date(msg.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>

                      {msg.isEdited && (
                        <span className="italic font-medium text-slate-400">(edited)</span>
                      )}

                      {/* WhatsApp-Style Delivery Ticks (for sender) */}
                      {isMe && (
                        <span className="ml-0.5 flex items-center">
                          {msg.status === 'pending' && (
                            <Clock className="w-3 h-3 text-slate-400 animate-spin" aria-label="Pending" />
                          )}
                          {msg.status === 'sent' && (
                            <Check className="w-3 h-3 text-emerald-500" aria-label="Sent" />
                          )}
                          {msg.status === 'delivered' && (
                            <CheckCheck className="w-3.5 h-3.5 text-emerald-500" aria-label="Delivered" />
                          )}
                          {msg.status === 'read' && (
                            <CheckCheck className="w-3.5 h-3.5 text-sky-400" aria-label="Read" />
                          )}
                          {msg.status === 'failed' && (
                            <button
                              onClick={() => handleRetry(msg.id)}
                              className="flex items-center gap-0.5 text-rose-500 font-bold hover:underline"
                              aria-label="Failed to send. Click to retry."
                            >
                              <AlertCircle className="w-3 h-3" />
                              <span>Retry</span>
                            </button>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Mention Popover Suggestions */}
          {mentionQuery !== null && activeConv.participants && (
            <div className="mx-4 mb-2 p-2 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-lg max-h-40 overflow-y-auto space-y-1">
              <div className="text-[10px] font-bold text-slate-400 px-2 py-1 uppercase">
                Mention Cohort Peer
              </div>
              {activeConv.participants
                .filter(
                  (p) =>
                    p.name.toLowerCase().includes(mentionQuery.toLowerCase()) &&
                    p.userId !== activeUserId
                )
                .map((p) => (
                  <button
                    key={p.userId}
                    type="button"
                    onClick={() => handleSelectMention(p)}
                    className="w-full text-left px-2 py-1.5 rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-xs text-slate-800 dark:text-slate-200 flex items-center gap-2"
                  >
                    <div className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px] flex items-center justify-center">
                      {p.name[0]}
                    </div>
                    <span className="font-semibold">{p.name}</span>
                  </button>
                ))}
            </div>
          )}

          {/* Quoted Reply Preview Bar */}
          {activeReply && (
            <div className="mx-4 p-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800/80 border-l-4 border-emerald-500 flex items-center justify-between text-xs">
              <div className="min-w-0 pr-2">
                <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 block">
                  Replying to {activeReply.senderName}
                </span>
                <p className="text-slate-600 dark:text-slate-300 text-[11px] truncate">
                  {activeReply.textPreview}
                </p>
              </div>
              <button
                onClick={() => setActiveReply(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
                aria-label="Cancel reply"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Composer */}
          <form
            onSubmit={handleSend}
            className="p-3 sm:p-4 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2"
          >
            <button
              type="button"
              disabled={uploadingAttachment}
              onClick={() => attachmentInputRef.current?.click()}
              className="p-2.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              title="Attach private document or image (Max 10MB)"
            >
              {uploadingAttachment ? (
                <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
              ) : (
                <Paperclip className="w-4 h-4" />
              )}
            </button>
            <input
              ref={attachmentInputRef}
              type="file"
              className="hidden"
              accept="image/jpeg,image/png,image/webp,application/pdf,text/plain"
              onChange={handleAttachmentSelected}
            />

            <input
              ref={inputRef}
              type="text"
              value={inputText}
              onChange={(e) => handleInputChange(e.target.value)}
              placeholder={
                activeConv.type === 'group'
                  ? 'Message squad (type @ to mention a peer)...'
                  : 'Type your message...'
              }
              className="flex-1 px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />

            <button
              type="submit"
              disabled={!inputText.trim()}
              className="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 disabled:opacity-40 text-white transition shadow-xs"
              aria-label="Send message"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center p-8 text-center text-xs text-slate-400 space-y-3">
          <div>
            <MessageSquare className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p>Select or start a conversation from the sidebar.</p>
          </div>
        </div>
      )}

      {/* -------------------- MODAL: NEW DIRECT CHAT -------------------- */}
      <Modal
        isOpen={newChatModalOpen}
        onClose={() => {
          setNewChatModalOpen(false);
          setUserSearchTerm('');
        }}
        title="Start Direct Conversation"
        maxWidth="sm"
      >
        <div className="space-y-4 p-1">
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Search Users by Name or Email
            </label>
            <input
              type="text"
              value={userSearchTerm}
              onChange={(e) => setUserSearchTerm(e.target.value)}
              placeholder="Search student, landlord, or support..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              autoFocus
            />
          </div>

          <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {searchingPeers ? (
              <div className="py-6 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                <span>Searching users…</span>
              </div>
            ) : peerResults.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">
                {userSearchTerm.trim()
                  ? 'No active users found matching that query.'
                  : 'Enter a name or email to start a live conversation.'}
              </p>
            ) : (
              peerResults.map((peer) => (
                <div key={peer.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200 font-bold text-xs flex items-center justify-center shrink-0">
                      {peer.fullName[0]?.toUpperCase() || 'U'}
                    </div>
                    <div className="min-w-0">
                      <h5 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        {peer.fullName}
                      </h5>
                      <span className="text-[10px] text-slate-400 capitalize">
                        {peer.role} · {peer.email}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={startingChatId === peer.id}
                    onClick={() => void handleStartDirectChat(peer)}
                    className="px-3 py-1 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-600 text-white text-xs font-bold shadow-xs cursor-pointer disabled:opacity-60 shrink-0"
                  >
                    {startingChatId === peer.id ? 'Opening…' : 'Message'}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </Modal>

      {/* -------------------- MODAL: GROUP MEMBERS DRAWER -------------------- */}
      {activeConv?.type === 'group' && (
        <Modal
          isOpen={groupDrawerOpen}
          onClose={() => setGroupDrawerOpen(false)}
          title={`Cohort Roster: ${activeConv.name}`}
          maxWidth="md"
        >
          <div className="space-y-4 p-1">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <span className="text-xs text-slate-500">
                {activeConv.participantIds.length} Verified Participants
              </span>
              {activeConv.groupId && activeUserRole === 'student' && (
                <Link
                  to={`/student/groups/${activeConv.groupId}`}
                  className="text-xs font-bold text-emerald-600 hover:underline flex items-center gap-1"
                >
                  <span>Cohort Hub</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </Link>
              )}
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-72 overflow-y-auto">
              {activeConv.participants?.map((p) => {
                const isMe = p.userId === activeUserId;
                return (
                  <div key={p.userId} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 font-bold text-xs flex items-center justify-center">
                        {p.name?.[0] || 'U'}
                      </div>
                      <div>
                        <div className="flex items-center gap-1">
                          <h5 className="text-xs font-bold text-slate-900 dark:text-white">
                            {p.name}
                          </h5>
                          {isMe && <span className="text-[10px] text-slate-400">(You)</span>}
                        </div>
                        <span className="text-[10px] text-slate-400 capitalize">{p.role}</span>
                      </div>
                    </div>

                    {!isMe && (
                      <button
                        type="button"
                        onClick={() => {
                          setGroupDrawerOpen(false);
                          void handleStartDirectChat({ id: p.userId, fullName: p.name, role: p.role });
                        }}
                        className="px-3 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer"
                      >
                        1-on-1 Chat
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
