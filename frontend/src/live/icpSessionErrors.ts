/**
 * Raised before any canister call is sent when there is no usable Internet
 * Identity session. Because nothing reached the network, a caller may keep the
 * member's unsaved input and ask them to sign in again without any risk that
 * the action was half-applied. Kept dependency-free so entry-chunk code can
 * import it.
 */
export class IcpSessionRequiredError extends Error {
  readonly code = "icp_session_required" as const;
  constructor(message = "No active Internet Identity session. Sign in again to continue.") {
    super(message);
    this.name = "IcpSessionRequiredError";
  }
}

export function isIcpSessionRequiredError(error: unknown): boolean {
  if (error instanceof IcpSessionRequiredError) return true;
  return (error as { code?: unknown } | null)?.code === "icp_session_required";
}

/** Session health as seen by this device's sign-in client. */
export type IcpSessionHealth = "active" | "ended" | "unknown";
