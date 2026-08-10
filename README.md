# BioGraph

[Live demo](https://biograph.pjayav.workers.dev/)

A chat agent that reads a biomarker panel, compares each value against reference ranges, flags what is out of range, and explains what that combination of results suggests. Built on the Cloudflare Agents SDK with xAI Grok-2.

## What it does

- **Reads a panel and finds the outliers.** Paste lab values and it compares them against reference ranges, then highlights the ones that fall outside.
- **Reasons out loud before concluding.** The system prompt forces extended exploration: question assumptions, follow dead ends, revise, and hold off on a conclusion until the evidence supports one. Answers come back long and show their work rather than jumping to a verdict.
- **Suggests next steps.** Where the panel warrants it, the response includes follow-up tests and an action plan.
- **Streams responses.** Token-by-token output over the Agents SDK, with conversation history preserved across turns.

## Who it's for

This is a demo of what an agent looks like when the reasoning is the product. Useful if you are evaluating the Cloudflare Agents SDK, or comparing how a deliberately slow, exploratory system prompt behaves against a normal assistant prompt on the same input.

Not a medical device and not clinical advice. It is a reasoning demo on public reference ranges.

## Tech stack

- Cloudflare Workers and the Cloudflare Agents SDK (`agents`)
- xAI `grok-2-latest` via the Vercel AI SDK
- React with Tailwind and Radix primitives
- Vite, Vitest, Biome

## Local development

```bash
npm install
npm start
```

Put your key in `.dev.vars`:

```
XAI_API_KEY=<your-xai-key>
```

For deployment, set it as a Worker secret:

```bash
npx wrangler secret put XAI_API_KEY
```

## Deployment

```bash
npm run deploy
```

## Known limitations

- The tool definitions in `src/tools.ts` (weather, local time, task scheduling) are carried over from the Cloudflare agents starter and are not wired into the biomarker workflow.
- Test coverage is a single smoke test on the Worker's 404 path.

## License

MIT
