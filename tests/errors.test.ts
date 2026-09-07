import { describe, it, expect } from "vitest";
import { userFacingStreamError } from "../src/errors";

describe("userFacingStreamError", () => {
  it("maps 401 and 403 to a reachability sentence", () => {
    const msg401 = userFacingStreamError({
      name: "AI_APICallError",
      statusCode: 401,
      responseBody: '{"error":{"code":"invalid_api_key"}}',
    });
    expect(msg401).toBe(
      "The assistant could not reach the model. Please try again in a moment."
    );
    expect(msg401).not.toMatch(/invalid_api_key|ABSK|bearer/i);

    expect(userFacingStreamError({ statusCode: 403 })).toBe(msg401);
  });

  it("maps 429 to the same copy the rate-limit path already uses", () => {
    expect(userFacingStreamError({ statusCode: 429 })).toBe(
      "You are sending messages too quickly. Please wait a moment and try again."
    );
  });

  it("does not leak request bodies or unknown fields", () => {
    const msg = userFacingStreamError({
      statusCode: 500,
      message: "upstream exploded",
      responseBody: "OPENAI_API_KEY=ABSKSECRET",
      url: "https://bedrock-mantle.us-west-2.api.aws/openai/v1/chat/completions",
    });
    expect(msg).toBe(
      "Something went wrong while generating a reply. Please try again."
    );
    expect(msg).not.toMatch(/ABSK|OPENAI_API_KEY|bedrock-mantle|exploded/);
  });

  it("treats missing or non-object errors as the generic sentence", () => {
    const generic =
      "Something went wrong while generating a reply. Please try again.";
    expect(userFacingStreamError(undefined)).toBe(generic);
    expect(userFacingStreamError("boom")).toBe(generic);
    expect(userFacingStreamError(null)).toBe(generic);
  });

  it("reads status as well as statusCode", () => {
    expect(userFacingStreamError({ status: 401 })).toMatch(/could not reach/);
  });
});
