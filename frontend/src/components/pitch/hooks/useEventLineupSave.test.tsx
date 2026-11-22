import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ save: vi.fn(), read: vi.fn(), toast: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ toast: mocks.toast }));
vi.mock('../eventLineupRepository', () => ({ saveEventLineup: mocks.save, fetchEventLineup: mocks.read, lineupSignature: (s: unknown) => JSON.stringify(s) }));
import { useEventLineupSave } from './useEventLineupSave';
const job = { userId: 'coach', teamId: 'team-a', eventId: 'event-a', snapshot: { players: [], teamSize: '7' as const, selectedFormation: 1, savedAt: 1, version: 1 as const } };
const key = 'ignite_lineup_draft_coach_team-a_event-a';
async function tick() { await act(async () => { await vi.advanceTimersByTimeAsync(1200); }); }
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); sessionStorage.clear(); mocks.save.mockResolvedValue(true); });
afterEach(() => vi.useRealTimers());
describe('acknowledged lineup persistence', () => {
  it('commits its signature only after acknowledgement and deduplicates the same lineup', async () => {
    const hook = renderHook(({ value }) => useEventLineupSave(value), { initialProps: { value: job } });
    await tick();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(key)).toBeNull();
    hook.rerender({ value: { ...job, snapshot: { ...job.snapshot } } });
    await tick();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    hook.unmount();
  });
  it.each(['false', 'rejected'])('retains an unacknowledged %s save and reconciles an explicit same-state readback without replay', async outcome => {
    if (outcome === 'false') mocks.save.mockResolvedValueOnce(false);
    else mocks.save.mockRejectedValueOnce(new Error('unknown outcome'));
    const hook = renderHook(() => useEventLineupSave(job));
    await tick();
    expect(JSON.parse(sessionStorage.getItem(key) ?? '{}')).toEqual(job);
    await tick();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    mocks.read.mockResolvedValueOnce({ snapshot: job.snapshot });
    await act(async () => { mocks.toast.mock.calls.at(-1)?.[0].action.props.onClick(); });
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(key)).toBeNull();
    hook.unmount();
  });
  it('flushes the latest debounced lineup on close rather than cancelling it', async () => {
    const hook = renderHook(() => useEventLineupSave(job));
    await act(async () => hook.unmount());
    expect(mocks.save).toHaveBeenCalledWith(job);
  });
  it('does not replay an interrupted write on remount', async () => {
    sessionStorage.setItem(key, JSON.stringify(job));
    const hook = renderHook(() => useEventLineupSave(job));
    await tick();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(key)).not.toBeNull();
    hook.unmount();
  });
  it('never overwrites a different coach’s saved lineup after a lost acknowledgement', async () => {
    sessionStorage.setItem(key, JSON.stringify(job));
    mocks.read.mockResolvedValueOnce({ snapshot: { ...job.snapshot, selectedFormation: 3 } });
    const hook = renderHook(() => useEventLineupSave(job));
    await tick();
    await act(async () => mocks.toast.mock.calls.at(-1)?.[0].action.props.onClick());
    expect(mocks.save).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem(key) ?? '{}')).toEqual(job);
    hook.unmount();
  });
  it('an old retry action cannot write after an account change', async () => {
    mocks.save.mockResolvedValueOnce(false);
    const hook = renderHook(({ value }) => useEventLineupSave(value), { initialProps: { value: job } });
    await tick();
    const retry = mocks.toast.mock.calls.at(-1)?.[0].action.props.onClick;
    hook.rerender({ value: { ...job, userId: 'different' } });
    await act(async () => retry());
    expect(mocks.save).toHaveBeenCalledTimes(1);
    hook.unmount();
  });
});