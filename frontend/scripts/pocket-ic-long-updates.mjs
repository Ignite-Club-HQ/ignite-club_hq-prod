// Test-only: PocketIC's await_ingress_message gives up after a fixed 100 rounds.
// Calls that fan out across many canisters (all 28 two-group targets plus witness
// and lifecycle reads) legitimately need more rounds. This replaces the wait with a
// bounded tick-and-poll on the same ingress message, so the outcome (reply or reject)
// is unchanged; only the round budget grows. Never used outside isolated PocketIC.
//
// The library's own client.ingressStatus() sends raw_message_id as a bare string,
// which the PocketIC server rejects (it expects {effective_principal, message_id}).
// So we post /read/ingress_status ourselves, reusing the library's own await-request
// encoder for that struct and its own response decoder.
import { createRequire } from 'node:module';

export const DEFAULT_MAX_ROUNDS = 5000;

const loadCodec = () => {
  const types = createRequire(import.meta.url)('@dfinity/pic/dist/pocket-ic-client-types.js');
  return { encode: types.encodeAwaitCanisterCallRequest, decode: types.decodeIngressStatusResponse };
};

export function allowLongUpdates(pic, { maxRounds = DEFAULT_MAX_ROUNDS, codec } = {}) {
  const client = pic?.client;
  if (!client || typeof client.post !== 'function' || typeof client.tick !== 'function') {
    throw new Error('PocketIC client does not expose ingress status polling');
  }
  if (!Number.isInteger(maxRounds) || maxRounds < 1) throw new Error('maxRounds must be a positive integer');
  const { encode, decode } = codec ?? loadCodec();
  if (typeof encode !== 'function' || typeof decode !== 'function') throw new Error('PocketIC codec unavailable');
  client.awaitCall = async (submitted) => {
    const body = { raw_message_id: encode(submitted), raw_caller: undefined };
    for (let round = 0; round <= maxRounds; round++) {
      const status = decode(await client.post('/read/ingress_status', body));
      if (status !== null) return status;
      if (round < maxRounds) await client.tick();
    }
    throw new Error(`Ingress message not answered after ${maxRounds} rounds`);
  };
  return pic;
}
