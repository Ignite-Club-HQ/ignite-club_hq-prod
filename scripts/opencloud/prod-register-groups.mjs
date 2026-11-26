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
// Owner-approved initial deployment revision, independent of router revision.
const deploymentRevision=1n;
function rawRead(){return cli(['canister','call',router,'read_group_registry','("opencloud-prod")','--candid',path.join(root,'backend/shard_router/shard_router.did'),'--network','ic','--identity',identity]);}
function ack(method,args,expected){const out=invoke(method,args);const m=out.match(/Ok\s*=\s*([\d_]+)\s*:\s*nat64/);if(!m||BigInt(m[1].replaceAll('_',''))!==expected)throw Error('Unexpected acknowledgement');}
function verify(expected,count){const out=read();if(revision(out)!==expected||/accepting\s*=\s*true/.test(out))throw Error('Unexpected registry state');for(const p of plans.slice(0,count)){for(const id of Object.values(p.g.canisterIds))if(!out.includes(id))throw Error('Missing endpoint '+id);if(!out.includes('"'+(p.g.id==='g1'?'base':'g2')+'"'))throw Error('Missing group');}if((out.match(/deployment_revision\s*=\s*1\s*:\s*nat64/g)||[]).length!==count)throw Error('Unexpected placement revision');return out;}
const initial=rawRead();console.log(initial);
if(!/Err\s*=\s*"Incomplete group placement registry"/.test(initial))throw Error('Not the reviewed partial registration state; stop');
for(const p of plans)console.log(p.placement.candidArgs.replace('<reviewed_deployment_revision>',String(deploymentRevision)));
if(mode==='check'){console.log('Recovery plan only; exact revision enforced by placement write');process.exit(0);}
function place(p,rev){ack(p.placement.method,p.placement.candidArgs.replace('<reviewed_deployment_revision>',String(deploymentRevision)).replace('<acknowledged_registry_revision>',String(rev)),rev+1n);}
place(plans[0],1n);
verify(2n,1);
ack(plans[1].group.method,plans[1].group.candidArgs.replace('<expected_revision>','2'),3n);
place(plans[1],3n);
verify(4n,2);
console.log('Both groups registered and placed closed at registry revision 4.');
