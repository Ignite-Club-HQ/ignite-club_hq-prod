import { act } from 'react';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerTimer, TimerReadResponse, TimerEventResponse } from '@/lib/serverTimer';
import GameTimerWidget from './GameTimerWidget';

const mocks = vi.hoisted(() => ({ read: vi.fn(), send: vi.fn(), toast: vi.fn(), backend: 'icp' }));
vi.mock('@/live/authBackendMode', () => ({ resolveAuthBackend: () => mocks.backend }));
vi.mock('@/lib/serverTimer', async original => ({ ...await original<typeof import('@/lib/serverTimer')>(), readServerTimer: mocks.read, sendTimerEvent: mocks.send }));
vi.mock('@/hooks/useWakeLock', () => ({ useWakeLock: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ toast: mocks.toast }));
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }) } }));

const NOW = Date.UTC(2026, 10, 24, 22);
const teamId = 'team-club-a-1';
const eventId = 'fixture-exact';
function timer(running: boolean, timestamp = NOW): ServerTimer {
  return { schema_version: 2, current_half: 1, minutes_per_half: 20, half_started_at: new Date(NOW - 30000).toISOString(), half_paused_at: running ? null : new Date(timestamp).toISOString(), accumulated_pause_ms: 0, is_running: running, is_game_finished: false, half_ended_at: null, last_event_at: new Date(timestamp).toISOString() };
}
function readResponse(value: ServerTimer): TimerReadResponse {
  return { found: true, timer_state: value, server_now: new Date(Date.now()).toISOString() };
}
function acknowledgement(): TimerEventResponse {
  return { ok: true, row_id: eventId, timer_state: timer(true), elapsed_seconds: 0, server_now: new Date(Date.now()).toISOString() };
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function settle() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }
function savedTimer() { return JSON.parse(localStorage.getItem(`pitch-board-timer-state-team-${teamId}`) ?? '{}'); }
function startButton() { return screen.getAllByRole('button')[0]; }

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW); vi.clearAllMocks(); localStorage.clear(); mocks.backend = 'icp';
  const state = { schema_version: 2, minutesPerHalf: 20, currentHalf: 1, elapsedSeconds: 30, isRunning: false, lastUpdateTime: NOW - 1000, teamId, eventId, teamName: 'Synthetic' };
  localStorage.setItem('pitch-board-timer-state', JSON.stringify(state));
  localStorage.setItem(`pitch-board-timer-state-team-${teamId}`, JSON.stringify(state));
  localStorage.setItem(`ignite-pitch-board-state-team-${teamId}`, JSON.stringify({ teamId, linkedEventId: eventId, players: [] }));
  mocks.read.mockResolvedValue({ found: false, server_now: new Date(NOW).toISOString() });
  mocks.send.mockResolvedValue(acknowledgement());
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Home secure-sign-in timer start', () => {
  it('never lets a delayed mount read undo an acknowledged start', async () => {
    const read = deferred<TimerReadResponse>(); mocks.read.mockReturnValueOnce(read.promise);
    render(<GameTimerWidget />); await settle();
    fireEvent.click(startButton()); await settle();
    expect(savedTimer().isRunning).toBe(true);
    read.resolve(readResponse(timer(false, NOW - 1000))); await settle();
    expect(savedTimer().isRunning).toBe(true);
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith({ teamId, eventId, event: 'resume', minutesPerHalf: 20 });
  });
  it('rejects a stale paused snapshot on a later foreground read', async () => {
    render(<GameTimerWidget />); await settle();
    fireEvent.click(startButton()); await settle();
    mocks.read.mockResolvedValue(readResponse(timer(false, NOW - 1000)));
    window.dispatchEvent(new Event('focus')); await settle();
    expect(savedTimer().isRunning).toBe(true);
  });
  it('shows a pending start and prevents duplicate commands until acknowledgement', async () => {
    const send = deferred<TimerEventResponse>(); mocks.send.mockReturnValueOnce(send.promise);
    render(<GameTimerWidget />); await settle();
    fireEvent.click(startButton()); await settle();
    expect(startButton()).toBeDisabled();
    fireEvent.click(startButton()); expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(savedTimer().isRunning).toBe(false);
    send.resolve(acknowledgement()); await settle();
    expect(savedTimer().isRunning).toBe(true); expect(startButton()).not.toBeDisabled();
  });
  it('does not write a delayed start acknowledgement into a relinked match', async () => {
    const send = deferred<TimerEventResponse>(); mocks.send.mockReturnValueOnce(send.promise);
    render(<GameTimerWidget />); await settle(); fireEvent.click(startButton());
    localStorage.setItem(`ignite-pitch-board-state-team-${teamId}`, JSON.stringify({ teamId, linkedEventId: 'different-fixture', players: [] }));
    send.resolve(acknowledgement()); await settle();
    expect(savedTimer().isRunning).toBe(false);
  });
  it('preserves email-mode immediate local start', async () => {
    mocks.backend = 'supabase'; mocks.send.mockReturnValue(new Promise(() => {}));
    render(<GameTimerWidget />); await settle(); fireEvent.click(startButton());
    expect(savedTimer().isRunning).toBe(true);
  });
});