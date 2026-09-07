# Post-Migration Hardening Spec

**Date:** 2026-09-07
**Repo:** `/Users/pjay/hippocratic`
**Context:** Follows `docs/bedrock-migration.md`. Inference already runs on
xAI Grok 4.6 via Bedrock mantle. This spec covers the nine issues found in the
post-migration code review.

---

## Measured evidence

All figures below were taken against the live Bedrock mantle endpoint on
2026-09-07, model `xai.grok-4.6`, using this panel question:

> Patient panel: fasting glucose 112 mg/dL, HbA1c 5.9%, LDL 165 mg/dL, HDL 38
> mg/dL, triglycerides 210 mg/dL, TSH 2.1 mIU/L, ALT 54 U/L. Which are out of
> range and what should I do?

| System prompt        | `reasoning_effort` | prompt tok | reasoning tok | answer tok | cost         |
| -------------------- | ------------------ | ---------- | ------------- | ---------- | ------------ |
| current (1392 chars) | default (`low`)    | 394        | 1178          | 368        | $0.01107     |
| trimmed (681 chars)  | default (`low`)    | 244        | **2240**      | 304        | **$0.01733** |
| current              | `none`             | 387        | **0**         | 388        | $0.00341     |
| trimmed              | `none`             | 237        | **0**         | 343        | $0.00279     |

Isolated `reasoning_effort` sweep (short question, no system prompt):

| effort   | reasoning tok | completion tok | finish |
| -------- | ------------- | -------------- | ------ |
| `none`   | 0             | 13             | stop   |
| `low`    | 298           | 314            | stop   |
| `medium` | 508           | 520            | stop   |
| `high`   | 392           | 405            | stop   |

**Conclusion:** `reasoning_effort` is the only meaningful cost lever. Shortening
the system prompt _increased_ total cost by 56%, because a terser prompt made
the model reason longer. The earlier review claim that the "minimum 10,000
characters" prompt block was the primary cost driver is **wrong** and is
retracted here.

At `reasoning_effort: "none"` the model still produced a complete, correct
biomarker analysis (flagged glucose, HbA1c, LDL, HDL, triglycerides and ALT
correctly; correctly called TSH normal; noted sex-dependent ranges).

---

## Retracted finding

The review claimed `executeTask` saves a message but never triggers a model
response. **This is false.** `AIChatAgent#saveMessages`
(`node_modules/agents/dist/ai-chat-agent.js:106-120`) calls `persistMessages`
(which broadcasts `cf_agent_chat_messages` to connected clients), then calls
`this.onChatMessage(...)`, drains the returned stream, and persists the final
messages via the `onFinish` callback. Scheduled tasks therefore do produce a
model reply. No work is required. Issue 3 is dropped from scope.

An E2E attempt to observe this did time out after 120s without a reply. The
cause was not isolated. A plausible explanation is the current prompt driving
reasoning into the 8000-token cap on a tool-calling turn, which the migration
doc documents as returning `content: null` with `finish_reason: "length"`. This
spec does not assert that cause; Task 3 includes an explicit re-test.

---

## Verified platform facts

These were confirmed by reading the installed packages, not from memory.

1. **`providerOptions` reaches the wire verbatim.**
   `@ai-sdk/openai-compatible@0.1.17` spreads
   `providerMetadata[providerOptionsName]` directly into the Chat Completions
   request body (`dist/index.js:323`). `providerOptionsName` is
   `config.provider.split(".")[0]` (`dist/index.js:269`), and
   `createOpenAICompatible({ name: "bedrock" })` sets `provider` to
   `"bedrock.chat"` (`dist/index.js:1168`). So the key is **`bedrock`**.
2. **`streamText` accepts `providerOptions`.** `ai@4.3.19`,
   `dist/index.d.ts:566`. (`experimental_providerMetadata` is deprecated.)
3. **`formatDataStreamPart("text", string)`** emits the `0:` prefix the client
   renders as assistant text (`@ai-sdk/ui-utils/dist/index.d.ts:623`).
4. **The `ratelimits` binding shape** is fixed by the installed wrangler's own
   schema (`node_modules/wrangler/config-schema.json`,
   `definitions/RawConfig/properties/ratelimits`): each entry requires `name`,
   `namespace_id`, and `simple: { limit, period }`, where **`period` must be
   exactly `10` or `60`**.
5. **The rate limiter works locally.** Wrangler passes `ratelimits` into
   Miniflare options (`wrangler-dist/cli.js:50209-50211`), so it is enforced by
   workerd under `vite dev` and `vitest-pool-workers`.
6. **`RateLimit` / `RateLimitOptions` / `RateLimitOutcome` types already exist**
   in `worker-configuration.d.ts:5019-5032`. No new type packages needed.
7. **Chat messages do not each cost an HTTP request.** The client opens one
   WebSocket and sends `cf_agent_use_chat_request` frames over it
   (`agents/dist/ai-chat-agent.js:34`). A rate limit applied only in
   `fetch()` therefore caps _connections_, not model calls, and would not cap
   Bedrock spend.

---

## Scope: the nine issues

| #   | Issue                                                                                                                        | Decision                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | Reasoning cost                                                                                                               | Add `OPENAI_REASONING_EFFORT`, default `"none"`, env-overridable                                                        |
| 1b  | Prompt is self-contradictory (demands 10k chars of contemplation, then says hide reasoning); typos `betchmarks`, `reasining` | Rewrite for coherence — justified on correctness, **not** cost                                                          |
| 2   | Demo tools are dead weight; `getWeatherInformation` needs confirmation but the confirm UI is commented out                   | Delete `getWeatherInformation` + `getLocalTime`; keep `scheduleTask`; delete the now-dead human-in-the-loop scaffolding |
| 3   | `executeTask` never replies                                                                                                  | **Retracted — not a bug.** Dropped                                                                                      |
| 4   | Enter/Shift+Enter inverted                                                                                                   | Fix: Enter submits, Shift+Enter newlines                                                                                |
| 5   | `temperature`/`top_p` unset                                                                                                  | Set explicitly                                                                                                          |
| 6   | `showDebug` permanently false, `showRole` unused                                                                             | Delete both                                                                                                             |
| 7   | Branding: logo hotlinked from greenhouse.io                                                                                  | Keep the name **"Biograph Copilot"**; replace the hotlink with an inline SVG                                            |
| 8   | No auth, no rate limit, no disclaimer                                                                                        | **No auth** (user decision). Add rate limiting + a visible medical disclaimer                                           |
| 9   | `dist/hippocratic/.dev.vars` holds the key in plaintext                                                                      | Strip it during `deploy`; document                                                                                      |

## Decisions taken by the user

- **Reasoning:** default `none`, overridable via `OPENAI_REASONING_EFFORT`.
- **Access:** no authentication. Rate limiting yes.
- **Branding:** keep the name "Biograph Copilot"; only de-hotlink the logo.

## Non-goals

- No authentication, login, or session management.
- No React component test infrastructure (jsdom / Testing Library). The repo's
  vitest runs in `vitest-pool-workers` only. UI changes are verified by the
  smoke script and by eye.
- No change to the Durable Object storage model, the agents SDK version, or the
  Bedrock endpoint/model defaults.
- No cost-tracking dashboard. Token usage still reports `NaN` (a known
  `@ai-sdk/openai-compatible@0.1.x` limitation documented in
  `docs/bedrock-migration.md`); that stays unresolved.
