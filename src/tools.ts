/**
 * Tool definitions for the AI chat agent.
 * Tools with an `execute` function run automatically (no confirmation UI).
 */
import { tool } from "ai";

import { agentContext } from "./server";
import { unstable_scheduleSchema } from "agents/schedule";
import { panelReportSchema } from "./panel-schema";

const scheduleTask = tool({
  description: "A tool to schedule a task to be executed at a later time",
  parameters: unstable_scheduleSchema,
  execute: async ({ when, description }) => {
    const agent = agentContext.getStore();
    if (!agent) {
      throw new Error("No agent found");
    }
    function throwError(msg: string): string {
      throw new Error(msg);
    }
    if (when.type === "no-schedule") {
      return "Not a valid schedule input";
    }
    const input =
      when.type === "scheduled"
        ? when.date
        : when.type === "delayed"
          ? when.delayInSeconds
          : when.type === "cron"
            ? when.cron
            : throwError("not a valid schedule input");
    try {
      agent.schedule(input!, "executeTask", description);
    } catch (error) {
      console.error("error scheduling task", error);
      return `Error scheduling task: ${error}`;
    }
    return `Task scheduled for type "${when.type}" : ${input}`;
  },
});

/**
 * Echoes a structured panel so the UI can render a table from
 * `part.toolInvocation.result`. The model fills this in; we do not recompute
 * ranges on the server.
 */
const reportPanel = tool({
  description:
    "Record a structured biomarker panel so the interface can render a table. Call this when the user provides one or more lab values, before writing next steps. Do not call it for questions that contain no lab values.",
  parameters: panelReportSchema,
  execute: async (report) => report,
});

export const tools = {
  reportPanel,
  scheduleTask,
};
