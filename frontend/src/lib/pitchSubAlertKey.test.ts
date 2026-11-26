import { describe, expect, it } from 'vitest';
import { pitchSubAlertKey, shouldTriggerImmediatePitchCheck } from './pitchBoardRepository';

const sub = { half: 1, time: 300, playerOut: { id: 'a' }, playerIn: { id: 'b' } };
describe('pitchSubAlertKey', () => {
  it('gives the open board and the server timer the same key for one sub', () => {
    expect(pitchSubAlertKey('run1', sub)).toBe(pitchSubAlertKey('run1', { ...sub }));
  });
  it('gives a new plan run a different key', () => {
    expect(pitchSubAlertKey('run1', sub)).not.toBe(pitchSubAlertKey('run2', sub));
  });
  it('queues only one alert when two player changes are due at the same time', () => {
    const second = { ...sub, playerOut: { id: 'c' }, playerIn: { id: 'd' } };
    const queued = new Set([sub, second, sub].map(change => `${pitchSubAlertKey('run1', change)}-coach`));
    expect(queued.size).toBe(1);
  });
  it('does not merge different substitution times or halves', () => {
    const keys = [sub, { ...sub, time: 600 }, { ...sub, half: 2 }]
      .map(change => pitchSubAlertKey('run1', change));
    expect(new Set(keys).size).toBe(3);
  });
  it('does not enqueue another ICP sub alert when the board is closed', () => {
    expect(shouldTriggerImmediatePitchCheck('client-pending-sub-sync', true)).toBe(false);
  });
  it('preserves email-mode checks and unrelated ICP half-time alerts', () => {
    expect(shouldTriggerImmediatePitchCheck('client-pending-sub-sync', false)).toBe(true);
    expect(shouldTriggerImmediatePitchCheck('client-halftime-sync', true)).toBe(true);
  });
});
