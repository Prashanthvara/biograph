import { useEffect, useState, useRef, useCallback } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "agents/ai-react";
import type { Message } from "@ai-sdk/react";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import { Textarea } from "./components/ui/textarea";
import { Avatar, AvatarFallback } from "./components/ui/avatar";
import { Send, Trash2, Copy, Check } from "lucide-react";
import { parsePanelReport } from "./panel";
import { isStreamingAssistantText, isWaitingForReply } from "./chat-status";
import { LoadingState } from "./components/loading-state";
import { ErrorState } from "./components/error-state";
import { PanelTable } from "./components/panel-table";
import { FollowUps } from "./components/follow-ups";

export default function Chat() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollTimeoutRef = useRef<number | null>(null);

  // Debounced resize handler
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 640);
    };

    let timeoutId: number;
    const debouncedResize = () => {
      clearTimeout(timeoutId);
      timeoutId = window.setTimeout(handleResize, 250);
    };

    window.addEventListener("resize", debouncedResize);
    return () => {
      window.removeEventListener("resize", debouncedResize);
      clearTimeout(timeoutId);
    };
  }, []);

  const scrollToBottom = useCallback(() => {
    // Clear any pending scroll timeouts
    if (scrollTimeoutRef.current) {
      window.clearTimeout(scrollTimeoutRef.current);
    }

    // Use RAF for smoother scrolling
    requestAnimationFrame(() => {
      if (messagesEndRef.current) {
        const behavior = isMobile ? "auto" : "smooth";
        try {
          messagesEndRef.current.scrollIntoView({
            behavior,
            block: "end",
          });
        } catch (error) {
          // Fallback for browsers that don't support smooth scrolling
          messagesEndRef.current.scrollIntoView(false);
        }
      }
    });
  }, [isMobile]);

  useEffect(() => {
    // Apply light theme class on mount
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.add("light");
    // Focus the input field after render
    requestAnimationFrame(() => {
      if (inputRef.current && document.activeElement !== inputRef.current) {
        inputRef.current.focus();
      }
    });
  }, []);

  // Scroll to bottom on mount
  useEffect(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  const agent = useAgent({
    agent: "chat",
  });

  const {
    messages: agentMessages,
    input: agentInput,
    handleInputChange: handleAgentInputChange,
    handleSubmit: handleAgentSubmit,
    append,
    clearHistory,
    status,
    error,
    reload,
  } = useAgentChat({
    agent,
    maxSteps: 5,
  });

  // Scroll to bottom when messages change, with a slight delay to ensure content is rendered
  useEffect(() => {
    if (agentMessages.length > 0 || status === "submitted") {
      // Clear any pending scroll timeouts
      if (scrollTimeoutRef.current) {
        window.clearTimeout(scrollTimeoutRef.current);
      }
      // Add a small delay to ensure content is rendered
      scrollTimeoutRef.current = window.setTimeout(scrollToBottom, 100);
    }
  }, [agentMessages, status, scrollToBottom]);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const handleCopy = async (text: string, messageId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(messageId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  const waiting = isWaitingForReply(status, agentMessages);
  const showCaret = isStreamingAssistantText(status, agentMessages);
  const lastMessageId = agentMessages[agentMessages.length - 1]?.id;
  const busy = status === "submitted" || status === "streaming";

  return (
    <div className="h-[100dvh] w-full bg-gradient-to-br from-[#F48120]/10 via-background/30 to-[#FAAD3F]/10 backdrop-blur-md sm:p-4 flex justify-center items-stretch bg-fixed">
      <div className="bg-background w-full mx-auto max-w-2xl flex flex-col shadow-xl rounded-none sm:rounded-md border-y sm:border border-assistant-border/20">
        <div className="shrink-0 px-4 py-3 sm:py-4 border-b border-border flex items-center gap-3 bg-background z-10 safe-top">
          <div className="flex items-center justify-center h-8 w-8 sm:h-10 sm:w-10">
            <svg
              width="28"
              height="28"
              viewBox="0 0 32 32"
              role="img"
              aria-label="Biograph Copilot"
              className="text-[#F48120]"
            >
              <title>Biograph Copilot</title>
              <rect
                x="1"
                y="1"
                width="30"
                height="30"
                rx="8"
                fill="currentColor"
                opacity="0.12"
              />
              <path
                d="M4 16h5l2.5-6 4 12 3-9 2.5 3H28"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <div className="flex-1">
            <h2 className="font-semibold text-base">Biograph Copilot</h2>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="rounded-full h-10 w-10 sm:h-9 sm:w-9"
            onClick={clearHistory}
          >
            <Trash2 className="h-5 w-5 sm:h-4 sm:w-4" />
          </Button>
        </div>

        <div className="shrink-0 px-4 py-2 border-b border-border bg-secondary/20">
          <p className="text-[11px] leading-snug text-muted-foreground">
            This is an AI assistant, not a medical professional. Information
            here is for general education only and is not a diagnosis. Always
            consult a qualified clinician before acting on it.
          </p>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-20 max-h-[calc(100dvh-8rem)] sm:max-h-[calc(100dvh-10rem)]">
          {agentMessages.length === 0 && !waiting && status !== "error" && (
            <div className="h-full flex items-center justify-center">
              <Card className="bg-secondary/30 border-secondary/50 p-6 max-w-md mx-auto">
                <div className="text-center space-y-4">
                  <h3 className="font-semibold text-lg">
                    Welcome to Biograph Copilot
                  </h3>
                  <p className="text-muted-foreground text-sm">
                    Paste a lab panel to see each marker against its range, then
                    next steps. Follow-up questions appear as chips under the
                    table.
                  </p>
                </div>
              </Card>
            </div>
          )}

          {agentMessages.map((m: Message, index) => {
            const isUser = m.role === "user";
            const showAvatar =
              index === 0 || agentMessages[index - 1]?.role !== m.role;
            const isLastAssistant =
              !isUser && m.id === lastMessageId && status === "ready";

            return (
              <div key={m.id}>
                <div
                  className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`flex gap-2 ${
                      isUser
                        ? "max-w-[85%] flex-row-reverse"
                        : "w-full flex-row"
                    }`}
                  >
                    {showAvatar && !isUser ? (
                      <Avatar className="h-8 w-8 mt-1 flex-shrink-0">
                        <AvatarFallback className="bg-[#1A2B3C] text-white">
                          AI
                        </AvatarFallback>
                      </Avatar>
                    ) : (
                      !isUser && <div className="w-8 flex-shrink-0" />
                    )}

                    <div className="min-w-0 flex-1 space-y-2">
                      {m.parts?.map((part, i) => {
                        if (part.type === "text") {
                          const isLastText =
                            showCaret &&
                            m.id === lastMessageId &&
                            i === (m.parts?.length ?? 0) - 1;
                          return (
                            <div key={`${m.id}-part-${i}`}>
                              <Card
                                className={`p-3 rounded-md ${
                                  isUser
                                    ? "bg-primary text-primary-foreground rounded-br-none"
                                    : "bg-secondary/10 rounded-bl-none border-assistant-border"
                                } ${
                                  part.text.startsWith("scheduled message")
                                    ? "border-accent/50"
                                    : ""
                                } relative`}
                              >
                                {part.text.startsWith("scheduled message") && (
                                  <span className="absolute -top-3 -left-2 text-base">
                                    🕒
                                  </span>
                                )}
                                <p className="text-sm whitespace-pre-wrap">
                                  {part.text.replace(
                                    /^scheduled message: /,
                                    ""
                                  )}
                                  {isLastText ? (
                                    <span
                                      className="inline-block w-[0.6ch] ml-0.5 bg-foreground/70 align-baseline motion-safe:animate-pulse"
                                      aria-hidden="true"
                                    >
                                      ▍
                                    </span>
                                  ) : null}
                                </p>
                              </Card>
                              <div
                                className={`flex items-center gap-2 mt-1 text-xs text-muted-foreground ${
                                  isUser ? "flex-row-reverse" : "flex-row"
                                }`}
                              >
                                <span>
                                  {formatTime(
                                    new Date(m.createdAt as unknown as string)
                                  )}
                                </span>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-4 w-4 p-0"
                                  onClick={() =>
                                    handleCopy(
                                      part.text.replace(
                                        /^scheduled message: /,
                                        ""
                                      ),
                                      m.id
                                    )
                                  }
                                >
                                  {copiedId === m.id ? (
                                    <Check className="h-3 w-3" />
                                  ) : (
                                    <Copy className="h-3 w-3" />
                                  )}
                                </Button>
                              </div>
                            </div>
                          );
                        }

                        if (part.type === "tool-invocation") {
                          const invocation = part.toolInvocation;
                          if (invocation.toolName !== "reportPanel") {
                            return null;
                          }
                          if (invocation.state === "call") {
                            return (
                              <p
                                key={`${m.id}-tool-${i}`}
                                className="text-xs text-muted-foreground"
                              >
                                Reading panel…
                              </p>
                            );
                          }
                          if (invocation.state === "result") {
                            const report = parsePanelReport(invocation.result);
                            if (!report) return null;
                            return (
                              <div
                                key={`${m.id}-tool-${i}`}
                                className="space-y-2"
                              >
                                <PanelTable report={report} />
                                {isLastAssistant ? (
                                  <FollowUps
                                    items={report.followUps}
                                    onSelect={(item) => {
                                      void append({
                                        role: "user",
                                        content: item,
                                      });
                                    }}
                                  />
                                ) : null}
                              </div>
                            );
                          }
                          return null;
                        }
                        return null;
                      })}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {waiting ? <LoadingState /> : null}

          {status === "error" ? (
            <ErrorState
              message={
                error?.message ||
                "Something went wrong while generating a reply. Please try again."
              }
              onRetry={() => {
                void reload();
              }}
            />
          ) : null}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="shrink-0 border-t border-border bg-background">
          <form
            onSubmit={handleAgentSubmit}
            className="px-4 py-4 flex items-center gap-2 safe-bottom"
          >
            <Textarea
              ref={inputRef}
              value={agentInput}
              onChange={handleAgentInputChange}
              placeholder="Paste a lab panel or ask a follow-up…"
              className="flex-1 min-h-[80px] resize-none py-2 px-3"
              onKeyDown={(e) => {
                // Enter sends, Shift+Enter inserts a newline.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (busy) return;
                  handleAgentSubmit(e);
                }
              }}
            />
            <Button
              type="submit"
              size="icon"
              className="rounded-full h-12 w-12 sm:h-9 sm:w-9 flex-shrink-0"
              disabled={busy}
            >
              <Send className="h-5 w-5 sm:h-4 sm:w-4" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
