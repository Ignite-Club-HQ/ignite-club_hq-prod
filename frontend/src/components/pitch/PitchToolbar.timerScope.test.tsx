import { act, createRef, type ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PitchToolbar from './PitchToolbar';
import type { GameTimerRef } from './GameTimer';

const server = vi.hoisted(() => ({ send: vi.fn(), read: vi.fn() }));
vi.mock('@/live/authBackendMode', () => ({ resolveAuthBackend: () => 'icp' }));
vi.mock('@/lib/serverTimer', async original => ({ ...await original<typeof import('@/lib/serverTimer')>(), sendTimerEvent: server.send, readServerTimer: server.read }));
vi.mock('@/hooks/useWakeLock', () => ({ useWakeLock: vi.fn() }));
vi.mock('@/lib/notifications', () => ({ requestNotificationPermission: vi.fn(), showBrowserNotification: vi.fn() }));
vi.mock('./SyncStatusIndicator', () => ({ SyncStatusIndicator: () => null }));
vi.mock('./PitchSettingsDialog', () => ({ PitchSettingsDialog: () => null }));
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }) } }));

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  server.read.mockResolvedValue({ found: false, server_now: new Date().toISOString() });
  server.send.mockResolvedValue({ ok: true, row_id: 'fixture-exact', timer_state: { schema_version: 2, current_half: 1, minutes_per_half: 20, half_started_at: new Date().toISOString(), half_paused_at: null, accumulated_pause_ms: 0, is_running: true, is_game_finished: false, half_ended_at: null, last_event_at: new Date().toISOString() }, server_now: new Date().toISOString() });
});
afterEach(cleanup);
describe('alternate pitch controls retain the linked match', () => {
  it.each([
    ['portrait', false], ['portrait', true], ['landscape', false],
  ] as const)('%s collapsed=%s starts the exact linked fixture', async (variant, collapsed) => {
    const ref = createRef<GameTimerRef>();
    const noop = vi.fn();
    const props: ComponentProps<typeof PitchToolbar> = {
      teamId: 'team-club-a-1', teamName: 'Synthetic', linkedEventId: 'fixture-exact', minutesPerHalf: 20,
      teamSize: '7', onTeamSizeChange: noop, selectedFormation: 0, onFormationChange: noop, formations: [],
      gameTimerRef: ref, onTimerUpdate: noop, onHalfChange: noop, disableAutoSubs: true, autoSubActive: false,
      autoSubPaused: false, autoSubPlan: [], onOpenNewPlan: noop, onTogglePause: noop, onCancelPlan: noop, onOpenEditPlan: noop,
      subMode: false, onToggleSubMode: noop, selectedOnPitch: null, onOpenSubPreview: noop,
      drawingTool: 'none', onDrawingToolChange: noop, drawingColor: '', onDrawingColorChange: noop, onClearDrawings: noop,
      zoom: 1, onZoomIn: noop, onZoomOut: noop, onResetZoom: noop, onOpenStats: noop, mockMode: false,
      onMockModeChange: noop, onOpenPositionEditor: noop, saveDialogOpen: false, onSaveDialogOpenChange: noop,
      loadDialogOpen: false, onLoadDialogOpenChange: noop, formationName: '', onFormationNameChange: noop,
      onSaveFormation: noop, savePending: false, loadingFormations: false, savedFormations: [], onLoadFormation: noop,
      onDeleteFormation: noop, players: [], variant, collapsed,
    };
    render(<PitchToolbar {...props} />);
    if (variant === 'landscape') fireEvent.click(screen.getByRole('button', { name: /Game Setup/i }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(ref.current).not.toBeNull();
    await act(async () => { ref.current?.toggleTimer(); });
    expect(server.send).toHaveBeenCalledExactlyOnceWith({ teamId: 'team-club-a-1', eventId: 'fixture-exact', event: 'start_half', minutesPerHalf: 20 });
    expect(ref.current?.isRunning()).toBe(true);
  });
});