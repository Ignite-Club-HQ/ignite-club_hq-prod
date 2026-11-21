/** Governor-signed, read-only diagnosis of Group 2 account admission.
 * This does not open/close a group, authorise any reader, or install anything.
 * Usage: tsx scripts/check-group2-admission.ts <existing-governor.pem> <report.json>
 */
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { loadOperatorIdentity } from '../src/live/operatorTransport';
import { ADMISSION_DOMAINS } from '../src/live/groupRemovalWiring';

const [pem, out] = process.argv.slice(2);
if (!pem || !out) throw new Error('Usage: check-group2-admission <governor.pem> <report.json>');
const GOVERNOR = 'vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae';
const approval = JSON.parse(readFileSync(new URL('../../deploy/groups/g2/general-opening.json', import.meta.url), 'utf8'));
const ids = JSON.parse(readFileSync(new URL('../../deploy/mainnet/.icp/data/mappings/ic.ids.json', import.meta.url), 'utf8'));
if (approval.governor !== GOVERNOR || approval.identityAccess !== ids.identity_access ||
    approval.routerId !== ids.shard_router || approval.targetAlias !== 'mainnet' ||
    approval.deploymentId !== 'mainnet') throw new Error('Existing mainnet governor and shared canister pins required');
const targets = [...ADMISSION_DOMAINS, 'media_blob_store'].map(name => {
  const service = approval.services?.find((s: {name: string}) => s.name === name);
  if (!service?.canisterId) throw new Error(`Approved Group 2 service missing: ${name}`);
  return { name, canisterId: service.canisterId as string };
});
if (targets.length !== 12 || new Set(targets.map(t => t.canisterId)).size !== 12) {
  throw new Error('Exactly 12 distinct approved Group 2 admission readers required');
}
const identity = loadOperatorIdentity(pem);
if (identity.getPrincipal().toText() !== GOVERNOR) throw new Error('Existing governor required');
const agent = await HttpAgent.create({ host: 'https://icp-api.io', identity });
const pairs = IDL.Vec(IDL.Tuple(IDL.Text, IDL.Text));
const actor = Actor.createActor(() => IDL.Service({
  read_group_opening_configuration: IDL.Func([], [IDL.Variant({ Ok: pairs, Err: IDL.Text })], []),
}), { agent, canisterId: Principal.fromText(ids.identity_access) }) as unknown as {
  read_group_opening_configuration(): Promise<{Ok: [string,string][]}|{Err: string}>;
};
const reply = await actor.read_group_opening_configuration();
if ('Err' in reply) throw new Error(`Shared identity configuration refused: ${reply.Err}`);
const rows = reply.Ok;
const releaseRows = rows.filter(([key]) => key === 'account_admission_released');
const releaseValue = releaseRows.length === 1 ? releaseRows[0][1] : null;
const authorised = new Set(rows.filter(([key]) => key === 'eligibility_authority').map(([,id]) => id));
const missingReaders = targets.filter(t => !authorised.has(t.canisterId));
const report = {
  checkedAt: new Date().toISOString(),
  environment: 'Ignite DEV/mainnet',
  identityAccess: ids.identity_access,
  group: 'g2',
  accountAdmissionReleased: releaseValue === 'true',
  accountAdmissionRawValue: releaseValue,
  approvedReaders: targets.length,
  authorisedReaders: targets.length - missingReaders.length,
  all12ReadersAuthorised: missingReaders.length === 0,
  missingReaders,
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
console.log('Read-only governor-signed Group 2 account admission report:');
console.log(JSON.stringify(report, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `## Group 2 account admission (read-only)\n\n` +
    `- Admission released: **${report.accountAdmissionRawValue ?? 'missing/ambiguous'}**\n` +
    `- Group 2 eligibility readers authorised: **${report.authorisedReaders}/12**\n` +
    `- Missing readers: **${missingReaders.map(t => t.name).join(', ') || 'none'}**\n\n`);
}
