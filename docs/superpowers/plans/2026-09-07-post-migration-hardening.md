# Post-Migration Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut per-response inference cost ~3x, remove dead starter-template code, cap runaway Bedrock spend, and show a medical disclaimer — without adding authentication.

**Architecture:** All model-call configuration moves out of the inline `streamText` literal into a small pure module (`src/config.ts`) that can be unit-tested without a network call. Rate limiting is applied in two places because chat messages travel over one long-lived WebSocket rather than one HTTP request each: `fetch()` caps connection attempts, and `onChatMessage` caps actual model invocations. UI work is confined to `src/app.tsx`.

**Tech Stack:** Cloudflare Workers + Durable Objects, `agents@0.0.38` (`AIChatAgent`), Vercel AI SDK `ai@4.3.19`, `@ai-sdk/openai-compatible@0.1.17` against Bedrock mantle, React 19 + Vite 6, Vitest with `@cloudflare/vitest-pool-workers`, Biome + Prettier, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-07-post-migration-hardening.md`

## Global Constraints

- **Provider options key is `bedrock`** — `createOpenAICompatible({ name: "bedrock" })` makes `providerOptionsName` = `"bedrock"`. Using any other key silently sends nothing.
- **`reasoning_effort`, not `reasoning`** — the Responses-API `reasoning={"effort":...}` form is silently ignored on Chat Completions.
- **Valid effort values:** `"none" | "low" | "medium" | "high"`. Default for this app: `"none"`.
- **`maxTokens: 8000` must not be lowered.** Reasoning tokens draw from the same budget as the answer; too small a cap returns HTTP 200 with `content: null` and `finish_reason: "length"`.
- **Rate limit `period` must be exactly `10` or `60`** (wrangler schema enum). Any other value fails config validation.
- **Model/endpoint defaults do not change:** `BASE_URL` stays `https://bedrock-mantle.us-west-2.api.aws/openai/v1`, `MODEL_ID` stays `xai.grok-4.6`.
- **No authentication.** Do not add login screens, tokens, passphrases, or session handling.
- **Product name stays "Biograph Copilot"** in all user-facing copy and in `index.html`.
- **Node is not on `PATH` in non-interactive shells** (nvm shim). Scripts that need it must be run with the absolute binary, e.g. `/Users/pjay/.nvm/versions/node/v22.18.0/bin/node`, or via `pnpm exec`.
- **`tsconfig.json` excludes `tests/`** (line 125), so `tsc --noEmit` type-checks `src/` only. Types in test files are stripped, never checked — a type error there will not fail the build, so verify test behaviour by running them.
- **Every task ends green on:** `pnpm exec prettier . --check`, `pnpm exec biome lint .`, `pnpm exec tsc --noEmit`, `pnpm exec vitest run`.

**Before Task 1:** the working tree already contains the Bedrock migration and a review cleanup pass. Commit that first so each task below is an isolated diff:

```bash
cd /Users/pjay/hippocratic
git add -A
git commit -m "chore: bedrock migration cleanup and repo-wide format"
```

---

### Task 1: Smoke-test harness

Every later task changes model behaviour or UI in ways the unit tests cannot see. This task builds the tool the rest of the plan verifies against, so it comes first.

**Files:**

- Create: `scripts/smoke.mjs`
- Modify: `package.json` (scripts block)

**Interfaces:**

- Consumes: nothing.
- Produces: `pnpm run smoke` — opens a WebSocket to a locally running dev server, sends one chat message, prints the assistant's reply, exits `0` on non-empty text and `1` on empty/error/timeout. Later tasks call this verbatim.

- [ ] **Step 1: Write the smoke script**

Create `scripts/smoke.mjs`:

```js
// Drives the agent end-to-end over its WebSocket protocol against a running
// dev server. The chat protocol is WebSocket-only: `/get-messages` is the sole
// HTTP route, so a plain fetch cannot exercise the model path.
//
// Usage: node scripts/smoke.mjs [--port 5173] [--message "..."]

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const port = flag("port", "5173");
const message = flag(
  "message",
  "Fasting glucose 112 mg/dL. Is it in range, and what should I do?"
);
const room = `smoke-${Date.now()}`;
const timeoutMs = Number(flag("timeout", "120000"));

const ws = new WebSocket(`ws://localhost:${port}/agents/chat/${room}`);
let text = "";
let streamError = "";

const finish = (code, summary) => {
  console.log(summary);
  try {
    ws.close();
  } catch {}
  process.exit(code);
};

const timer = setTimeout(
  () =>
    finish(1, `FAIL: no completion within ${timeoutMs}ms. partial: ${text}`),
  timeoutMs
);

