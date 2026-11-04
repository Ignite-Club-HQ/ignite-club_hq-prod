import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildIcs, downloadIcs, type IcsEventInput } from './icsExport';

const native = vi.hoisted(() => ({ value: false }));
const open = vi.hoisted(() => vi.fn());
const share = vi.hoisted(() => vi.fn());
const write = vi.hoisted(() => vi.fn());
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.value } }));
vi.mock('@capacitor-community/file-opener', () => ({ FileOpener: { open } }));
vi.mock('@capacitor/share', () => ({ Share: { share } }));
vi.mock('@capacitor/filesystem', () => ({ Filesystem: { writeFile: write }, Directory: { Cache: 'CACHE' }, Encoding: { UTF8: 'utf8' } }));

const game: IcsEventInput = { id: 'game-1', title: 'Game', event_date: '2026-12-09', start_time: '18:30' };
const unfold = (ics: string) => ics.replace(/\r\n /g, '');

describe('calendar export rules', () => {
  beforeEach(() => { native.value = false; vi.resetAllMocks(); write.mockResolvedValue({ uri: 'file:///cache/game.ics' }); });
  it('exports 6:30pm Adelaide on 9 December as 08:00 UTC', () => {
    expect(buildIcs([game])).toContain('DTSTART:20261209T080000Z');
  });
  it('defaults to one hour', () => {
    expect(buildIcs([game])).toContain('DTEND:20261209T090000Z');
  });
  it('escapes commas, semicolons and line breaks', () => {
    expect(unfold(buildIcs([{ ...game, title: 'A,B;C\r\nD\nE' }]))).toContain('SUMMARY:A\\,B\\;C\\nD\\nE');
  });
  it('folds UTF-8 lines without breaking emoji or changing the title', () => {
    const title = '🏏😀é'.repeat(60);
    const ics = buildIcs([{ ...game, title }]);
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(unfold(ics)).toContain(`SUMMARY:${title}\r\n`);
  });
  it('uses the production domain for links regardless of supplied origin', () => {
    expect(unfold(buildIcs([{ ...game, url: 'https://preview.invalid/events/game-1' }]))).toContain('URL:https://igniteclubhq.app/events/game-1');
  });
  it('marks cancelled events', () => {
    expect(buildIcs([{ ...game, is_cancelled: true }])).toContain('STATUS:CANCELLED');
  });
  it('opens the cached calendar before sharing', async () => {
    native.value = true;
    await downloadIcs('game', buildIcs([game]));
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ directory: 'CACHE', encoding: 'utf8' }));
    expect(open).toHaveBeenCalledWith({ filePath: 'file:///cache/game.ics', contentType: 'text/calendar', openWithDefault: true });
    expect(share).not.toHaveBeenCalled();
  });
  it('falls back to sharing only after opening fails', async () => {
    native.value = true; open.mockRejectedValue(new Error('No calendar app'));
    await downloadIcs('game', buildIcs([game]));
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ files: ['file:///cache/game.ics'] }));
    expect(open.mock.invocationCallOrder[0]).toBeLessThan(share.mock.invocationCallOrder[0]);
  });
  it('provides actionable failure after opener and share both fail', async () => {
    native.value = true; open.mockRejectedValue(new Error('No app')); share.mockRejectedValue(new Error('Share unavailable'));
    await expect(downloadIcs('game', buildIcs([game]))).rejects.toThrow(/Google Calendar.*manually/);
  });
});