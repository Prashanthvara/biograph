import { describe, it, expect } from "vitest";
import {
  isWaitingForReply,
  isStreamingAssistantText,
} from "../src/chat-status";

describe("isWaitingForReply", () => {
  it("is true after submit before any assistant message", () => {
    expect(isWaitingForReply("submitted", [{ role: "user" }])).toBe(true);
    expect(isWaitingForReply("streaming", [{ role: "user" }])).toBe(true);
    expect(isWaitingForReply("submitted", [])).toBe(true);
  });

  it("is false once an assistant message exists or the turn is idle", () => {
    expect(
      isWaitingForReply("streaming", [{ role: "user" }, { role: "assistant" }])
    ).toBe(false);
    expect(isWaitingForReply("ready", [{ role: "user" }])).toBe(false);
    expect(isWaitingForReply("error", [{ role: "user" }])).toBe(false);
  });
});

describe("isStreamingAssistantText", () => {
  it("is true only while the last message is a live assistant", () => {
    expect(
      isStreamingAssistantText("streaming", [
        { role: "user" },
        { role: "assistant" },
      ])
    ).toBe(true);
    expect(isStreamingAssistantText("streaming", [{ role: "user" }])).toBe(
      false
    );
    expect(
      isStreamingAssistantText("ready", [
        { role: "user" },
        { role: "assistant" },
      ])
    ).toBe(false);
  });
});