ws.onopen = () => {
  ws.send(
    JSON.stringify({
      type: "cf_agent_use_chat_request",
      id: "smoke-1",
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              id: "m1",
              role: "user",
              createdAt: new Date().toISOString(),
              content: message,
              parts: [{ type: "text", text: message }],
            },
          ],
        }),
      },
    })
  );
};

ws.onmessage = (event) => {
  let envelope;
  try {
    envelope = JSON.parse(event.data);
  } catch {
    return;
  }
  if (envelope.type !== "cf_agent_use_chat_response") return;

  // The data-stream protocol prefixes each line: `0:` is assistant text,
  // `3:` is an error.
  for (const line of (envelope.body || "").split("\n")) {
    if (line.startsWith("0:")) text += JSON.parse(line.slice(2));
    if (line.startsWith("3:")) streamError += line.slice(2);
  }

  if (!envelope.done) return;
  clearTimeout(timer);
  if (streamError) return finish(1, `FAIL: stream error: ${streamError}`);
  if (!text.trim()) {
    return finish(
      1,
      "FAIL: empty response. Reasoning likely consumed the whole maxTokens budget."
    );
  }
  finish(0, `PASS (${text.length} chars):\n\n${text.trim()}`);
};

ws.onerror = () =>
  finish(1, "FAIL: websocket error (is the dev server running?)");
```

- [ ] **Step 2: Add the script entry**

In `package.json`, inside `"scripts"`, add `smoke` after `"start"`:

```json
    "start": "vite dev",
    "smoke": "node scripts/smoke.mjs",
```

- [ ] **Step 3: Run it against a live dev server to verify it passes**

In one terminal:

```bash
cd /Users/pjay/hippocratic && pnpm run start
```

Note the port Vite prints — it will pick the next free port if 5173 is taken. In a second terminal, using that port:

```bash
cd /Users/pjay/hippocratic && pnpm run smoke -- --port 5173
```

Expected: `PASS (N chars):` followed by a biomarker answer. If it prints `FAIL: websocket error`, the port is wrong.

- [ ] **Step 4: Verify it correctly reports failure**

Stop the dev server, then re-run the smoke script.

```bash
cd /Users/pjay/hippocratic && pnpm run smoke -- --port 5173
```

Expected: exits non-zero with `FAIL: websocket error (is the dev server running?)`. A harness that cannot fail is not a harness.

- [ ] **Step 5: Format, check, commit**

```bash
cd /Users/pjay/hippocratic
pnpm exec prettier --write scripts/smoke.mjs package.json
pnpm exec biome lint . && pnpm exec tsc --noEmit && pnpm exec vitest run
git add scripts/smoke.mjs package.json
git commit -m "test: add end-to-end smoke script for the agent chat path"
```

---

### Task 2: Model call configuration

Moves reasoning effort and sampling out of the inline literal into a tested pure module. This is the cost fix: measured 3.2x cheaper per response.

**Files:**

- Create: `src/config.ts`
- Create: `tests/config.test.ts`
- Modify: `src/server.ts` (imports; the `streamText({...})` options block)
- Modify: `worker-configuration.d.ts` (the `Cloudflare.Env` interface at the top of the file)
- Modify: `.dev.vars` (add a commented example line)

**Interfaces:**

- Consumes: `scripts/smoke.mjs` from Task 1.
- Produces:
  - `export type ReasoningEffort = "none" | "low" | "medium" | "high"`
  - `export const DEFAULT_REASONING_EFFORT: ReasoningEffort`
  - `export function resolveReasoningEffort(value: string | undefined): ReasoningEffort`
  - `export const TEMPERATURE: number`
  - `export const TOP_P: number`
  - `Env.OPENAI_REASONING_EFFORT?: string`

- [ ] **Step 1: Write the failing test**

Create `tests/config.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/pjay/hippocratic && pnpm exec vitest run tests/config.test.ts
```

Expected: FAIL — `Failed to resolve import "../src/config"`.

- [ ] **Step 3: Write the implementation**

Create `src/config.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/pjay/hippocratic && pnpm exec vitest run tests/config.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Declare the new environment variable**

In `worker-configuration.d.ts`, the interface at the very top of the file currently reads:

```ts
declare namespace Cloudflare {
  interface Env {
    OPENAI_API_KEY: string;
    OPENAI_BASE_URL?: string;
    OPENAI_MODEL_ID?: string;
    Chat: DurableObjectNamespace<import("./src/server").Chat>;
  }
}
```

Add one line after `OPENAI_MODEL_ID` (this file is tab-indented — match it):

```ts
		OPENAI_REASONING_EFFORT?: string;
```

- [ ] **Step 6: Wire it into the model call**

In `src/server.ts`, add to the import block near the top (after the `./tools` import):

