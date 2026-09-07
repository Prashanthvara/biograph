import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/server";
import { allowRequest } from "../src/config";

// The real binding is enforced by workerd, so these tests inject a stub
// limiter instead. That keeps the assertions about *our* gate, not about
// Cloudflare's counter.
const withLimiter = (success: boolean) => ({
  ...env,
  RATE_LIMITER: { limit: async () => ({ success }) },
});

describe("rate limiting", () => {
  it("returns 429 with a retry hint when the limiter denies", async () => {
    const request = new Request("http://example.com/agents/chat/test");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, withLimiter(false), ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
  });

  it("passes the request through when the limiter allows", async () => {
    const request = new Request("http://example.com/");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, withLimiter(true), ctx);
    await waitOnExecutionContext(ctx);

    // Nothing routes "/", so the handler's own 404 proves we got past the gate.
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
  });

  it("allows the request through when the binding is missing", async () => {
    // @cloudflare/vite-plugin 0.1.x does not wire `ratelimits` into miniflare,
    // so env.RATE_LIMITER is undefined under `vite dev`. Crashing there would
    // take local development down entirely.
    const request = new Request("http://example.com/");
    const ctx = createExecutionContext();
    const response = await worker.fetch(
      request,
      { ...env, RATE_LIMITER: undefined },
      ctx
    );
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(404);
  });
});

describe("allowRequest", () => {
  it("allows when no limiter is bound", async () => {
    expect(await allowRequest(undefined, "k")).toBe(true);
  });

  it("returns the limiter's decision", async () => {
    const allow = { limit: async () => ({ success: true }) };
    const deny = { limit: async () => ({ success: false }) };
    expect(await allowRequest(allow, "k")).toBe(true);
    expect(await allowRequest(deny, "k")).toBe(false);
  });

  it("fails open when the limiter throws", async () => {
    // A limiter outage should not become an outage of the whole app.
    const broken = {
      limit: async () => {
        throw new Error("binding unavailable");
      },
    };
    expect(await allowRequest(broken, "k")).toBe(true);
  });
});
