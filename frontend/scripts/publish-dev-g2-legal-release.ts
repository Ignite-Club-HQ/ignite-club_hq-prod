/** Publish only the owner-approved initial signup Terms/Privacy release to DEV Group 2.
 * Group 1 was separately corrected via Paul's signed app-admin account.
 * No canister upgrade, global reacceptance, registration, consent, or PROD access.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { loadOperatorIdentity, createOperatorTransport } from '../src/live/operatorTransport';
import { loadIds, assertIsolated } from '../../scripts/icp-environments.mjs';
import {
  DEV_LEGAL, checkDevLegalContext, checkDevLegalInventory,
  planDevLegalRelease, assertDevLegalGovernor
} from '../../scripts/dev-legal-release-policy.mjs';

const [pem, output] = process.argv.slice(2);
if (!pem || !output) throw Error('Governor key file and report path required');
const action = checkDevLegalContext(process.env);
const shared = loadIds('dev');
const provision = JSON.parse(readFileSync(new URL('../../deploy/groups/g2/provision.json', import.meta.url), 'utf8'));
const prodIds = loadIds('prod');
assertIsolated('dev', shared, prodIds);
checkDevLegalInventory(shared.club_domain, provision.canisters?.club_domain, prodIds);
if (provision.groupId !== 'g2' || provision.deploymentId !== 'mainnet' ||
    shared.identity_access !== 'mq2sj-fiaaa-aaaal-qxlqa-cai') {
  throw Error('Reviewed DEV Group 2 placement and shared identity required');
}

const identity = loadOperatorIdentity(pem);
assertDevLegalGovernor(identity.getPrincipal().toText());
const host = 'https://icp-api.io';
const operator = await createOperatorTransport({ host, identity, idls: new Map() });
// The signed operator must actually control the pinned target canister.
await operator.verifyGovernor(DEV_LEGAL.group2, DEV_LEGAL.governor);
const agent = await HttpAgent.create({ host, identity, retryTimes: 0 });
const idlFactory = ({ IDL: idl }: { IDL: typeof IDL }) => idl.Service({
  get_app_config: idl.Func([idl.Text], [idl.Opt(idl.Text)], ['query']),
  set_app_config: idl.Func(
    [idl.Text, idl.Text],
    [idl.Variant({ Ok: idl.Null, Err: idl.Text })],
    [],
  ),
});
type SettingsActor = {
  get_app_config: (key: string) => Promise<[] | [string]>;
  set_app_config: (key: string, value: string) => Promise<{ Ok: null } | { Err: string }>;
};
const group1 = Actor.createActor(idlFactory, { agent, canisterId: DEV_LEGAL.group1 }) as unknown as SettingsActor;
const group2 = Actor.createActor(idlFactory, { agent, canisterId: DEV_LEGAL.group2 }) as unknown as SettingsActor;
const read = async (a: SettingsActor): Promise<string | null> =>
  (await a.get_app_config(DEV_LEGAL.key))[0] ?? null;

const before1 = await read(group1);
const before2 = await read(group2);
const plan = planDevLegalRelease(before1, before2);
// This report contains only the approved public release identifier and fixed DEV IDs.
const evidence = {
  scope: 'DEV g2 legal_document_release only',
  commit: process.env.GITHUB_SHA,
  observedAt: new Date().toISOString(),
  action,
  version: DEV_LEGAL.release,
  group1: { canisterId: DEV_LEGAL.group1, initial: before1 },
  group2: { canisterId: DEV_LEGAL.group2, initial: before2 },
  plan,
  writeAttempted: false,
  verified: false,
};
writeFileSync(output, JSON.stringify(evidence, null, 2));

if (action === 'publish' && plan === 'write-group2-once') {
  evidence.writeAttempted = true;
  writeFileSync(output, JSON.stringify(evidence, null, 2));
  // Exactly one write. On uncertainty, stop and rerun the *check* action first.
  const result = await group2.set_app_config(DEV_LEGAL.key, DEV_LEGAL.release);
  if ('Err' in result) throw Error('DEV Group 2 governor refused legal-release publication');
}
const after1 = await read(group1);
const after2 = await read(group2);
if (after1 !== DEV_LEGAL.release) throw Error('Group 1 approved release changed during DEV publication');
if (action === 'publish' && after2 !== DEV_LEGAL.release)
  throw Error('Group 2 legal-release confirmation missing; inspect fresh read before any retry');
if (action === 'check' && after2 !== before2)
  throw Error('Group 2 changed during read-only check; rerun check');
evidence.group1 = { canisterId: DEV_LEGAL.group1, initial: before1, verified: after1 };
evidence.group2 = { canisterId: DEV_LEGAL.group2, initial: before2, verified: after2 };
evidence.verified = action === 'publish'
  ? after2 === DEV_LEGAL.release
  : after2 === null || after2 === DEV_LEGAL.release;
writeFileSync(output, JSON.stringify(evidence, null, 2));
console.log(action === 'check'
  ? 'Read-only DEV legal release preflight passed. No changes were made.'
  : 'DEV Group 2 release 2026-11-13 independently read back. No PROD/consent changes.');