```ts
import { resolveReasoningEffort, TEMPERATURE, TOP_P } from "./config";
```

Then in the `streamText({...})` call, the options currently read:

```ts
          const result = streamText({
            model: this.model(),
            // Grok 4.3/4.6 always reason, and reasoning tokens are drawn from the
            // same budget as the answer - too small a cap returns content: null
            // with finish_reason "length". Leave ample room.
            maxTokens: 8000,
            system: `...`,
```

Insert these four settings immediately after `maxTokens: 8000,` and before `system:`:

```ts
            temperature: TEMPERATURE,
            topP: TOP_P,
            // "bedrock" must match createOpenAICompatible({ name: "bedrock" });
            // @ai-sdk/openai-compatible spreads this object straight into the
            // Chat Completions request body. A wrong key is silently dropped.
            providerOptions: {
              bedrock: {
                reasoning_effort: resolveReasoningEffort(
                  this.env.OPENAI_REASONING_EFFORT
                ),
              },
            },
```

- [ ] **Step 7: Document the variable locally**

Append to `.dev.vars` (this file is gitignored — the line is for the developer's own reference):

```
# Optional: none | low | medium | high. Defaults to "none".
# OPENAI_REASONING_EFFORT=none
```

- [ ] **Step 8: Verify the setting actually reaches Bedrock**

Start the dev server, then run the smoke script and confirm a real answer comes back:

```bash
cd /Users/pjay/hippocratic && pnpm run start
# second terminal, using the port Vite printed:
cd /Users/pjay/hippocratic && pnpm run smoke -- --port 5173
```

Expected: `PASS` with a substantive answer, and noticeably faster than before (no hidden reasoning phase).

Then confirm the wiring end-to-end by proving an invalid value is _not_ what gets sent — set a bad value, restart the dev server, and re-run:

```bash
cd /Users/pjay/hippocratic
echo 'OPENAI_REASONING_EFFORT=not-a-level' >> .dev.vars
# restart dev server, then:
pnpm run smoke -- --port 5173
```

Expected: still `PASS` (the fallback protected it, rather than Bedrock returning a 400). Now remove that line again:

```bash
cd /Users/pjay/hippocratic
grep -v '^OPENAI_REASONING_EFFORT=not-a-level$' .dev.vars > .dev.vars.tmp && mv .dev.vars.tmp .dev.vars
```

- [ ] **Step 9: Full check and commit**

```bash
cd /Users/pjay/hippocratic
pnpm exec prettier --write src/config.ts tests/config.test.ts src/server.ts
pnpm exec prettier . --check && pnpm exec biome lint . && pnpm exec tsc --noEmit && pnpm exec vitest run
git add src/config.ts tests/config.test.ts src/server.ts worker-configuration.d.ts
git commit -m "perf: default reasoning_effort to none and pin sampling params

Measured on xai.grok-4.6: 1178 hidden reasoning tokens per response at the
default effort, billed at the output rate. Setting effort to none drops that
to 0 and cuts cost per response from \$0.01107 to \$0.00341, with no loss of
accuracy on a 7-marker panel. Overridable via OPENAI_REASONING_EFFORT."
```

---

### Task 3: Rewrite the system prompt

Justified on **coherence, not cost** — the measurements show a shorter prompt actually costs more. The current prompt demands 10,000 characters of contemplation and "continue reasoning indefinitely", then asks the model not to show its reasoning, which is incoherent now that reasoning is off. It also contains two typos that reach the model verbatim.

**Files:**

- Modify: `src/server.ts` (the `system:` template literal)

**Interfaces:**

- Consumes: Task 2's `reasoning_effort: "none"` default.
- Produces: nothing importable.

- [ ] **Step 1: Replace the prompt**

In `src/server.ts`, delete the entire `system:` template literal — everything from `system: \`You are an medical assistant` through the closing `` `, `` — and replace it with:

```ts
            system: `You are a medical assistant that analyses patient biomarker panels.

For each biomarker the user provides, compare the value against its standard
reference range. Clearly identify every value that falls outside its range, say
whether it is high or low, and by how much. Note in-range values briefly as
normal. Follow the findings with concrete, practical next steps.

Rules:
- Answer only questions in the medical and health domain. If asked about
  anything else, say plainly that you cannot answer or comment on it.
- Give the answer and the next steps only. Do not narrate your reasoning
  process.
- Write in clear, well-structured prose. Do not use * or # characters for
  emphasis or headings.
- Where a reference range depends on age, sex, or laboratory, say so rather
  than guessing.
- You are not a doctor and this is not a diagnosis. Recommend consulting a
  qualified clinician before acting on anything you flag.`,
```

Note what changed and why:

- Dropped "EXPLORATION OVER CONCLUSION", "DEPTH OF REASONING", "THINKING PROCESS", "PERSISTENCE" — they instruct the model to do the exact thing `reasoning_effort: "none"` turns off.
- Fixed `betchmarks` → the sentence is rewritten; fixed `reasining` → `reasoning`.
- Added the domain guard, the formatting rule, and the not-a-doctor line.

- [ ] **Step 2: Verify a medical question still gets a correct, well-formed answer**

Start the dev server, then:

```bash
cd /Users/pjay/hippocratic
pnpm run smoke -- --port 5173 --message "Patient panel: fasting glucose 112 mg/dL, HbA1c 5.9%, LDL 165 mg/dL, HDL 38 mg/dL, triglycerides 210 mg/dL, TSH 2.1 mIU/L, ALT 54 U/L. Which are out of range and what should I do?"
```

Expected: `PASS`. Read the output and confirm all of: glucose, HbA1c, LDL, triglycerides and ALT are flagged high; HDL is flagged low; TSH is called normal; there are no `*` or `#` characters; next steps are present.

- [ ] **Step 3: Verify the domain guard works**

```bash
cd /Users/pjay/hippocratic
pnpm run smoke -- --port 5173 --message "Write me a Python function that reverses a linked list."
```

Expected: `PASS`, and the text declines to answer because it is outside the medical domain.

- [ ] **Step 4: Re-test the scheduled-task path**

The spec records an unexplained 120s timeout on a tool-calling turn under the old prompt. Confirm whether it survives:

```bash
cd /Users/pjay/hippocratic
pnpm run smoke -- --port 5173 --message "Schedule a task 10 seconds from now with the description 'check in'. Confirm once scheduled."
```

Expected: `PASS` within the timeout. If it still times out, that is a genuine separate bug — record the observed behaviour and raise it rather than working around it in this task.

- [ ] **Step 5: Check and commit**

```bash
cd /Users/pjay/hippocratic
pnpm exec prettier --write src/server.ts
pnpm exec prettier . --check && pnpm exec biome lint . && pnpm exec tsc --noEmit && pnpm exec vitest run
git add src/server.ts
git commit -m "fix: rewrite system prompt for coherence with reasoning disabled

The prompt demanded 10,000 characters of contemplation and indefinite
reasoning, then asked the model to hide its reasoning. With reasoning_effort
now none, that block was actively contradictory. Also fixes the typos
'betchmarks' and 'reasining', and adds a medical-domain guard."
```

---

### Task 4: Remove demo tools and dead confirmation scaffolding

`getWeatherInformation` has no `execute`, so the agents SDK requires a human confirmation before it can resolve — but the confirmation UI in `app.tsx` is entirely commented out. If the model ever calls it, the turn dead-ends. `getLocalTime` returns the hardcoded string `"10am"`. Both are starter-template demos shipped into a medical assistant, and both are sent as input tokens on every request.

Removing them leaves no confirmation-required tools, which makes `executions`, `processToolCalls`, `src/shared.ts` and ~90 lines of commented JSX dead. They go too. All of it is recoverable with `git show`.

**Files:**

- Modify: `src/tools.ts:14-37` (the two tool definitions) and `:81-91` (the `executions` export)
- Modify: `src/server.ts` (imports; the `processToolCalls` call; `tools` usage stays)
- Delete: `src/utils.ts`
- Delete: `src/shared.ts`
- Modify: `src/app.tsx:5` (the `APPROVAL` import), `:11` (the `Bot` icon), `:13-16` and `:284-361` (the commented-out confirmation UI)

**Interfaces:**

- Consumes: nothing.
- Produces: `tools` in `src/tools.ts` narrows to `{ scheduleTask }`. `executions`, `processToolCalls`, and `APPROVAL` no longer exist.

- [ ] **Step 1: Confirm nothing else references what is about to be deleted**

```bash
cd /Users/pjay/hippocratic
grep -rn "processToolCalls\|executions\|APPROVAL\|getWeatherInformation\|getLocalTime\|from \"./shared\"\|from \"./utils\"" src tests scripts
```

Expected: hits only in `src/server.ts`, `src/tools.ts`, `src/utils.ts`, `src/shared.ts` and `src/app.tsx`. If anything else appears, stop and re-scope.

- [ ] **Step 2: Trim `src/tools.ts`**

Delete the `getWeatherInformation` block (its doc comment and the `tool({...})` call) and the `getLocalTime` block. Change the `tools` export to:

```ts
export const tools = {
  scheduleTask,
};
```

Delete the entire `executions` export at the bottom of the file, including its doc comment.

- [ ] **Step 3: Trim `src/server.ts`**

Remove these two imports:

```ts
import { processToolCalls } from "./utils";
```

and change:

```ts
import { tools, executions } from "./tools";
```

to:

```ts
import { tools } from "./tools";
```

Then replace the `processToolCalls` call inside `execute:` — this block:

```ts
// Process any pending tool calls from previous messages
// This handles human-in-the-loop confirmations for tools
const processedMessages = await processToolCalls({
  messages: this.messages,
  dataStream,
  tools,
  executions,
});
```

with nothing, and change the `streamText` option `messages: processedMessages,` to:

```ts
            messages: this.messages,
```

- [ ] **Step 4: Delete the dead modules**

```bash
cd /Users/pjay/hippocratic
git rm src/utils.ts src/shared.ts
```

- [ ] **Step 5: Trim `src/app.tsx`**

Delete line 5, `import { APPROVAL } from "./shared";`.

Delete the commented block at lines 13-16:

```tsx
// List of tools that require human confirmation
// const toolsRequiringConfirmation: (keyof typeof tools)[] = [
//   "getWeatherInformation",
// ];
```

Change the lucide import on line 11 from:

```tsx
import { Send, Bot, Trash2, Copy, Check } from "lucide-react";
```

to:

```tsx
import { Send, Trash2, Copy, Check } from "lucide-react";
```

Then find the `if (part.type === "tool-invocation") {` branch and replace the whole branch — the ~75 commented lines and the trailing `return null;` — with:

```tsx
if (part.type === "tool-invocation") {
  // Tool calls are not surfaced in the UI.
  return null;
}
```

Then delete the commented-out fallback block that follows the map callback's final `return null;` — the seven lines beginning `// return (` and ending `// );`:

```tsx
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
```

becomes:

```tsx
return null;
```

- [ ] **Step 6: Verify the build and tests are still green**

```bash
cd /Users/pjay/hippocratic
pnpm exec tsc --noEmit && pnpm exec biome lint . && pnpm exec vitest run && pnpm exec vite build
```

Expected: all pass. `tsc` is the real gate — it will name any dangling reference to a deleted module.

- [ ] **Step 7: Verify chat still works end to end**

Restart the dev server, then:

```bash
cd /Users/pjay/hippocratic && pnpm run smoke -- --port 5173
```

Expected: `PASS`.

- [ ] **Step 8: Check and commit**

```bash
cd /Users/pjay/hippocratic
pnpm exec prettier --write src/tools.ts src/server.ts src/app.tsx
pnpm exec prettier . --check && pnpm exec biome lint . && pnpm exec tsc --noEmit && pnpm exec vitest run
git add -A src/tools.ts src/server.ts src/app.tsx src/utils.ts src/shared.ts
git commit -m "refactor: drop starter demo tools and dead confirmation scaffolding

getWeatherInformation required a human confirmation that the UI never
rendered, so any call to it dead-ended the turn. getLocalTime returned a
hardcoded string. Both were sent as input tokens on every request. With no
confirmation-required tools left, processToolCalls, executions, APPROVAL and
the commented-out confirmation UI are all dead and go with them."
```

---

### Task 5: Rate limiting

Caps Bedrock spend if the URL leaks. Applied in **two** places: chat messages travel over one long-lived WebSocket rather than one HTTP request each, so a limit in `fetch()` alone caps connections, not model calls.

**Files:**

- Modify: `wrangler.jsonc` (add a top-level `ratelimits` array)
- Modify: `worker-configuration.d.ts` (the `Cloudflare.Env` interface)
- Modify: `src/server.ts` (the `fetch` handler; the top of `onChatMessage`)
- Create: `tests/rate-limit.test.ts`

**Interfaces:**

- Consumes: Task 2's `src/config.ts` (unchanged), Task 4's trimmed `server.ts`.
- Produces: `Env.RATE_LIMITER: RateLimit`. The `fetch` handler returns `429` with a `retry-after: 60` header when the limiter denies. `onChatMessage` returns a data-stream response carrying a plain-text apology when the limiter denies.

- [ ] **Step 1: Write the failing test**

Create `tests/rate-limit.test.ts`:

```ts
import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/server";

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
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/pjay/hippocratic && pnpm exec vitest run tests/rate-limit.test.ts
```

Expected: FAIL — the first test gets `404` instead of `429`, because no gate exists yet.

- [ ] **Step 3: Add the binding to `wrangler.jsonc`**

Add a top-level `"ratelimits"` array. Place it immediately after the `"migrations"` array and before `"ai"`. `namespace_id` is an identifier you choose; `period` **must** be `10` or `60`.

```jsonc
  "ratelimits": [
    {
      "name": "RATE_LIMITER",
      "namespace_id": "1001",
      "simple": { "limit": 20, "period": 60 }
    }
  ],
```

- [ ] **Step 4: Declare the binding type**

In `worker-configuration.d.ts`, add to the `Cloudflare.Env` interface at the top of the file (tab-indented, after `OPENAI_REASONING_EFFORT`):

```ts
RATE_LIMITER: RateLimit;
```

`RateLimit` is already declared further down the same file — no import or package needed.

- [ ] **Step 5: Gate the fetch handler**

In `src/server.ts`, the default export currently reads:

```ts
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (!env.OPENAI_API_KEY) {
```

Insert the gate after the `OPENAI_API_KEY` guard block and before the `return (`:

```ts
// Caps connection attempts. Note this does NOT cap model calls: chat
// messages travel over one long-lived WebSocket, so a single connection
// can send many. onChatMessage carries the limit that caps spend.
const clientKey = request.headers.get("cf-connecting-ip") ?? "anonymous";
const { success } = await env.RATE_LIMITER.limit({ key: clientKey });
if (!success) {
  return new Response("Too many requests", {
    status: 429,
    headers: { "retry-after": "60" },
  });
}
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd /Users/pjay/hippocratic && pnpm exec vitest run tests/rate-limit.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 7: Gate the model call itself**

Add `formatDataStreamPart` to the imports in `src/server.ts`:

```ts
import { formatDataStreamPart } from "@ai-sdk/ui-utils";
```

Then at the very top of `onChatMessage`, before `return agentContext.run(...)`:

```ts
// This is the limit that actually caps Bedrock spend — one WebSocket can
// carry unlimited messages, so the fetch-level gate does not see them.
const { success } = await this.env.RATE_LIMITER.limit({
  key: `chat:${this.name}`,
});
if (!success) {
  return createDataStreamResponse({
    execute: async (dataStream) => {
      dataStream.write(
        formatDataStreamPart(
          "text",
          "You are sending messages too quickly. Please wait a moment and try again."
        )
      );
    },
  });
}
```

- [ ] **Step 8: Verify the message-level limit in a real browser**

Restart the dev server, open the app, and send 21 messages in under a minute (short ones are fine — "hi" repeated).

Expected: the first 20 get model answers; further messages come back as the "sending messages too quickly" text, and the dev server log shows no Bedrock call for them. Wait 60 seconds and confirm it recovers.

- [ ] **Step 9: Check and commit**

```bash
cd /Users/pjay/hippocratic
pnpm exec prettier --write src/server.ts tests/rate-limit.test.ts wrangler.jsonc
pnpm exec prettier . --check && pnpm exec biome lint . && pnpm exec tsc --noEmit && pnpm exec vitest run
git add src/server.ts tests/rate-limit.test.ts wrangler.jsonc worker-configuration.d.ts
git commit -m "feat: rate limit connections and model calls

20 per minute, keyed by IP at the edge and by conversation inside the Durable
Object. The DO-level limit is the one that caps Bedrock spend: chat messages
travel over a single long-lived WebSocket, so the fetch-level gate never sees
them."
```

---

### Task 6: Medical disclaimer

The model volunteers a disclaimer in its prose (and Task 3 instructs it to), but nothing in the interface says so before a user types.

**Files:**

- Modify: `src/app.tsx` (header region, immediately after the header `</div>` at what is currently line 163)

**Interfaces:**

- Consumes: Task 4's trimmed `app.tsx`.
- Produces: nothing importable.

- [ ] **Step 1: Add the disclaimer banner**

In `src/app.tsx`, find the end of the header block — the `</div>` that closes the element with `className="shrink-0 px-4 py-3 sm:py-4 border-b border-border flex items-center gap-3 bg-background z-10 safe-top"`, immediately before the `{/* Messages */}` comment. Insert between them:

```tsx
<div className="shrink-0 px-4 py-2 border-b border-border bg-secondary/20">
  <p className="text-[11px] leading-snug text-muted-foreground">
    This is an AI assistant, not a medical professional. Information here is for
    general education only and is not a diagnosis. Always consult a qualified
    clinician before acting on it.
  </p>
</div>
```

- [ ] **Step 2: Verify it renders and does not break the layout**

Restart the dev server and open the app in a browser.

Expected: the disclaimer sits directly under the "Biograph Copilot" header, above the message area, on both a narrow (mobile) and wide viewport. The message list still scrolls, and the input stays pinned to the bottom — the messages container has a `max-h-[calc(100dvh-8rem)]` cap, so confirm the extra band has not pushed the composer off-screen. If it has, raise the subtracted value to `9rem` / `11rem` in that `className` and re-check.

- [ ] **Step 3: Check and commit**

```bash
cd /Users/pjay/hippocratic
pnpm exec prettier --write src/app.tsx
pnpm exec prettier . --check && pnpm exec biome lint . && pnpm exec tsc --noEmit && pnpm exec vitest run
git add src/app.tsx
git commit -m "feat: show a medical disclaimer in the UI"
```

---

### Task 7: UI fixes

Three unrelated but small defects in one file: inverted Enter behaviour, dead state, and an externally hotlinked logo.

**Files:**

- Modify: `src/app.tsx` — the `onKeyDown` handler (currently ~line 382), the `showDebug` state and its `<pre>` block, the unused `showRole` const, and the header `<svg>` (currently ~lines 132-148)

**Interfaces:**

- Consumes: Task 6's `app.tsx`.
- Produces: nothing importable.

- [ ] **Step 1: Fix the Enter key**

The handler currently submits on **Shift+Enter**, the opposite of every chat UI:

```tsx
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.shiftKey) {
                  e.preventDefault();
                  handleAgentSubmit(e);
                }
              }}
