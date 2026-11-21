import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeatureBackendContext } from './featureRouter';
import { GROUP_DOMAINS } from './groupRouting';
import type { GroupRegistry, GroupSessionTransport } from './groupSession';
import { openMixedMembershipSession } from './mixedMembershipSession';
import { clearMixedMembershipRuntime, dispatchMixedMembership, installMixedMembershipRuntime } from './mixedMembershipRuntime';
import { isScopedContext } from './scopedContext';
const roleMocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('./domains', () => ({ connectLiveClubDomain: async (target: unknown) => ({ actor: { my_role_grants: () => roleMocks.read(target) } }) }));
import { fetchMyRoleGrantsEverywhere } from './features/myRoleGrants';
import { clearRoleGrantsMemo } from './roleGrantsMemo';

function destination(kind: 'public_mainnet' | 'cloud_engine', club: string) {
  let account = 'member';
  const alias = kind === 'public_mainnet' ? 'mainnet' : 'engine';
  const context = { identity: { getPrincipal: () => ({ toText: () => account }) }, target: {
    provider: 'icp', alias, host: `https://${alias}.example.com`, networkKind: kind,
    deploymentClass: kind === 'cloud_engine' ? 'cloud_engine' : 'public_subnet', status: 'active',
    canisterIds: { identity_access: 'shared-identity-cai', club_domain: `${alias}-0-cai`, shard_router: `${alias}-router-cai` },
  } } as unknown as FeatureBackendContext;
  const domains = GROUP_DOMAINS.map((domain, index) => ({ domain, canisterId: `${alias}-${index}-cai` }));
  const registry: GroupRegistry = {
    revision: 1n, groups: [{ id: 'base', targetAlias: alias, domains }],
    deployment: { id: alias, alias, networkKind: kind, host: context.target.host, revision: 1n,
      enabled: true, primarySubnet: `${alias}-subnet`, approvedSubnets: [`${alias}-subnet`], additionalSubnetsEnabled: false },
    bindings: [{ groupId: 'base', deploymentId: alias, deploymentRevision: 1n,
      domains: domains.map(d => ({ ...d, subnetId: `${alias}-subnet` })) }],
  };
  const transport: GroupSessionTransport = {
    readRegistry: vi.fn(async () => structuredClone(registry)),
    readMemberships: vi.fn(async () => ({ clubs: club ? [club] : [], next: null, aclRevision: 1n })),
    readAssignments: vi.fn(async ids => ids.map(clubId => ({ clubId, groupId: 'base', revision: 1n }))),
  };
  return { context, transport, registry, switchAccount: () => { account = 'other'; } };
}
async function fixture() {
  const mainnet = destination('public_mainnet', 'club-mainnet');
  const engine = destination('cloud_engine', 'club-engine');
  const session = await openMixedMembershipSession(mainnet.context, [mainnet, engine]);
  return { mainnet, engine, session };
}
afterEach(() => { clearMixedMembershipRuntime(); clearRoleGrantsMemo(); vi.unstubAllGlobals(); });

