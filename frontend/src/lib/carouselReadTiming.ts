/** Bounded device-only diagnostics; no account ids, targets or response data. */
export type CarouselReadStage = 'approval' | 'membership' | 'teams' | 'leagues';
type Sample = { stage: CarouselReadStage; durationMs: number; ok: boolean };
const samples: Sample[] = [];
export async function timeCarouselRead<T>(stage: CarouselReadStage, read: () => Promise<T>): Promise<T> {
  const started = performance.now();
  let ok = false;
  try { const value = await read(); ok = true; return value; }
  finally {
    samples.push({ stage, durationMs: Math.round(performance.now() - started), ok });
    if (samples.length > 40) samples.shift();
    if (typeof window !== 'undefined') (window as unknown as { __igniteCarouselReads: Sample[] }).__igniteCarouselReads = [...samples];
  }
}