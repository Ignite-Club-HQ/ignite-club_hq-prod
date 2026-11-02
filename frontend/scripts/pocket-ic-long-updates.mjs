// Test-only: PocketIC's await_ingress_message gives up after a fixed 100 rounds.
// Calls that fan out across many canisters (all 28 two-group targets plus witness
// and lifecycle reads) legitimately need more rounds. This replaces the wait with a
// bounded tick-and-poll on the same ingress message, so the outcome (reply or reject)
// is unchanged; only the round budget grows. Never used outside isolated PocketIC.
export const DEFAULT_MAX_ROUNDS = 5000;

export function allowLongUpdates(pic, { maxRounds = DEFAULT_MAX_ROUNDS } = {}) {
  const client = pic?.client;
  if (!client || typeof client.ingressStatus !== 'function' || typeof client.tick !== 'function') {
    throw new Error('PocketIC client does not expose ingress status polling');
  }
  if (!Number.isInteger(maxRounds) || maxRounds < 1) throw new Error('maxRounds must be a positive integer');
  client.awaitCall = async (submitted) => {
    for (let round = 0; round <= maxRounds; round++) {
      const status = await client.ingressStatus({ messageId: submitted.messageId });
      if (status !== null) return status;
      if (round < maxRounds) await client.tick();
    }
    throw new Error(`Ingress message not answered after ${maxRounds} rounds`);
  };
  return pic;
}
