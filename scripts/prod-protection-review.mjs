import {createPublicKey,verify,createHash} from 'node:crypto';
import {canonical} from './prod-base-group-policy.mjs';
import {digest,verifyActivatedDraft,APPROVAL_LIFETIME_NS} from './prod-protection-policy.mjs';
const hex=b=>Buffer.from(b).toString('hex');
// Candid type tables differ between Rust and JS encoders, so signers hash the
// canister's exact bytes only after they decode back to the reviewed value.
export function exactEncoding(IDL,type,body,encoding) {
  if(!encoding)throw Error('Exact canister encoding required before signing');
  const bytes=Buffer.from(encoding);let value;
  try{[value]=IDL.decode([type],bytes);}catch(e){throw Error('Canister encoding does not decode: '+e.message);}
  if(!Buffer.from(IDL.encode([type],[value])).equals(Buffer.from(IDL.encode([type],[body]))))throw Error('Canister encoding differs from reviewed value');
  return bytes;
}
export function approvalBytes(IDL,type,body,encoding) {
  return Buffer.concat([Buffer.from('ignite:production-account-authorization:v1\0'),createHash('sha256').update(exactEncoding(IDL,type,body,encoding)).digest()]);
}
export function recoveryBytes(IDL,type,body,encoding,subject=false) {
  const bytes=Buffer.concat([Buffer.from('ignite:independent-recovery-acceptance:lifecycle-v2\0'),createHash('sha256').update(exactEncoding(IDL,type,body,encoding)).digest()]);
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
    BigInt(body.expires_at_ns)>BigInt(Date.now())*1_000_000n+APPROVAL_LIFETIME_NS||
    String(body.recovery_epoch)!==String(head.epoch))throw Error('Complete commissioning body differs from certified evidence');
  assertEmptyHistory(commissioning.history,body.expectation.inventory.groups.history_revision);
  if(records.length||String(head.revision)!=='0')throw Error('Non-empty witness history requires separate review');
  if(purpose==='inventory'&&commissioning.inventory_approval.length)throw Error('Inventory already provisioned');
  if(purpose==='protection'&&commissioning.inventory_approval.length!==1)throw Error('Exact provisioned inventory evidence required');
  if(hex(body.runtime_evidence)!==digest(plain(review))||hex(body.original_inventory_evidence)!==digest({base,g2,inventory:plain(body.expectation.inventory)})||
     hex(body.fenced_recovery_evidence)!==digest(fence))throw Error('Commissioning evidence digest mismatch');
  if(canonical(fence.identityHistory)!==canonical(plain(commissioning.history))||fence.identityHistoryRevision!==String(commissioning.history.revision))
    throw Error('Decoded identity history evidence mismatch');
  const modules=new Map(body.expectation.modules.map(([p,m])=>[p.toText(),hex(m)]));
  if(modules.size!==targets.length+1)throw Error('Exact program evidence required');
  for(const row of fence.fencedState) {
    const t=targets.find(t=>t.id===row.id);
    if(row.controllers.length!==1||row.controllers[0]!==governor||modules.get(row.id)!==row.moduleHash||
       (t&&row.subnet!==t.subnet))throw Error('Independent program/controller/subnet evidence mismatch');
  }
}
export const COMMISSIONING_PHASES=['planned','inventory-reviewed','inventory-signed','inventory-recovery-signed','inventory-witness-accepted','inventory-delivered',
  'protection-reviewed','protection-signed','protection-recovery-signed','protection-witness-accepted','protection-subject-accepted','protection-delivered','verified'];
export function jobTransition(job,receipt) {
  if(job==='plan')return receipt?'reject':'run';
  if(job==='prepare')return !receipt||receipt.phase==='planned'?'run':COMMISSIONING_PHASES.includes(receipt.phase)?'done':'reject';
  if(!receipt||!COMMISSIONING_PHASES.includes(receipt.phase))return 'reject';
  if(job==='deliver-protection'&&receipt.purpose==='protection'&&
     ['protection-delivered','verified'].includes(receipt.phase))return 'run';
  const purpose=job.endsWith('inventory')?'inventory':'protection';
  const complete=job.startsWith('account-')?`${purpose}-signed`:job.startsWith('recovery-')?`${purpose}-recovery-signed`:`${purpose}-delivered`;
  const start=job.startsWith('account-')?`${purpose}-reviewed`:job.startsWith('recovery-')?`${purpose}-signed`:`${purpose}-recovery-signed`;
  const at=COMMISSIONING_PHASES.indexOf(receipt.phase);
  if(at>=COMMISSIONING_PHASES.indexOf(complete))return 'done';
  if(receipt.purpose!==purpose||at<COMMISSIONING_PHASES.indexOf(start))return 'reject';
  return 'run';
}
export function assertArtifactPlan(plan,{sourceCommit,identityHash,pins,receivers}) {
  if(plan?.version!==1||plan.sourceCommit!==sourceCommit||plan.identityModuleHash!==identityHash||
     canonical(plan.pins)!==canonical(pins)||canonical(plan.receivers)!==canonical(receivers)||plan.openingAuthorized!==false)
    throw Error('Reviewed immutable commissioning artifact plan required');
}
export function assertReviewedReceivers(plan,targets,observed) {
  const ids=targets.map(t=>t.id).sort();
  if(canonical(plan?.receivers?.map(t=>t.id).sort())!==canonical(ids)||
     canonical(observed.filter(t=>ids.includes(t.id)).map(t=>t.id).sort())!==canonical(ids))throw Error('Exact reviewed receiver inventory required');
  for(const target of targets){
    const approved=plan.receivers.find(t=>t.id===target.id),current=observed.find(t=>t.id===target.id);
    if(!approved||!current||approved.moduleHash!==current.moduleHash||approved.subnet!==current.subnet||
       approved.subnet!==target.subnet||canonical(approved.controllers)!==canonical(current.controllers))
      throw Error('Receiver differs from owner-reviewed artifact plan');
  }
}
export function identityPreparationDecision(observed,reviewed,original) {
  if(observed===reviewed)return 'already-installed';
  if(observed===original)return 'upgrade';
  throw Error('Identity program differs from original and reviewed artifacts');
}
export function protectionReviewContext(receipt,runId) {
  if(receipt.phase!=='inventory-delivered'||receipt.purpose!=='inventory'||receipt.pending||
     !receipt.inventoryApproval||receipt.inventoryApproval!==receipt.approval||!receipt.inventoryAcceptance)
    throw Error('Acknowledged signed inventory delivery required before protection review');
  return {purpose:'protection',runId,inventoryStage:{body:receipt.body,proofs:receipt.proofs,
    approval:receipt.approval,acceptance:receipt.acceptance,fenceEvidence:receipt.fenceEvidence}};
}