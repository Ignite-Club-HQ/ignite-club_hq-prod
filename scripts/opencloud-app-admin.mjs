import { readFileSync, appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { identityFromPem } from './prod-connection-check.mjs';
import { hasGlobalAdmin, APP_ADMIN_SCOPE } from './prod-app-admin-policy.mjs';

async function main() {
  const env = process.env;
  if (env.GITHUB_REPOSITORY !== 'Ignite-Club-HQ/ignite-club_hq-prod' || env.GITHUB_REF !== 'refs/heads/main' || !['dev','prod'].includes(env.ADMIN_ENV) || !['check','grant'].includes(env.ADMIN_ACTION)) throw Error('Invalid operator context');
  const config = JSON.parse(readFileSync('deploy/opencloud/'+env.ADMIN_ENV+'.json','utf8'));
  if (config.environment !== 'opencloud-'+env.ADMIN_ENV || config.applicationKey !== 'ignite_'+env.ADMIN_ENV+'_v2' || config.apiHost !== 'https://s53an-5aaaa-aaac5-aaaaa-cai.icp.net') throw Error('Invalid target');
  const principal = env.ADMIN_ENV === 'dev' ? 'ixboh-zq5lj-7t6yy-4m27e-qbj6a-fjjwu-jcmo6-ajjyh-jigrx-vyu2g-oae' : '7mjx5-fakc7-3ue3o-ef4tt-4txr6-pavps-rvfxc-z57pr-475k7-2wm4x-lae';
  const ADMIN_TARGETS = {identity:config.shared.identity_access, insights:config.groups.map(g=>g.canisterIds.insights_domain), clubs:config.groups.map(g=>g.canisterIds.club_domain)};
  const require = createRequire(path.join(env.CHECK_DEPS_DIR, 'package.json'));
  const { Actor, HttpAgent } = require('@icp-sdk/core/agent');
  const { IDL } = require('@icp-sdk/core/candid');
  const { Principal } = require('@icp-sdk/core/principal');
  const { Ed25519KeyIdentity } = require('@icp-sdk/core/identity');
  const { Secp256k1KeyIdentity } = require('@icp-sdk/core/identity/secp256k1');
  const identity = identityFromPem(readFileSync(env.CHECK_KEY_PEM, 'utf8'), { Ed25519KeyIdentity, Secp256k1KeyIdentity });
  if (identity.getPrincipal().toText() !== config.controllers.governor) throw Error('Wrong governor');
  const agent = await HttpAgent.create({ host: config.apiHost, identity });
  const result = type => IDL.Variant({ Ok: type, Err: IDL.Text });
  const role = IDL.Record({ account_id: IDL.Text, role: IDL.Text, club: IDL.Opt(IDL.Text), team: IDL.Opt(IDL.Text), site_id: IDL.Opt(IDL.Text) });
  const accountType = IDL.Record({ account_id: IDL.Text, principals: IDL.Vec(IDL.Principal), status: IDL.Variant({ Active: IDL.Null, Suspended: IDL.Null }), roles: IDL.Vec(role) });
  const ia = Actor.createActor(() => IDL.Service({
    list_admin_accounts: IDL.Func([IDL.Text, IDL.Opt(IDL.Text), IDL.Nat16], [result(IDL.Record({ items: IDL.Vec(accountType), next: IDL.Opt(IDL.Text) }))], []),
    grant_role: IDL.Func([IDL.Text, IDL.Text, IDL.Opt(IDL.Text), IDL.Opt(IDL.Text)], [result(IDL.Null)], []),
  }), { agent, canisterId: ADMIN_TARGETS.identity });
  const insights = id => Actor.createActor(() => IDL.Service({
    read_account_list_app_admins: IDL.Func([], [result(IDL.Vec(IDL.Principal))], []),
    grant_app_admin: IDL.Func([IDL.Principal], [result(IDL.Null)], []),
  }), { agent, canisterId: id });
  const club = id => Actor.createActor(() => IDL.Service({
    read_account_is_app_admin: IDL.Func([IDL.Principal], [IDL.Bool], []),
    add_role_grant: IDL.Func([IDL.Principal, IDL.Text, IDL.Text, IDL.Opt(IDL.Text)], [IDL.Variant({ Ok: IDL.Null, Err: IDL.Text })], []),
  }), { agent, canisterId: id });
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
  const select = async () => {
    const rows = (await readAccount(principal)).filter(r=>r.principals.some(p=>p.toText()===principal));
    if(rows.length!==1 || !('Active' in rows[0].status)) throw Error('Exactly one active existing account required');
    return rows[0];
  };
  const account = await select();
  const p = Principal.fromText(principal);
  const read = async () => ({identity:hasGlobalAdmin(await select()), insights:await Promise.all(ADMIN_TARGETS.insights.map(async id=>unwrap(await insights(id).read_account_list_app_admins()).some(x=>x.toText()===principal))), clubs:await Promise.all(ADMIN_TARGETS.clubs.map(id=>club(id).read_account_is_app_admin(p)))});
  const before = await read();
  console.log('Before',JSON.stringify(before));
  if(env.ADMIN_ACTION==='grant'){
    if(!before.identity) unwrap(await ia.grant_role(account.account_id,'app_admin',[],[]));
    for(const [i,id] of ADMIN_TARGETS.insights.entries()) if(!before.insights[i]) unwrap(await insights(id).grant_app_admin(p));
    for(const [i,id] of ADMIN_TARGETS.clubs.entries()) if(!before.clubs[i]) unwrap(await club(id).add_role_grant(p,APP_ADMIN_SCOPE,'app_admin',[]));
  }
  const after=await read();
  if((await select()).account_id!==account.account_id) throw Error('Account changed');
  console.log('After',JSON.stringify(after));
  if(env.ADMIN_ACTION==='grant' && (!after.identity || !after.insights.every(Boolean) || !after.clubs.every(Boolean))) throw Error('Grant incomplete');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
