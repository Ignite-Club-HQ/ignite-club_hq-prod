import { describe, expect, it } from 'vitest';
import { createNameUnlockTracker, summarizeNameUnlockTimings } from './nameUnlockProgress';

describe('name unlock progress', () => {
  it('records how long each step took, in order', () => {
    let t = 0;
    const tracker = createNameUnlockTracker(() => t);
    tracker.start();
    t = 2000; tracker.mark('route');
    t = 20000; tracker.mark('vetkey');
    t = 29000; tracker.mark('done');
    expect(tracker.get()?.timings.map(x => [x.step, x.ms])).toEqual([['profiles', 2000], ['route', 18000], ['vetkey', 9000]]);
    expect(summarizeNameUnlockTimings(tracker.get())).toBe('finding profiles 2s · checking club access 18s · getting the club name key 9s');
  });
  it('ignores late steps after the unlock has stopped', () => {
    let t = 0;
    const tracker = createNameUnlockTracker(() => t);
    tracker.start(); t = 65000; tracker.mark('failed'); t = 70000; tracker.mark('decrypt');
    expect(tracker.get()?.step).toBe('failed');
  });
});
