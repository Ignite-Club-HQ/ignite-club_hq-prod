/**
 * OWNER-GATED, READ-ONLY DEV legacy Group 1 private-name topology check.
 *
 * Reads only consensus router/Identity directory snapshots and the original
 * PII service's PUBLIC verification key. NEVER reads/decrypts a person's PII,
 * changes routing, grants authority, submits canister installs or turns on
 * release flags. This is NOT authorization for user-visible names.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { loadOperatorIdentity } from '../src/live/operatorTransport';
import { readPinnedGroupRegistry } from '../src/live/groupRegistryPager';
import { idlFactory as routerIdl } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';
import type { _SERVICE as RouterService } from '../src/lab/bindings/shard_router/declarations/shard_router.did';
import { idlFactory as identityIdl } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
import type { _SERVICE as IdentityService } from '../src/lab/bindings/identity_access/declarations/identity_access.did';
import { classifyLegacyIdentityDirectoryRevision, inspectLegacyGroup1TeamNameTopology } from '../src/live/crossGroupTeamNameReadiness';
import { GROUP2_GOVERNOR } from '../../scripts/group2-upgrade-rules.mjs';

const [pem, reportDir] = process.argv.slice(2);
if (!pem || !reportDir) throw new Error('Existing governor PEM and report directory required.');
if (process.env.GITHUB_REF !== 'refs/heads/main' ||
    process.env.GITHUB_REPOSITORY !== 'Ignite-Club-HQ/ignite-club_hq-prod') {
  throw new Error('Only the approved main branch of the original repository may read the live Identity directory.');
}
const root = new URL('../../', import.meta.url);
const shared = JSON.parse(readFileSync(new URL('deploy/mainnet/.icp/data/mappings/ic.ids.json', root), 'utf8'));
const group2 = JSON.parse(readFileSync(new URL('deploy/groups/g2/provision.json', root), 'utf8'));
const pins = Object.freeze({
  originalClubDomain: 'mzzzv-taaaa-aaaal-qxlrq-cai',
  originalPiiCanister: 'iui5p-aaaaa-aaaal-qxllq-cai',
  targetClubDomain: 'yfwyv-nyaaa-aaaal-qxpyq-cai',
  targetPiiCanister: 'zt5a6-yiaaa-aaaal-qxp5q-cai',
  sourceGroupId: 'g1', targetGroupId: 'g2',
  routerCanister: 'jcdfe-vqaaa-aaaal-qxloq-cai',
  identityAccess: 'mq2sj-fiaaa-aaaal-qxlqa-cai',
});
if (shared.shard_router !== pins.routerCanister ||
    shared.identity_access !== pins.identityAccess ||
    shared.club_domain !== pins.originalClubDomain ||
    shared.pii_access_control !== pins.originalPiiCanister ||
    group2.canisters.club_domain !== pins.targetClubDomain ||
    group2.canisters.pii_access_control !== pins.targetPiiCanister) {
  throw new Error('Source-controlled DEV original/G2 pins changed. Stop without trusting any new runtime ID.');
}
const operator = loadOperatorIdentity(pem);
if (operator.getPrincipal().toText() !== GROUP2_GOVERNOR) throw new Error('Exact original governor required.');
const agent = await HttpAgent.create({ host: 'https://icp-api.io', identity: operator });
const router = Actor.createActor<RouterService>(routerIdl, {agent, canisterId:pins.routerCanister});
const identity = Actor.createActor<IdentityService>(identityIdl, {agent, canisterId:pins.identityAccess});

const snapshot = await readPinnedGroupRegistry((rev, cursor, limit) =>
  router.read_group_registry_page('mainnet', rev, cursor, limit));
const target = snapshot.placements.find(p=>p.group_id==='g2');
if (!target) throw new Error('Expected registered DEV Group 2 placement missing.');
const binding = {
  targetAlias:'main', registryAlias:'mainnet', deploymentId:target.deployment_id,
  deploymentRevision:target.deployment_revision, host:target.host, networkKind:target.network_kind,
  registryRevision:snapshot.revision,
  requiredClubAuthorities:[pins.targetClubDomain],
};
const first = await identity.read_membership_directory_configuration();
if ('Err' in first) throw new Error('Governor Identity directory read refused: '+first.Err);
// A stale binding cannot be fixed by silently substituting the current router
// revision. Capture only non-sensitive metadata; make two independent reads
// before recording an actionable, explicitly BLOCKED recovery report.
const drift = classifyLegacyIdentityDirectoryRevision(snapshot.revision, first.Ok.binding.registry_revision);
if (drift !== 'matching') {
  const afterSnapshot = await readPinnedGroupRegistry((rev, cursor, limit) =>
    router.read_group_registry_page('mainnet', rev, cursor, limit));
  const afterDirectory = await identity.read_membership_directory_configuration();
  if ('Err' in afterDirectory) throw new Error('Closing Identity directory read refused; no recovery report.');
  const fingerprint = (value: unknown) => JSON.stringify(value, (_, item) =>
    typeof item === 'bigint' ? item.toString() : item instanceof Uint8Array ? Array.from(item) : item);
  if (fingerprint(snapshot) !== fingerprint(afterSnapshot) ||
      fingerprint(first.Ok) !== fingerprint(afterDirectory.Ok)) {
    throw new Error('Identity/router configuration changed during drift check; stop without reporting stale evidence.');
  }
  // Do not publish source principal lists, names, keys, full directory binding,
  // or the signed governor credential; only revision/status facts.
  mkdirSync(resolve(reportDir), {recursive:true});
  writeFileSync(resolve(reportDir,'check.json'), JSON.stringify({
    action:'check', state:'blocked', reason:'identity-directory-registry-revision-drift',
    direction:drift,
    liveRouterRevision:String(snapshot.revision),
    savedIdentityDirectoryRevision:String(first.Ok.binding.registry_revision),
    twoIndependentReadbacksStable:true,
    directoryEnabled:first.Ok.enabled,
    membershipLookupReleased:first.Ok.app_enabled,
    directoryGeneration:String(first.Ok.generation),
    originalPiiKeyVerified:false,
    originalPiiIdentityAllowlistVerified:false,
    teamOnlyNamePermissionVerified:false,
    readyToReleaseName:false,
    nameReadAuthorised:false,
    noWritesAttempted:true,
  },null,2));
  throw new Error(
    'Fenced recovery required: live router revision ' + String(snapshot.revision) +
    ', saved Identity directory revision ' + String(first.Ok.binding.registry_revision) +
    '. Evidence saved; no PII, keys, grants or configurations changed.'
  );
}
const observed = inspectLegacyGroup1TeamNameTopology(snapshot,binding,first.Ok,pins);

// Public canister key, not a vetKey decryption or a name. This fingerprint
// must later be compared against independently approved original-key history.
const keyIdl = () => IDL.Service({
  pii_vetkey_verification_key: IDL.Func([], [IDL.Vec(IDL.Nat8)], []),
});
const publicKeyActor = Actor.createActor<{pii_vetkey_verification_key():Promise<Uint8Array>}>(
  keyIdl, {agent,canisterId:pins.originalPiiCanister});
const publicKey = Uint8Array.from(await publicKeyActor.pii_vetkey_verification_key());
if (publicKey.length !== 96) throw new Error('Original G1 PII public key has unexpected format.');
const originalKeyFingerprint = createHash('sha256').update(publicKey).digest('hex');

// Reconfirm both immutable sources after the public key read and any awaits.
const afterSnapshot = await readPinnedGroupRegistry((rev, cursor, limit) =>
  router.read_group_registry_page('mainnet', rev, cursor, limit));
const afterDir = await identity.read_membership_directory_configuration();
if ('Err' in afterDir) throw new Error('Closing Identity directory read refused.');
const fingerprint = (v:unknown) => JSON.stringify(v,(_,value) =>
  typeof value === 'bigint' ? value.toString() : value instanceof Uint8Array ? Array.from(value) : value);
if (fingerprint(snapshot)!==fingerprint(afterSnapshot) || fingerprint(first.Ok)!==fingerprint(afterDir.Ok)) {
  throw new Error('Routing or Identity directory drifted during read-only preflight.');
}
inspectLegacyGroup1TeamNameTopology(afterSnapshot,binding,afterDir.Ok,pins);
mkdirSync(resolve(reportDir),{recursive:true});
writeFileSync(resolve(reportDir,'check.json'),JSON.stringify({
  action:'check', releaseCommit:process.env.GITHUB_SHA, source:'authenticated existing governor',
  registryRevision:String(snapshot.revision),
  identityDirectoryGeneration:String(first.Ok.generation),
  sources:observed.verifiedSourceMapping ? [
    {group:'g1',clubCanister:pins.originalClubDomain,registration:'legacy identity directory source'},
    {group:'g2',clubCanister:pins.targetClubDomain,registration:'modern router placement'},
  ]:[],
  originalPiiCanister:pins.originalPiiCanister,
  originalPublicKeyFingerprint:originalKeyFingerprint,
  originalKeyMatchesHistoricalBaseline:false,
  originalPiiIdentityAllowlistVerified:false,
  teamOnlyNamePermissionVerified:false,
  readyToReleaseName:false,
  nameReadAuthorised:false,
},null,2));
console.log('Read-only legacy G1 + registered G2 identity-source audit PASSED. Historical PII key and team-name release remain UNVERIFIED and DENIED.');