```

Replace with:

```tsx
              onKeyDown={(e) => {
                // Enter sends, Shift+Enter inserts a newline.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleAgentSubmit(e);
                }
              }}
```

- [ ] **Step 2: Remove the dead debug state**

Delete this line (currently line 19):

```tsx
const [showDebug, setShowDebug] = useState(false);
```

`setShowDebug` is never called anywhere, so `showDebug` is permanently `false` and the block it guards is unreachable. Delete that block too:

```tsx
{
  showDebug && (
    <pre className="text-xs text-muted-foreground overflow-scroll">
      {JSON.stringify(m, null, 2)}
    </pre>
  );
}
```

- [ ] **Step 3: Remove the unused const**

Delete this line (currently line 188) — it is computed and never read:

```tsx
const showRole = showAvatar && !isUser;
```

- [ ] **Step 4: Replace the hotlinked logo with an inline SVG**

The header currently pulls the mark from a third-party recruiting CDN, which is an external request on every page load, leaks a referrer, and breaks if that URL rots. Replace this whole `<svg>` element:

```tsx
<svg width="28px" height="28px" className="text-[#F48120]" data-icon="agents">
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
```

with:

```tsx
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
```

- [ ] **Step 5: Verify all three fixes in a browser**

Restart the dev server and open the app.

Expected, checking each:

1. Typing a message and pressing **Enter** sends it. Pressing **Shift+Enter** inserts a newline without sending.
2. No raw JSON appears above any message.
3. The header shows an orange ECG-trace mark. Open DevTools → Network, reload, and confirm there is **no** request to `greenhouse.io`.

- [ ] **Step 6: Check and commit**

```bash
cd /Users/pjay/hippocratic
pnpm exec prettier --write src/app.tsx
pnpm exec prettier . --check && pnpm exec biome lint . && pnpm exec tsc --noEmit && pnpm exec vitest run
git add src/app.tsx
git commit -m "fix: Enter sends, inline the logo, drop dead UI state

