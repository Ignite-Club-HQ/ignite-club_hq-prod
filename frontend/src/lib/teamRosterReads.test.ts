import { describe, it, expect, vi, beforeEach } from 'vitest';
const m = vi.hoisted(() => ({ ids: vi.fn(), assignments: vi.fn(), scope: vi.fn() }));
vi.mock('@/live/features/club', () => ({ listLiveTeamChildIds: m.ids }));
vi.mock('@/live/contentRouting', () => ({ readContentInScope: async (ctx: unknown, feature: string, scope: unknown, call: (ctx: unknown) => unknown) => {
  m.scope(feature, scope); return call(ctx);
} }));
vi.mock('@/live/features/events', () => ({ listLiveChildTeamAssignments: m.assignments }));
import { readTeamChildRows, teamRoleRows, teamRosterReadFailureCode } from './teamRosterReads';
import type { FeatureBackendContext } from '@/live/featureRouter';
describe('authorized team roster reads', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('reads all team child IDs from the canonical club-domain source, without legacy Events reads', async () => {
    m.ids.mockResolvedValueOnce(['child-9', 'child-10']);
    const ctx = {} as FeatureBackendContext;
    const rows = await readTeamChildRows(ctx, 'club-2', 'team-9');
    expect(m.ids).toHaveBeenCalledWith(ctx, 'club-2', 'team-9');
    expect(rows.map(row => row.child_id)).toEqual(['child-9', 'child-10']);
    expect(m.assignments).not.toHaveBeenCalled();
    expect(m.scope).not.toHaveBeenCalled();
  });
  it('never falls back or fabricates an empty roster when membership is denied', async () => {
    m.ids.mockRejectedValueOnce(new Error('Club membership required'));
    await expect(readTeamChildRows({} as FeatureBackendContext, 'club-2', 'team-9')).rejects.toThrow('Club membership required');
    expect(m.assignments).not.toHaveBeenCalled();
  });
  it('uses legacy scoped Events reads only if the new canister method is absent', async () => {
    m.ids.mockRejectedValueOnce(new Error('has no update method'));
    m.assignments.mockResolvedValueOnce([{ child_id: 'child-9' }]);
    const ctx = {} as FeatureBackendContext;
    const rows = await readTeamChildRows(ctx, 'club-2', 'team-9');
    expect(m.scope).toHaveBeenCalledWith('events', { clubId: 'club-2' });
    expect(m.assignments).toHaveBeenCalledWith(ctx, 'club-2', 'team-9');
    expect(rows.map(row => row.child_id)).toEqual(['child-9']);
  });
  it('preserves denied legacy reads without substituting another child roster', async () => {
    m.ids.mockRejectedValueOnce(new Error('method not found'));
    m.assignments.mockRejectedValueOnce(new Error('Forbidden'));
    await expect(readTeamChildRows({} as FeatureBackendContext, 'club-2', 'team-9')).rejects.toThrow('Forbidden');
  });
  it('retries one transient browser transport failure without changing the identity or club', async () => {
    m.ids.mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce(['child-9', 'child-10']);
    const ctx = {} as FeatureBackendContext;
    const rows = await readTeamChildRows(ctx, 'club-2', 'team-9');
    expect(rows.map(row => row.child_id)).toEqual(['child-9', 'child-10']);
    expect(m.ids).toHaveBeenCalledTimes(2);
    expect(m.ids).toHaveBeenNthCalledWith(2, ctx, 'club-2', 'team-9');
    expect(m.assignments).not.toHaveBeenCalled();
  });
  it('never retries a permission refusal or an identity failure', async () => {
    m.ids.mockRejectedValueOnce(new Error('Team membership required'));
    await expect(readTeamChildRows({} as FeatureBackendContext, 'club-2', 'team-9')).rejects.toThrow('Team membership required');
    expect(m.ids).toHaveBeenCalledTimes(1);
    vi.clearAllMocks();
    m.ids.mockRejectedValueOnce(new Error('Identity session changed'));
    await expect(readTeamChildRows({} as FeatureBackendContext, 'club-2', 'team-9')).rejects.toThrow('Identity session changed');
    expect(m.ids).toHaveBeenCalledTimes(1);
  });
  it('repeated transport faults fail closed and cannot fabricate an empty roster', async () => {
    m.ids.mockRejectedValueOnce(new Error('Failed to fetch')).mockRejectedValueOnce(new Error('Failed to fetch'));
    await expect(readTeamChildRows({} as FeatureBackendContext, 'club-2', 'team-9')).rejects.toThrow('Failed to fetch');
    expect(m.ids).toHaveBeenCalledTimes(2);
    expect(m.assignments).not.toHaveBeenCalled();
  });
  it('categorises player failures without exposing IDs or encrypted details', () => {
    expect(teamRosterReadFailureCode(new Error('Team membership required'))).toBe('PERMISSION');
    expect(teamRosterReadFailureCode(new Error('The team player list took too long to load.'))).toBe('TIMEOUT');
    expect(teamRosterReadFailureCode(new Error('Failed to fetch'))).toBe('TRANSPORT');
    expect(teamRosterReadFailureCode(new Error('Identity session changed'))).toBe('SESSION');
    expect(teamRosterReadFailureCode(new Error('Routing snapshot changed'))).toBe('ROUTING');
    expect(teamRosterReadFailureCode(new Error('unrecognised internal failure'))).toBe('OTHER');
  });
  it('normalizes principal roles without a private profile lookup', () => {
    expect(teamRoleRows([{ account_id: 'principal:abc', role: 'coach' }, { account_id: 'uuid', role: 'parent' }]))
      .toEqual([{ id: 'abc:coach', user_id: 'abc', role: 'coach', profiles: null }, { id: 'uuid:parent', user_id: 'uuid', role: 'parent', profiles: null }]);
  });
});
