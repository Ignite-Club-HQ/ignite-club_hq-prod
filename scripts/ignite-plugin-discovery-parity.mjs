// Read-only DEV connector discovery audit. No principals, credentials, canister writes or redirects.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const DEV_CANONICAL = 'https://proe7-kqaaa-aaaas-qg6gq-cai.icp0.io';
export const DEV_LOVABLE = 'https://ignite-club-launchpad.lovable.app';
export const DEV_G2_CLUB = 'yfwyv-nyaaa-aaaal-qxpyq-cai';
export const DEV_IDENTITY = 'mq2sj-fiaaa-aaaal-qxlqa-cai';
export const DEV_ROUTER = 'jcdfe-vqaaa-aaaal-qxloq-cai';

export function validateDiscovery(manifest, {requireGroup2=false}={}) {
  assert.ok(manifest && typeof manifest==='object' && Array.isArray(manifest.canisters), 'Valid ICP service discovery JSON required');
  const declared=manifest.canisters.map(c=>c?.id);
  assert.equal(new Set(declared).size,declared.length,'Duplicate canister declarations refused');
  for(const id of [DEV_IDENTITY,DEV_ROUTER]) assert.ok(declared.includes(id),'Missing required declared backend: '+id);
  if(requireGroup2) assert.ok(declared.includes(DEV_G2_CLUB),'DEV Group 2 is not declared to the ICP plugin');
  return {group2Declared:declared.includes(DEV_G2_CLUB),declaredCount:declared.length};
}

export function compareDiscovery(canonical,lovable) {
  const source=validateDiscovery(canonical,{requireGroup2:true});
  const front=validateDiscovery(lovable);
  return {
    canonicalGroup2Declared:source.group2Declared,
    lovableGroup2Declared:front.group2Declared,
    parity:source.group2Declared===front.group2Declared,
    pluginDevEntry:DEV_CANONICAL,
    notice:front.group2Declared
      ? 'Both DEV origins declare Group 2; still verify actual caller admission'
      : 'Lovable DEV does not declare Group 2: use canonical DEV frontend for connector discovery',
  };
}

export async function auditDiscovery(fetchImpl=fetch){
  const endpoints=[DEV_CANONICAL,DEV_LOVABLE];
  const results=await Promise.all(endpoints.map(async origin=>{
    const url=origin+'/.well-known/ic-architecture';
    const response=await fetchImpl(url,{signal:AbortSignal.timeout(12000),redirect:'error',headers:{accept:'application/json'}});
    if(!response.ok)throw Error('Discovery endpoint returned HTTP '+response.status+' at '+origin);
    if(!(response.headers.get('content-type')??'').toLowerCase().includes('json'))throw Error('Discovery endpoint returned non-JSON content at '+origin);
    const text=await response.text();
    if(text.length>100000)throw Error('Oversized discovery manifest at '+origin);
    return JSON.parse(text);
  }));
  return compareDiscovery(results[0],results[1]);
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  auditDiscovery().then(report=>{
    console.log(JSON.stringify(report,null,2));
    if(!report.parity){console.error('::warning::Lovable DEV discovery is behind canonical DEV; ChatGPT Group 2 requires the canonical URL until the hosting pipeline is updated.');}
  }).catch(e=>{console.error('::error::Read-only DEV plugin discovery audit failed: '+e.message);process.exitCode=1;});
}
