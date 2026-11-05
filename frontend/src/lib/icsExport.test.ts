import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addToGoogleCalendar, buildGoogleCalendarUrl, buildIcs, downloadIcs, mapEventToCalendar, type IcsEventInput } from './icsExport';
import { readFileSync } from 'node:fs';

const native = vi.hoisted(() => ({ value: false }));
const open = vi.hoisted(() => vi.fn());
const share = vi.hoisted(() => vi.fn());
const write = vi.hoisted(() => vi.fn());
const launch = vi.hoisted(() => vi.fn());
vi.mock('@capacitor/app-launcher', () => ({ AppLauncher: { openUrl: launch } }));
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
  it('preserves already-UTC start and end timestamps from ICP', () => {
    const ics = buildIcs([{ ...game, start_time: null, event_date: '2026-12-09T08:00:00.000Z', end_time: '2026-12-09T09:45:00.000Z' }]);
    expect(ics).toContain('DTSTART:20261209T080000Z');
    expect(ics).toContain('DTEND:20261209T094500Z');
  });
  it('respects a supplied club zone instead of the default', () => {
    const e = mapEventToCalendar({ ...game, clubs: { timezone: 'Australia/Perth' } });
    expect(buildIcs([e])).toContain('DTSTART:20261209T103000Z');
  });
  it('uses Adelaide winter offset independently of the device', () => {
    expect(buildIcs([{ ...game, event_date: '2026-06-09' }])).toContain('DTSTART:20260609T090000Z');
  });
  it('keeps the embedded wall time when there is no separate start time', () => {
    expect(buildIcs([{ ...game, event_date: '2026-12-09T18:30:00', start_time: null }])).toContain('DTSTART:20261209T080000Z');
  });
  it('handles an overnight event in the club zone', () => {
    expect(buildIcs([{ ...game, start_time: '23:30', end_time: '00:30' }])).toContain('DTEND:20261209T140000Z');
  });
  it('rejects invalid dates rather than exporting incorrect times', () => {
    expect(() => buildIcs([{ ...game, event_date: '2026-02-30' }])).toThrow('Invalid event');
  });
  it('shares one mapping and includes every event in a schedule', () => {
    const events = [game, { ...game, id: 'game-2', event_date: '2026-12-10' }].map(mapEventToCalendar);
    const ics = unfold(buildIcs(events));
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain('URL:https://igniteclubhq.app/events/game-2');
    expect(ics).toContain('DTSTART:20261210T080000Z');
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
  it('provides actionable failure when writing the file fails', async () => {
    native.value = true; write.mockRejectedValue(new Error('Disk full'));
    await expect(downloadIcs('game', buildIcs([game]))).rejects.toThrow(/manually/);
    expect(open).not.toHaveBeenCalled(); expect(share).not.toHaveBeenCalled();
  });
  it('builds the Google template with identical UTC dates, location and public link', () => {
    const url = new URL(buildGoogleCalendarUrl({ ...game, title: 'Game & BBQ 🏏', location_name: 'Oval', description: 'Bring water' }));
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe('Game & BBQ 🏏');
    expect(url.searchParams.get('dates')).toBe('20261209T080000Z/20261209T090000Z');
    expect(url.searchParams.get('location')).toBe('Oval');
    expect(url.searchParams.get('details')).toBe('Bring water\n\nView in Ignite: https://igniteclubhq.app/events/game-1');
  });
  it('opens Google in the native system browser', async () => {
    native.value = true; launch.mockResolvedValue({ completed: true });
    await addToGoogleCalendar(game);
    expect(launch).toHaveBeenCalledWith({ url: buildGoogleCalendarUrl(game) });
  });
  it('rejects a failed native Google browser launch', async () => {
    native.value = true; launch.mockResolvedValue({ completed: false });
    await expect(addToGoogleCalendar(game)).rejects.toThrow("couldn't open");
  });
  it('keeps the normal web file download', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:calendar');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await downloadIcs('game', buildIcs([game]));
    expect(create).toHaveBeenCalled(); expect(click).toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled(); click.mockRestore(); create.mockRestore();
  });
  it('keeps the preview fallback event and its calendar content', async () => {
    const top = vi.spyOn(window, 'top', 'get').mockReturnValue(null);
    const listener = vi.fn(); window.addEventListener('ics-preview-fallback', listener);
    const ics = buildIcs([game]); await downloadIcs('game', ics);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.objectContaining({ filename: 'game.ics', ics }) }));
    window.removeEventListener('ics-preview-fallback', listener); top.mockRestore();
  });
  it('ships Android opener cache-path access and URI read grants', () => {
    const paths = readFileSync('node_modules/@capacitor-community/file-opener/android/src/main/res/xml/file_opener_paths.xml', 'utf8');
    const manifest = readFileSync('node_modules/@capacitor-community/file-opener/android/src/main/AndroidManifest.xml', 'utf8');
    expect(paths).toMatch(/<cache-path[^>]+path="\."/);
    expect(manifest).toContain('android:grantUriPermissions="true"');
  });
});