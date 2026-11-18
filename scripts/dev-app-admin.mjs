import { readFileSync, appendFileSync } from 'node:fs';
import { createPrivateKey } from 'node:crypto';
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { Ed25519KeyIdentity } from '@icp-sdk/core/identity';
import { Secp256k1KeyIdentity } from '@icp-sdk/core/identity/secp256k1';
import { assertDevAdminContext, selectExactAdminAccount } from './dev-app-admin-policy.mjs';

let stage = 'reading settings';
class Refusal extends Error {}
async function main() {
  const env = process.env;
  const principal = Principal.fromText(env.ONLY_PRINCIPAL || '').toText();
  const ids = JSON.parse(readFileSync(env.IDS_FILE, 'utf8'));
  const pem = env.DEPLOYER_PEM.replace(/\r/g, '').replace(/\\n/g, '\n');
  const jwk = createPrivateKey(pem).export({ format: 'jwk' });
  const secret = new Uint8Array(Buffer.from(jwk.d, 'base64url'));
  const identity = jwk.kty === 'OKP' && jwk.crv === 'Ed25519' ? Ed25519KeyIdentity.fromSecretKey(secret)
    : jwk.kty === 'EC' && jwk.crv === 'secp256k1' ? Secp256k1KeyIdentity.fromSecretKey(secret) : null;
  if (!identity) throw Error('Unsupported key');
  stage = 'checking DEV context';
  assertDevAdminContext(env, ids, identity.getPrincipal().toText());
  const agent = await HttpAgent.create({ host: 'https://icp-api.io', identity });
  const actors = {};
  for (const name of ['identity_access', 'club_domain', 'insights_domain', 'messaging_domain']) {
    const { idlFactory } = await import(`./${name}.did.js`);
    actors[name] = Actor.createActor(idlFactory, { agent, canisterId: ids[name] });
  }
  const unwrap = result => {
    if (!('Ok' in result)) throw new Refusal(String(result.Err).slice(0, 200));
    return result.Ok;
  };
  const readAccount = async () => {
    const rows = [];
    let after = [];
    for (let i = 0; i < 50; i += 1) {
      const page = unwrap(await actors.identity_access.list_admin_accounts(principal, after, 100));
      rows.push(...page.items);
      if (!page.next.length) return selectExactAdminAccount(rows, principal);
      after = page.next;
    }
    throw Error('Account search incomplete');
  };
  stage = 'finding the account';
  const account = await readAccount();
  console.log(`Verified active DEV account ${account.account_id} for ${principal}`);
  const p = Principal.fromText(principal);
  const scope = '966bdaec-ebf1-46da-b2b3-cc53bf05c422';
  stage = 'granting on club service';
  unwrap(await actors.club_domain.add_role_grant(p, scope, 'app_admin', []));
  stage = 'granting on insights service';
  unwrap(await actors.insights_domain.grant_app_admin(p));
  stage = 'granting on messaging service';
  unwrap(await actors.messaging_domain.grant_role(p, 'app_admin', [], []));
  stage = 'granting on identity service';
  if (!account.roles.some(r => r.role === 'app_admin' && !r.club.length && !r.team.length)) {
    unwrap(await actors.identity_access.grant_role(account.account_id, 'app_admin', [], []));
  }
  stage = 'verifying';
  const verified = await readAccount();
  const clubAdmin = await actors.club_domain.read_account_is_app_admin(p);
  const insightsAdmins = unwrap(await actors.insights_domain.read_account_list_app_admins());
  if (!verified.roles.some(r => r.role === 'app_admin' && !r.club.length && !r.team.length)
    || !clubAdmin || !insightsAdmins.some(x => x.toText() === principal)) throw Error('Admin readback incomplete');
  const message = `DEV app-admin access verified for ${principal}. No identities, memberships or PROD data moved.`;
  console.log(message);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${message}\n`);
}
main().catch(error => {
  const detail = error instanceof Refusal ? `DEV refused: ${error.message}`
    : /^(Unsupported key|Exactly one|Account search|Admin readback|DEV )/.test(error?.message || '') ? error.message : 'connection or call failed';
  console.error(`Stopped while ${stage}: ${detail}`);
  console.error('DEV admin grant stopped. Check the exact account and any completed grants before retrying; nothing is replayed automatically.');
  process.exitCode = 1;
});