/** Anonymous read-only diagnostics. Never relay vetKD, mutate settings or fund anything. */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { ROOT } from './deployment.mjs';
const require = createRequire(path.join(ROOT, 'frontend/package.json'));
const { HttpAgent, Actor, fetchCandid } = require('@icp-sdk/core/agent');
export async function verifyProxy(config) {
  if (!config.consoleProxyId || config.consoleProxyId === config.operatorId) throw Error('Separate console chain-key proxy required');
  const agent = HttpAgent.createSync({ host: 'https://icp-api.io', shouldFetchRootKey: false, shouldVerifyQuerySignatures: true });
  const candid = await fetchCandid(config.consoleProxyId, agent);
  const expected = readFileSync(path.join(ROOT, 'deploy/opencloud/proxy-interface.did'), 'utf8');
  const fingerprint = text => createHash('sha256').update(text).digest('hex');
  const report = { kind: 'anonymous-opencloud-proxy-review/v1', observedAt: new Date().toISOString(),
    proxyId: config.consoleProxyId, expectedSubnet: config.subnetId, interfaceSha256: fingerprint(candid),
    interfaceMatchesReviewedSnapshot: fingerprint(candid) === fingerprint(expected),
    paidDerivations: false, changedConfiguration: false, liveEncryptionAcceptance: false, releaseAuthorized: false };
  const actor = Actor.createActor(({ IDL }) => {
    const funding = IDL.Record({ engine_canister: IDL.Principal, engine_id: IDL.Text, proxy_id: IDL.Text, low_threshold: IDL.Nat });
    const topup = IDL.Record({ at: IDL.Nat64, outcome: IDL.Variant({ Ok: IDL.Nat, Err: IDL.Text }) });
    return IDL.Service({
      get_allowed_subnet: IDL.Func([], [IDL.Opt(IDL.Principal)], ['query']),
      get_funding: IDL.Func([], [IDL.Record({ funding: IDL.Opt(funding), balance: IDL.Nat, last_top_up: IDL.Opt(topup) })], ['query']),
    });
  }, { agent, canisterId: config.consoleProxyId });
  const subnet = await actor.get_allowed_subnet();
  const funding = await actor.get_funding();
  return { ...report, reportedSubnet: subnet[0]?.toText() ?? null, subnetMatches: subnet[0]?.toText() === config.subnetId,
    reportedEngineId: funding.funding[0]?.engine_id ?? null,
    engineMatches: funding.funding[0]?.engine_id === config.engineId,
    reportedBalance: funding.balance.toString(), fundingConfigured: funding.funding.length === 1 };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [, , input, output] = process.argv;
  if (!input || !output) throw Error('Usage: verify-proxy.mjs <config.json> <report.json>');
  const report = await verifyProxy(JSON.parse(readFileSync(input, 'utf8')));
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  if (!report.interfaceMatchesReviewedSnapshot || !report.subnetMatches || !report.engineMatches || !report.fundingConfigured) {
    throw Error('Proxy review incomplete or changed. No key derivation or release authorized.');
  }
  console.log('Anonymous proxy interface, subnet and funding bindings match; live encryption acceptance still required.');
}