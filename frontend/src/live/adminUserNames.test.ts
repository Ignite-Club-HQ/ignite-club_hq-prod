import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import type { FeatureBackendContext } from './featureRouter';
import { unlockAdminUserNames } from './adminUserNames';
const mocks = vi.hoisted(() => ({ hydrate: vi.fn(), resolve: vi.fn() }));
vi.mock('./privateProfileNames', () => ({ hydratePrivateProfileNames: mocks.hydrate }));
vi.mock('./adminNameAuthority', () => ({ createAdminNameAuthorityResolver: () => mocks.resolve }));
beforeEach(() => vi.clearAllMocks());
describe('admin users names-only cross-group requests', () => {
  it('requests names from both original groups under the shared server-checked admin scope', async () => {
    const identity = Principal.fromText('mq2sj-fiaaa-aaaal-qxlqa-cai');
    const ctx = { target: { canisterIds: { identity_access: identity.toText() } } } as unknown as FeatureBackendContext;
    const subjects = [1, 2].map(n => Principal.fromUint8Array(Uint8Array.from([n, 1])));
    const rows = subjects.map((principal, n) => ({ account_id: `account-${n}`, principal,
      display_name: `pii-display-name:v1:${n ? 'zt5a6-yiaaa-aaaal-qxp5q-cai' : 'iui5p-aaaaa-aaaal-qxllq-cai'}:${principal.toText()}` }));
    mocks.hydrate.mockResolvedValue([{ display_name: 'Member One' }, { display_name: 'Member Two' }]);
    const names = await unlockAdminUserNames(ctx, rows);
    expect([...names]).toEqual([['account-0', 'Member One'], ['account-1', 'Member Two']]);
    expect(mocks.hydrate).toHaveBeenCalledWith(ctx, rows, { audience: { kind: 'app_admin', authority: identity, resource: 'all', profile_revision: 0n }, partialNames: true, resolveAuthority: mocks.resolve });
  });
  it('uses the saved original alias rather than the first login alias', async () => {
    const ctx = { target: { canisterIds: { identity_access: 'mq2sj-fiaaa-aaaal-qxlqa-cai' } } } as unknown as FeatureBackendContext;
    const aliases = [1, 2].map(n => Principal.fromUint8Array(Uint8Array.from([n, 1])));
    const row = { account_id: 'linked-account', principals: aliases, display_name: `pii-display-name:v1:iui5p-aaaaa-aaaal-qxllq-cai:${aliases[1].toText()}` };
    mocks.hydrate.mockResolvedValue([{ display_name: 'Linked Member' }]);
    expect((await unlockAdminUserNames(ctx, [row])).get('linked-account')).toBe('Linked Member');
    expect(mocks.hydrate.mock.calls[0][1][0].principal).toEqual(aliases[1]);
  });
  it('never unlocks a reference whose subject is not an account alias', async () => {
    const ctx = { target: { canisterIds: { identity_access: 'mq2sj-fiaaa-aaaal-qxlqa-cai' } } } as unknown as FeatureBackendContext;
    const owner = Principal.fromUint8Array(Uint8Array.from([1, 1]));
    const foreign = Principal.fromUint8Array(Uint8Array.from([2, 1]));
    const names = await unlockAdminUserNames(ctx, [{ account_id: 'member', principals: [owner], display_name: `pii-display-name:v1:iui5p-aaaaa-aaaal-qxllq-cai:${foreign.toText()}` }]);
    expect(names.size).toBe(0);
    expect(mocks.hydrate).not.toHaveBeenCalled();
  });
});