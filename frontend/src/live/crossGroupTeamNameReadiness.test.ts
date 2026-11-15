import { describe, expect, it } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { GROUP_DOMAINS } from './groupRouting';
import type { AccountRegistryBinding, AccountRegistrySnapshot } from './accountAuthorityRegistry';
import { inspectLegacyGroup1TeamNameTopology, verifyCrossGroupTeamNameRoute, type LegacyIdentityDirectoryReadback, type TeamNameRoutePins } from './crossGroupTeamNameReadiness';

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


const legacyBinding: AccountRegistryBinding = {
  ...binding, requiredClubAuthorities: [pins.targetClubDomain],
};
function legacyDirectory(): LegacyIdentityDirectoryReadback {
  return {
    binding: {
      registry: Principal.fromText('jcdfe-vqaaa-aaaal-qxloq-cai'),
      registry_revision: 11n,
      target_alias: 'mainnet',
      deployment_id: 'mainnet',
      deployment_revision: 1n,
      host: 'https://icp-api.io',
      network_kind: 'public_mainnet',
    },
    generation: 1n,
    inventory_digest: new Uint8Array(32).fill(7),
    sources: [
      ['g1', Principal.fromText(pins.originalClubDomain)],
      ['g2', Principal.fromText(pins.targetClubDomain)],
    ],
    enabled: true, app_enabled: true,
  };
}
const legacyPins = { ...pins, routerCanister: 'jcdfe-vqaaa-aaaal-qxloq-cai' };

describe('legacy G1 Identity-sourced topology audit (still NO name release)', () => {
  it('accepts an approved legacy G1 source WITHOUT fabricating a Group 1 router placement', () => {
    const snapshot = registry([group('g2')]);
    const original = JSON.stringify(snapshot, (_, v) => typeof v === 'bigint' ? v.toString() : v);
    const result = inspectLegacyGroup1TeamNameTopology(snapshot, legacyBinding, legacyDirectory(), legacyPins);
    expect(result).toEqual({
      legacySource: pins.originalClubDomain,
      targetClub: pins.targetClubDomain,
      targetPii: pins.targetPiiCanister,
      registryRevision: 11n,
      directoryGeneration: 1n,
      verifiedSourceMapping: true,
      originalPiiKeyVerified: false,
      nameReadAuthorised: false,
      requiresOriginalPiiIdentityAllowlist: true,
      requiresLiveTeamPermission: true,
      requiresOwnerRelease: true,
    });
    expect(JSON.stringify(snapshot, (_, v) => typeof v === 'bigint' ? v.toString() : v)).toEqual(original);
    expect(snapshot.groups).toHaveLength(1);
  });
  it('fails if Identity does not explicitly pin the original G1 source', () => {
    const d = legacyDirectory();
    d.sources = d.sources.slice(1);
    expect(() => inspectLegacyGroup1TeamNameTopology(registry([group('g2')]),legacyBinding,d,legacyPins))
      .toThrow(/Identity source inventory/);
  });
  it('fails if a foreign original club masquerades as Group 1', () => {
    const d = legacyDirectory();
    d.sources = [['g1', Principal.fromText('ryjl3-tyaaa-aaaaa-aaaba-cai')], d.sources[1]];
    expect(() => inspectLegacyGroup1TeamNameTopology(registry([group('g2')]),legacyBinding,d,legacyPins))
      .toThrow(/Identity source inventory/);
  });
  it('fails on duplicate source, wrong revision or unapproved router', () => {
    const d = legacyDirectory();
    d.sources = [...d.sources, d.sources[0]];
    expect(() => inspectLegacyGroup1TeamNameTopology(registry([group('g2')]),legacyBinding,d,legacyPins))
      .toThrow(/Identity source inventory/);
    const r=legacyDirectory();r.binding.registry_revision = 10n;
    expect(() => inspectLegacyGroup1TeamNameTopology(registry([group('g2')]),legacyBinding,r,legacyPins))
      .toThrow(/Identity directory binding/);
    expect(() => inspectLegacyGroup1TeamNameTopology(registry([group('g2')]),legacyBinding,legacyDirectory(),
      {...legacyPins,routerCanister:'ryjl3-tyaaa-aaaaa-aaaba-cai'})).toThrow(/Identity directory binding/);
  });
  it('rejects directory before reader enable or malformed inventory digest', () => {
    const d=legacyDirectory();d.app_enabled=false;
    expect(() => inspectLegacyGroup1TeamNameTopology(registry([group('g2')]),legacyBinding,d,legacyPins))
      .toThrow(/Identity directory binding/);
    const d2=legacyDirectory();d2.inventory_digest=[7];
    expect(() => inspectLegacyGroup1TeamNameTopology(registry([group('g2')]),legacyBinding,d2,legacyPins))
      .toThrow(/Identity directory binding/);
  });
  it('rejects fabricated modern G1 registration, foreign Group 2 PII, or a wide registry binding', () => {
    expect(() => inspectLegacyGroup1TeamNameTopology(registry(),legacyBinding,legacyDirectory(),legacyPins))
      .toThrow(/Legacy G1 unexpectedly registered/);
    expect(() => inspectLegacyGroup1TeamNameTopology(registry([group('g2')]),legacyBinding,legacyDirectory(),
      {...legacyPins,targetPiiCanister:pins.originalPiiCanister})).toThrow(/Exact disjoint/);
    expect(() => inspectLegacyGroup1TeamNameTopology(registry([group('g2')]),binding,legacyDirectory(),legacyPins))
      .toThrow(/Registered and legacy authority/);
  });
});

