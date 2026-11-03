import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {assertEmptyHistory,verifySignature,assertArtifactPlan} from './prod-protection-review.mjs';
test('history revision may advance for inventory provisioning but no removal row is ignored',()=>{
  const h={revision:'8',principal_denials:'0',erased_accounts:'0',pending_intents:'0',removal_barriers:'0',removal_subjects:'0',removal_receipts:'0',removal_completions:'0'};
  assert.doesNotThrow(()=>assertEmptyHistory(h,'8'));
  for(const k of Object.keys(h).filter(k=>k!=='revision'))assert.throws(()=>assertEmptyHistory({...h,[k]:'1'},'8'));
  assert.throws(()=>assertEmptyHistory(h,'7'));
});
test('recovery approval requires the real independently pinned account signature',()=>{
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');const key=publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('hex');
  const b=Buffer.from('review');const signature=sign(null,b,privateKey);verifySignature(b,signature,key);
  assert.throws(()=>verifySignature(Buffer.from('substituted review'),signature,key));
});
test('identity upgrade cannot promote its newly computed hash into its own approval',()=>{
  const p={version:1,sourceCommit:'a'.repeat(40),identityModuleHash:'b'.repeat(64),pins:{witness:'w'},receivers:[{id:'r',hash:'c'}],openingAuthorized:false};
  const expected={sourceCommit:p.sourceCommit,identityHash:p.identityModuleHash,pins:p.pins,receivers:p.receivers};assertArtifactPlan(p,expected);
  for(const change of [{identityHash:'d'.repeat(64)},{sourceCommit:'e'.repeat(40)},{pins:{witness:'foreign'}}])assert.throws(()=>assertArtifactPlan(p,{...expected,...change}));
});