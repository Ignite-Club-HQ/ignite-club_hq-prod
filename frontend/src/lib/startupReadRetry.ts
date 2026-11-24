import { isIcpSessionRequiredError } from "@/live/icpSessionErrors";

/**
 * Retry only failures typical of a cold start (sign-in still restoring, a
 * dropped connection), quickly and at most twice. Timeouts and refusals keep
 * the Try again card so a stalled read is never silently repeated.
 */
export function retryStartupRead(failureCount: number, error: unknown) {
  if (failureCount >= 2) return false;
  if (isIcpSessionRequiredError(error)) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /failed to fetch|network|connection|fetch failed|load failed/i.test(message);
}
