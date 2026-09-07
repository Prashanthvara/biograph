# 🩺 BioGraph - Medical Biomarker Analysis Assistant

A specialized AI-powered medical assistant built on Cloudflare's Agent platform, designed to analyze biomarkers and provide detailed medical insights. This project provides an interactive chat interface for medical professionals to get thorough analysis of biomarker data with benchmarking and recommendations.

## Features

- 🔬 Comprehensive biomarker analysis
- 📊 Benchmark comparison
- 💬 Interactive medical consultation interface
- 🧠 Powered by xAI Grok 4.6 on Amazon Bedrock
- 🎯 Detailed action plans and next steps
- 🌓 Dark/Light theme support
- ⚡️ Real-time streaming responses
- 🔄 Conversation history tracking

A lab-panel question renders as a table (marker, value, unit, range, flag)
plus next-step prose and follow-up chips. Questions with no lab values stay
plain chat. While a reply is in flight the UI shows a waiting row; if the
model call fails it shows an error with retry, not a blank thread.

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

Note the rate-limit binding is not wired by `vite dev`
(`@cloudflare/vite-plugin` 0.1.x), so limits are inactive there and the app
degrades to allowing every request. `wrangler dev` and production both bind it.

## Testing

```bash
pnpm run check   # prettier + biome + tsc
pnpm test        # unit tests
pnpm run start   # dev server
pnpm run smoke   # end-to-end: drives the real agent over its WebSocket
```

## Use Cases

1. **Biomarker Analysis**
   - Compare lab results against established benchmarks
   - Identify out-of-range values
   - Get detailed explanations of implications

2. **Medical Recommendations**
   - Receive evidence-based next steps
   - Get detailed action plans
   - Access follow-up recommendations

3. **Medical Professional Support**
   - Quick access to biomarker interpretations
   - Evidence-based decision support
   - Efficient patient data analysis

## License

MIT