describe('one account, independently authorized mainnet and engine clubs', () => {
  it('keeps mainnet administrator rights separate from engine player rights and rejects foreign role mirrors', async () => {
    vi.stubGlobal('location', { hostname: 'localhost' });
    const { session, mainnet } = await fixture();
    roleMocks.read.mockImplementation(async (target: { networkKind: string }) => target.networkKind === 'cloud_engine'
      ? [{ role: 'player', club: ['club-engine'], team: ['engine-team'] },
        { role: 'club_admin', club: ['club-mainnet'], team: [] }, { role: 'app_admin', club: [], team: [] }]
      : [{ role: 'club_admin', club: ['club-mainnet'], team: [] }]);
    installMixedMembershipRuntime({ session, locate: async () => null });
    expect(await fetchMyRoleGrantsEverywhere(mainnet.context)).toEqual([
      { role: 'player', club: ['club-engine'], team: ['engine-team'] },
      { role: 'club_admin', club: ['club-mainnet'], team: [] },
    ]);
  });

  it('sends and reads back separate chat histories through the installed mixed dispatcher', async () => {
    vi.stubGlobal('location', { hostname: 'localhost' }); const { session, mainnet } = await fixture();
    const histories = new Map<string, string[]>();
    installMixedMembershipRuntime({ session, locate: async () => null });
    for (const [club, body] of [['club-mainnet', 'Mainnet club only'], ['club-engine', 'Engine club only']]) {
      await dispatchMixedMembership(mainnet.context, 'messaging_domain', { clubId: club, writeKey: `send-${club}`, attempts: 1 }, async ctx => {
        const key = ctx.target.canisterIds.messaging_domain;
        const messages = histories.get(key) ?? []; messages.push(body); histories.set(key, messages); return body;
      });
    }
    const read = async (ctx: FeatureBackendContext) => histories.get(ctx.target.canisterIds.messaging_domain);
    expect(await dispatchMixedMembership(mainnet.context, 'messaging_domain', { clubId: 'club-mainnet' }, read)).toEqual({ value: ['Mainnet club only'] });
    expect(await dispatchMixedMembership(mainnet.context, 'messaging_domain', { clubId: 'club-engine' }, read)).toEqual({ value: ['Engine club only'] });
  });
  it('discovers both clubs despite both deployments naming their group base', async () => {
    const { session } = await fixture();
    expect(session.memberClubIds).toEqual(['club-engine', 'club-mainnet']);
    expect(session.principal).toBe('member'); session.dispose();
  });
  it('routes every permission and messaging authority together to the owning club', async () => {
    const { session } = await fixture();
    for (const club of ['club-mainnet', 'club-engine']) {
      const result = await session.readClub(club, 'messaging_domain', async ctx => ({
        account: ctx.identity.getPrincipal().toText(), kind: ctx.target.networkKind,
        club: ctx.target.canisterIds.club_domain, chat: ctx.target.canisterIds.messaging_domain,
        scoped: isScopedContext(ctx),
      }));
      const alias = club === 'club-engine' ? 'engine' : 'mainnet';
      expect(result).toEqual({ account: 'member', kind: alias === 'engine' ? 'cloud_engine' : 'public_mainnet',
        club: `${alias}-0-cai`, chat: `${alias}-2-cai`, scoped: true });
    }
    session.dispose();
  });
  it('refuses an unjoined club before calling its chat service', async () => {
    const { session } = await fixture(); const read = vi.fn();
    await expect(session.readClub('outsider-club', 'messaging_domain', read)).rejects.toThrow('outside');
    expect(read).not.toHaveBeenCalled(); session.dispose();
  });
  it('removal from one club refuses its reads and sends without affecting the other club', async () => {
    const { session } = await fixture();
    const service = vi.fn(async (ctx: FeatureBackendContext) => {
      if (ctx.target.networkKind === 'cloud_engine') throw new Error('Club membership revoked');
      return 'mainnet-message';
    });
    await expect(session.readClub('club-engine', 'messaging_domain', service)).rejects.toThrow('revoked');
    await expect(session.writeClub('club-engine', 'messaging_domain', 'send-1', service)).rejects.toThrow('revoked');
    expect(await session.readClub('club-mainnet', 'messaging_domain', service)).toBe('mainnet-message');
    session.dispose();
  });
  it('a lost engine send is attempted once and never redirected to mainnet', async () => {
    const { session } = await fixture(); const send = vi.fn(async (_ctx: FeatureBackendContext) => { throw new Error('network reply lost'); });
    await expect(session.writeClub('club-engine', 'messaging_domain', 'message-1', send)).rejects.toThrow('uncertain');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0].target.networkKind).toBe('cloud_engine');
    expect(await session.readClub('club-mainnet', 'club_domain', async ctx => ctx.target.alias)).toBe('mainnet');
    session.dispose();
  });
  it('empty engine membership is valid and does not read engine chats', async () => {
    const a = destination('public_mainnet', 'club-mainnet'), b = destination('cloud_engine', '');
    const session = await openMixedMembershipSession(a.context, [a, b]);
    const read = vi.fn(async ctx => ctx.target.alias);
    expect(await session.readMembers('messaging_domain', read)).toEqual(['mainnet']);
    expect(read).toHaveBeenCalledTimes(1); session.dispose();
  });
  it('engine discovery failure never becomes a successful mainnet-only membership list', async () => {
    const a = destination('public_mainnet', 'club-mainnet'), b = destination('cloud_engine', 'club-engine');
    b.transport.readMemberships = async () => { throw new Error('Engine unavailable'); };
    await expect(openMixedMembershipSession(a.context, [a, b])).rejects.toThrow('Engine unavailable');
  });
  it('rejects a club claimed by both destinations', async () => {
    const a = destination('public_mainnet', 'same-club'), b = destination('cloud_engine', 'same-club');
    await expect(openMixedMembershipSession(a.context, [a, b])).rejects.toThrow('multiple destinations');
  });
  it('refuses mismatched account authorities before membership reads', async () => {
    const a = destination('public_mainnet', 'club-mainnet'), b = destination('cloud_engine', 'club-engine');
    b.context.target.canisterIds.identity_access = 'foreign-identity-cai';
    await expect(openMixedMembershipSession(a.context, [a, b])).rejects.toThrow('shared account');
    expect(a.transport.readMemberships).not.toHaveBeenCalled(); expect(b.transport.readMemberships).not.toHaveBeenCalled();
  });
  it('refuses another principal before membership reads', async () => {
    const a = destination('public_mainnet', 'club-mainnet'), b = destination('cloud_engine', 'club-engine'); b.switchAccount();
    await expect(openMixedMembershipSession(a.context, [a, b])).rejects.toThrow('shared account');
    expect(b.transport.readMemberships).not.toHaveBeenCalled();
  });
  it('rejects destination changes and late replies after account switching', async () => {
    const { session, engine } = await fixture();
    await expect(session.readClub('club-engine', 'messaging_domain', async () => { engine.switchAccount(); return 'private'; }))
      .rejects.toThrow('changed'); session.dispose();
  });
  it('registry drift blocks a send before the mutation callback', async () => {
    const { session, engine } = await fixture(); engine.registry.revision = 2n; const send = vi.fn();
    await expect(session.writeClub('club-engine', 'messaging_domain', 'm-1', send)).rejects.toThrow('registry changed');
    expect(send).not.toHaveBeenCalled(); session.dispose();
  });
  it('dispatches club chats, combined inbox and shared DMs through the mixed runtime', async () => {
    vi.stubGlobal('location', { hostname: 'localhost' });
    const { session, mainnet } = await fixture();
    installMixedMembershipRuntime({ session, locate: async ctx => ctx.target.networkKind === 'cloud_engine' ? 'club-engine' : null });
    const read = async (ctx: FeatureBackendContext) => ctx.target.alias;
    expect(await dispatchMixedMembership(mainnet.context, 'messaging_domain', { clubId: 'club-engine' }, read)).toEqual({ value: 'engine' });
    expect(await dispatchMixedMembership(mainnet.context, 'messaging_domain', { conversationId: 'engine-chat' }, read)).toEqual({ value: 'engine' });
    expect(await dispatchMixedMembership(mainnet.context, 'messaging_domain', { memberGroups: true, merge: parts => parts }, read))
      .toEqual({ value: ['mainnet', 'engine'] });
    expect(await dispatchMixedMembership(mainnet.context, 'messaging_domain', { shared: 'person' }, read)).toEqual({ value: 'mainnet' });
    await expect(dispatchMixedMembership(mainnet.context, 'messaging_domain', undefined, read)).rejects.toThrow('club scope');
  });
  it('cannot activate mixed membership on a published site before engine acceptance', async () => {
    vi.stubGlobal('location', { hostname: 'igniteclubhq.app' }); const { session } = await fixture();
    expect(() => installMixedMembershipRuntime({ session, locate: async () => null })).toThrow('acceptance'); session.dispose();
  });
  it('sign-out disposes both destinations and refuses retained session operations', async () => {
    vi.stubGlobal('location', { hostname: 'localhost' }); const { session } = await fixture();
    installMixedMembershipRuntime({ session, locate: async () => null }); clearMixedMembershipRuntime();
    await expect(session.readClub('club-engine', 'messaging_domain', vi.fn())).rejects.toThrow('disposed');
  });
});