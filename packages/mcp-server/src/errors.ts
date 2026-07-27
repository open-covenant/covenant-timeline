export type TimelineMcpErrorCode =
  | "timeline.mcp.input.invalid"
  | "timeline.mcp.internal"
  | "timeline.mcp.store.busy"
  | "timeline.mcp.store.conflict"
  | "timeline.mcp.store.corrupt"
  | "timeline.mcp.store.indeterminate"
  | "timeline.mcp.store.limit"
  | "timeline.mcp.store.not-found";

export class TimelineMcpError extends Error {
  constructor(
    readonly code: TimelineMcpErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TimelineMcpError";
  }
}

export function asTimelineMcpError(error: unknown): TimelineMcpError {
  if (error instanceof TimelineMcpError) return error;
  return new TimelineMcpError("timeline.mcp.internal", "request failed");
}
