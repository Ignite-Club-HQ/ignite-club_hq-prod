import type { QueryClient, QueryKey } from '@tanstack/react-query';

/** Recover just the observed carousel; healthy cards never restart on resume. */
export function createCarouselResumeRecovery(client: QueryClient, key: QueryKey) {
  let pending: Promise<void> | undefined;
  let lastStarted = -Infinity;
  return (options?: { restartSuspended?: boolean }) => {
    const restart = options?.restartSuspended === true;
    if (pending && !restart) return pending;
    const query = client.getQueryCache().find({ queryKey: key, exact: true });
    if (!query || !query.isActive()) return Promise.resolve();
    const state = query.state;
    const hasCards = Array.isArray(state.data) && state.data.length > 0;
    const suspended = restart && state.fetchStatus === 'fetching';
    if (hasCards && state.status !== 'error' && state.fetchStatus !== 'paused' && !suspended) return Promise.resolve();
    if (!suspended && Date.now() - lastStarted < 2500) return Promise.resolve();
    lastStarted = Date.now();
    const run = (async () => {
      // cancelQueries also releases initial (no-data) fetches, which ordinary
      // refetchQueries would otherwise join indefinitely after suspension.
      await client.cancelQueries({ queryKey: key, exact: true });
      if (!query.isActive() || client.getQueryCache().find({ queryKey: key, exact: true }) !== query) return;
      await client.refetchQueries({ queryKey: key, exact: true, type: 'active' });
    })();
    pending = run;
    void run.finally(() => { if (pending === run) pending = undefined; }).catch(() => undefined);
    return run;
  };
}