Enter and Shift+Enter were inverted. showDebug had no setter so its block was
unreachable, and showRole was computed but never read. The header mark was
hotlinked from a third-party recruiting CDN; it is now an inline SVG."
```

---

### Task 8: Build hygiene and documentation

`vite build` copies `.dev.vars` — which holds the Bedrock mantle key in plaintext — into `dist/hippocratic/.dev.vars`. `dist` is gitignored and the generated deploy config carries `"vars": {}`, so the key does not reach production or version control. It is still an avoidable plaintext copy in the build output.

**Files:**

- Modify: `package.json` (the `deploy` script)
- Modify: `README.md`
- Modify: `docs/bedrock-migration.md` (the "Known open items" section)

**Interfaces:**

- Consumes: everything above.
- Produces: nothing importable.

- [ ] **Step 1: Strip the secret from the build output before deploying**

In `package.json`, change:

```json
    "deploy": "vite build && wrangler deploy",
```

to:

```json
    "deploy": "vite build && rm -f dist/hippocratic/.dev.vars && wrangler deploy",
```

Wrangler does not read `.dev.vars` during `deploy` (the generated `dist/hippocratic/wrangler.json` has `"vars": {}`), so removing it changes nothing about the deployed Worker.

- [ ] **Step 2: Verify the deploy pipeline still builds**

```bash
cd /Users/pjay/hippocratic
pnpm exec vite build && rm -f dist/hippocratic/.dev.vars && ls -la dist/hippocratic/
```

Expected: the build succeeds, and the listing shows `server.js` and `wrangler.json` but **no** `.dev.vars`. Do not run the real `wrangler deploy` as part of this task.

- [ ] **Step 3: Document the new configuration**

Add to `README.md`, under the existing feature list:

````markdown
## Configuration

| Variable                  | Required | Default                                              | Notes                                                                        |
| ------------------------- | -------- | ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| `OPENAI_API_KEY`          | yes      | —                                                    | Bedrock **mantle** API key. Not an xAI key, and not a `bedrock-runtime` key. |
| `OPENAI_BASE_URL`         | no       | `https://bedrock-mantle.us-west-2.api.aws/openai/v1` |                                                                              |
| `OPENAI_MODEL_ID`         | no       | `xai.grok-4.6`                                       | Set to `xai.grok-4.3` to switch models.                                      |
| `OPENAI_REASONING_EFFORT` | no       | `none`                                               | `none` / `low` / `medium` / `high`. Anything else falls back to `none`.      |

