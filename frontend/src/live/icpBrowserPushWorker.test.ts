import { describe, expect, it } from 'vitest';
import { waitForActiveWorker } from './icpBrowserPush';

function fakeWorker() {
  const listeners: Array<() => void> = [];
  const worker = { state: 'installing', addEventListener: (_: string, fn: () => void) => listeners.push(fn) };
  return { worker, set(state: string) { worker.state = state; listeners.forEach(fn => fn()); } };
}

describe('waitForActiveWorker', () => {
  it('waits until an installing worker activates', async () => {
    const f = fakeWorker();
    let done = false;
    const p = waitForActiveWorker({ installing: f.worker } as unknown as ServiceWorkerRegistration).then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    f.set('activated');
    await p;
    expect(done).toBe(true);
  });
  it('fails when the worker becomes redundant', async () => {
    const f = fakeWorker();
    const p = waitForActiveWorker({ installing: f.worker } as unknown as ServiceWorkerRegistration);
    f.set('redundant');
    await expect(p).rejects.toThrow();
  });
});
