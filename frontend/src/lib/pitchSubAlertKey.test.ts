import { describe, expect, it } from 'vitest';
import { pitchSubAlertKey } from './pitchBoardRepository';

const sub = { half: 1, time: 300, playerOut: { id: 'a' }, playerIn: { id: 'b' } };
describe('pitchSubAlertKey', () => {
  it('gives the open board and the server timer the same key for one sub', () => {
    expect(pitchSubAlertKey('run1', sub)).toBe(pitchSubAlertKey('run1', { ...sub }));
  });
  it('gives a new plan run a different key', () => {
    expect(pitchSubAlertKey('run1', sub)).not.toBe(pitchSubAlertKey('run2', sub));
  });
});
