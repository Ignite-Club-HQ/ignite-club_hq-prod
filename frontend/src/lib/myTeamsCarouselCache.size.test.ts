import { beforeEach, expect, it } from 'vitest';
import { getCachedCarouselWithTs, setCachedCarousel } from './myTeamsCarouselCache';
import { pruneDeviceReadCaches } from './deviceCacheBudget';

beforeEach(() => { localStorage.clear(); pruneDeviceReadCaches(); });

it('keeps saved cards for a member of many teams (over the old 512KB entry cap)', () => {
  const items = Array.from({ length: 40 }, (_, i) => ({ id: `team-${i}`, name: `Team ${i}`, notes: 'x'.repeat(8000) }));
  setCachedCarousel('principal-a', null, { items });
  expect(getCachedCarouselWithTs<{ items: unknown[] }>('principal-a', null)?.data.items).toHaveLength(40);
});

it('still saves the cards when embedded photos make the set too large', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ id: `team-${i}`, name: `Team ${i}`, logo_url: `data:image/png;base64,${'A'.repeat(80_000)}` }));
  setCachedCarousel('principal-b', null, { items });
  const saved = getCachedCarouselWithTs<{ items: { name: string; logo_url?: string }[] }>('principal-b', null)?.data.items;
  expect(saved).toHaveLength(10);
  expect(saved?.[0].name).toBe('Team 0');
  expect(saved?.[0].logo_url).toBeUndefined();
});
