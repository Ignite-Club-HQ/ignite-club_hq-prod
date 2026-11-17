/**
 * Step-by-step progress for one roster name unlock. Labels only: never names,
 * IDs or ciphertext. Lets a long unlock show where it is instead of a bare
 * "Unlocking name…", and keeps the last attempt's step timings for diagnosis.
 */
export type NameUnlockStep =
  | 'profiles' | 'route' | 'ciphertext' | 'vetkey' | 'decrypt' | 'confirm' | 'closing' | 'done' | 'failed';

export type NameUnlockSnapshot = {
  step: NameUnlockStep;
  startedAt: number;
  stepStartedAt: number;
  timings: { step: NameUnlockStep; ms: number }[];
};

export const NAME_UNLOCK_STEP_LABELS: Record<NameUnlockStep, string> = {
  profiles: 'finding profiles',
  route: 'checking club access',
  ciphertext: 'reading locked names',
  vetkey: 'getting the club name key',
  decrypt: 'unlocking',
  confirm: 're-checking club access',
  closing: 'finishing access check',
  done: 'done',
  failed: 'stopped',
};

export function createNameUnlockTracker(now: () => number = Date.now) {
  let snapshot: NameUnlockSnapshot | null = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(fn => fn());
  return {
    start() {
      const t = now();
      snapshot = { step: 'profiles', startedAt: t, stepStartedAt: t, timings: [] };
      emit();
    },
    mark(step: NameUnlockStep) {
      if (!snapshot || snapshot.step === step || snapshot.step === 'done' || snapshot.step === 'failed') return;
      const t = now();
      snapshot = {
        step, startedAt: snapshot.startedAt, stepStartedAt: t,
        timings: [...snapshot.timings, { step: snapshot.step, ms: t - snapshot.stepStartedAt }],
      };
      emit();
    },
    get: () => snapshot,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };
}

/** Short "step 4s · step 12s" summary for the last attempt. */
export function summarizeNameUnlockTimings(s: NameUnlockSnapshot | null): string {
  if (!s) return '';
  return s.timings.map(t => `${NAME_UNLOCK_STEP_LABELS[t.step]} ${Math.round(t.ms / 1000)}s`).join(' · ');
}
