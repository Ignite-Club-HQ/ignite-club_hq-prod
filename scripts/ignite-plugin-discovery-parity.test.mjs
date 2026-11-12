import test from 'node:test';
import assert from 'node:assert/strict';
import { DEV_G2_CLUB, DEV_IDENTITY, DEV_ROUTER, DEV_CANONICAL, validateDiscovery, compareDiscovery, auditDiscovery } from './ignite-plugin-discovery-parity.mjs';
const shared=[{id:DEV_IDENTITY},{id:DEV_ROUTER}];
const full={canisters:[...shared,{id:DEV_G2_CLUB}]};
const partial={canisters:[...shared]};
test('canonical has reviewed Group 2 and Lovable remains a separate origin',()=>{
  const report=compareDiscovery(full,partial);
  assert.equal(report.canonicalGroup2Declared,true);
  assert.equal(report.lovableGroup2Declared,false);
  assert.equal(report.parity,false);
  assert.equal(report.pluginDevEntry,DEV_CANONICAL);
  assert.match(report.notice,/canonical/i);
});
test('missing canonical Group 2 always fails closed',()=>{
  assert.throws(()=>compareDiscovery(partial,full),/not declared/);
});
test('only identical declarations pass parity; duplicate or absent identity/router fail closed',()=>{
  assert.equal(compareDiscovery(full,full).parity,true);
  assert.throws(()=>validateDiscovery({canisters:[...shared,...shared]}),/Duplicate/);
  assert.throws(()=>validateDiscovery({canisters:[{id:DEV_G2_CLUB}]}, {requireGroup2:true}),/Missing required/);
  assert.throws(()=>validateDiscovery({canisters:[]}, {requireGroup2:true}),/Missing required/);
});
test('audit fetches only approved public manifest paths and never calls canisters',async()=>{
  const called=[];
  const reply=url=>{
    called.push(url);
    const isCanonical=url.startsWith(DEV_CANONICAL);
    return {ok:true,headers:{get:()=> 'application/json'},text:async()=>JSON.stringify(isCanonical?full:partial)};
  };
  const report=await auditDiscovery(reply);
  assert.equal(report.parity,false);
  assert.equal(called.length,2);
  assert.ok(called.every(x=>x.endsWith('/.well-known/ic-architecture')));
});
test('HTML fallback or missing endpoint is never treated as a valid manifest',async()=>{
  await assert.rejects(auditDiscovery(async()=>({ok:true,headers:{get:()=> 'text/html'}})),/non-JSON/);
  await assert.rejects(auditDiscovery(async()=>({ok:false,status:404,headers:{get:()=> 'application/json'}})),/HTTP 404/);
});
