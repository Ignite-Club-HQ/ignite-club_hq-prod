import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileScoreHistory } from './score-history-reconciliation.mjs';
const match={competitionId:'competition-one',matchId:'match-one'};
const row=(extra={})=>({ ...match,sourceId:'match-source',kind:'match',side:'home',homeScore:0,awayScore:2,...extra });
const review=sources=>reconcileScoreHistory({matches:[match],sources});
test('zero scores survive and away History orientation maps to canonical home/away',()=>{
 const r=review([row(),row({sourceId:'away-history',kind:'history',side:'away',homeScore:2,awayScore:0})]);
 assert.equal(r.results[0].status,'consistent');assert.equal(r.results[0].homeScore,0);assert.equal(r.results[0].awayScore,2);
 assert.equal(r.accountedSourceCount,2);assert.equal(r.requiresReview,false);
});
test('divergent source records hold review and preserve every before-image without latest-wins',()=>{
 const r=review([row(),row({sourceId:'event-source',kind:'event',homeScore:4,updatedAt:'2099-01-01'})]);
 assert.equal(r.results[0].status,'conflict');assert.equal(r.requiresReview,true);assert.equal(r.results[0].homeScore,null);
 assert.deepEqual(r.results[0].sources.map(s=>s.homeScore).sort(),[0,4]);
});
test('NULL is not zero and partial rows are not silently merged',()=>{
 assert.equal(review([row({homeScore:null,awayScore:null})]).results[0].status,'empty');
 assert.equal(review([row({homeScore:null})]).results[0].status,'partial');
 const r=review([row({homeScore:null}),row({sourceId:'partial-event',kind:'event',awayScore:null})]);
 assert.equal(r.results[0].status,'conflict');
});
test('orphan/cross-competition/unknown-orientation rows remain accounted for and hold review',()=>{
 for(const changes of [{competitionId:null},{matchId:'deleted-match'},{competitionId:'other-competition'},{side:null}]){
  const r=review([row(changes)]);assert.equal(r.requiresReview,true);assert.equal(r.accountedSourceCount,1);assert.equal(r.results[0].sources.length,0);
 }
});
test('PlayHQ external IDs require tenant/source binding and cannot collide within one tenant',()=>{
 const first={...match,tenantId:'tenant-one',source:'playhq',externalId:'external-one'};
 const second={competitionId:'competition-two',matchId:'match-two',tenantId:'tenant-two',source:'playhq',externalId:'external-one'};
 assert.equal(reconcileScoreHistory({matches:[first,second],sources:[]}).results.length,2);
 assert.throws(()=>reconcileScoreHistory({matches:[first,{...second,tenantId:'tenant-one'}],sources:[]}));
 assert.throws(()=>reconcileScoreHistory({matches:[{...first,tenantId:null}],sources:[]}));
});
test('malformed, negative/fractional scores, duplicate identities and missing arrays fail closed',()=>{
 for(const homeScore of [-1,1.5,'0',undefined])assert.throws(()=>review([row({homeScore})]));
 assert.throws(()=>review([row(),row()]));assert.throws(()=>reconcileScoreHistory({matches:[match,match],sources:[]}));
 assert.throws(()=>reconcileScoreHistory({matches:[match]}));
});
test('reordered input produces the same review fingerprint and never authorizes backfill or release',()=>{
 const rows=[row(),row({sourceId:'history',kind:'history'})];
 const a=review(rows);const b=review([...rows].reverse());
 assert.equal(a.inputSha256,b.inputSha256);assert.deepEqual(a.results,b.results);
 assert.equal(a.deploymentAuthorized,false);assert.equal(a.dataClearingAuthorized,false);
});