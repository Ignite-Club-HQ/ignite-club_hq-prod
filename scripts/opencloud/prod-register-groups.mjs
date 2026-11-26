import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {validate} from './deployment.mjs';
import {registerGroupCall, registerGroupPlacementCall} from './deployment.mjs';
const mode=process.argv[2];
if(!['check','register'].includes(mode))throw Error('Explicit mode required');
const config=JSON.parse(fs.readFileSync('deploy/opencloud/prod.json'));
const peer=JSON.parse(fs.readFileSync('deploy/opencloud/dev.json'));
if(process.env.GITHUB_REF_NAME!=='main'||config.environment!=='opencloud-prod'||config.applicationKey!=='ignite_prod_v2'||config.apiHost!=='https://s53an-5aaaa-aaac5-aaaaa-cai.icp.net')throw Error('Wrong PROD target');
const rows=validate({...config,supabase:{...config.supabase,publishableKey:config.supabase.publishableKey||'sb_publishable_OFFLINE_INSTALL_VALIDATION'}},peer);
const root=process.cwd(), cwd=process.env.RUNNER_TEMP;
const router=config.shared.shard_router;
if(router!=='fwgn7-saaaa-aaac5-aaebq-cai'||config.groups.map(g=>g.id).join(',')!=='g1,g2')throw Error('Unexpected router or groups');
const identity='opencloud-governor';
function cli(args){const r=spawnSync('icp',args,{cwd,encoding:'utf8',maxBuffer:4*1024*1024});if(r.status!==0)throw Error('CLI failed: '+r.stderr);return r.stdout;}
if(cli(['identity','principal','--identity',identity]).trim()!==config.controllers.governor)throw Error('Wrong governor');
function invoke(method,args){const out=cli(['canister','call',router,method,args,'--candid',path.join(root,'backend/shard_router/shard_router.did'),'--network','ic','--identity',identity]);console.log(out);if(!/\bOk\b/.test(out)||/\bErr\b/.test(out))throw Error('Uncertain response: '+method);return out;}
function read(){return invoke('read_group_registry','("opencloud-prod")');}
function revision(out){const m=[...out.matchAll(/\brevision\s*=\s*([\d_]+)\s*:\s*nat64/g)];if(m.length!==1)throw Error('Ambiguous registry revision');return BigInt(m[0][1].replaceAll('_',''));}
const plans=config.groups.map(g=>({group:registerGroupCall(config,g),placement:registerGroupPlacementCall(config,g),g}));
if(plans.some(p=>!p.group.ready||p.group.target!==router||p.placement.target!==router))throw Error('Incomplete registration plan');
let snapshot=read(), rev=revision(snapshot);
if(!/groups\s*=\s*vec\s*\{\s*\}/.test(snapshot)||!/placements\s*=\s*vec\s*\{\s*\}/.test(snapshot))throw Error('Registry not empty; review before any replay');
for(const p of plans){console.log(p.group.candidArgs);console.log(p.placement.candidArgs);}
if(mode==='check')process.exit(0);
for(const p of plans){
 const args=p.group.candidArgs.replace('<expected_revision>',String(rev));
 invoke(p.group.method,args);
 snapshot=read();const next=revision(snapshot);
 if(next!==rev+1n||!snapshot.includes('"' +(p.g.id==='g1'?'base':'g2')+'"')||/accepting\s*=\s*true/.test(snapshot))throw Error('Unexpected registration readback');
 for(const id of Object.values(p.g.canisterIds))if(!snapshot.includes(id))throw Error('Missing registered endpoint '+id);
 rev=next;
}
// Placement requires an independently reviewed deployment revision; do not invent it.
console.log('Both groups registered closed; placement registration remains separate pending reviewed deployment revision.');