Local config goes in `.dev.vars` (gitignored). Production: `pnpm wrangler secret put OPENAI_API_KEY`.

`reasoning_effort` is the dominant cost lever on Grok 4.6 — reasoning tokens
bill at the output rate and are never returned to you. Measured on a 7-marker
panel question: `low` (the model default) cost $0.01107 per response, `none`
cost $0.00341 with no loss of accuracy. Shortening the system prompt does _not_
save money; it made the model reason longer and cost 56% more.

Requests are rate limited to 20 per minute, both per client IP at the edge and
per conversation inside the Durable Object. There is no authentication —
anyone with the URL can use the app, within that limit.

## Testing

```bash
pnpm run check   # prettier + biome + tsc
pnpm test        # unit tests
pnpm run start   # dev server
pnpm run smoke   # end-to-end: drives the real agent over its WebSocket
```
````

````

- [ ] **Step 4: Update the migration doc's open items**

In `docs/bedrock-migration.md`, replace the "Known open items" list with:

```markdown
- No authentication; anyone with the URL can use the app. Rate limited to 20
  requests/minute per IP and per conversation, which caps but does not prevent
  spend.
- Token usage still reports `NaN` — `@ai-sdk/openai-compatible@0.1.x` does not
  parse usage off mantle's stream, so cost tracking built on `onFinish` values
  is blind. Unresolved.
- `vite build` writes a plaintext copy of the mantle key to
  `dist/hippocratic/.dev.vars` for local `wrangler dev`. `dist` is gitignored
  and the generated deploy config has `"vars": {}`, so it does not reach
  production; the `deploy` script deletes it before uploading.
````

- [ ] **Step 5: Full green run and commit**

```bash
cd /Users/pjay/hippocratic
pnpm exec prettier --write README.md docs/bedrock-migration.md package.json
pnpm exec prettier . --check && pnpm exec biome lint . && pnpm exec tsc --noEmit && pnpm exec vitest run && pnpm exec vite build
git add package.json README.md docs/bedrock-migration.md
git commit -m "docs: document config, rate limits and cost findings

