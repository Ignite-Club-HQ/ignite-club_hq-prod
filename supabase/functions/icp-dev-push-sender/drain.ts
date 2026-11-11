import type { DeliveryReport } from './delivery.ts';

/** Continue bounded batches while there is work; never retry a thrown reserve,
 * send or settlement. Queue timers provide the next wake after the time budget.
 */
export async function drainNativePush(
  runBatch: () => Promise<DeliveryReport>,
  rescan: () => boolean,
  now: () => number = Date.now,
  budgetMs = 20_000,
): Promise<{ batches: number; complete: boolean }> {
  const deadline = now() + budgetMs;
  let batches = 0;
  do {
    const report = await runBatch();
    batches++;
    const again = rescan();
    if (report.complete && !again) return { batches, complete: true };
  } while (now() < deadline);
  return { batches, complete: false };
}