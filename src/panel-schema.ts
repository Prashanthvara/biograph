import { z } from "zod";

/**
 * Tool-parameter schema. The AI SDK validates this before `execute` and
 * throws InvalidToolArgumentsError on failure, which aborts the turn.
 * Keep this loose. Normalise in parsePanelReport.
 */
export const panelReportSchema = z.object({
  markers: z
    .array(
      z.object({
        name: z.string(),
        value: z.union([z.string(), z.number()]),
        unit: z.string().optional(),
        range: z.string().optional(),
        flag: z.string(),
        note: z.string().optional(),
      })
    )
    .optional()
    .default([]),
  summary: z.string().optional(),
  followUps: z.array(z.string()).optional(),
});
