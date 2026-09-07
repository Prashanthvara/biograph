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
// A lab-panel question must produce a reportPanel tool call, not just prose.
const expectPanel = args.includes("--expect-panel")
  ? true
  : args.includes("--no-panel")
    ? false
    : /mg\/dL|HbA1c|LDL/i.test(message);

const ws = new WebSocket(`ws://localhost:${port}/agents/chat/${room}`);
let text = "";
let streamError = "";
const toolNames = [];

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
    if (line.includes("reportPanel")) toolNames.push("reportPanel");
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
  if (expectPanel && !toolNames.includes("reportPanel")) {
    return finish(
      1,
      `FAIL: expected reportPanel tool call, got text only:\n\n${text.trim()}`
    );
  }
  finish(
    0,
    `PASS (${text.length} chars, tools=${toolNames.join(",") || "none"}):\n\n${text.trim()}`
  );
};

ws.onerror = () =>
  finish(1, "FAIL: websocket error (is the dev server running?)");
