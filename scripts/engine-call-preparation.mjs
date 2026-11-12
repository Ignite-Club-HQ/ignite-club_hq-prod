/** Offline adapter protocol only. This JS deadline is NOT an IC bounded-wait
 * implementation. Real canisters must use timeout/Call::bounded_wait in both
 * directions. No live transport or automatic write retry is provided. */
import { createHash } from 'node:crypto';
import { preparationBindingHash } from './engine-operational-preparation.mjs';

export function callPreparationBinding(call) {
  if (!call || !['read', 'write'].includes(call.kind) ||
      !['operation', 'caller', 'service', 'method', 'sourceSubnet'].every(k => typeof call[k] === 'string' && call[k].trim()) ||
      !/^[a-f0-9]{64}$/.test(call.argumentHash ?? '') ||
      !Number.isInteger(call.timeoutSeconds) || call.timeoutSeconds < 1 || call.timeoutSeconds > 300 ||
      Object.hasOwn(call, 'cycles')) throw Error('Explicit bounded cycle-free call required');
  const destination = preparationBindingHash(call.destination);
  if (!call.destination.services.some(s => s.service === call.service)) throw Error('Unknown destination service');
  return createHash('sha256').update(JSON.stringify([destination, call.kind, call.operation, call.caller,
    call.service, call.method, call.argumentHash, call.sourceSubnet, call.timeoutSeconds])).digest('hex');
}
async function persist(journal, value) {
  await journal.assertExclusiveWriter();
  await journal.save(structuredClone(value));
  await journal.assertExclusiveWriter();
  if (JSON.stringify(await journal.read()) !== JSON.stringify(value)) throw Error('Journal readback failed; keep call held');
}
async function bounded(work, milliseconds) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('Unknown call outcome')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
/** Adapter replies are stand-ins, not independently authenticated evidence. */
export async function rehearseDestinationCall(call, adapter, journal) {
  call = structuredClone(call);
  const binding = callPreparationBinding(call);
  await journal.assertExclusiveWriter();
  const saved = await journal.read();
  if (saved) throw Error('Existing call requires reconciliation; no replay');
  await persist(journal, { binding, operation: call.operation, phase: 'pending' });
  let reply;
  try { reply = await bounded(() => adapter.call(structuredClone(call)), call.timeoutSeconds * 1000); }
  catch { return { preparationOnly: true, activationAuthorized: false, outcome: 'unknown', binding }; }
  if (reply?.binding !== binding || reply.operation !== call.operation || !['committed', 'refused'].includes(reply.outcome)) {
    return { preparationOnly: true, activationAuthorized: false, outcome: 'unknown', binding };
  }
  await persist(journal, { binding, operation: call.operation, phase: reply.outcome });
  return { preparationOnly: true, activationAuthorized: false, outcome: reply.outcome, binding };
}
/** Only exact outcome readback can settle a held intent. A missing receipt or
 * read failure is NOT proof the original write did not happen. Never resends. */
export async function reconcileDestinationCall(call, adapter, journal) {
  call = structuredClone(call);
  const binding = callPreparationBinding(call);
  await journal.assertExclusiveWriter();
  const saved = await journal.read();
  if (saved?.binding !== binding || saved.operation !== call.operation || saved.phase !== 'pending') throw Error('Exact pending call required');
  let reply;
  try { reply = await bounded(() => adapter.readOutcome(binding, call.operation), call.timeoutSeconds * 1000); }
  catch { reply = undefined; }
  if (reply?.binding !== binding || reply.operation !== call.operation || !['committed', 'refused'].includes(reply.outcome)) {
    return { preparationOnly: true, activationAuthorized: false, outcome: 'unknown', binding };
  }
  await persist(journal, { binding, operation: call.operation, phase: reply.outcome });
  return { preparationOnly: true, activationAuthorized: false, outcome: reply.outcome, binding };
}