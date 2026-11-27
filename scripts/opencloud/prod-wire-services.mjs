import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {validate} from './deployment.mjs';
import {connectionCalls} from './deployment.mjs';
const mode=process.argv[2];
if(!['check','wire'].includes(mode))throw Error('Explicit mode required');
const config=JSON.parse(fs.readFileSync('deploy/opencloud/prod.json'));
const peer=JSON.parse(fs.readFileSync('deploy/opencloud/dev.json'));
if(process.env.GITHUB_REF_NAME!=='prod'||config.environment!=='opencloud-prod'||config.applicationKey!=='ignite_prod_v2'||config.apiHost!=='https://s53an-5aaaa-aaac5-aaaaa-cai.icp.net')throw Error('Wrong PROD target');
const rows=validate({...config,supabase:{...config.supabase,publishableKey:config.supabase.publishableKey||'sb_publishable_OFFLINE_INSTALL_VALIDATION'}},peer);
const root=process.cwd(), cwd=process.env.RUNNER_TEMP;
const calls=connectionCalls(config);
const allowed=new Set(rows.filter(r=>r.service!=='frontend').map(r=>r.id));
for(const c of calls){
 if(!allowed.has(c.target)||c.signer!=='internal-governor')throw Error('Unexpected target');
 for(const match of c.candidArgs.matchAll(/principal "([^"]+)"/g))if(!allowed.has(match[1]))throw Error('Unexpected linked principal');
}
function cli(args){const r=spawnSync('icp',args,{cwd,encoding:'utf8',maxBuffer:4*1024*1024});if(r.status!==0)throw Error('CLI failed: '+r.stderr);return r.stdout;}
const identity='opencloud-governor';
if(cli(['identity','principal','--identity',identity]).trim()!==config.controllers.governor)throw Error('Wrong governor');
function invoke(c,method,args){
 const row=rows.find(r=>r.id===c.target);
 const did=path.join(root,'backend',row.service,row.service+'.did');
 return cli(['canister','call',c.target,method,args,'--candid',did,'--network','ic','--identity',identity]);
}
const unique=[...new Map(calls.map(c=>[c.target,c])).values()];
for(const c of unique){const out=invoke(c,'read_group_opening_configuration','()');if(c.service.endsWith('_timer_jobs') && /Timer queue is not initialized|Governor required/.test(out)){console.log(c.service+' governor readback unavailable; controller-only initialize must succeed before wiring continues');continue;}if(/\bErr\b/.test(out)||!out.trim())throw Error('Readback refused '+c.service+': '+out);console.log(c.service+' readback: '+out);}
console.log('Validated '+calls.length+' wiring calls');
if(mode==='check')process.exit(0);
for(const c of [...calls.filter(c=>c.method==='initialize'),...calls.filter(c=>c.method!=='initialize')]){
 console.log('Applying '+c.service+'.'+c.method);
 const out=invoke(c,c.method,c.candidArgs);
 if(/\bErr\b|\berr\b/.test(out)||!out.trim())throw Error('Uncertain reply: '+out);
 console.log(out);
 const read=invoke(c,'read_group_opening_configuration','()');
 if(/\bErr\b/.test(read)||!read.trim())throw Error('Readback refused '+c.service);
 console.log('Readback: '+read);
}
console.log('Wiring calls completed; review readbacks before registering groups. Do not blindly replay.');
