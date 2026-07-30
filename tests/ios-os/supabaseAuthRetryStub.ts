/**
 * Stub for `@/lib/supabaseAuthRetry` used ONLY by the iOS OS harness.
 *
 * The production adapter imports `abortAllInFlightRestGets` from that module,
 * which transitively imports the Supabase client (and therefore the Supabase
 * URL / publishable key). The harness must never embed those, so the vite
 * config aliases the module to this file. The abort contract is preserved so
 * the adapter's abort-then-refetch ordering is still exercised.
 */
let abortCalls = 0;

export function abortAllInFlightRestGets(reason?: string): number {
  abortCalls += 1;
  // eslint-disable-next-line no-console
  console.log(`IOSTEST ABORT reason=${reason ?? "unknown"} call=${abortCalls}`);
  return 0;
}

export function __abortCallCount(): number {
  return abortCalls;
}
