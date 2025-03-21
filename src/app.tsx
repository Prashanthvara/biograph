import { useEffect, useState, useRef, useCallback } from "react";
import { useAgent } from "agents/react";
import { useAgentChat } from "agents/ai-react";
import type { Message } from "@ai-sdk/react";
import { APPROVAL } from "./shared";
// import type { tools } from "./tools";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { Avatar, AvatarFallback } from "./components/ui/avatar";
import { Switch } from "./components/ui/switch";
import { Send, Bot, Trash2, Bug, Copy, Check } from "lucide-react";

// List of tools that require human confirmation
// const toolsRequiringConfirmation: (keyof typeof tools)[] = [
//   "getWeatherInformation",
// ];

export default function Chat() {
  const [showDebug, setShowDebug] = useState(false);
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

    window.addEventListener('resize', debouncedResize);
    return () => {
      window.removeEventListener('resize', debouncedResize);
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
        const behavior = isMobile ? 'auto' : 'smooth';
        try {
          messagesEndRef.current.scrollIntoView({ 
            behavior,
            block: 'end',
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
    addToolResult,
    clearHistory,
  } = useAgentChat({
    agent,
    maxSteps: 5,
  });

  // Scroll to bottom when messages change, with a slight delay to ensure content is rendered
  useEffect(() => {
    if (agentMessages.length > 0) {
      // Clear any pending scroll timeouts
      if (scrollTimeoutRef.current) {
        window.clearTimeout(scrollTimeoutRef.current);
      }
      // Add a small delay to ensure content is rendered
      scrollTimeoutRef.current = window.setTimeout(scrollToBottom, 100);
    }
  }, [agentMessages, scrollToBottom]);

  const pendingToolCallConfirmation = agentMessages.some((m: Message) =>
    m.parts?.some(
      (part) =>
        part.type === "tool-invocation" &&
        part.toolInvocation.state === "call" //&&
        // toolsRequiringConfirmation.includes(
        //   part.toolInvocation.toolName as keyof typeof tools
        // )
    )
  );

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const handleCopy = async (text: string, messageId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(messageId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  return (
    <div className="h-[100dvh] w-full bg-gradient-to-br from-[#F48120]/10 via-background/30 to-[#FAAD3F]/10 backdrop-blur-md sm:p-4 flex justify-center items-stretch bg-fixed">
      <div className="bg-background w-full mx-auto max-w-lg flex flex-col shadow-xl rounded-none sm:rounded-md border-y sm:border border-assistant-border/20">
        <div className="shrink-0 px-4 py-3 sm:py-4 border-b border-border flex items-center gap-3 bg-background z-10 safe-top">
          <div className="flex items-center justify-center h-8 w-8 sm:h-10 sm:w-10">
            <svg
              width="28px"
              height="28px"
              className="text-[#F48120]"
              data-icon="agents"
            >
              <title>Biograph Copilot</title>
              <symbol id="ai:local:agents" viewBox="0 0 80 79">
                <image
                  href="https://s7-recruiting.cdn.greenhouse.io/external_greenhouse_job_boards/logos/400/213/800/original/Biograph_-_Black_-_Icon.png?1710277849"
                  width="80"
                  height="79"
                  preserveAspectRatio="xMidYMid meet"
                />
              </symbol>
              <use href="#ai:local:agents" />
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

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-20 max-h-[calc(100dvh-8rem)] sm:max-h-[calc(100dvh-10rem)]">
          {agentMessages.length === 0 && (
            <div className="h-full flex items-center justify-center">
              <Card className="bg-secondary/30 border-secondary/50 p-6 max-w-md mx-auto">
                <div className="text-center space-y-4">
                  <h3 className="font-semibold text-lg">
                    Welcome to Biograph Copilot
                  </h3>
                  <p className="text-muted-foreground text-sm">
                    Start a conversation with your copilot by providing patient information to get structured output with personalized recommendations.
                  </p>
                </div>
              </Card>
            </div>
          )}

          {agentMessages.map((m: Message, index) => {
            const isUser = m.role === "user";
            const showAvatar =
              index === 0 || agentMessages[index - 1]?.role !== m.role;
            const showRole = showAvatar && !isUser;

            return (
              <div key={m.id}>
                {showDebug && (
                  <pre className="text-xs text-muted-foreground overflow-scroll">
                    {JSON.stringify(m, null, 2)}
                  </pre>
                )}
                <div
                  className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`flex gap-2 max-w-[85%] ${
                      isUser ? "flex-row-reverse" : "flex-row"
                    }`}
                  >
                    {showAvatar && !isUser ? (
                      <Avatar className="h-8 w-8 mt-1 flex-shrink-0">
                        <AvatarFallback className="bg-[#1A2B3C] text-white">
                          AI
                        </AvatarFallback>
                      </Avatar>
                    ) : (
                      !isUser && <div className="w-8" />
                    )}

                    <div>
                      <div>
                        {m.parts?.map((part, i) => {
                          if (part.type === "text") {
                            return (
                              <div key={i}>
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
                                  {part.text.startsWith(
                                    "scheduled message"
                                  ) && (
                                    <span className="absolute -top-3 -left-2 text-base">
                                      🕒
                                    </span>
                                  )}
                                  <p className="text-sm whitespace-pre-wrap">
                                    {part.text.replace(
                                      /^scheduled message: /,
                                      ""
                                    )}
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
                                    onClick={() => handleCopy(part.text.replace(/^scheduled message: /, ""), m.id)}
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
                            // const toolInvocation = part.toolInvocation;
                            // const toolCallId = toolInvocation.toolCallId;

                            // if (
                            //   toolsRequiringConfirmation.includes(
                            //     toolInvocation.toolName as keyof typeof tools
                            //   ) &&
                            //   toolInvocation.state === "call"
                            // ) {
                            //   return (
                            //     <Card
                            //       key={i}
                            //       className="p-4 my-3 bg-secondary/30 border-secondary/50 rounded-md"
                            //     >
                            //       <div className="flex items-center gap-2 mb-3">
                            //         <div className="bg-[#F48120]/10 p-1.5 rounded-full">
                            //           <Bot className="h-4 w-4 text-[#F48120]" />
                            //         </div>
                            //         <h4 className="font-medium">
                            //           {toolInvocation.toolName}
                            //         </h4>
                            //       </div>

                            //       <div className="mb-3">
                            //         <h5 className="text-xs font-medium mb-1 text-muted-foreground">
                            //           Arguments:
                            //         </h5>
                            //         <pre className="bg-background/80 p-2 rounded-md text-xs overflow-auto">
                            //           {JSON.stringify(
                            //             toolInvocation.args,
                            //             null,
                            //             2
                            //           )}
                            //         </pre>
                            //       </div>

                            //       <div className="flex gap-2 justify-end">
                            //         <Button
                            //           variant="outline"
                            //           size="sm"
                            //           onClick={() =>
                            //             addToolResult({
                            //               toolCallId,
                            //               result: APPROVAL.NO,
                            //             })
                            //           }
                            //         >
                            //           Reject
                            //         </Button>
                            //         <Button
                            //           variant="default"
                            //           size="sm"
                            //           onClick={() =>
                            //             addToolResult({
                            //               toolCallId,
                            //               result: APPROVAL.YES,
                            //             })
                            //           }
                            //         >
                            //           Approve
                            //         </Button>
                            //       </div>
                            //     </Card>
                            //   );
                            // }
                            return null;
                          }
                          return null;
                          // return (
                          //   <div key={i}>
                          //     <Card className="p-3 rounded-2xl bg-secondary border-secondary">
                          //       <pre className="text-xs">
                          //         {JSON.stringify(part, null, 2)}
                          //       </pre>
                          //     </Card>
                          //   </div>
                          // );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
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
              placeholder="Send a message..."
              className="flex-1 min-h-[80px] resize-none py-2 px-3"
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.shiftKey) {
                  e.preventDefault();
                  handleAgentSubmit(e);
                }
              }}
            />
            <Button
              type="submit"
              size="icon"
              className="rounded-full h-12 w-12 sm:h-9 sm:w-9 flex-shrink-0"
            >
              <Send className="h-5 w-5 sm:h-4 sm:w-4" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
