import { wasmHash } from './group2-upgrade-rules.mjs';
import { FIRST_CONTENT_DEV as pins } from './dev-first-content-stage-policy.mjs';

/** Validate the *bytes*, never a claim in a log or a historical module hash.
 * Only both exact historic modules qualify for a controlled rollback bundle.
 */
export function verifyExactPreviousWasms({identity_access,club_domain}) {
  const inputs={identity_access,club_domain};
  const expected=[pins.identity,pins.club];
  const verified=[];
  for (const service of expected) {
    const value=inputs[service.name];
    if(!(value instanceof Uint8Array)||!value.length)
      throw Error('Missing actual archived old Wasm bytes: '+service.name);
    const hash=wasmHash(Buffer.from(value));
    if(hash!==service.old)throw Error('Archived prior Wasm differs from live installed module: '+service.name);
    verified.push({name:service.name,canisterId:service.id,sha256:hash,bytes:value.length});
  }
  return {verified,identityHash:pins.identity.old,clubHash:pins.club.old};
}
export function assertRecoveryRunMetadata(run,repo='Ignite-Club-HQ/ignite-club_hq-prod') {
  if(!run || run.repository?.full_name!==repo ||
     run.path!=='.github/workflows/dev-first-content-recovery-artifacts.yml' ||
     run.event!=='workflow_dispatch'||run.conclusion!=='success'||
     run.status!=='completed'||run.head_branch!=='main'||
     !/^[a-f0-9]{40}$/.test(run.head_sha??''))
    throw Error('Recovery bundle must originate from successful, manually reviewed DEV recovery workflow on main');
  return {runId:run.id,headSha:run.head_sha};
}
