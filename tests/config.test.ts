import { describe, it, expect } from "vitest";
import {
  resolveReasoningEffort,
  DEFAULT_REASONING_EFFORT,
} from "../src/config";

describe("resolveReasoningEffort", () => {
  it("defaults to none when unset", () => {
    expect(resolveReasoningEffort(undefined)).toBe("none");
    expect(DEFAULT_REASONING_EFFORT).toBe("none");
  });

  it("accepts every documented effort level", () => {
    expect(resolveReasoningEffort("none")).toBe("none");
    expect(resolveReasoningEffort("low")).toBe("low");
    expect(resolveReasoningEffort("medium")).toBe("medium");
    expect(resolveReasoningEffort("high")).toBe("high");
  });

  it("normalises surrounding whitespace and case", () => {
    expect(resolveReasoningEffort("  HIGH ")).toBe("high");
    expect(resolveReasoningEffort("Low")).toBe("low");
  });

  it("falls back to the default rather than sending an invalid value", () => {
    // An invalid reasoning_effort is rejected by Bedrock, which would take the
    // whole app down. Falling back keeps a typo from breaking production.
    expect(resolveReasoningEffort("bogus")).toBe("none");
    expect(resolveReasoningEffort("")).toBe("none");
    expect(resolveReasoningEffort("   ")).toBe("none");
  });
});
