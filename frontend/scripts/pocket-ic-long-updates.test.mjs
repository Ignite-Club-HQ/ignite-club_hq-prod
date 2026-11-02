import test from 'node:test';
import assert from 'node:assert/strict';
import { allowLongUpdates } from './pocket-ic-long-updates.mjs';
import { Principal } from '@dfinity/principal';
const call = () => ({ messageId: 'bWlk', effectivePrincipal: { canisterId: Principal.fromText('rrkah-fqaaa-aaaaa-aaaaq-cai') } });

// Fake server speaking PocketIC's wire format: null while pending, {Ok}/{Err} when done.
const fake = (answerAfter, reject = false) => {
  let ticks = 0; const bodies = [];
  return { ticks: () => ticks, bodies, client: {
    tick: async () => { ticks++; },
    post: async (path, body) => {
      assert.equal(path, '/read/ingress_status'); bodies.push(body);
      if (ticks < answerAfter) return null;
      return reject ? { Err: { reject_message: 'refused', reject_code: 5, error_code: 'x', certified: true } } : { Ok: 'Bw==' };
    },
  } };
};

test('waits beyond PocketIC 100-round cap and returns the same reply', async () => {
  const f = fake(250); const pic = allowLongUpdates({ client: f.client });
  assert.deepEqual([...(await pic.client.awaitCall(call())).body], [7]);
  assert.equal(f.ticks(), 250);
});
test('sends raw_message_id as the struct the server expects, not a bare string', async () => {
  const f = fake(0); allowLongUpdates({ client: f.client });
  await f.client.awaitCall(call());
  const id = f.bodies[0].raw_message_id;
  assert.equal(typeof id, 'object'); assert.equal(id.message_id, 'bWlk'); assert.equal(typeof id.effective_principal.CanisterId, 'string');
});
test('rejections still surface unchanged', async () => {
  const f = fake(3, true); allowLongUpdates({ client: f.client });
  await assert.rejects(f.client.awaitCall(call()), /refused/);
});
test('stays bounded', async () => {
  const f = fake(1e9); allowLongUpdates({ client: f.client }, { maxRounds: 10 });
  await assert.rejects(f.client.awaitCall(call()), /after 10 rounds/);
  assert.equal(f.ticks(), 10);
});
