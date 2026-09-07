# Migrating inference to xAI Grok on Amazon Bedrock

This app previously called the xAI API directly (`@ai-sdk/xai`, `grok-2-latest`).
It now calls **xAI Grok 4.6 on Amazon Bedrock**, through Bedrock's
OpenAI-compatible endpoint.

Everything below was verified against the live API on 2026-09-07.

## What changed

|                  | Before                | After                                                |
| ---------------- | --------------------- | ---------------------------------------------------- |
| Provider package | `@ai-sdk/xai`         | `@ai-sdk/openai-compatible`                          |
| Endpoint         | `https://api.x.ai/v1` | `https://bedrock-mantle.us-west-2.api.aws/openai/v1` |
| Model            | `grok-2-latest`       | `xai.grok-4.6`                                       |
| Auth             | xAI API key           | Bedrock **mantle** API key (Bearer)                  |
| Billing          | xAI account           | AWS account                                          |

Only `src/server.ts` changed materially. The agent, Durable Object, tool
plumbing, and UI are untouched — Bedrock speaks the OpenAI Chat Completions
shape, so swapping the provider was a configuration change, not a rewrite.

```ts
const bedrock = createOpenAICompatible({
  name: "bedrock",
  baseURL: this.env.OPENAI_BASE_URL ?? BASE_URL,
  apiKey: this.env.OPENAI_API_KEY,
});

const result = streamText({
  model: bedrock(this.env.OPENAI_MODEL_ID ?? MODEL_ID),
  maxTokens: 8000,
  // ...
});
```

## Configuration

| Variable          | Required | Default                                              | Notes                                                                        |
| ----------------- | -------- | ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| `OPENAI_API_KEY`  | yes      | —                                                    | Bedrock **mantle** API key. Not an xAI key, and not a `bedrock-runtime` key. |
| `OPENAI_BASE_URL` | no       | `https://bedrock-mantle.us-west-2.api.aws/openai/v1` |                                                                              |
| `OPENAI_MODEL_ID` | no       | `xai.grok-4.6`                                       | Set to `xai.grok-4.3` to switch models.                                      |

The variable is still named `OPENAI_API_KEY` because that is what the Bedrock
model card itself uses — Bedrock serves these models through an
OpenAI-compatible surface, so the OpenAI SDK naming carries over. It holds a
Bedrock credential, not an OpenAI one.

Local: `.dev.vars` (gitignored). Production: `wrangler secret put OPENAI_API_KEY`.
Only the key needs setting in production; the base URL and model have working
defaults compiled in.

## The two Bedrock endpoints

Bedrock exposes two inference surfaces, and **they do not accept the same
credentials or serve the same models**. This is the single biggest source of
confusion in this migration.

|                       | `bedrock-runtime`                        | `bedrock-mantle`                  |
| --------------------- | ---------------------------------------- | --------------------------------- |
| Host                  | `bedrock-runtime.{region}.amazonaws.com` | `bedrock-mantle.{region}.api.aws` |
| IAM action            | `bedrock:InvokeModel`                    | `bedrock-mantle:CreateInference`  |
| Cross-region profiles | yes (`us.`, `global.` prefixes)          | **no** — In-Region only           |
| Grok 4.3              | not offered                              | ✅                                |
| Grok 4.6              | ✅ (`us.`/`global.` profiles)            | ✅ (us-west-2 only)               |

### Model and region availability (verified)

| Endpoint | Region        | `xai.grok-4.3` | `xai.grok-4.6`            |
| -------- | ------------- | -------------- | ------------------------- |
| mantle   | **us-west-2** | ✅             | ✅                        |
| mantle   | us-east-1     | ✅             | ❌ `model does not exist` |
| mantle   | us-east-2     | ✅             | ❌                        |
| runtime  | us-east-1     | ❌ not offered | ⚠️ 403 not entitled       |

**us-west-2 on mantle is the only place both models are available**, which is
why it is the default. Switching between 4.3 and 4.6 is a `OPENAI_MODEL_ID`
change and nothing else.

Note the runtime row: `us.xai.grok-4.6` returns
`403 — "xai.grok-4.6 is not available for this account. ... contact AWS Sales"`.
That entitlement gate is **specific to `bedrock-runtime`**. The same account
invokes 4.6 fine on mantle. Do not conclude from a runtime 403 that the account
lacks xAI access.

## Bedrock API keys come in two incompatible families

A key that works on one endpoint is rejected as _malformed_ by the other — not
merely unauthorized. Both are ~130+ chars and start with `ABSK`, so they are
easy to mix up.

| Key family                | Works on                                       | Rejected by                                                    |
| ------------------------- | ---------------------------------------------- | -------------------------------------------------------------- |
| Bedrock/runtime key       | `bedrock.*.amazonaws.com`, `bedrock-runtime.*` | mantle → `401 invalid bearer token`                            |
| **Mantle key** (this app) | `bedrock-mantle.*.api.aws`                     | runtime → `401 Invalid API Key format: Base64 decoding failed` |

