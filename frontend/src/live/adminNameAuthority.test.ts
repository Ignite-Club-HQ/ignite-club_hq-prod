import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { GROUP_DOMAINS } from './groupRouting';
import type { FeatureBackendContext } from './featureRouter';
import { groupApprovalConfiguration, approvalConfigurationSha256 } from './groupApproval';
import { createAdminNameAuthorityResolver } from './adminNameAuthority';

const mocks = vi.hoisted(() => ({ page: vi.fn(), approval: vi.fn(), dev: vi.fn() }));
vi.mock('./domains', () => ({ connectLiveShardRouter: async () => ({ actor: { read_group_registry_page: mocks.page, read_routing_approval: mocks.approval } }) }));
vi.mock('./devCrossGroupTeamNameRoute', () => ({ createDevCrossGroupTeamNameResolver: (...args: unknown[]) => mocks.dev(...args) }));
vi.mock('./generated/routingGates', () => ({ ROUTING_GATES_SNAPSHOT: { approved: true, host: 'https://icp-api.io', routerCanisterId: 'jcdfe-vqaaa-aaaal-qxloq-cai', targetAlias: 'mainnet' } }));
const p = (n: number) => Principal.fromUint8Array(Uint8Array.from([n, 1]));
async function setup() {
  const subnet = p(120);
  const groups = ['base', 'g2', 'g3'].map((id, n) => ({ id, target_alias: 'mainnet', accepting: true, max_clubs: 100,
    heap_budget_bytes: 10000n, min_cycles: 0n, photo_store: [],
    domains: GROUP_DOMAINS.map((domain, i) => ({ domain, canister: p(1 + n * 25 + i) })) }));
  const placements = groups.map(g => ({ group_id: g.id, deployment_id: 'mainnet', deployment_revision: 1n,
    host: 'https://icp-api.io', network_kind: 'public_mainnet', primary_subnet: subnet, approved_subnets: [subnet], additional_subnets_enabled: false,
    domains: g.domains.map(d => ({ ...d, subnet })) }));
  const registry = { revision: 12n, configuration_revision: [3n], groups, placements, next_cursor: [] };
  mocks.page.mockImplementation(async () => ({ Ok: registry }));
  const approved = { target_alias: 'mainnet', configuration_revision: 3n, removal_wiring_group_ids: groups.map(g => g.id),
    approved_configuration_sha256: await approvalConfigurationSha256(groupApprovalConfiguration(groups as Parameters<typeof groupApprovalConfiguration>[0], placements)) };
  mocks.approval.mockImplementation(async () => ({ Ok: [approved] }));
  const ctx = { identity: { getPrincipal: () => p(110) }, target: { provider: 'icp', alias: 'icp-public-mainnet', host: 'https://icp-api.io', networkKind: 'public_mainnet',
    canisterIds: { identity_access: p(111).toText(), shard_router: 'jcdfe-vqaaa-aaaal-qxloq-cai', pii_access_control: groups[0].domains.find(d => d.domain === 'pii_access_control')?.canister.toText() } } } as unknown as FeatureBackendContext;
  const authorities = groups.map(g => g.domains.find(d => d.domain === 'pii_access_control')?.canister.toText() ?? '');
  return { ctx, registry, approved, authorities, resolve: createAdminNameAuthorityResolver(ctx) };
}
beforeEach(() => { vi.clearAllMocks(); mocks.dev.mockReturnValue(undefined); });
describe('app-admin original names across every registered group', () => {
  it('routes base, group two and group three without changing name ownership or shared identity', async () => {
    const f = await setup();
    for (const authority of f.authorities) {
      const lease = await f.resolve(authority);
      expect(lease.context.target.canisterIds.pii_access_control).toBe(authority);
      expect(lease.context.target.canisterIds.identity_access).toBe(f.ctx.target.canisterIds.identity_access);
      expect(lease.context.identity).toBe(f.ctx.identity);
      await lease.confirm();
    }
    expect(f.ctx.target.canisterIds.pii_access_control).toBe(f.authorities[0]);
  });
  it('does not contact a browser-selected unregistered name store', async () => {
    const f = await setup();
    await expect(f.resolve(p(115).toText())).rejects.toThrow('verified deployment');
  });
  it('rejects a missing group in governor approval', async () => {
    const f = await setup(); f.approved.removal_wiring_group_ids.pop();
    await expect(f.resolve(f.authorities[2])).rejects.toThrow('not been approved');
  });
  it('rejects replaced name stores even when the claimed configuration revision is unchanged', async () => {
    const f = await setup(); f.registry.groups[1].domains[0].canister = p(116);
    await expect(f.resolve(f.authorities[1])).rejects.toThrow('not been approved');
  });
  it('rejects registry changes after key reads instead of attaching stale names', async () => {
    const f = await setup(); const lease = await f.resolve(f.authorities[1]); f.registry.revision++;
    await expect(lease.confirm()).rejects.toThrow('stale');
  });
  it('rejects a sign-in replacement during readback', async () => {
    const f = await setup(); const lease = await f.resolve(f.authorities[1]);
    f.ctx.identity = { getPrincipal: () => p(112) } as FeatureBackendContext['identity'];
    await expect(lease.confirm()).rejects.toThrow('sign-in');
  });
  it('keeps the separately pinned legacy DEV source resolver rather than inventing a registry entry', async () => {
    const f = await setup();
    const confirm = vi.fn(); const dev = vi.fn(async () => ({ context: f.ctx, confirm })); mocks.dev.mockReturnValue(dev);
    const lease = await createAdminNameAuthorityResolver(f.ctx)('iui5p-aaaaa-aaaal-qxllq-cai');
    await lease.confirm();
    expect(dev).toHaveBeenCalledWith('iui5p-aaaaa-aaaal-qxllq-cai');
    expect(confirm).toHaveBeenCalledOnce();
    expect(mocks.page).not.toHaveBeenCalled();
  });
  it('opens both DEV name sources when the admin page starts on the original shared group', async () => {
    const f = await setup();
    Object.assign(f.ctx.target.canisterIds, { identity_access: 'mq2sj-fiaaa-aaaal-qxlqa-cai', shard_router: 'jcdfe-vqaaa-aaaal-qxloq-cai', club_domain: 'mzzzv-taaaa-aaaal-qxlrq-cai', pii_access_control: 'iui5p-aaaaa-aaaal-qxllq-cai' });
    const dev = vi.fn(async (authority: string) => ({ context: { ...f.ctx, target: { ...f.ctx.target, canisterIds: { ...f.ctx.target.canisterIds, pii_access_control: authority } } }, confirm: vi.fn() }));
    mocks.dev.mockReturnValue(dev);
    const resolve = createAdminNameAuthorityResolver(f.ctx);
    for (const authority of ['iui5p-aaaaa-aaaal-qxllq-cai', 'zt5a6-yiaaa-aaaal-qxp5q-cai']) {
      expect((await resolve(authority)).context.target.canisterIds.pii_access_control).toBe(authority);
    }
    expect(mocks.dev).toHaveBeenLastCalledWith(expect.objectContaining({ target: expect.objectContaining({ canisterIds: expect.objectContaining({ club_domain: 'yfwyv-nyaaa-aaaal-qxpyq-cai', pii_access_control: 'zt5a6-yiaaa-aaaal-qxp5q-cai' }) }) }));
    expect(f.ctx.target.canisterIds.pii_access_control).toBe('iui5p-aaaaa-aaaal-qxllq-cai');
  });
});