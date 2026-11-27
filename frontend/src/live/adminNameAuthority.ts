import type { FeatureBackendContext } from './featureRouter';
import type { PrivateProfileAuthorityResolver } from './privateProfileAuthority';
import { createPrivateProfileAuthorityResolver } from './privateProfileAuthority';
import { accountAuthoritiesFromRegistry } from './accountAuthorityRegistry';
import { capturePrivateProfileSession } from './privateProfileSession';
import { createDevCrossGroupTeamNameResolver } from './devCrossGroupTeamNameRoute';
import { ROUTING_GATES_SNAPSHOT } from './generated/routingGates';
import { groupApprovalConfiguration, approvalConfigurationSha256 } from './groupApproval';
import { assertOpenCloudGroupCanister, opencloudEnvironment, opencloudPinnedTarget } from './opencloudEnvironment';

/** Location only: every original PII endpoint delegates names-only permission
 * to the shared identity authority, which checks the current global admin role.
 * No keys, records, role mirrors or plaintext are copied between groups. */
export function createAdminNameAuthorityResolver(ctx: FeatureBackendContext): PrivateProfileAuthorityResolver {
  // Admin pages start at the shared (original G1) target, not a member's
  // scoped G2 target. Construct only the independently pinned read view;
  // the resolver still verifies the full live registry before either source.
  const devShared = ctx.target.provider === 'icp' && ctx.target.host === 'https://icp-api.io' && ctx.target.networkKind === 'public_mainnet' &&
    ctx.target.canisterIds.identity_access === 'mq2sj-fiaaa-aaaal-qxlqa-cai' && ctx.target.canisterIds.shard_router === 'jcdfe-vqaaa-aaaal-qxloq-cai';
  const devContext = devShared ? { identity: ctx.identity, target: { ...ctx.target, canisterIds: { ...ctx.target.canisterIds,
    club_domain: 'yfwyv-nyaaa-aaaal-qxpyq-cai', pii_access_control: 'zt5a6-yiaaa-aaaal-qxp5q-cai' } } } : ctx;
  const dev = createDevCrossGroupTeamNameResolver(devContext);
  if (dev) {
    const session = capturePrivateProfileSession();
    const target = JSON.stringify(ctx.target);
    const identity = ctx.identity;
    const caller = identity.getPrincipal().toText();
    const active = () => {
      session();
      if (ctx.identity !== identity || identity.getPrincipal().isAnonymous() || identity.getPrincipal().toText() !== caller || JSON.stringify(ctx.target) !== target || ctx.target.status === 'disabled') throw new Error('Name reader sign-in or destination changed.');
    };
    return async authority => {
      active(); const lease = await dev(authority); active();
      return { context: lease.context, confirm: async () => { active(); await lease.confirm(); active(); } };
    };
  }
  const engine = opencloudEnvironment();
  const pinned = engine ? opencloudPinnedTarget() : null;
  if (engine && pinned && (ctx.target.alias !== engine || ctx.target.networkKind !== 'cloud_engine' ||
      Object.entries(pinned.canisterIds).some(([name, id]) => ctx.target.canisterIds[name] !== id))) {
    throw new Error('The OpenCloud name-store target is not the pinned shared deployment.');
  }
  // OpenCloud artifacts carry their own complete inventory, not the mainnet
  // snapshot. This is only a location pin: inspect() still requires the
  // router's current governor-recorded approval before releasing any name.
  const anchor: { approved: boolean; targetAlias: string; host: string; routerCanisterId?: string;
    configurationRevision?: string; approvedConfiguration?: string } = engine && pinned
    ? { approved: true, targetAlias: engine, host: pinned.host, routerCanisterId: pinned.canisterIds.shard_router }
    : ROUTING_GATES_SNAPSHOT;
  const session = capturePrivateProfileSession();
  const identity = ctx.identity;
  const target = JSON.stringify(ctx.target);
  const caller = identity.getPrincipal().toText();
  const active = () => {
    session();
    if (ctx.identity !== identity || identity.getPrincipal().isAnonymous() || identity.getPrincipal().toText() !== caller || JSON.stringify(ctx.target) !== target || ctx.target.status === 'disabled') {
      throw new Error('Name reader sign-in or destination changed.');
    }
    if (!anchor?.approved || anchor.host !== ctx.target.host || !anchor.routerCanisterId || anchor.routerCanisterId !== ctx.target.canisterIds.shard_router) {
      throw new Error('The approved name-store directory is unavailable.');
    }
  };
  const inspect = async () => {
    active();
    const { connectLiveShardRouter } = await import('./domains');
    active();
    const { actor } = await connectLiveShardRouter(ctx.target, identity);
    active();
    const { readPinnedGroupRegistry } = await import('./groupRegistryPager');
    active();
    if (!anchor) throw new Error('The approved name-store directory is unavailable.');
    const registry = await readPinnedGroupRegistry((revision, cursor, limit) => actor.read_group_registry_page(anchor.targetAlias, revision, cursor, limit), undefined, active);
    if (engine) {
      const full = JSON.parse(import.meta.env.IGNITE_LIVE_OPENCLOUD_IDS_JSON || '{}') as Record<string, string>;
      if (registry.groups.length !== 2) throw new Error('The complete OpenCloud name-store inventory is required.');
      for (const group of registry.groups) {
        const prefix = group.id === 'base' ? 'g1' : group.id === 'g2' ? 'g2' : null;
        if (!prefix || group.target_alias !== engine || group.photo_store[0]?.toText() !== full[`${prefix}_media_blob_store`]) {
          throw new Error('The OpenCloud name-store group is outside the pinned deployment.');
        }
        for (const domain of group.domains) assertOpenCloudGroupCanister(group.id, domain.domain, domain.canister.toText());
      }
    }
    const configuration = groupApprovalConfiguration(registry.groups, registry.placements);
    if (anchor.configurationRevision !== undefined && anchor.approvedConfiguration && registry.configurationRevision === BigInt(anchor.configurationRevision)) {
      if (configuration !== anchor.approvedConfiguration) throw new Error('Name-store configuration changed.');
    } else {
      const reply = await actor.read_routing_approval(anchor.targetAlias);
      active();
      const approval = 'Ok' in reply ? reply.Ok[0] : undefined;
      const ids = registry.groups.map(g => g.id).sort();
      if (!approval || registry.configurationRevision === undefined || approval.target_alias !== anchor.targetAlias || approval.configuration_revision !== registry.configurationRevision ||
          JSON.stringify([...approval.removal_wiring_group_ids].sort()) !== JSON.stringify(ids) ||
          approval.approved_configuration_sha256 !== await approvalConfigurationSha256(configuration)) {
        throw new Error('Name-store configuration has not been approved.');
      }
      active();
    }
    const placement = registry.placements[0];
    if (!placement) throw new Error('The name-store directory is empty.');
    const binding = { targetAlias: ctx.target.alias, registryAlias: anchor.targetAlias, registryRevision: registry.revision,
      deploymentId: placement.deployment_id, deploymentRevision: placement.deployment_revision,
      host: ctx.target.host, networkKind: ctx.target.networkKind,
      requiredClubAuthorities: registry.groups.flatMap(g => g.domains.filter(d => d.domain === 'club_domain').map(d => d.canister.toText())) };
    accountAuthoritiesFromRegistry(registry, binding);
    return { registry, binding };
  };
  let resolver: Promise<PrivateProfileAuthorityResolver> | undefined;
  return async authority => {
    active();
    resolver ??= (async () => {
      const first = await inspect();
      active();
      let opening = true;
      return createPrivateProfileAuthorityResolver(ctx, first.binding, async () => {
        active();
        if (opening) { opening = false; return first.registry; }
        return (await inspect()).registry;
      });
    })();
    const lease = await (await resolver)(authority);
    active();
    return { context: lease.context, confirm: async () => { active(); await lease.confirm(); active(); } };
  };
}