import { expect, it } from 'vitest';
import { timeCarouselRead } from './carouselReadTiming';
it('keeps only forty stage-only timing samples, including failed reads', async () => {
  for (let i = 0; i < 42; i++) expect(await timeCarouselRead('teams', async () => i)).toBe(i);
  await expect(timeCarouselRead('approval', async () => { throw new Error('private account detail'); })).rejects.toThrow();
  const samples = (window as unknown as { __igniteCarouselReads: unknown[] }).__igniteCarouselReads;
  expect(samples).toHaveLength(40);
  expect(samples[39]).toEqual({ stage: 'approval', durationMs: expect.any(Number), ok: false });
  expect(JSON.stringify(samples)).not.toContain('private account detail');
});