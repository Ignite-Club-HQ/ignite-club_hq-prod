import {commissioning} from './deployment.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { identityFromPem } from '../prod-connection-check.mjs';
import { guard, activation, MANAGEMENT_PROXY } from './dev-auto.mjs';
const mode=process.argv[2];
if (mode !== 'publish') throw Error('Explicit mode required');
const config = JSON.parse(fs.readFileSync('deploy/opencloud/dev.json'));
const peer = JSON.parse(fs.readFileSync('deploy/opencloud/prod.json'));
const rows = guard({config,peer,branch:process.env.GITHUB_REF_NAME});
if (activation(config).autoDeploy || activation(config).lovableRouting) throw Error('Activation must remain off');
const require = createRequire(path.resolve('frontend/package.json'));
const {HttpAgent,Actor}=require('@icp-sdk/core/agent');
const {IDL:I}=require('@icp-sdk/core/candid');
const {Principal}=require('@icp-sdk/core/principal');
const {Ed25519KeyIdentity}=require('@icp-sdk/core/identity');
const {Secp256k1KeyIdentity}=require('@icp-sdk/core/identity/secp256k1');
const identity=identityFromPem(fs.readFileSync(process.env.GOVERNOR_PEM_FILE,'utf8'),{Ed25519KeyIdentity,Secp256k1KeyIdentity});
if(identity.getPrincipal().toText()!==config.controllers.governor) throw Error('Wrong governor');
const agent=await HttpAgent.create({host:config.apiHost,identity,shouldFetchRootKey:false});
const ids=['him2v-zqaaa-aaac5-aadta-cai','ed2mw-7iaaa-aaac5-aadzq-cai'];
const release='2026-11-13', key='legal_document_release';
if(config.environment!=='opencloud-dev'||JSON.stringify(config.groups.map(g=>g.canisterIds.club_domain))!==JSON.stringify(ids))throw Error('Wrong DEV targets');
const actors=ids.map(canisterId=>Actor.createActor(()=>I.Service({get_app_config:I.Func([I.Text],[I.Opt(I.Text)],['query']),set_app_config:I.Func([I.Text,I.Text],[I.Variant({Ok:I.Null,Err:I.Text})],[])}),{agent,canisterId}));
for(const a of actors){const old=await a.get_app_config(key);if(old.length&&old[0]!==release)throw Error('Existing different release');}
for(const a of actors){const old=await a.get_app_config(key);if(!old.length){const result=await a.set_app_config(key,release);if(!('Ok' in result))throw Error(result.Err);}const after=await a.get_app_config(key);if(after.length!==1||after[0]!==release)throw Error('Readback failed');console.log('Verified '+release);}