Also strips the plaintext .dev.vars copy from the build output before deploy."
```

---

## Final verification

Run once after every task is complete.

- [ ] **All static checks and tests**

```bash
cd /Users/pjay/hippocratic
pnpm exec prettier . --check && pnpm exec biome lint . && pnpm exec tsc --noEmit && pnpm exec vitest run && pnpm exec vite build
```

Expected: all green. Test count should be 1 (existing) + 4 (config) + 2 (rate limit) = 7.

- [ ] **End-to-end against the real model**

```bash
cd /Users/pjay/hippocratic && pnpm run start
# second terminal:
pnpm run smoke -- --port 5173 --message "Patient panel: fasting glucose 112 mg/dL, HbA1c 5.9%, LDL 165 mg/dL, TSH 2.1 mIU/L. Which are out of range?"
```

Expected: `PASS`, correct flags, no `*` or `#` characters.

- [ ] **Confirm the cost saving landed**

With the dev server running, send one panel question through the browser and check the dev server log for the request. Then verify directly against Bedrock that effort is being honoured:

```bash
cd /Users/pjay/hippocratic
KEY=$(grep -E '^OPENAI_API_KEY=' .dev.vars | cut -d= -f2-)
curl -sS https://bedrock-mantle.us-west-2.api.aws/openai/v1/chat/completions \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"model":"xai.grok-4.6","messages":[{"role":"user","content":"Fasting glucose 112 mg/dL. In range?"}],"max_completion_tokens":8000,"reasoning_effort":"none"}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('reasoning_tokens =', d['usage']['completion_tokens_details']['reasoning_tokens'])"
```

Expected: `reasoning_tokens = 0`.

- [ ] **Confirm nothing external is fetched**

Open the app, then DevTools → Network → reload. Expected: no request to `greenhouse.io` or any third-party host.
