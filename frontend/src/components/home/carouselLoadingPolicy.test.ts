import { describe, expect, it } from 'vitest';
import { carouselReady } from './carouselLoadingPolicy';

describe('complete first-login carousel', () => {
  it('does not reveal first-login cards until all available card data settles', () => {
    expect(carouselReady(false, true, [true, false, true])).toBe(false);
    expect(carouselReady(false, true, [true, true, true])).toBe(true);
  });
  it('shows saved same-account cards without waiting for refresh', () => {
    expect(carouselReady(true, false, [false, false, false])).toBe(true);
  });
});