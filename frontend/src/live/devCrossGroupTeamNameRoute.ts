import type { FeatureBackendContext } from './featureRouter';
import type { PrivateProfileAuthorityResolver } from './privateProfileAuthority';
import { capturePrivateProfileSession } from './privateProfileSession';
import {
  accountAuthoritiesFromRegistry, readLiveAccountAuthoritySnapshot,
  type AccountRegistryBinding, type AccountRegistrySnapshot,
} from './accountAuthorityRegistry';
import { Principal } from '@icp-sdk/core/principal';

/**
 * Original G1 -> any registered DEV team route. Browser routing is NOT
 * authorization: the original PII must independently authenticate the caller,
 * Identity must verify the original source/service and the owning Club must
 * recheck BOTH viewer and subject on the exact team before releasing names.
 *
 * Do not derive a PII endpoint from an encrypted profile reference. The
 * original G1 PII is pinned separately from the modern Group 2 registry.
 * No PROD target, email/Supabase account or arbitrary canister is eligible.
 */
const DEV = Object.freeze({
  identity: 'mq2sj-fiaaa-aaaal-qxlqa-cai',
  router: 'jcdfe-vqaaa-aaaal-qxloq-cai',
  originalPii: 'iui5p-aaaaa-aaaal-qxllq-cai',
  originalClub: 'mzzzv-taaaa-aaaal-qxlrq-cai',
  registeredG2Club: 'yfwyv-nyaaa-aaaal-qxpyq-cai',
  registeredG2Pii: 'zt5a6-yiaaa-aaaal-qxp5q-cai',
});

const signature = (value: unknown) => JSON.stringify(value, (_, v) =>
  typeof v === 'bigint' ? v.toString() : v);

export function createDevCrossGroupTeamNameResolver(
  ctx: FeatureBackendContext,
  readSnapshot: (ctx: FeatureBackendContext, binding: AccountRegistryBinding) => Promise<AccountRegistrySnapshot> = readLiveAccountAuthoritySnapshot,
): PrivateProfileAuthorityResolver | undefined {
  const target = ctx.target;
  if (target.provider !== 'icp' || target.networkKind !== 'public_mainnet' ||
      target.host !== 'https://icp-api.io' || target.status === 'disabled' ||
      target.canisterIds.identity_access !== DEV.identity ||
      target.canisterIds.shard_router !== DEV.router ||
      target.canisterIds.club_domain !== DEV.registeredG2Club ||
      target.canisterIds.pii_access_control !== DEV.registeredG2Pii) return undefined;

  const binding: AccountRegistryBinding = {
    targetAlias: target.alias, registryAlias: 'mainnet',
    deploymentId: 'mainnet', deploymentRevision: 1n,
    registryRevision: 11n, host: 'https://icp-api.io',
    networkKind: 'public_mainnet', requiredClubAuthorities: [DEV.registeredG2Club],
  };
  const identity = ctx.identity;
  const caller = identity.getPrincipal().toText();
  const originalTarget = signature(target);
  const session = capturePrivateProfileSession();
  const active = () => {
    session();
    if (identity.getPrincipal().isAnonymous() || identity.getPrincipal().toText() !== caller ||
        ctx.identity !== identity || signature(ctx.target) !== originalTarget || ctx.target.status === 'disabled') {
      throw new Error('Private-name session or target changed');
    }
  };

  const inspect = async () => {
    active();
    const snapshot = await readSnapshot(ctx, binding);
    active();
    accountAuthoritiesFromRegistry(snapshot, binding);
    const g2 = snapshot.groups.find(group => group.id === 'g2');
    if (snapshot.revision !== 11n || snapshot.groups.length !== 1 ||
        snapshot.placements.length !== 1 || snapshot.placements[0].group_id !== 'g2' ||
        !g2 || g2.domains.find(d => d.domain === 'club_domain')?.canister.toText() !== DEV.registeredG2Club ||
        g2.domains.find(d => d.domain === 'pii_access_control')?.canister.toText() !== DEV.registeredG2Pii ||
        snapshot.groups.some(g => g.domains.some(d => d.canister.toText() === DEV.originalPii ||
          d.canister.toText() === DEV.originalClub))) {
      throw new Error('Original DEV source or registered team authority changed');
    }
    return { signature: signature(snapshot), allowed: new Set([DEV.originalPii, DEV.registeredG2Pii]) };
  };

  let opening: Promise<Awaited<ReturnType<typeof inspect>>> | undefined;
  return async authority => {
    active();
    const principal = Principal.fromText(authority);
    if (principal.isAnonymous() || principal.toText() !== authority || authority === 'aaaaa-aa') {
      throw new Error('Invalid original name authority');
    }
    // This set is pinned independently from the untrusted profile reference.
    // It does not grant an audience; all actual decryption is canister-gated.
    if (authority !== DEV.originalPii && authority !== DEV.registeredG2Pii) {
      throw new Error('Foreign original PII canister is not approved for DEV');
    }
    opening ??= inspect();
    const first = await opening;
    active();
    if (!first.allowed.has(authority)) throw new Error('Unapproved original PII source');
    return {
      context: { identity, target: {
        ...target, canisterIds: { ...target.canisterIds, pii_access_control: authority },
      } },
      confirm: async () => {
        const final = await inspect();
        active();
        if (final.signature !== first.signature || !final.allowed.has(authority)) {
          throw new Error('DEV team-name routing authority changed');
        }
      },
    };
  };
}
