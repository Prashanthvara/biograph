function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as Record<string, unknown>;
  if (typeof record.statusCode === "number") return record.statusCode;
  if (typeof record.status === "number") return record.status;
  return undefined;
}

/**
 * Maps an SDK / Bedrock error to a sentence safe to put on the data stream
 * (`3:` prefix) and in the UI. Never interpolates bodies, URLs, or keys.
 */
export function userFacingStreamError(error: unknown): string {
  const status = statusOf(error);
  if (status === 401 || status === 403) {
    return "The assistant could not reach the model. Please try again in a moment.";
  }
  if (status === 429) {
    return "You are sending messages too quickly. Please wait a moment and try again.";
  }
  return "Something went wrong while generating a reply. Please try again.";
}
