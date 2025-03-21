import { routeAgentRequest, type Schedule } from "agents";

import { unstable_getSchedulePrompt } from "agents/schedule";

import { AIChatAgent } from "agents/ai-chat-agent";
import {
  createDataStreamResponse,
  generateId,
  streamText,
  type StreamTextOnFinishCallback,
} from "ai";
import { createXai } from "@ai-sdk/xai";
import { processToolCalls } from "./utils";
import { tools, executions } from "./tools";
import { AsyncLocalStorage } from "node:async_hooks";

// we use ALS to expose the agent context to the tools
export const agentContext = new AsyncLocalStorage<Chat>();
/**
 * Chat Agent implementation that handles real-time AI chat interactions
 */
export class Chat extends AIChatAgent<Env> {
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

          // Initialize OpenAI client with API key from environment
          const xai = createXai({
            apiKey: this.env.OPENAI_API_KEY,
          });

          // Cloudflare AI Gateway
          // const openai = createOpenAI({
          //   apiKey: this.env.OPENAI_API_KEY,
          //   baseURL: this.env.GATEWAY_BASE_URL,
          // });

          // Stream the AI response using GPT-4
          const result = streamText({
            model: xai("grok-2-latest"),
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
