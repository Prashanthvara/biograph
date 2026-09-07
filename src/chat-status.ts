export type ChatStatus = "submitted" | "streaming" | "ready" | "error";

export function isWaitingForReply(
  status: ChatStatus,
  messages: { role: string }[]
): boolean {
  if (status !== "submitted" && status !== "streaming") return false;
  const last = messages[messages.length - 1];
  return !last || last.role === "user";
}

export function isStreamingAssistantText(
  status: ChatStatus,
  messages: { role: string }[]
): boolean {
  if (status !== "streaming") return false;
  const last = messages[messages.length - 1];
  return last?.role === "assistant";
}
