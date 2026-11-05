// Production-only dependencies. The held entry point creates this runtime only
// after its release guard; the shared orchestrator has no default live adapter.
import {readFileSync,writeFileSync,mkdirSync,appendFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {githubJournal} from './prod-base-group.mjs';
import {identityPinEnv} from './prod-safeguard-live-policy.mjs';
import {configuredMainnetPhotoKey} from '../frontend/scripts/media-key-mainnet.mjs';
import {evidenceText} from './prod-connection-check-policy.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function createProductionRuntime(env){
  const require=createRequire(path.join(env.CHECK_DEPS_DIR,'package.json'));
  const sdk={...require('@icp-sdk/core/agent'),...require('@icp-sdk/core/candid'),...require('@icp-sdk/core/principal')};
  return {env,sdk,identities:{...require('@icp-sdk/core/identity'),...require('@icp-sdk/core/identity/secp256k1')},
    ids:JSON.parse(readFileSync(path.join(ROOT,'deploy/prod/.icp/data/mappings/ic.ids.json'),'utf8')),
    readPem:()=>readFileSync(env.CHECK_KEY_PEM,'utf8'),
    journalFor:spec=>githubJournal(env,fetch,spec),
    build:async(name,safeguard,ids)=>{
      execFileSync('icp',['build',name],{cwd:path.join(ROOT,'deploy/prod'),env:{...env,...identityPinEnv(safeguard,ids)},stdio:['ignore','ignore','pipe']});
      return readFileSync(path.join(ROOT,'deploy/prod/.icp/cache/artifacts',name));
    },photoKey:configuredMainnetPhotoKey,
    writeReceipt:r=>{mkdirSync(env.CHECK_REPORT_DIR,{recursive:true});writeFileSync(path.join(env.CHECK_REPORT_DIR,'activation-receipt.json'),evidenceText(r));},
    report:text=>{console.log(text);if(env.GITHUB_STEP_SUMMARY)appendFileSync(env.GITHUB_STEP_SUMMARY,text+'\n');},
  };
}