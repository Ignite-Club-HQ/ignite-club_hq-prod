import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { CalendarExportMenu } from './CalendarExportMenu';

const opener = vi.hoisted(() => vi.fn());
const share = vi.hoisted(() => vi.fn());
const launch = vi.hoisted(() => vi.fn());
const write = vi.hoisted(() => vi.fn());
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('@capacitor-community/file-opener', () => ({ FileOpener: { open: opener } }));
vi.mock('@capacitor/share', () => ({ Share: { share } }));
vi.mock('@capacitor/app-launcher', () => ({ AppLauncher: { openUrl: launch } }));
vi.mock('@capacitor/filesystem', () => ({ Filesystem: { writeFile: write }, Directory: { Cache: 'CACHE' }, Encoding: { UTF8: 'utf8' } }));
const event = { id: 'one', title: 'Game', event_date: '2026-12-09', start_time: '18:30' };
beforeEach(() => { vi.resetAllMocks(); write.mockResolvedValue({ uri: 'file:///cache/game.ics' }); });

it('shows an actionable message after real export open and share failures', async () => {
  opener.mockRejectedValue(new Error('No handler')); share.mockRejectedValue(new Error('Unavailable'));
  const toast = vi.fn(); const user = userEvent.setup();
  render(<CalendarExportMenu event={event} toast={toast} />);
  await user.click(screen.getByRole('button', { name: 'Add to calendar' }));
  await user.click(screen.getByRole('menuitem', { name: 'Add to calendar (.ics)' }));
  expect(opener).toHaveBeenCalled(); expect(share).toHaveBeenCalled();
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', description: expect.stringMatching(/Google Calendar.*manually/) }));
});

it('opens the single-event Google option with the same event times and link', async () => {
  launch.mockResolvedValue({ completed: true });
  const toast = vi.fn(); const user = userEvent.setup();
  render(<CalendarExportMenu event={event} toast={toast} />);
  await user.click(screen.getByRole('button', { name: 'Add to calendar' }));
  await user.click(screen.getByRole('menuitem', { name: 'Add to Google Calendar' }));
  const url = new URL(launch.mock.calls[0][0].url);
  expect(url.searchParams.get('dates')).toBe('20261209T080000Z/20261209T090000Z');
  expect(url.searchParams.get('details')).toContain('https://igniteclubhq.app/events/one');
  expect(share).not.toHaveBeenCalled(); expect(toast).not.toHaveBeenCalled();
});