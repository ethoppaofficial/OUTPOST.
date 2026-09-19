import React, { useState, useEffect, useRef } from 'react';
import { Send, MessageSquare, Users, ShieldCheck, Search, Image as ImageIcon } from 'lucide-react';
import { authService } from '../../application/services/authService';
import { chatService } from '../../application/services/chatService';
import { Conversation, ChatMessage } from '../../domain/types';

export const ChatPage: React.FC = () => {
  const session = authService.getSession();
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    chatService.getUserConversations(session.user.id)
  );
  const [activeConvId, setActiveConvId] = useState<string>(conversations[0]?.id || '');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeConv = conversations.find((c) => c.id === activeConvId) || conversations[0];

  useEffect(() => {
    if (!activeConv) return;
    const msgs = chatService.getConversationMessages(activeConv.id);
    setMessages(msgs);

    // Subscribe to live messages
    const unsub = chatService.subscribeToConversation(activeConv.id, (newMsg) => {
      setMessages((prev) => [...prev, newMsg]);
      setConversations(chatService.getUserConversations(session.user.id));
    });

    return () => unsub();
  }, [activeConvId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !activeConv) return;

    chatService.sendMessage(
      activeConv.id,
      session.user.id,
      session.displayName,
      inputText.trim()
    );

    setInputText('');
  };

  return (
    <div className="h-[calc(100vh-12rem)] min-h-[500px] flex flex-col md:flex-row bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
      {/* Conversations Sidebar */}
      <div className="w-full md:w-80 border-r border-slate-100 dark:border-slate-800 flex flex-col">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Messages & Groups</h2>
          <p className="text-[11px] text-slate-400">Direct conversations and accommodation cohorts</p>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-50 dark:divide-slate-800/50">
          {conversations.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400">No conversations yet</div>
          ) : (
            conversations.map((c) => {
              const isActive = c.id === activeConv?.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setActiveConvId(c.id)}
                  className={`w-full text-left p-4 flex items-start gap-3 transition ${
                    isActive
                      ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-l-4 border-emerald-600'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="w-10 h-10 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center flex-shrink-0 text-slate-600 dark:text-slate-300 font-bold text-xs">
                    {c.type === 'group' ? <Users className="w-5 h-5 text-blue-500" /> : (c.name?.[0] || 'C')}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline mb-0.5">
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        {c.name}
                      </h4>
                      {c.lastMessageTimestamp && (
                        <span className="text-[10px] text-slate-400">
                          {new Date(c.lastMessageTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {c.lastMessageText || 'No messages yet'}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Main Chat Thread */}
      {activeConv ? (
        <div className="flex-1 flex flex-col justify-between bg-slate-50/30 dark:bg-slate-950/30">
          {/* Thread Header */}
          <div className="px-6 py-3.5 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-bold text-xs text-slate-700 dark:text-slate-300">
                {activeConv.type === 'group' ? <Users className="w-4 h-4 text-blue-500" /> : (activeConv.name?.[0] || 'C')}
              </div>
              <div>
                <h3 className="text-xs font-bold text-slate-900 dark:text-white">{activeConv.name}</h3>
                <span className="text-[10px] text-slate-400 capitalize">
                  {activeConv.type === 'group' ? 'Cohort Group Chat' : 'Direct Conversation'}
                </span>
              </div>
            </div>
          </div>

          {/* Messages Stream */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
            {messages.length === 0 ? (
              <div className="h-full flex items-center justify-center text-center text-xs text-slate-400">
                Send a message to start this discussion.
              </div>
            ) : (
              messages.map((msg) => {
                const isMe = msg.senderId === session.user.id;
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                  >
                    {!isMe && (
                      <span className="text-[10px] text-slate-400 font-semibold mb-1 ml-1">
                        {msg.senderName}
                      </span>
                    )}
                    <div
                      className={`max-w-xs sm:max-w-md p-3.5 rounded-2xl text-xs leading-relaxed ${
                        isMe
                          ? 'bg-slate-900 text-white dark:bg-emerald-600 rounded-br-xs'
                          : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200/80 dark:border-slate-700/80 rounded-bl-xs shadow-xs'
                      }`}
                    >
                      {msg.text}
                    </div>
                    <span className="text-[9px] text-slate-400 mt-1 px-1">
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Composer */}
          <form
            onSubmit={handleSend}
            className="p-3 sm:p-4 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2"
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Type your message..."
              className="flex-1 px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />

            <button
              type="submit"
              className="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white transition shadow-xs"
              aria-label="Send message"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center p-8 text-center text-xs text-slate-400">
          Select or start a conversation from the list.
        </div>
      )}
    </div>
  );
};