describe('exact, non-sensitive Identity directory failure diagnosis', () => {
  const check = (mutate: (d: LegacyIdentityDirectoryReadback) => void, message: RegExp) => {
    const d = legacyDirectory();
    mutate(d);
    expect(() => inspectLegacyGroup1TeamNameTopology(
      registry([group('g2')]), legacyBinding, d, legacyPins,
    )).toThrow(message);
  };
  it('distinguishes stale router revision from stale approved registry revision', () => {
    check(d => { d.binding.registry_revision = 10n; },
      /directory revision differs from the live router revision/);
    expect(() => inspectLegacyGroup1TeamNameTopology(
      registry([group('g2')]), {...legacyBinding, registryRevision: 10n}, legacyDirectory(), legacyPins,
    )).toThrow(/Incomplete or stale account registry/);
  });
  it('pinpoints disabled membership-directory and unreleased reader separately', () => {
    check(d => { d.enabled = false; }, /Identity membership directory disabled/);
    check(d => { d.app_enabled = false; }, /Identity membership directory reader not released/);
    check(d => { d.generation = 0n; }, /directory generation not activated/);
  });
  it('pinpoints authority, binding, deployment and fingerprint mismatch without printing their data', () => {
    check(d => { d.binding.registry = Principal.fromText('ryjl3-tyaaa-aaaaa-aaaba-cai'); },
      /original router authority mismatch/);
    check(d => { d.binding.target_alias = 'other'; }, /deployment alias mismatch/);
    check(d => { d.binding.deployment_id = 'other'; }, /deployment identity mismatch/);
    check(d => { d.binding.deployment_revision += 1n; }, /deployment revision mismatch/);
    check(d => { d.binding.host = 'https://other.invalid'; }, /deployment host mismatch/);
    check(d => { d.binding.network_kind = 'cloud_engine'; }, /network kind mismatch/);
    check(d => { d.inventory_digest = new Uint8Array([3]); }, /inventory fingerprint missing or invalid/);
  });
  it('does not turn any of these failures into an authorisation or automatic repair', () => {
    check(d => { d.enabled = false; }, /No private-name access was attempted/);
    const good = inspectLegacyGroup1TeamNameTopology(registry([group('g2')]), legacyBinding, legacyDirectory(), legacyPins);
    expect(good.nameReadAuthorised).toBe(false);
    expect(good.originalPiiKeyVerified).toBe(false);
    expect(good.requiresLiveTeamPermission).toBe(true);
    expect(good.requiresOwnerRelease).toBe(true);
  });
});
