import { isIcpSessionRequiredError } from "@/live/icpSessionErrors";

/**
 * What a failed event save means for the member's data.
 *  - session_before_send: no usable sign-in; nothing was sent. Keep the form,
 *    ask them to sign in, then they tap Save again.
 *  - uncertain: a request may have reached the service but no answer came back
 *    (network drop, timeout). It might have been applied. Never retry
 *    automatically; ask the member to check first.
 *  - rejected: the service answered with a refusal; nothing was applied by
 *    that call.
 */
export type EventSaveFailure = "session_before_send" | "uncertain" | "rejected";

const UNCERTAIN = /timed?\s*out|timeout|network|failed to fetch|fetch failed|load failed|aborted|abort|connection (?:was )?(?:closed|reset|lost)|unknown status|status:? 50[234]|socket|offline|request (?:was )?not (?:yet )?(?:processed|answered)|took too long/i;

export function classifyEventSaveFailure(error: unknown): EventSaveFailure {
  if (isIcpSessionRequiredError(error)) return "session_before_send";
  const message = error instanceof Error ? error.message : String(error ?? "");
  return UNCERTAIN.test(message) ? "uncertain" : "rejected";
}

/** Stage a save had reached when it failed. */
export type EventSaveStage = "before_send" | "main_update" | "related_updates";

/**
 * True when the save path creates new events (recurring conversion on the
 * canister has no idempotency key), so an uncertain outcome could duplicate
 * events if the member simply tapped Save again.
 */
export function uncertainSaveBlocksResubmit(failure: EventSaveFailure, stage: EventSaveStage, createsEvents: boolean): boolean {
  return createsEvents && failure === "uncertain" && stage === "main_update";
}
