import { describe, expect, it, vi } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { GROUP_DOMAINS } from './groupRouting';
import type { FeatureBackendContext } from './featureRouter';
import type { AccountRegistrySnapshot } from './accountAuthorityRegistry';
import { createDevCrossGroupTeamNameResolver } from './devCrossGroupTeamNameRoute';

const DEV = {
  identity: 'mq2sj-fiaaa-aaaal-qxlqa-cai',
  router: 'jcdfe-vqaaa-aaaal-qxloq-cai',
  originalPii: 'iui5p-aaaaa-aaaal-qxllq-cai',
  originalClub: 'mzzzv-taaaa-aaaal-qxlrq-cai',
  g2Club: 'yfwyv-nyaaa-aaaal-qxpyq-cai',
  g2Pii: 'zt5a6-yiaaa-aaaal-qxp5q-cai',
};
const p = (n: number) => Principal.fromUint8Array(Uint8Array.from([n, 1]));
function setup() {
  const subnet = p(120);
  const domains = GROUP_DOMAINS.map((domain, i) => ({
    domain,
    canister: Principal.fromText(domain === 'club_domain' ? DEV.g2Club :
      domain === 'pii_access_control' ? DEV.g2Pii : p(i+1).toText()),
  }));
  const snapshot: AccountRegistrySnapshot = {
    revision: 11n,
    groups: [{id:'g2',target_alias:'mainnet',domains}],
    placements:[{ group_id:'g2',deployment_id:'mainnet',deployment_revision:1n,
      host:'https://icp-api.io',network_kind:'public_mainnet',
      primary_subnet:subnet,approved_subnets:[subnet],additional_subnets_enabled:false,
      domains:domains.map(d=>({...d,subnet})) }],
  };
  const identity = { getPrincipal: () => p(90) };
  const ctx = { identity, target: {
    provider:'icp',alias:'icp-public-mainnet',networkKind:'public_mainnet',
    host:'https://icp-api.io',deploymentClass:'public_subnet',
    canisterIds:{identity_access:DEV.identity,shard_router:DEV.router,
      club_domain:DEV.g2Club,pii_access_control:DEV.g2Pii},
  } } as unknown as FeatureBackendContext;
  const read = vi.fn(async () => snapshot);
  return {ctx,snapshot,read,resolver:createDevCrossGroupTeamNameResolver(ctx,read)};
}
describe('DEV original G1 encrypted teammate names - authoritative cross-group route',()=>{
  it('routes the true G1 PII for any authorised team without guessing from a profile reference',async()=>{
    const f=setup();
    const lease=await f.resolver!(DEV.originalPii);
    expect(lease.context.identity).toBe(f.ctx.identity);
    expect(lease.context.target.canisterIds.pii_access_control).toBe(DEV.originalPii);
    expect(lease.context.target.canisterIds.club_domain).toBe(DEV.g2Club);
    expect(f.ctx.target.canisterIds.pii_access_control).toBe(DEV.g2Pii);
    await lease.confirm();
    expect(f.read).toHaveBeenCalledTimes(2);
  });
  it('preserves registered G2 PII routing and verifies the same complete registry',async()=>{
    const f=setup();
    const lease=await f.resolver!(DEV.g2Pii);
    await lease.confirm();
    expect(lease.context.target.canisterIds.pii_access_control).toBe(DEV.g2Pii);
  });
  it('never uses a foreign, guessed or malformed PII endpoint',async()=>{
    const f=setup();
    for(const bad of [p(50).toText(),DEV.originalClub,DEV.g2Club,'aaaaa-aa','not-a-principal']){
      await expect(f.resolver!(bad)).rejects.toThrow();
    }
    expect(f.read).not.toHaveBeenCalled();
  });
  it('never enables frontend route in PROD, Supabase, unknown group or wrong DEV authority',()=>{
    for (const change of [
      {provider:'supabase'}, {host:'https://evil.invalid'}, {networkKind:'cloud_engine'},
      {canisterIds:{...setup().ctx.target.canisterIds,identity_access:p(99).toText()}},
      {canisterIds:{...setup().ctx.target.canisterIds,club_domain:DEV.originalClub}},
      {canisterIds:{...setup().ctx.target.canisterIds,pii_access_control:DEV.originalPii}},
      {canisterIds:{...setup().ctx.target.canisterIds,shard_router:p(93).toText()}},
      {status:'disabled'},
    ]) {
      const f=setup();
      Object.assign(f.ctx.target, change);
      expect(createDevCrossGroupTeamNameResolver(f.ctx,f.read)).toBeUndefined();
    }
  });
  it('rejects a stale router, altered Group 2 or silently registered legacy Group 1',async()=>{
    for(const mutate of [
      (s:AccountRegistrySnapshot)=>{s.revision=12n;},
      (s:AccountRegistrySnapshot)=>{s.groups[0].domains.find(d=>d.domain==='club_domain')!.canister=p(80);},
      (s:AccountRegistrySnapshot)=>{s.groups[0].domains.find(d=>d.domain==='pii_access_control')!.canister=p(80);},
      (s:AccountRegistrySnapshot)=>{s.placements[0].network_kind='cloud_engine';},
      (s:AccountRegistrySnapshot)=>{s.groups[0].domains.find(d=>d.domain==='pii_access_control')!.canister=Principal.fromText(DEV.originalPii);},
    ]){
      const f=setup();mutate(f.snapshot);
      await expect(f.resolver!(DEV.originalPii)).rejects.toThrow();
    }
  });
  it('rejects authority drift between opening and closing verification',async()=>{
    const f=setup();
    const lease=await f.resolver!(DEV.originalPii);
    f.snapshot.revision=12n;
    await expect(lease.confirm()).rejects.toThrow();
  });
  it('rejects an identity or deployment change after opening the source route',async()=>{
    const f=setup();
    const lease=await f.resolver!(DEV.originalPii);
    f.ctx.target.host='https://unexpected.invalid';
    await expect(lease.confirm()).rejects.toThrow();
  });
});
