import { describe, expect, it } from 'vitest';
import { maskSharedPitchNames, sharedPitchNameRefs, resolveSharedPitchNames } from './sharedPitchPrivacy';
describe('shared pitch names stay opaque', () => {
  it('masks names in players, substitutions and goals, without changing coordinates or timers', () => {
    const source = { players: [{ id: 'p', name: 'Child A', position: { x: 12, y: 34 } }], autoSubPlan: [{ playerOut: { id: 'p', name: 'Child A' }, playerIn: { id: 'q', name: 'Child B' } }], goals: [{ name: 'Child C' }], elapsedSeconds: 75 };
    const masked = maskSharedPitchNames(source, 'pitch:team:');
    const wire = JSON.stringify(masked.pitch);
    for (const name of ['Child A','Child B','Child C']) expect(wire).not.toContain(name);
    expect(masked.pitch.players).toEqual([{ id: 'p', name: 'pitch:team:p', position: { x: 12, y: 34 } }]);
    expect(masked.pitch.elapsedSeconds).toBe(75);
    expect(sharedPitchNameRefs(masked.pitch)).toHaveLength(3);
    expect(resolveSharedPitchNames(masked.pitch, masked.names)).toEqual(source);
  });
  it('keeps existing refs opaque and displays an unreadable name neutrally', () => {
    const masked = maskSharedPitchNames({ players: [{ id: 'p', name: 'pitch:team:p' }] }, 'pitch:team:');
    expect(masked.names.size).toBe(0);
    expect(resolveSharedPitchNames(masked.pitch, new Map())).toEqual({ players: [{ id: 'p', name: 'Player' }] });
  });
});
import { describe as d2, it as i2, expect as e2 } from 'vitest';
import { maskSharedPitchNames as mask2, sharedPitchNameRefs as refs2, resolveSharedPitchNames as resolve2 } from './sharedPitchPrivacy';
d2('pitchname: references', () => {
  i2('are resolved, never re-masked as names', () => {
    const pitch = { players: [{ id: 'p1', name: 'pitchname:team:p1' }] };
    e2(refs2(pitch)).toEqual(['pitchname:team:p1']);
    e2(mask2(pitch, 'pitchname:team:').names.size).toBe(0);
    e2(resolve2(pitch, new Map([['pitchname:team:p1', 'Sam']]))).toEqual({ players: [{ id: 'p1', name: 'Sam' }] });
    e2(resolve2(pitch, new Map([['pitchname:team:p1', 'pitchname:team:p1']]))).toEqual({ players: [{ id: 'p1', name: 'Player' }] });
  });
});

import { repairPitchPlaceholderNames as repair3 } from './sharedPitchPrivacy';
d2('placeholder name repair', () => {
  i2('fills nested substitution names, keeps real names', () => {
    const plan = [{ playerOut: { id: 'mock-1', name: 'Player' }, playerIn: { id: 'c1', name: 'pitchname:t:c1' }, keep: { id: 'c2', name: 'Ann' } }];
    const out = repair3(plan, id => ({ 'mock-1': 'Alex Smith', c1: 'Sam', c2: 'Other' } as Record<string, string>)[id]);
    e2(out).toEqual([{ playerOut: { id: 'mock-1', name: 'Alex Smith' }, playerIn: { id: 'c1', name: 'Sam' }, keep: { id: 'c2', name: 'Ann' } }]);
  });
});
