/** One-shot self-test. The canister claim is the durable send-once fence. */
export async function deliverBrowserSelfTest(id: string, queue: {
  claim: (id: string) => Promise<{ id: string; token: string; owner: string } | undefined>;
  settle: (id: string, outcome: string) => Promise<void>;
}, send: (row: { id: string; token: string; owner: string }) => Promise<boolean>) {
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(id)) throw new Error('Invalid test id');
  const row = await queue.claim(id);
  if (!row) return { status: 'not-pending' };
  let outcome = 'held';
  try { outcome = await send(row) ? 'accepted' : 'failed'; }
  catch { /* Unknown provider acceptance is held; never repeat. */ }
  await queue.settle(id, outcome);
  return { status: outcome };
}