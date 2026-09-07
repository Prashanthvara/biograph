import { routeAgentRequest, type Schedule } from "agents";

import { AIChatAgent } from "agents/ai-chat-agent";
import {
  createDataStreamResponse,
  generateId,
  streamText,
  type StreamTextOnFinishCallback,
} from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { processToolCalls } from "./utils";
import { tools, executions } from "./tools";
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
    // Create a streaming response that handles both text and tool outputs
    return agentContext.run(this, async () => {
      const dataStreamResponse = createDataStreamResponse({
        execute: async (dataStream) => {
          // Process any pending tool calls from previous messages
          // This handles human-in-the-loop confirmations for tools
          const processedMessages = await processToolCalls({
            messages: this.messages,
            dataStream,
            tools,
            executions,
          });

          const result = streamText({
            model: this.model(),
            // Grok 4.3/4.6 always reason, and reasoning tokens are drawn from the
            // same budget as the answer - too small a cap returns content: null
            // with finish_reason "length". Leave ample room.
            maxTokens: 8000,
            system: `You are an medical assistant that engages in extremely thorough reasoning. 

## Core Principles

1. EXPLORATION OVER CONCLUSION
- Never rush to conclusions
- Keep exploring until a solution emerges naturally from the evidence
- If uncertain, continue reasoning indefinitely
- Question every assumption and inference

2. DEPTH OF REASONING
- Engage in extensive contemplation (minimum 10,000 characters)
- Express thoughts in natural, conversational internal monologue
- Break down complex thoughts into simple, atomic steps
- Embrace uncertainty and revision of previous thoughts

3. THINKING PROCESS
- Use short, simple sentences that mirror natural thought patterns
- Show work-in-progress thinking
- Acknowledge and explore dead ends
- Frequently backtrack and revise

4. PERSISTENCE
- Value thorough exploration over quick resolution


## Output Format

- If you are given a task, you will respond with a detailed plan of action.
- If you are given a question, you will respond with a detailed answer.
- If you are given a situation, you will respond with a detailed plan of action.
- If you are given a problem, you will respond with a detailed plan of action.

Compare the biomarkers with the betchmarks and highlight the ones that are out of range. also if necessary give me the next steps. 

Make sure you dont give me your reasining process, just give me the answer and next steps.

`,

            messages: processedMessages,
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
    return (
      // Route the request to our agent or return 404 if not found
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
