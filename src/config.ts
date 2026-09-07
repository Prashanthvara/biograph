/**
 * Model call configuration.
 *
 * Kept separate from server.ts so it can be unit-tested without a network
 * call or a Durable Object.
 */

/**
 * Chat Completions reasoning levels. Note this is `reasoning_effort` — the
 * `reasoning: { effort }` form on the model card is a Responses API parameter
 * and is silently ignored here.
 */
export type ReasoningEffort = "none" | "low" | "medium" | "high";

const REASONING_EFFORTS: readonly string[] = ["none", "low", "medium", "high"];

/**
 * Measured against xai.grok-4.6 on 2026-09-07 with a 7-marker panel question:
 * "low" (the model's own default) burned 1178 hidden reasoning tokens billed at
 * the output rate, for $0.01107 a response. "none" burned 0, cost $0.00341, and
 * still produced a complete and correct analysis.
 */
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "none";

/**
 * An invalid reasoning_effort is rejected by Bedrock outright, so a typo in the
 * env var would break every request. Fall back instead of propagating it.
 */
export function resolveReasoningEffort(
  value: string | undefined
): ReasoningEffort {
  const normalized = value?.trim().toLowerCase();
  if (normalized && REASONING_EFFORTS.includes(normalized)) {
    return normalized as ReasoningEffort;
  }
  return DEFAULT_REASONING_EFFORT;
}

/**
 * Grok 4.3/4.6 default to temperature 0.7 and top_p 0.95, not the
 * OpenAI-standard 1. Biomarker comparison should be repeatable, so both are
 * pinned explicitly rather than inherited.
 */
export const TEMPERATURE = 0.2;
export const TOP_P = 0.95;

/**
 * Returns true when the request may proceed.
 *
 * The binding is absent under some local setups — @cloudflare/vite-plugin
 * 0.1.x does not wire `ratelimits` into miniflare — and a limiter that is
 * missing or erroring should degrade to "allow" rather than take the whole
 * app down. Production has the binding; see wrangler.jsonc.
 */
export async function allowRequest(
  limiter: RateLimit | undefined,
  key: string
): Promise<boolean> {
  if (!limiter) return true;
  try {
    const { success } = await limiter.limit({ key });
    return success;
  } catch (error) {
    console.error("rate limiter unavailable, allowing request:", error);
    return true;
  }
}
