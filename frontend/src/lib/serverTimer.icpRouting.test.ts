import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ backend: 'icp', write: vi.fn(), read: vi.fn(), email: vi.fn() }));
vi.mock('@/live/authBackendMode', () => ({ resolveAuthBackend: () => mocks.backend }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: mocks.email }, auth: { getSession: mocks.email } } }));
vi.mock('@/live/featureRouter', () => ({ withFeatureBackend: async (_: unknown, providers: { icp: (ctx: unknown) => unknown }) => providers.icp({}) }));
vi.mock('@/live/features/events', () => ({ setLiveEventTimer: mocks.write, getLiveEventTimer: mocks.read }));
import { isServerTimerEligibleTeamId, sendTimerEvent, readServerTimer } from './serverTimer';
const teamId = 'team-club-a-1-1795340400000';
const timer = { current_half: 1, minutes_per_half: 20, half_started_at_ms: [1000n], half_paused_at_ms: [], half_ended_at_ms: [], accumulated_pause_ms: 0n, is_running: true, is_game_finished: false, last_event_at_ms: 1000n };
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); mocks.backend = 'icp'; mocks.write.mockResolvedValue(timer); mocks.read.mockResolvedValue([timer]); });
describe('ICP exact linked timer routing', () => {
  it.each(['start_half', 'pause', 'resume', 'end_half', 'start_half_2', 'end_game'] as const)('dispatches %s for an actual generated team id to the exact fixture', async event => {
    expect(isServerTimerEligibleTeamId(teamId)).toBe(true);
    const response = await sendTimerEvent({ teamId, eventId: 'fixture-exact', event, minutesPerHalf: 20 });
    expect(mocks.write).toHaveBeenCalledWith({}, 'fixture-exact', event, 20, null);
    expect(response.row_id).toBe('fixture-exact');
    expect(response.timer_state.schema_version).toBe(2);
    expect(mocks.email).not.toHaveBeenCalled();
  });
  it('reads a restored board linkage without retaining a stale event cache', async () => {
    const key = `ignite-pitch-board-state-team-${teamId}`;
    localStorage.setItem(key, JSON.stringify({ teamId, linkedEventId: 'first' }));
    expect((await readServerTimer(teamId)).row_id).toBe('first');
    localStorage.setItem(key, JSON.stringify({ teamId, linkedEventId: 'second' }));
    expect((await readServerTimer(teamId)).row_id).toBe('second');
    expect(mocks.read).toHaveBeenLastCalledWith({}, 'second');
  });
  it('does not guess a fixture for an unlinked or mismatched board', async () => {
    localStorage.setItem(`ignite-pitch-board-state-team-${teamId}`, JSON.stringify({ teamId: 'foreign', linkedEventId: 'foreign-event' }));
    await expect(sendTimerEvent({ teamId, event: 'start_half' })).rejects.toThrow('not-applicable');
    expect((await readServerTimer(teamId)).found).toBe(false);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.email).not.toHaveBeenCalled();
  });
  it('preserves read refusal rather than treating it as a missing clock', async () => {
    mocks.read.mockRejectedValueOnce(new Error('Forbidden'));
    await expect(readServerTimer(teamId, 'exact')).rejects.toThrow('Forbidden');
    expect(mocks.email).not.toHaveBeenCalled();
  });
  it('keeps group timers separate and preserves email UUID eligibility', () => {
    expect(isServerTimerEligibleTeamId('event-group-123')).toBe(false);
    expect(isServerTimerEligibleTeamId(null)).toBe(false);
    mocks.backend = 'supabase';
    expect(isServerTimerEligibleTeamId(teamId)).toBe(false);
    expect(isServerTimerEligibleTeamId(null)).toBe(true);
    expect(isServerTimerEligibleTeamId('00000000-0000-4000-8000-000000000001')).toBe(true);
  });
});