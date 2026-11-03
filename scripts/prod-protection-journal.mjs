// Serializable acknowledgement transitions; unknown outcomes never clear intent.
import {canonical} from './prod-base-group-policy.mjs';
export function outcome(pending, observed) {
  if (!pending || pending.version !== 2 || !pending.commit ||
      !('before' in pending) || !('after' in pending)) return 'unknown';
  if (canonical(pending.before) === canonical(pending.after)) return 'unknown';
  if (canonical(observed) === canonical(pending.after)) return 'committed';
  // A before-image cannot prove a submitted request will not execute later.
  // Only an explicit, durable proof that submission never began permits retry.
  if (pending.retryable && pending.notSubmitted === true && canonical(observed) === canonical(pending.before)) return 'not-applied';
  return 'unknown';
}
export function createProtectionJournal({load, save, probe}) {
  async function reconcile() {
    const receipt = await load();
    if (!receipt?.pending) return receipt;
    const pending = receipt.pending;
    const decision = outcome(pending, await probe(pending));
    if (decision === 'unknown') throw Error('Unresolved activation intent; manual read-only reconciliation required');
    const next = {...receipt, ...(decision === 'committed' ? pending.commit : {}), pending:null};
    await save(next);
    return next;
  }
  async function checkpoint({kind, before, after, commit, retryable=false, metadata={}}, call) {
    const receipt = await load();
    if (receipt?.pending) throw Error('Retained activation intent must be reconciled first');
    if (!commit || typeof commit !== 'object' || canonical(before) === canonical(after))
      throw Error('Distinct observable states and serializable completion transition required');
    const pending = {version:2, kind, before, after, commit, retryable, metadata};
    await save({...receipt, pending});
    const result = await call();
    const observed = await probe(pending);
    if (outcome(pending, observed) !== 'committed') throw Error('Acknowledged activation readback mismatch');
    await save({...await load(), ...commit, pending:null});
    return result;
  }
  return {checkpoint, reconcile};
}