import { describe, expect, it, vi } from 'vitest';

const actor = { delete_club_permanent: vi.fn(), delete_team_permanent: vi.fn() };
vi.mock('@/live/domains', async (orig) => ({ ...(await orig<object>()), connectLiveClubDomain: async () => ({ actor }) }));

import { deleteLiveClubPermanent, deleteLiveTeamPermanent } from './club';

const ctx = {} as never;

describe('permanent deletion sends the typed name for server confirmation', () => {
  it('club', async () => {
    actor.delete_club_permanent.mockResolvedValue({ Ok: null });
    await deleteLiveClubPermanent(ctx, 'club-1', 'Ignite Soccer');
    expect(actor.delete_club_permanent).toHaveBeenCalledWith('club-1', ['Ignite Soccer']);
  });
  it('team', async () => {
    actor.delete_team_permanent.mockResolvedValue({ Ok: null });
    await deleteLiveTeamPermanent(ctx, 'team-1', 'Under 10s');
    expect(actor.delete_team_permanent).toHaveBeenCalledWith('team-1', ['Under 10s']);
  });
});
