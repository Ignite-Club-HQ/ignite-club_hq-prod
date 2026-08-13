export type SubmissionLock = { current: boolean };

/** Synchronously reserve a submission before React state can rerender. */
export function acquireEventSubmission(lock: SubmissionLock): boolean {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

/** Release after validation, conflict, or mutation completion so retry is safe. */
export function releaseEventSubmission(lock: SubmissionLock): void {
  lock.current = false;
}
