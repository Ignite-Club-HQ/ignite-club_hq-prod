import {createPublicKey,verify,createHash} from 'node:crypto';
import {canonical} from './prod-base-group-policy.mjs';
import {digest,verifyActivatedDraft} from './prod-protection-policy.mjs';
const hex=b=>Buffer.from(b).toString('hex');
export function approvalBytes(IDL,type,body) {
  return Buffer.concat([Buffer.from('ignite:production-account-authorization:v1\0'),createHash('sha256').update(Buffer.from(IDL.encode([type],[body]))).digest()]);
}
export function recoveryBytes(IDL,type,body,subject=false) {
  const bytes=Buffer.concat([Buffer.from('ignite:independent-recovery-acceptance:lifecycle-v2\0'),createHash('sha256').update(Buffer.from(IDL.encode([type],[body]))).digest()]);
  return subject?Buffer.concat([Buffer.from('ignite:subject-scoped-removal-progress:lifecycle-v2\0'),createHash('sha256').update(bytes).digest()]):bytes;
}
export function verifySignature(bytes,signature,publicKey) {
  const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(publicKey,'hex')]),type:'spki',format:'der'});
  if(signature.length!==64||!verify(null,bytes,key,signature))throw Error('Independent approval signature mismatch');
}
export function assertEmptyHistory(history,revision) {
  if(String(history.revision)!==String(revision)||['principal_denials','erased_accounts','pending_intents','removal_barriers','removal_subjects','removal_receipts','removal_completions'].some(k=>String(history[k])!=='0'))
    throw Error('Existing or divergent removal history requires separate recovery review');
}
export function validateReview({body,review,commissioning,head,records,state,fence,base,g2,targets,identity,governor,purpose,plain}) {
  const b=plain(body);verifyActivatedDraft(b.review,targets,identity);
  if(b.identity!==identity||b.operator!==governor||b.kind!==`ignite-production-account-${purpose==='inventory'?'inventory':'protection'}-v1`||
    canonical(b.review)!==canonical(plain(review))||canonical(b.expectation.inventory)!==canonical(b.review.inventory)||
    BigInt(body.generation)!==BigInt(state.generation)+1n||BigInt(body.expires_at_ns)<=BigInt(Date.now())*1_000_000n||
    String(body.recovery_epoch)!==String(head.epoch))throw Error('Complete commissioning body differs from certified evidence');
  assertEmptyHistory(commissioning.history,body.expectation.inventory.groups.history_revision);
  if(records.length||String(head.revision)!=='0')throw Error('Non-empty witness history requires separate review');
  if(purpose==='inventory'&&commissioning.inventory_approval.length)throw Error('Inventory already provisioned');
  if(purpose==='protection'&&commissioning.inventory_approval.length!==1)throw Error('Exact provisioned inventory evidence required');
  if(hex(body.runtime_evidence)!==digest(plain(review))||hex(body.original_inventory_evidence)!==digest({base,g2,inventory:plain(body.expectation.inventory)})||
     hex(body.fenced_recovery_evidence)!==digest(fence))throw Error('Commissioning evidence digest mismatch');
  const modules=new Map(body.expectation.modules.map(([p,m])=>[p.toText(),hex(m)]));
  if(modules.size!==targets.length+1)throw Error('Exact program evidence required');
  for(const row of fence.fencedState) {
    const t=targets.find(t=>t.id===row.id);
    if(row.controllers.length!==1||row.controllers[0]!==governor||modules.get(row.id)!==row.moduleHash||
       (t&&row.subnet!==t.subnet))throw Error('Independent program/controller/subnet evidence mismatch');
  }
}
export function assertArtifactPlan(plan,{sourceCommit,identityHash,pins,receivers}) {
  if(plan?.version!==1||plan.sourceCommit!==sourceCommit||plan.identityModuleHash!==identityHash||
     canonical(plan.pins)!==canonical(pins)||canonical(plan.receivers)!==canonical(receivers)||plan.openingAuthorized!==false)
    throw Error('Reviewed immutable commissioning artifact plan required');
}