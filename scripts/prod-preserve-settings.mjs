// Keeps live service settings (switches set outside the code) across merge
// upgrades. `save NAME` records the live settings before upgrading;
// `restore NAME` puts back anything the upgrade removed or changed and prints
// "restored" (caller must restart the service on its code) or "same".
// Setting values are never printed.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { identityFromPem } from './prod-connection-check.mjs';
import { restoredSettings } from './prod-preserve-settings-policy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [action, name] = process.argv.slice(2);
const env = process.env;
if (!['save', 'restore'].includes(action) || !/^[a-z_]+$/.test(name ?? '')) throw new Error('Usage: save|restore NAME');
const ids = JSON.parse(readFileSync(path.join(ROOT, 'deploy/prod/.icp/data/mappings/ic.ids.json'), 'utf8'));
const id = ids[name];
if (!id) throw new Error(`Unknown PROD service ${name}`);
const require = createRequire(path.join(env.PRESERVE_DEPS_DIR, 'package.json'));
const { HttpAgent, Actor } = require('@icp-sdk/core/agent');
const { IDL } = require('@icp-sdk/core/candid');
const { Principal } = require('@icp-sdk/core/principal');
const { Ed25519KeyIdentity } = require('@icp-sdk/core/identity');
const { Secp256k1KeyIdentity } = require('@icp-sdk/core/identity/secp256k1');
const identity = identityFromPem(readFileSync(env.DEPLOYER_PEM_FILE, 'utf8'), { Ed25519KeyIdentity, Secp256k1KeyIdentity });
const agent = await HttpAgent.create({ host: 'https://icp-api.io', identity });
const Env = IDL.Vec(IDL.Record({ name: IDL.Text, value: IDL.Text }));
const mgmt = Actor.createActor(() => IDL.Service({
  canister_status: IDL.Func([IDL.Record({ canister_id: IDL.Principal })], [IDL.Record({
    settings: IDL.Record({ environment_variables: IDL.Opt(Env) }) })], []),
  update_settings: IDL.Func([IDL.Record({ canister_id: IDL.Principal,
    settings: IDL.Record({ environment_variables: IDL.Opt(Env) }) })], [], []),
}), { agent, canisterId: 'aaaaa-aa', effectiveCanisterId: Principal.fromText(id) });
const read = async () => {
  const rows = (await mgmt.canister_status({ canister_id: Principal.fromText(id) })).settings.environment_variables;
  const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : Array.isArray(rows) ? rows : [];
  return list.map(({ name, value }) => ({ name, value }));
};
const dir = path.join(env.RUNNER_TEMP ?? '/tmp', 'prod-preserved-settings');
const file = path.join(dir, `${name}.json`);

if (action === 'save') {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(await read()), { mode: 0o600 });
  console.log('saved');
} else {
  const before = JSON.parse(readFileSync(file, 'utf8'));
  const { next, changed } = restoredSettings(before, await read());
  if (!changed) { console.log('same'); process.exit(0); }
  await mgmt.update_settings({ canister_id: Principal.fromText(id), settings: { environment_variables: [next] } });
  if (restoredSettings(next, await read()).changed) throw new Error(`${name} settings readback failed after restore`);
  console.log('restored');
}