If you decode the base64 after the `ABSK` prefix, a mantle key contains a
`Man…` marker. That is the quickest way to tell them apart.

Long-term Bedrock API keys are IAM _service-specific credentials_ created with
`--service-name bedrock.amazonaws.com`; there is no `bedrock-mantle.amazonaws.com`
equivalent in `CreateServiceSpecificCredential`. Generate the mantle key from
the Bedrock console instead.

## Gotchas

### `maxTokens` is load-bearing

Grok 4.3 and 4.6 **always reason**, and reasoning tokens are drawn from the
_same_ budget as the answer. Too small a cap silently returns a successful
response with no content:

```json
{
  "finish_reason": "length",
  "message": { "content": null },
  "usage": { "completion_tokens_details": { "reasoning_tokens": 47 } }
}
```

That is an HTTP 200 — nothing throws. Hence `maxTokens: 8000`. Even a one-line
question consumed 538 reasoning tokens on 4.6. If you lower this value, test for
empty responses.

### `reasoning_effort`, not `reasoning`

The model card documents `reasoning={"effort": "..."}`, but that is a
**Responses API** parameter. This app uses Chat Completions, where the parameter
is `reasoning_effort` (`"none" | "low" | "medium" | "high"`, `"low"` is the
default). Passing `reasoning` on Chat Completions is **silently ignored** — no
error, reasoning still runs, tokens still billed.

`reasoning_effort: "none"` yields 0 reasoning tokens and is the main cost lever.
Verified working on both 4.3 and 4.6.

### Token usage reports as `NaN`

`@ai-sdk/openai-compatible@0.1.x` does not parse usage off mantle's stream, so
`onFinish` receives `{ promptTokens: NaN, completionTokens: NaN, totalTokens: NaN }`.
Behaviour is unaffected, but any cost tracking built on those values will be
blind. Unresolved.

### Non-standard sampling defaults

Grok 4.3/4.6 default `temperature` to `0.7` (not the OpenAI-standard `1`) and
`top_p` to `0.95`. Set them explicitly if consistency matters.

## Cost

Per 1M tokens, Standard tier. Reasoning tokens bill as **output**.

| Model          | Input | Output | Context | Structured outputs |
| -------------- | ----- | ------ | ------- | ------------------ |
| `xai.grok-4.3` | $1.25 | $2.50  | 1M      | yes                |
| `xai.grok-4.6` | $2.20 | $6.60  | 500K    | no (on runtime)    |

4.6 is roughly 4–5× the cost per response: it is 2.6× the output rate _and_ used
~1.8× the reasoning tokens on the same prompt. It was noticeably terser and more
precise; 4.3 padded. 4.3 also has double the context.

The system prompt in `src/server.ts` currently asks for "minimum 10,000
characters" of contemplation and to "continue reasoning indefinitely", then asks
the model not to show its reasoning. On these models that inflates hidden
reasoning tokens you pay full output rate for and never see, since Chat
Completions does not return reasoning content. That prompt block is the first
place to look if inference cost is a concern.

## Verifying a key

```bash
curl -sS -w '\nHTTP %{http_code}\n' \
  https://bedrock-mantle.us-west-2.api.aws/openai/v1/chat/completions \
  -H "Authorization: Bearer $(grep -E '^OPENAI_API_KEY=' .dev.vars | cut -d= -f2-)" \
  -H "Content-Type: application/json" \
  -d '{"model":"xai.grok-4.6","messages":[{"role":"user","content":"Reply with exactly: OK"}],"max_completion_tokens":2000}'
```

Reading the result:

| Response                                             | Meaning                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| `200` + `choices[0].message.content`                 | working                                                      |
| `200` + `content: null`, `finish_reason: "length"`   | reasoning ate the budget — raise `max_completion_tokens`     |
| `401 invalid bearer token`                           | wrong key family (runtime key on mantle) or malformed value  |
| `401 Invalid API Key format: Base64 decoding failed` | malformed value — check for a concatenated/truncated paste   |
| `404 model does not exist`                           | model not served in this region (e.g. 4.6 outside us-west-2) |
| `403 not available for this account`                 | entitlement gate — AWS access request                        |

When a key appears to fail for no reason, check its length first. A paste that
_appends_ rather than replaces produces a value containing `ABSK` twice, which
AWS reports as a base64 decoding failure rather than as a bad key.

## Deploying

```bash
pnpm wrangler secret put OPENAI_API_KEY   # the mantle key
pnpm run deploy
```

`wrangler.jsonc` was renamed `biograph` → `hippocratic`. That deploys a **new**
Worker: new `*.workers.dev` subdomain and **fresh Durable Object storage**, so
existing conversation history under `biograph` does not carry over, and the old
Worker keeps serving until deleted.

## Known open items

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
- The `ratelimits` binding is not wired into miniflare by
  `@cloudflare/vite-plugin@0.1.x`, so rate limits are inactive under
  `vite dev`. They are bound under `wrangler dev` and in production.
