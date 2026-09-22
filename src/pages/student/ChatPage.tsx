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
  MoreVertical
} from 'lucide-react';
import { authService } from '../../application/services/authService';
import { chatService } from '../../application/services/chatService';
import { groupChatService } from '../../application/services/groupChatService';
import { repository } from '../../infrastructure/repositories/localStorageRepository';
import {
  Conversation,
  ChatMessage,
  MessageReplyReference,
  MessageMention,
  StudentProfile
} from '../../domain/types';
import { Modal } from '../../components/ui/Modal';
import { Badge } from '../../components/ui/Badge';

export const ChatPage: React.FC = () => {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const session = authService.getSession();

  const [conversations, setConversations] = useState<Conversation[]>(() =>
    chatService.getUserConversations(session.user.id)
  );

  const [activeConvId, setActiveConvId] = useState<string>(
    conversationId || conversations[0]?.id || ''
  );

  const [messages, setMessages] = useState<ChatMessage[]>([]);
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
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Group Details / Member Drawer
  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false);

  // New Direct Chat Modal
  const [newChatModalOpen, setNewChatModalOpen] = useState(false);
  const [userSearchTerm, setUserSearchTerm] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const activeConv = conversations.find((c) => c.id === activeConvId);

  // Sync activeConvId if URL param changes
  useEffect(() => {
    if (conversationId && conversationId !== activeConvId) {
      setActiveConvId(conversationId);
    }
  }, [conversationId]);

  // Load and subscribe to active conversation messages
  useEffect(() => {
    if (!activeConvId) return;

    // Mark messages as read
    chatService.markMessagesAsRead(activeConvId, session.user.id);

    const msgs = chatService.getConversationMessages(activeConvId);
    setMessages(msgs);

    // Refresh conversation list
    setConversations(chatService.getUserConversations(session.user.id));

    // Subscribe to new incoming messages
    const unsubMsg = chatService.subscribeToMessages(activeConvId, (newMsg) => {
      setMessages((prev) => {
        const exists = prev.some((m) => m.id === newMsg.id);
        if (exists) {
          return prev.map((m) => (m.id === newMsg.id ? newMsg : m));
        }
        return [...prev, newMsg];
      });
      // Mark as read if from peer
      if (newMsg.senderId !== session.user.id) {
        chatService.markMessagesAsRead(activeConvId, session.user.id);
      }
      setConversations(chatService.getUserConversations(session.user.id));
    });

    // Subscribe to typing notifications
    const unsubTyping = chatService.subscribeToTyping(activeConvId, (state) => {
      if (state.userId !== session.user.id) {
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
      unsubMsg();
      unsubTyping();
      unsubRead();
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, [activeConvId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Handle switching conversations
  const handleSelectConversation = (id: string) => {
    setActiveConvId(id);
    navigate(`/student/chat/${id}`);
    setActiveReply(null);
    setEditingMessageId(null);
    setSearchOpen(false);
    setSearchQuery('');
  };

  // Broadcast typing on input change
  const handleInputChange = (val: string) => {
    setInputText(val);

    if (activeConv) {
      chatService.setTypingState(activeConv.id, session.user.id, session.displayName, true);
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
    if (!inputText.trim() || !activeConv) return;

    // Detect mentions in text
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
      chatService.sendMessage(activeConv.id, session.user.id, inputText.trim(), {
        replyTo: activeReply || undefined,
        mentions: mentions.length > 0 ? mentions : undefined,
      });

      setInputText('');
      setActiveReply(null);
      setMentionQuery(null);

      // Stop typing
      chatService.setTypingState(activeConv.id, session.user.id, session.displayName, false);
    } catch (err: any) {
      alert(err?.message || 'Failed to send message.');
    }
  };

  // Start Inline Editing with 15-minute rule verification
  const handleStartEdit = (msg: ChatMessage) => {
    const messageTime = new Date(msg.createdAt).getTime();
    const fifteenMinutesMs = 15 * 60 * 1000;
    if (Date.now() - messageTime > fifteenMinutesMs) {
      alert('This message can no longer be edited because the 15-minute window has expired.');
      return;
    }
    setEditingMessageId(msg.id);
    setEditingText(msg.text);
    setEditError(null);
  };

  // Submit Edited Message
  const handleSaveEdit = (msgId: string) => {
    setEditError(null);
    const res = chatService.editMessage(msgId, session.user.id, editingText);
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
    const res = chatService.retryFailedMessage(msgId, session.user.id);
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

  // Start new direct chat with another user
  const handleStartDirectChat = (targetUserId: string) => {
    try {
      const conv = chatService.startDirectConversation(session.user.id, targetUserId);
      setNewChatModalOpen(false);
      setConversations(chatService.getUserConversations(session.user.id));
      setActiveConvId(conv.id);
      navigate(`/student/chat/${conv.id}`);
    } catch (err: any) {
      alert(err?.message || 'Could not start direct chat.');
    }
  };

  // Search candidate peers for direct chat
  const allPeers: StudentProfile[] = userSearchTerm.trim()
    ? groupChatService.searchStudents(userSearchTerm).filter((s) => s.userId !== session.user.id)
    : [];

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
          {conversations.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 space-y-2">
              <MessageSquare className="w-8 h-8 text-slate-300 mx-auto" />
              <p>No active conversations yet.</p>
              <button
                onClick={() => setNewChatModalOpen(true)}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold"
              >
                Start a Message
              </button>
            </div>
          ) : (
            conversations.map((c) => {
              const isActive = c.id === activeConv?.id;
              const isGroup = c.type === 'group';
              const unread = c.unreadCount || 0;

              return (
                <button
                  key={c.id}
                  onClick={() => handleSelectConversation(c.id)}
                  className={`w-full text-left p-3.5 flex items-start gap-3 transition ${
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
                      {c.lastMessageTimestamp && (
                        <span className="text-[10px] text-slate-400 flex-shrink-0 ml-1">
                          {new Date(c.lastMessageTimestamp).toLocaleTimeString([], {
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
                  const muted = chatService.toggleMuteConversation(activeConv.id, session.user.id);
                  setConversations(chatService.getUserConversations(session.user.id));
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
            {displayedMessages.length === 0 ? (
              <div className="h-full flex items-center justify-center text-center text-xs text-slate-400">
                {searchQuery.trim()
                  ? 'No matching messages found for this query.'
                  : 'No messages yet. Send a friendly hello to begin.'}
              </div>
            ) : (
              displayedMessages.map((msg) => {
                const isMe = msg.senderId === session.user.id;
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
                    p.userId !== session.user.id
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
              Search by Student Name or Reg Number
            </label>
            <input
              type="text"
              value={userSearchTerm}
              onChange={(e) => setUserSearchTerm(e.target.value)}
              placeholder="e.g. Adebayo, Chioma..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              autoFocus
            />
          </div>

          <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {allPeers.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">
                {userSearchTerm.trim()
                  ? 'No verified peers found.'
                  : 'Search for a verified peer to begin a private 1-on-1 discussion.'}
              </p>
            ) : (
              allPeers.map((peer) => (
                <div key={peer.userId} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200 font-bold text-xs flex items-center justify-center">
                      {peer.fullName[0]}
                    </div>
                    <div>
                      <h5 className="text-xs font-bold text-slate-900 dark:text-white">
                        {peer.fullName}
                      </h5>
                      <span className="text-[10px] text-slate-400">{peer.university}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => handleStartDirectChat(peer.userId)}
                    className="px-3 py-1 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-600 text-white text-xs font-bold shadow-xs"
                  >
                    Message
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
              {activeConv.groupId && (
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
                const isMe = p.userId === session.user.id;
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
                        onClick={() => {
                          setGroupDrawerOpen(false);
                          handleStartDirectChat(p.userId);
                        }}
                        className="px-3 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200"
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
