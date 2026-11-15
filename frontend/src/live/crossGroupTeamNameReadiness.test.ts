import { describe, expect, it } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { GROUP_DOMAINS } from './groupRouting';
import type { AccountRegistryBinding, AccountRegistrySnapshot } from './accountAuthorityRegistry';
import { verifyCrossGroupTeamNameRoute, type TeamNameRoutePins } from './crossGroupTeamNameReadiness';

const subnet = Principal.fromText('e66qm-3cydn-nkf4i-ml4rb-4ro6o-srm5s-x5hwq-hnprz-3meqp-s7vks-5qe');
const pins: TeamNameRoutePins = {
  sourceGroupId: 'g1',
  targetGroupId: 'g2',
  originalClubDomain: 'mzzzv-taaaa-aaaal-qxlrq-cai',
  originalPiiCanister: 'iui5p-aaaaa-aaaal-qxllq-cai',
  targetClubDomain: 'yfwyv-nyaaa-aaaal-qxpyq-cai',
  targetPiiCanister: 'zt5a6-yiaaa-aaaal-qxp5q-cai',
};
const binding: AccountRegistryBinding = {
  targetAlias: 'main', registryAlias: 'mainnet',
  deploymentId: 'mainnet', deploymentRevision: 1n, host: 'https://icp-api.io',
  networkKind: 'public_mainnet', registryRevision: 11n,
  requiredClubAuthorities: [pins.originalClubDomain, pins.targetClubDomain],
};
function group(id: 'g1' | 'g2'): AccountRegistrySnapshot['groups'][number] {
  const n = id === 'g1' ? 30 : 60;
  return {
    id, target_alias: 'mainnet',
    domains: GROUP_DOMAINS.map((domain, i) => ({
      domain, canister: domain === 'club_domain' ? Principal.fromText(id === 'g1' ? pins.originalClubDomain : pins.targetClubDomain) :
        domain === 'pii_access_control' ? Principal.fromText(id === 'g1' ? pins.originalPiiCanister : pins.targetPiiCanister) :
        Principal.fromUint8Array(new Uint8Array([n, i + 1, 1])),
    })),
  };
}
function placement(groupRow: ReturnType<typeof group>): AccountRegistrySnapshot['placements'][number] {
  return {
    group_id: groupRow.id, deployment_id: binding.deploymentId,
    deployment_revision: binding.deploymentRevision, host: binding.host,
    network_kind: binding.networkKind, primary_subnet: subnet,
    approved_subnets: [subnet], additional_subnets_enabled: false,
    domains: groupRow.domains.map(d => ({...d, subnet})),
  };
}
function registry(groups: Array<ReturnType<typeof group>> = [group('g1'), group('g2')]): AccountRegistrySnapshot {
  return { revision: 11n, groups, placements: groups.map(placement) };
}

describe('DEV Group 1 → Group 2 adult name routing preflight (no release)', () => {
  it('identifies pinned original PII and target club only from a complete independently bound registry', () => {
    const result = verifyCrossGroupTeamNameRoute(registry(), binding, pins);
    expect(result).toEqual({
      sourceGroupId: 'g1', targetGroupId: 'g2', registryRevision: 11n,
      nameReadAuthorised: false, requiresLiveTeamPermission: true, requiresOwnerRelease: true,
    });
  });
  it('rejects the observed incomplete DEV router inventory (Group 2 only)', () => {
    expect(() => verifyCrossGroupTeamNameRoute(registry([group('g2')]), binding, pins))
      .toThrow(/Missing legacy account authority|both groups/i);
  });
  it('never derives a trusted source from an encrypted profile reference or substituted PII service', () => {
    expect(() => verifyCrossGroupTeamNameRoute(registry(), binding,
      { ...pins, originalPiiCanister: 'ryjl3-tyaaa-aaaaa-aaaba-cai' })).toThrow(/authority differs/);
    expect(() => verifyCrossGroupTeamNameRoute(registry(), binding,
      { ...pins, targetPiiCanister: 'ryjl3-tyaaa-aaaaa-aaaba-cai' })).toThrow(/authority differs/);
  });
  it('requires both independently approved club authorities, not the target club alone', () => {
    expect(() => verifyCrossGroupTeamNameRoute(registry(),
      {...binding, requiredClubAuthorities:[pins.targetClubDomain]}, pins)).toThrow(/both operator-approved/i);
  });
  it('rejects foreign deployment, stale registry and subnet changes before any name read', () => {
    expect(() => verifyCrossGroupTeamNameRoute(registry(), {...binding, registryRevision:10n}, pins)).toThrow(/stale/i);
    const changed = registry();
    changed.placements[1].host = 'https://other.invalid';
    expect(() => verifyCrossGroupTeamNameRoute(changed,binding,pins)).toThrow(/foreign/i);
    const changedSubnet = registry();
    changedSubnet.placements[0].domains[0].subnet = Principal.fromUint8Array(new Uint8Array([99]));
    expect(() => verifyCrossGroupTeamNameRoute(changedSubnet,binding,pins)).toThrow(/subnet|placement/i);
  });
  it('denies ambiguous original and target groups and unpinned route IDs', () => {
    expect(() => verifyCrossGroupTeamNameRoute(registry(),binding,{...pins,targetGroupId:'g1'})).toThrow(/distinct/i);
    expect(() => verifyCrossGroupTeamNameRoute(registry(),binding,{...pins,targetClubDomain:pins.originalClubDomain})).toThrow(/distinct/i);
    expect(() => verifyCrossGroupTeamNameRoute(registry(),binding,{...pins,targetGroupId:'g3'})).toThrow(/both groups/i);
  });
});
