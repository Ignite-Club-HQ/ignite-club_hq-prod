import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {guard,activation} from './dev-auto.mjs';
import {registerGroupCall,registerGroupPlacementCall} from './deployment.mjs';
const mode=process.argv[2];
if(!['check','register'].includes(mode))throw Error('Explicit mode required');
const config=JSON.parse(fs.readFileSync('deploy/opencloud/dev.json'));
const peer=JSON.parse(fs.readFileSync('deploy/opencloud/prod.json'));
const rows=guard({config,peer,branch:process.env.GITHUB_REF_NAME});
if(activation(config).autoDeploy||activation(config).lovableRouting)throw Error('Activation must remain off');
const root=process.cwd(), cwd=process.env.RUNNER_TEMP;
const router=config.shared.shard_router;
if(router!=='htjgq-diaaa-aaac5-aadrq-cai'||config.groups.length!==2)throw Error('Unexpected DEV router');
function cli(args){const r=spawnSync('icp',args,{cwd,encoding:'utf8',maxBuffer:4*1024*1024});if(r.status!==0)throw Error('CLI failed: '+r.stderr);return r.stdout;}
const identity='opencloud-governor';
if(cli(['identity','principal','--identity',identity]).trim()!==config.controllers.governor)throw Error('Wrong governor');
function invoke(c,method,args){
 const row=rows.find(r=>r.id===c.target);
 const did=path.join(root,'backend',row.service,row.service+'.did');
 return cli(['canister','call',c.target,method,args,'--candid',did,'--network','ic','--identity',identity]);
}

const target={target:router};
const call=(method,args)=>{const out=invoke(target,method,args);if(/\bErr\b/.test(out)||!out.trim())throw Error(method+' refused: '+out);console.log(method+': '+out);return out;};
const revision=()=>{const out=call('version','()');const m=out.match(/^\s*\(\s*([\d_]+)\s*:\s*nat64\s*,?\s*\)\s*$/);if(!m)throw Error('Unrecognized revision');return BigInt(m[1].replaceAll('_',''));};
const initial=call('list_groups','()');
const first=revision();
const empty=/variant\s*\{\s*Ok\s*=\s*vec\s*\{\s*\}\s*\}/.test(initial);
let resume=false;
let deploymentRevision=first+1n;
if(!empty){
 if(first!==2n)throw Error('Unexpected partial registry revision');
 const snapshot=call('read_group_registry_page','("opencloud-dev", opt (2 : nat64), null, 64 : nat32)');
 const g=config.groups[0];
 if(!/id\s*=\s*"base"/.test(snapshot)||/id\s*=\s*"g2"/.test(snapshot)||!/accepting\s*=\s*false/.test(snapshot)||!/deployment_revision\s*=\s*1\s*:\s*nat64/.test(snapshot)||!Object.values(g.canisterIds).every(id=>snapshot.includes(id))||!snapshot.includes(config.subnetId)||!snapshot.includes(config.apiHost))throw Error('Unexpected existing group or placement');
 resume=true;deploymentRevision=1n;
}
const plan=config.groups.map(g=>({group:registerGroupCall(config,g),placement:registerGroupPlacementCall(config,g)}));
if(plan.some(p=>!p.group.ready))throw Error('Missing capacity configuration');
console.log('Reviewed initial logical deployment revision: '+deploymentRevision);
if(mode==='check')process.exit(0);
let rev=first;
for(const p of (resume?plan.slice(1):plan)){
 for(const c of [p.group,p.placement]){
  if(revision()!==rev)throw Error('Concurrent registry change');
  const args=c.candidArgs.replace('<expected_revision>',String(rev)).replace('<acknowledged_registry_revision>',String(rev)).replace('<reviewed_deployment_revision>',String(deploymentRevision));
  const out=call(c.method,args);
  const match=out.match(/Ok\s*=\s*([\d_]+)\s*:\s*nat64/);
  if(!match||BigInt(match[1].replaceAll('_',''))!==rev+1n)throw Error('Unexpected write revision; inspect before retry');
  rev+=1n;
 }
 call('read_group_registry_page','("opencloud-dev", opt ('+rev+' : nat64), null, 64 : nat32)');
}
console.log('Both closed groups and placements registered at revision '+rev);
