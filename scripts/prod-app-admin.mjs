import { readFileSync, appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { identityFromPem } from './prod-connection-check.mjs';
import { assertGovernor } from './icp-environments.mjs';
import { ADMIN_TARGETS, APP_ADMIN_SCOPE, PAUL_PROD_PRINCIPAL, alignAdmin } from './prod-app-admin-policy.mjs';

async function main() {
  const env = process.env;
  if (env.GITHUB_REPOSITORY !== 'Ignite-Club-HQ/ignite-club_hq-prod' || !['refs/heads/main', 'refs/heads/prod'].includes(env.GITHUB_REF) || env.IGNITE_ICP_ENV !== 'prod') throw Error('Production operator context required');
  const require = createRequire(path.join(env.CHECK_DEPS_DIR, 'package.json'));
  const { Actor, HttpAgent } = require('@icp-sdk/core/agent');
  const { IDL } = require('@icp-sdk/core/candid');
  const { Principal } = require('@icp-sdk/core/principal');
  const { Ed25519KeyIdentity } = require('@icp-sdk/core/identity');
  const { Secp256k1KeyIdentity } = require('@icp-sdk/core/identity/secp256k1');
  const identity = identityFromPem(readFileSync(env.CHECK_KEY_PEM, 'utf8'), { Ed25519KeyIdentity, Secp256k1KeyIdentity });
  assertGovernor('prod', identity.getPrincipal().toText(), env);
  const agent = await HttpAgent.create({ host: 'https://icp-api.io', identity });
  const result = type => IDL.Variant({ Ok: type, Err: IDL.Text });
  const role = IDL.Record({ account_id: IDL.Text, role: IDL.Text, club: IDL.Opt(IDL.Text), team: IDL.Opt(IDL.Text), site_id: IDL.Opt(IDL.Text) });
  const account = IDL.Record({ account_id: IDL.Text, principals: IDL.Vec(IDL.Principal), status: IDL.Variant({ Active: IDL.Null, Suspended: IDL.Null }), roles: IDL.Vec(role) });
  const ia = Actor.createActor(() => IDL.Service({
    list_admin_accounts: IDL.Func([IDL.Text, IDL.Opt(IDL.Text), IDL.Nat16], [result(IDL.Record({ items: IDL.Vec(account), next: IDL.Opt(IDL.Text) }))], []),
    grant_role: IDL.Func([IDL.Text, IDL.Text, IDL.Opt(IDL.Text), IDL.Opt(IDL.Text)], [result(IDL.Null)], []),
  }), { agent, canisterId: ADMIN_TARGETS.identity });
  const insights = id => Actor.createActor(() => IDL.Service({
    read_account_list_app_admins: IDL.Func([], [result(IDL.Vec(IDL.Principal))], []),
    grant_app_admin: IDL.Func([IDL.Principal], [result(IDL.Null)], []),
  }), { agent, canisterId: id });
  const club = Actor.createActor(() => IDL.Service({
    read_account_is_app_admin: IDL.Func([IDL.Principal], [IDL.Bool], []),
    add_role_grant: IDL.Func([IDL.Principal, IDL.Text, IDL.Text, IDL.Opt(IDL.Text)], [IDL.Variant({ Ok: IDL.Null, Err: IDL.Text })], []),
  }), { agent, canisterId: ADMIN_TARGETS.club });
  const unwrap = r => { if ('Err' in r) throw Error('Production refused the account operation'); return r.Ok; };
  const readAccount = async p => {
    let cursor = [], rows = [];
    for (let pages = 0; pages < 20; pages++) {
      const page = unwrap(await ia.list_admin_accounts(p, cursor, 100)); rows.push(...page.items);
      if (!page.next.length) return rows;
      cursor = page.next;
    }
    throw Error('Account lookup incomplete; no grants allowed');
  };
  const report = await alignAdmin({ principal: PAUL_PROD_PRINCIPAL, action: env.ADMIN_ACTION, confirmation: env.ADMIN_CONFIRMATION,
    readAccount, readAdmins: async id => unwrap(await insights(id).read_account_list_app_admins()).map(p => p.toText()),
    grantIdentity: async id => unwrap(await ia.grant_role(id, 'app_admin', [], [])),
    grantInsights: async (id, p) => unwrap(await insights(id).grant_app_admin(Principal.fromText(p))),
    readClubAdmin: async p => club.read_account_is_app_admin(Principal.fromText(p)),
    grantClub: async p => unwrap(await club.add_role_grant(Principal.fromText(p), APP_ADMIN_SCOPE, 'app_admin', [])),
  });
  console.log(JSON.stringify(report));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `## Paul's PROD app-admin access\n\n${JSON.stringify(report)}\n\nNo club membership, identity linking, deployment or other user changes.\n`);
}
main().catch(() => { console.error('Production admin operation stopped; inspect account/readback before retry. No automatic retry.'); process.exitCode = 1; });