import { routeAgentRequest, type Schedule } from "agents";

import { AIChatAgent } from "agents/ai-chat-agent";
import {
  createDataStreamResponse,
  generateId,
  streamText,
  type StreamTextOnFinishCallback,
} from "ai";
import { formatDataStreamPart } from "@ai-sdk/ui-utils";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { tools } from "./tools";
import {
  allowRequest,
  resolveReasoningEffort,
  TEMPERATURE,
  TOP_P,
} from "./config";
import { AsyncLocalStorage } from "node:async_hooks";
// we use ALS to expose the agent context to the tools
export const agentContext = new AsyncLocalStorage<Chat>();

// Per the Grok 4.6 model card: bedrock-mantle, OpenAI-compatible Chat
// Completions, Bedrock API key as the bearer token.
// 4.6 on mantle is us-west-2 ONLY (4.3 is also in us-east-1/2).
// https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-xai-grok-4-6.html
const BASE_URL = "https://bedrock-mantle.us-west-2.api.aws/openai/v1";
const MODEL_ID = "xai.grok-4.6";
/**
 * Chat Agent implementation that handles real-time AI chat interactions
 */
export class Chat extends AIChatAgent<Env> {
  // Built once per Durable Object instance rather than per message.
  #model?: ReturnType<ReturnType<typeof createOpenAICompatible>>;

  private model() {
    if (!this.#model) {
      const bedrock = createOpenAICompatible({
        name: "bedrock",
        baseURL: this.env.OPENAI_BASE_URL ?? BASE_URL,
        apiKey: this.env.OPENAI_API_KEY,
      });
      this.#model = bedrock(this.env.OPENAI_MODEL_ID ?? MODEL_ID);
    }
    return this.#model;
  }

  /**
   * Handles incoming chat messages and manages the response stream
   * @param onFinish - Callback function executed when streaming completes
   */

  // biome-ignore lint/complexity/noBannedTypes: <explanation>
  async onChatMessage(onFinish: StreamTextOnFinishCallback<{}>) {
    // This is the limit that actually caps Bedrock spend - one WebSocket can
    // carry unlimited messages, so the fetch-level gate does not see them.
    if (!(await allowRequest(this.env.RATE_LIMITER, `chat:${this.name}`))) {
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

    // Create a streaming response that handles both text and tool outputs
    return agentContext.run(this, async () => {
      const dataStreamResponse = createDataStreamResponse({
        execute: async (dataStream) => {
          const result = streamText({
            model: this.model(),
            // Grok 4.3/4.6 always reason, and reasoning tokens are drawn from the
            // same budget as the answer - too small a cap returns content: null
            // with finish_reason "length". Leave ample room.
            maxTokens: 8000,
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

            messages: this.messages,
            tools,
            onFinish,
            onError: (error) => {
              console.error("Error while streaming:", error);
            },
            maxSteps: 10,
          });

          // Merge the AI response stream with tool execution outputs
          result.mergeIntoDataStream(dataStream);
        },
      });

      return dataStreamResponse;
    });
  }
  async executeTask(description: string, task: Schedule<string>) {
    await this.saveMessages([
      ...this.messages,
      {
        id: generateId(),
        role: "user",
        content: `Running scheduled task: ${description}`,
        createdAt: new Date(),
      },
    ]);
  }
}

/**
 * Worker entry point that routes incoming requests to the appropriate handler
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (!env.OPENAI_API_KEY) {
      console.error(
        "OPENAI_API_KEY is not set, don't forget to set it locally in .dev.vars, and use `wrangler secret bulk .dev.vars` to upload it to production"
      );
      return new Response("OPENAI_API_KEY is not set", { status: 500 });
    }

    // Caps connection attempts. Note this does NOT cap model calls: chat
    // messages travel over one long-lived WebSocket, so a single connection
    // can send many. onChatMessage carries the limit that caps spend.
    const clientKey = request.headers.get("cf-connecting-ip") ?? "anonymous";
    if (!(await allowRequest(env.RATE_LIMITER, clientKey))) {
      return new Response("Too many requests", {
        status: 429,
        headers: { "retry-after": "60" },
      });
    }
    return (
      // Route the request to our agent or return 404 if not found
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
