import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { identityFromPem } from './prod-connection-check.mjs';
import { assertCheckContext, evidenceText } from './prod-connection-check-policy.mjs';
import { githubJournal, saveBaseFailure } from './prod-base-group.mjs';
import { groupContract } from './prod-group-contract.mjs';
import { buildProdG2Plan, g2PlanSummary } from './prod-g2-plan-policy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function runProdG2Plan({ ids, env, principal, loadReceipt, readRegistry, readCertified, readBalance, save }) {
  // Authorize context before invoking any injected reader. All readers are
  // infrastructure-only; no writer, CLI or paid order adapter exists here.
  assertCheckContext(ids, env, principal);
  const receipt = await loadReceipt();
  if (receipt?.phase !== 'registered-closed' || receipt.pending !== null) throw new Error('Confirmed closed base receipt required');
  const page = await readRegistry();
  const observations = [];
  for (const name of Object.keys(ids).sort()) observations.push(await readCertified(name, ids[name]));
  const balance = await readBalance(principal);
  const plan = buildProdG2Plan({ ids, env, principal, receipt, page, observations, balance, checkedAt: new Date().toISOString() });
  await save(plan);
  return plan;
}

async function main() {
  const env = process.env;
  const ids = JSON.parse(readFileSync(path.join(ROOT, 'deploy/prod/.icp/data/mappings/ic.ids.json'), 'utf8'));
  const require = createRequire(path.join(env.CHECK_DEPS_DIR, 'package.json'));
  const { HttpAgent, Actor, CanisterStatus } = require('@icp-sdk/core/agent');
  const { IDL } = require('@icp-sdk/core/candid');
  const { Principal } = require('@icp-sdk/core/principal');
  const { Ed25519KeyIdentity } = require('@icp-sdk/core/identity');
  const { Secp256k1KeyIdentity } = require('@icp-sdk/core/identity/secp256k1');
  const identity = identityFromPem(readFileSync(env.CHECK_KEY_PEM, 'utf8'), { Ed25519KeyIdentity, Secp256k1KeyIdentity });
  const principal = identity.getPrincipal().toText();
  assertCheckContext(ids, env, principal);
  const agent = await HttpAgent.create({ host: 'https://icp-api.io', identity });
  const router = Actor.createActor(groupContract(IDL).reader, { agent, canisterId: ids.shard_router });
  // Exact Cycles Ledger read-only ICRC account query, default subaccount only.
  const ledger = Actor.createActor(() => IDL.Service({ icrc1_balance_of: IDL.Func([
    IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) })], [IDL.Nat], ['query']) }),
    { agent, canisterId: 'um5iw-rqaaa-aaaaq-qaaba-cai' });
  const journal = githubJournal(env);
  mkdirSync(env.CHECK_REPORT_DIR, { recursive: true });
  const plan = await runProdG2Plan({ ids, env, principal, loadReceipt: () => journal.load({ readOnly: true }),
    readRegistry: async () => {
      const r = await router.read_group_registry_page('mainnet', [], [], 64);
      if (!r.Ok) throw new Error('Complete base-only registry required; existing or unknown g2 needs separate review');
      return JSON.parse(evidenceText(r.Ok));
    },
    readCertified: async (name, id) => {
      const s = await CanisterStatus.request({ agent, canisterId: Principal.fromText(id), paths: ['controllers', 'module_hash', 'subnet'] });
      const module = s.get('module_hash');
      return { name, id, moduleHash: typeof module === 'string' ? module : Buffer.from(module ?? []).toString('hex'),
        controllers: (s.get('controllers') ?? []).map(p => p.toText()), subnet: s.get('subnet')?.subnetId };
    },
    readBalance: owner => ledger.icrc1_balance_of({ owner: Principal.fromText(owner), subaccount: [] }),
    save: p => writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-g2-plan.json'), evidenceText(p)),
  });
  const summary = g2PlanSummary(plan);
  console.log(summary);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  // Never publish raw SDK/GitHub failures or credentials.
  saveBaseFailure(process.env, error, 'read-only PROD g2 proposal (no mutations)');
  process.exitCode = 1;
});