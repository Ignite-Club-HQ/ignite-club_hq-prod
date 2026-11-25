import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAutoSubs } from './useAutoSubs';
import type { Player, SubstitutionEvent } from '@/components/pitch/types';
import type { GameTimerRef } from '@/components/pitch/GameTimer';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/pitch/GameTimer', () => ({ playSubAlertBeep: vi.fn() }));

const out: Player = { id: 'out', name: 'Alex', position: { x: 50, y: 50 } };
const incoming: Player = { id: 'in', name: 'Blake', position: null };
const oldPlan: SubstitutionEvent[] = Array.from({ length: 15 }, (_, i) => ({
  half: i < 8 ? 1 : 2, time: (i + 1) * 60,
  playerOut: out, playerIn: incoming, executed: i < 7, skipped: i < 2,
}));

function setup() {
  return renderHook(() => useAutoSubs({
    initialPlan: oldPlan, initialActive: true, initialPaused: true,
    gameTimerRef: { current: {
      getElapsedSeconds: () => 1200, getCurrentHalf: () => 2,
      getMinutesPerHalf: () => 25, isRunning: () => false,
    } as unknown as GameTimerRef },
    playersRef: { current: [out, incoming] }, setPlayers: vi.fn(), teamSize: '7',
    rotateGkAtHalftime: false, pushToUndoHistoryRef: { current: null },
    runSubAnimationRef: { current: null },
  }));
}

describe('new-game substitution progress', () => {
  it('starts a new kick-off at 0/15 rather than retaining the previous 7/15', () => {
    const { result } = setup();
    act(() => result.current.handleStartAutoSubPlan(oldPlan, true));
    expect(result.current.autoSubPlan).toHaveLength(15);
    expect(result.current.autoSubPlan.filter(s => s.executed)).toHaveLength(0);
    expect(result.current.autoSubPlan.filter(s => s.skipped)).toHaveLength(0);
    expect(result.current.autoSubActive).toBe(true);
    expect(result.current.autoSubPaused).toBe(false);
    expect(oldPlan.filter(s => s.executed)).toHaveLength(7);
  });

  it('can cancel a plan that already contains completed substitutions', () => {
    const { result } = setup();
    act(() => result.current.handleCancelAutoSubPlan());
    expect(result.current.autoSubPlan).toEqual([]);
    expect(result.current.autoSubActive).toBe(false);
  });

  it('keeps 7/15 when resuming or editing the same game', () => {
    const { result } = setup();
    act(() => result.current.handleStartAutoSubPlan(oldPlan));
    expect(result.current.autoSubPlan.filter(s => s.executed)).toHaveLength(7);
  });

  it('clears used subs and pending prompts on a silent new-game reset', () => {
    const { result } = setup();
    act(() => {
      result.current.setPendingAutoSub(oldPlan[8]);
      result.current.setPendingBatchSubs([oldPlan[9]]);
      result.current.setSubConfirmDialogOpen(true);
      result.current.skipCooldownRef.current = Date.now();
    });
    act(() => result.current.resetAutoSubs());
    expect(result.current.autoSubPlan).toEqual([]);
    expect(result.current.autoSubPaused).toBe(false);
    expect(result.current.pendingAutoSub).toBeNull();
    expect(result.current.pendingBatchSubs).toEqual([]);
    expect(result.current.subConfirmDialogOpen).toBe(false);
    expect(result.current.skipCooldownRef.current).toBe(0);
  });

  it('adopts a shared new-game 0/15 snapshot even after local 7/15 progress', () => {
    const { result } = setup();
    const fresh = oldPlan.map(s => ({ ...s, executed: false, skipped: false }));
    act(() => result.current.restoreAutoSubs(fresh, true, false));
    expect(result.current.autoSubPlan.filter(s => s.executed)).toHaveLength(0);
    expect(result.current.autoSubPlan).toHaveLength(15);
    expect(result.current.autoSubPaused).toBe(false);
  });

  it('still refuses ordinary edits that remove completed substitutions in the same game', () => {
    const { result } = setup();
    act(() => result.current.setAutoSubPlan(oldPlan.filter(s => !s.executed)));
    expect(result.current.autoSubPlan.filter(s => s.executed)).toHaveLength(7);
  });

  it('does not reset completed progress when saving a midgame plan edit', () => {
    const { result } = setup();
    act(() => result.current.handleStartAutoSubPlan(oldPlan.map(s => ({ ...s, executed: false }))));
    expect(result.current.autoSubPlan.filter(s => s.executed)).toHaveLength(7);
  });
});