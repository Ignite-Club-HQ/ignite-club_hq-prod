import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {validate} from './deployment.mjs';

const mode=process.argv[2];
if(!['check','commission'].includes(mode))throw Error('Explicit mode required');
const config=JSON.parse(fs.readFileSync('deploy/opencloud/prod.json'));
const peer=JSON.parse(fs.readFileSync('deploy/opencloud/dev.json'));
if(process.env.GITHUB_REF_NAME!=='prod'||config.environment!=='opencloud-prod'||config.applicationKey!=='ignite_prod_v2'||config.apiHost!=='https://s53an-5aaaa-aaac5-aaaaa-cai.icp.net')throw Error('Wrong PROD target');
const rows=validate({...config,supabase:{...config.supabase,publishableKey:config.supabase.publishableKey||'sb_publishable_OFFLINE_INSTALL_VALIDATION'}},peer);
const root=process.cwd(), cwd=process.env.RUNNER_TEMP;
const router=config.shared.shard_router;
if(router!=='fwgn7-saaaa-aaac5-aaebq-cai'||config.groups.map(g=>g.id).join(',')!=='g1,g2')throw Error('Unexpected router or groups');
const identity='opencloud-governor';
function cli(args){const r=spawnSync('icp',args,{cwd,encoding:'utf8',maxBuffer:4*1024*1024});if(r.status!==0)throw Error('CLI failed: '+r.stderr);return r.stdout;}
if(cli(['identity','principal','--identity',identity]).trim()!==config.controllers.governor)throw Error('Wrong governor');
function call(target,service,method,args){const out=cli(['canister','call',target,method,args,'--candid',path.join(root,'backend',service,service+'.did'),'--network','ic','--identity',identity]);console.log(method+': '+out);if(!/\bOk\b/.test(out)||/\bErr\b/.test(out))throw Error('Refused '+method);return out;}
const id=config.shared.identity_access;
const snapshot=call(router,'shard_router','read_group_registry','("opencloud-prod")');
if(!/\brevision\s*=\s*4\s*:\s*nat64/.test(snapshot)||/accepting\s*=\s*true/.test(snapshot)||(snapshot.match(/accepting\s*=\s*false/g)||[]).length!==2)throw Error('Unexpected registry');
for(const g of config.groups)for(const endpoint of Object.values(g.canisterIds))if(!snapshot.includes(endpoint))throw Error('Missing endpoint');
call(id,'identity_access','read_production_account_history_revision','()');
call(id,'identity_access','read_production_account_authorization','()');
if(mode==='commission'){call(router,'shard_router','set_deletion_authority','(principal "'+id+'")');call(router,'shard_router','read_group_registry','("opencloud-prod")');}
console.log('Registry and identity state inspected; signed inventory approval remains required.');
