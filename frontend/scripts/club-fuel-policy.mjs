// Local experiment bounds, not deployed-service operating limits.
export const IDLE_MINUTES = 20;
export const LOW_FUEL_ROUNDS = 80;
export const LOW_FUEL_STEP_MS = 100;
export const HEADROOMS = [2_000_000_000n, 200_000_000n, 20_000_000n, 2_000_000n];

export function timerCounts(seconds) {
  if (!Number.isInteger(seconds) || seconds < 0) throw Error('Invalid observation interval');
  return { directory: BigInt(Math.floor(seconds / 30)), cleanup: BigInt(Math.floor(seconds / 60)) };
}

export function classifyRetry(samples) {
  // A cost difference alone is not proof of a retry: retain the candidate label.
  const timer = samples.find(s => s.mode === 'timers');
  const control = samples.find(s => s.mode === 'control');
  if (!timer || !control || timer.error || control.error) return 'inconclusive';
  const timerCost = BigInt(timer.before) - BigInt(timer.after);
  const controlCost = BigInt(control.before) - BigInt(control.after);
  return timerCost > controlCost * 5n && timerCost > 10_000_000n
    ? 'amplification-candidate-not-proven' : 'no-amplification-observed';
}