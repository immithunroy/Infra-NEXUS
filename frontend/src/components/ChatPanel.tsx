import { useEffect, useRef, useState } from "react";
import { chatApi } from "../api/client";
import type { ChatMessage, ChatSession } from "../api/types";

interface Props {
  onClose: () => void;
}

export default function ChatPanel({ onClose }: Props) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSession, setActiveSession] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadSessions = async () => {
    try {
      const data = await chatApi.getSessions();
      setSessions(Array.isArray(data) ? data : []);
      // Auto-restore last active session
      if (!activeSession) {
        const lastId = chatApi.getLastSessionId();
        if (lastId) {
          const found = (Array.isArray(data) ? data : []).find((s) => s.id === lastId);
          if (found) {
            await loadMessages(lastId);
            return;
          }
        }
      }
    } catch { /* ignore */ }
  };

  const loadMessages = async (sessionId: number) => {
    setActiveSession(sessionId);
    chatApi.setLastSessionId(sessionId);
    setShowSessions(false);
    setLoading(true);
    try {
      const data = await chatApi.getMessages(sessionId);
      setMessages(Array.isArray(data) ? data : []);
    } catch {
      setMessages([]);
    }
    setLoading(false);
    inputRef.current?.focus();
  };

  const handleNewSession = async () => {
    try {
      const session = await chatApi.createSession();
      setSessions((prev) => [session, ...prev]);
      setActiveSession(session.id);
      chatApi.setLastSessionId(session.id);
      setMessages([]);
      setShowSessions(false);
      inputRef.current?.focus();
    } catch { /* ignore */ }
  };

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    const content = input.trim();
    setInput("");

    // Ensure we have a session
    let sessionId = activeSession;
    if (!sessionId) {
      try {
        const session = await chatApi.createSession();
        setSessions((prev) => [session, ...prev]);
        sessionId = session.id;
        setActiveSession(sessionId);
        chatApi.setLastSessionId(sessionId);
      } catch { return; }
    }

    // Add user message optimistically
    const userMsg: ChatMessage = {
      id: Date.now(),
      session_id: sessionId,
      role: "user",
      content,
      sql_query: null,
      row_count: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setSending(true);

    try {
      const response = await chatApi.sendMessage(sessionId, content);
      setMessages((prev) => [...prev, response]);
      // Update session title in sidebar
      loadSessions();
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          session_id: sessionId!,
          role: "assistant",
          content: `Error: ${e?.message || "Failed to get response"}`,
          sql_query: null,
          row_count: null,
          created_at: new Date().toISOString(),
        },
      ]);
    }
    setSending(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleDeleteSession = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this chat?")) return;
    try {
      await chatApi.deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (activeSession === id) {
        setActiveSession(null);
        setMessages([]);
      }
    } catch { /* ignore */ }
  };

  return (
    <div className="fixed bottom-6 right-2 z-50 w-[400px] h-[600px] bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-brand-600 text-white">
        <div className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          <span className="font-semibold text-sm">Infra NEXUS AI</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowSessions(!showSessions)}
            className="p-1 hover:bg-white/20 rounded"
            title="Chat history"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          <button onClick={onClose} className="p-1 hover:bg-white/20 rounded">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Session list dropdown */}
      {showSessions && (
        <div className="border-b border-slate-200 dark:border-slate-700 max-h-[200px] overflow-y-auto">
          <div className="p-2">
            <button
              onClick={handleNewSession}
              className="w-full text-left px-3 py-2 text-sm rounded-lg bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-900/40 font-medium"
            >
              + New Chat
            </button>
          </div>
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => loadMessages(s.id)}
              className={`flex items-center justify-between px-4 py-2 cursor-pointer text-sm hover:bg-slate-50 dark:hover:bg-slate-800 ${
                activeSession === s.id ? "bg-brand-50 dark:bg-brand-900/20" : ""
              }`}
            >
              <span className="truncate flex-1">{s.title}</span>
              <button
                onClick={(e) => handleDeleteSession(s.id, e)}
                className="ml-2 text-slate-400 hover:text-red-500 text-xs"
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !loading && (
          <div className="text-center text-slate-400 dark:text-slate-500 mt-20">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p className="text-sm font-medium">Ask me anything</p>
            <p className="text-xs mt-1 opacity-70">about your network, subscribers, tickets...</p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm ${
                msg.role === "user"
                  ? "bg-brand-600 text-white rounded-br-none"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-bl-none"
              }`}
            >
              {/* SQL query collapsible */}
              {msg.sql_query && (
                <details className="mb-2">
                  <summary className="cursor-pointer text-xs opacity-70 hover:opacity-100">
                    SQL ({msg.row_count ?? 0} rows)
                  </summary>
                  <pre className="mt-1 p-2 bg-black/10 rounded text-xs overflow-x-auto whitespace-pre-wrap break-all">
                    {msg.sql_query}
                  </pre>
                </details>
              )}
              {/* Message content */}
              <div className="whitespace-pre-wrap break-words">{msg.content}</div>
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="bg-slate-100 dark:bg-slate-800 rounded-xl rounded-bl-none px-4 py-3 text-sm">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-slate-200 dark:border-slate-700">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about ONUs, tickets, fiber..."
            rows={1}
            className="flex-1 resize-none rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 max-h-24"
            style={{ minHeight: "38px" }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className="p-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
