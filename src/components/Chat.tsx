import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import Logo from "../assets/Alfred_Logo.svg";
import { useAuth } from "../auth/authContext.ts";
import { PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import {
  type ChatMessage,
  buildSafeChatContext,
  sendChatMessage,
} from "../lib/aiChat.ts";
import { SafeMarkdown } from "./SafeMarkdown.tsx";

interface ChatProps {
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onNewChat?: () => void;
}

export default function Chat({
  isCollapsed = false,
  onToggleCollapse,
  onNewChat,
}: ChatProps) {
  const { session, loginWithGoogle, logout } = useAuth();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const isGoogleUser = session?.account?.type === "user";
  const displayName =
    session?.account?.name ||
    session?.account?.email?.split("@")[0] ||
    "Guest";

  // In-memory conversation state (ephemeral; cleared on reload)
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputPrompt, setInputPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [failedPrompt, setFailedPrompt] = useState<string | null>(null);

  const activeRequestIdRef = useRef(0);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isNearBottomRef = useRef(true);
  const justSentMessageRef = useRef(false);

  const hasMessages = messages.length > 0 || isLoading;

  // Auto-scroll messages container strictly within sidebar when at bottom or upon sending
  useEffect(() => {
    if (!messagesContainerRef.current || !hasMessages) return;
    const shouldScroll = justSentMessageRef.current || isNearBottomRef.current;
    if (shouldScroll) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: "smooth",
      });
      justSentMessageRef.current = false;
    }
  }, [messages, isLoading, hasMessages]);

  const handleMessagesScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const threshold = 80;
    const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    isNearBottomRef.current = distanceFromBottom <= threshold;
  };

  // Adjust textarea height dynamically up to 120px
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        120
      )}px`;
    }
  }, [inputPrompt]);

  const handleSendMessage = async (textToSend?: string) => {
    if (isLoading) return;

    const rawText = textToSend !== undefined ? textToSend : inputPrompt;
    const trimmed = rawText.trim();
    if (!trimmed) return;

    const currentReqId = ++activeRequestIdRef.current;
    const isRetry = textToSend !== undefined && failedPrompt !== null;
    justSentMessageRef.current = true;

    if (isRetry) {
      setMessages((prev) =>
        prev.map((m, idx) => {
          if (idx === prev.length - 1 && m.role === "user" && m.error) {
            return { ...m, error: undefined };
          }
          return m;
        })
      );
    } else {
      const userMessage: ChatMessage = {
        id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        role: "user",
        content: trimmed,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMessage]);
    }

    setInputPrompt("");
    setFailedPrompt(null);
    setIsLoading(true);

    try {
      const priorHistory = isRetry ? messages.slice(0, -1) : messages;
      const context = buildSafeChatContext(priorHistory, trimmed);

      const response = await sendChatMessage(context);

      // Check if user reset chat while waiting
      if (activeRequestIdRef.current !== currentReqId) return;

      const assistantMessage: ChatMessage = {
        id: `asst-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        role: "assistant",
        content: response.message.content,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err: unknown) {
      if (activeRequestIdRef.current !== currentReqId) return;

      const errorMessage =
        err instanceof Error
          ? err.message
          : "Failed to receive a response from Alfred.";

      // Mark error on user message and preserve prompt for retry
      setMessages((prev) =>
        prev.map((m, idx) => {
          if (idx === prev.length - 1 && m.role === "user") {
            return { ...m, error: errorMessage };
          }
          return m;
        })
      );
      setFailedPrompt(trimmed);
    } finally {
      if (activeRequestIdRef.current === currentReqId) {
        setIsLoading(false);
      }
    }
  };

  const handleRetry = () => {
    if (!failedPrompt || isLoading) return;
    void handleSendMessage(failedPrompt);
  };

  const handleNewChat = () => {
    activeRequestIdRef.current++;
    setMessages([]);
    setIsLoading(false);
    setFailedPrompt(null);
    setInputPrompt("");
    isNearBottomRef.current = true;
    justSentMessageRef.current = false;
  };


  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.key === "Enter" || e.keyCode === 13 || e.which === 13) && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      void handleSendMessage();
    }
  };

  return (
    <section className={`Chat ${isCollapsed ? "is-collapsed" : ""} ${hasMessages ? "has-active-conversation" : ""}`}>
      {/* Top Sidebar Header: Controls & Alfred Branding */}
      <div className="chat-top-header">
        <div className="chat-actions-group">
          {onToggleCollapse && (
            <div className="chat-action-btn-wrapper chat-sidebar-collapse-wrapper">
              <button
                type="button"
                className="chat-action-btn chat-sidebar-toggle-btn"
                onClick={onToggleCollapse}
                aria-label={isCollapsed ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)"}
                title={isCollapsed ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)"}
              >
                {isCollapsed ? (
                  <PanelLeftOpen size={17} strokeWidth={2} aria-hidden="true" />
                ) : (
                  <PanelLeftClose size={17} strokeWidth={2} aria-hidden="true" />
                )}
              </button>
              <div className="chat-btn-tooltip" role="tooltip">
                {isCollapsed ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)"}
              </div>
            </div>
          )}

          <div className="chat-action-btn-wrapper">
            <button
              type="button"
              className="chat-action-btn chat-new-conversation-btn"
              onClick={() => {
                if (onNewChat) {
                  onNewChat();
                } else {
                  handleNewChat();
                }
              }}
              aria-label="New chat"
              title="New chat"
            >
              <Plus size={17} strokeWidth={2.4} aria-hidden="true" />
            </button>
            <div className="chat-btn-tooltip" role="tooltip">
              New chat
            </div>
          </div>
        </div>

        <div className="chat-top-brand-title-wrap">
          <img src={Logo} alt="Alfred Logo" className="chat-brand-logo" />
          <h1 className="chat-brand-title">ALFRED</h1>
        </div>

        {/* Symmetry spacer to balance action buttons in expanded view */}
        <div className="chat-header-spacer" aria-hidden="true" />
      </div>

      {/* Main Sidebar Content Area (Hidden via CSS when collapsed, preserving conversation state) */}
      <div className="chat-body-content">
        {!hasMessages ? (
        <div className="chat-main-content">
          <button
            type="button"
            className="chat-mic-circle-btn"
            aria-label="Voice input"
            onClick={() => {
              if (inputPrompt.trim()) {
                void handleSendMessage();
              }
            }}
          >
            <svg
              className="chat-mic-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#1a1a1a"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 10a7 7 0 0 0 14 0" />
              <line x1="12" y1="17" x2="12" y2="21" />
              <line x1="8" y1="21" x2="16" y2="21" />
            </svg>
          </button>
          <p className="chat-prompt-label">Ask anything / Schedule a meeting!</p>
          <form
            className="chat-prompt-input-wrapper"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (inputPrompt.trim() && !isLoading) {
                void handleSendMessage();
              }
            }}
          >
            <input
              type="text"
              className="chat-prompt-input"
              aria-label="Ask Alfred"
              placeholder="Ask Alfred anything..."
              value={inputPrompt}
              onChange={(e) => setInputPrompt(e.target.value)}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.keyCode === 13 || e.which === 13) && !e.shiftKey) {
                  e.preventDefault();
                  e.stopPropagation();
                  void handleSendMessage();
                }
              }}
              enterKeyHint="send"
              disabled={isLoading}
            />
            <button
              type="submit"
              className="chat-prompt-send-btn"
              disabled={isLoading || !inputPrompt.trim()}
              title="Send message"
              aria-label="Send message"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          </form>
        </div>
      ) : (
        <div className="chat-conversation-area">
          {/* Scrollable message history */}
          <div
            ref={messagesContainerRef}
            className="chat-messages-scroll"
            role="log"
            aria-live="polite"
            onScroll={handleMessagesScroll}
          >
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={
                  msg.role === "user"
                    ? "chat-bubble-user"
                    : "chat-bubble-assistant"
                }
              >
                {msg.role === "assistant" ? (
                  <SafeMarkdown content={msg.content} />
                ) : (
                  <div>{msg.content}</div>
                )}

                {msg.error && (
                  <div className="chat-error-card">
                    <span>{msg.error}</span>
                    <div className="chat-error-actions">
                      <button
                        type="button"
                        className="chat-retry-btn"
                        onClick={handleRetry}
                        disabled={isLoading}
                        aria-label="Retry message"
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M21 2v6h-6" />
                          <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                          <path d="M3 22v-6h6" />
                          <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                        </svg>
                        <span>Retry</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div
                className="chat-typing-indicator"
                aria-label="Alfred is thinking"
              >
                <div className="chat-typing-dot" />
                <div className="chat-typing-dot" />
                <div className="chat-typing-dot" />
              </div>
            )}
          </div>

          {/* Anchored Composer within Sidebar */}
          <div className="chat-active-composer">
            <form
              className="chat-composer-box"
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (inputPrompt.trim() && !isLoading) {
                  void handleSendMessage();
                }
              }}
            >
              <textarea
                ref={textareaRef}
                className="chat-composer-textarea"
                placeholder="Ask Alfred..."
                rows={1}
                value={inputPrompt}
                onChange={(e) => setInputPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                enterKeyHint="send"
                disabled={isLoading}
                aria-label="Ask Alfred"
              />

              <button
                type="button"
                className="chat-composer-btn"
                title="Voice input"
                aria-label="Voice input"
                disabled={isLoading}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="9" y="2" width="6" height="12" rx="3" />
                  <path d="M5 10a7 7 0 0 0 14 0" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              </button>

              <button
                type="submit"
                className="chat-composer-btn chat-composer-send-btn"
                disabled={isLoading || !inputPrompt.trim()}
                title="Send message"
                aria-label="Send message"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
            </form>
          </div>
        </div>
      )}
      </div>

      {/* Unaltered Bottom Profile and Settings Bar */}
      <div className="chat-bottom-bar">
        <div className="user-bar-profile">
          {isGoogleUser && session.account.picture ? (
            <img
              src={session.account.picture}
              alt={displayName}
              className="user-bar-avatar-img"
            />
          ) : (
            <div className="user-bar-avatar-circle" aria-label="User avatar">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#141414">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
              </svg>
            </div>
          )}

          <div className="user-bar-label">
            {isGoogleUser ? (
              <span className="user-bar-name" title={displayName}>
                {displayName}
              </span>
            ) : (
              <button
                type="button"
                className="user-bar-signin-btn"
                onClick={() => loginWithGoogle()}
              >
                {displayName === "Guest"
                  ? "Sign in with Google"
                  : displayName}
              </button>
            )}
          </div>
        </div>

        <button
          type="button"
          className="user-bar-settings-btn"
          aria-label="Settings"
          title="Settings"
          onClick={() => setIsSettingsOpen(true)}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
      </div>

      {isSettingsOpen &&
        createPortal(
          <div
            className="task-dialog-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) setIsSettingsOpen(false);
            }}
          >
            <section
              className="settings-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="settings-title"
            >
              <div className="task-dialog-heading">
                <h2 id="settings-title">Settings</h2>
                <button
                  type="button"
                  className="task-dialog-close"
                  onClick={() => setIsSettingsOpen(false)}
                  aria-label="Close settings"
                >
                  ×
                </button>
              </div>

              <div className="settings-content">
                <div className="settings-section">
                  <h3 className="settings-section-title">Account</h3>
                  <div className="settings-account-card">
                    <div className="settings-account-info">
                      {isGoogleUser && session.account.picture ? (
                        <img
                          src={session.account.picture}
                          alt=""
                          className="settings-avatar-img"
                        />
                      ) : (
                        <div className="settings-avatar-circle">
                          {isGoogleUser ? displayName[0].toUpperCase() : "G"}
                        </div>
                      )}
                      <div className="settings-account-meta">
                        <span className="settings-account-name">
                          {displayName}
                        </span>
                        <span className="settings-account-email">
                          {session?.account?.email ||
                            (isGoogleUser ? "" : "Guest Account")}
                        </span>
                      </div>
                    </div>

                    {isGoogleUser ? (
                      <button
                        type="button"
                        className="settings-logout-btn"
                        onClick={() => {
                          logout();
                          setIsSettingsOpen(false);
                        }}
                      >
                        Log out
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="settings-signin-btn"
                        onClick={() => {
                          loginWithGoogle(() => {
                            setIsSettingsOpen(false);
                          });
                          setIsSettingsOpen(false);
                        }}
                      >
                        Sign in with Google
                      </button>
                    )}
                  </div>
                </div>

                <div className="settings-section">
                  <h3 className="settings-section-title">Preferences</h3>
                  <div className="settings-placeholder-box">
                    <p className="settings-coming-soon-text">
                      Custom voice parameters, models, and personal preferences
                      will be configured here soon.
                    </p>
                  </div>
                </div>
              </div>
            </section>
          </div>,
          document.body
        )}
    </section>
  );
}
