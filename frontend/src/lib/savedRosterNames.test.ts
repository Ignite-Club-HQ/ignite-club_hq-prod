import { describe, it, expect, beforeEach } from 'vitest';
import { loadSavedRosterNames, saveRosterNames, SAVED_ROSTER_NAMES_TTL_MS } from './savedRosterNames';

describe('saved roster names', () => {
  beforeEach(() => localStorage.clear());
  it('keeps only unlocked names, under the ignite_ prefix', () => {
    saveRosterNames('u', 'c', 't', [{ account_id: 'a', display_name: 'Ann' }, { account_id: 'b', display_name: null, name_error: 'x' }], 0);
    expect(loadSavedRosterNames('u', 'c', 't', 1)).toEqual([{ account_id: 'a', display_name: 'Ann' }]);
    expect(Object.keys(localStorage)[0].startsWith('ignite_')).toBe(true);
  });
  it('expires after 7 days', () => {
    saveRosterNames('u', 'c', 't', [{ account_id: 'a', display_name: 'Ann' }], 0);
    expect(SAVED_ROSTER_NAMES_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(loadSavedRosterNames('u', 'c', 't', SAVED_ROSTER_NAMES_TTL_MS + 1)).toBeUndefined();
  });
  it('is scoped to the signed-in account', () => {
    saveRosterNames('u', 'c', 't', [{ account_id: 'a', display_name: 'Ann' }], 0);
    expect(loadSavedRosterNames('other', 'c', 't', 1)).toBeUndefined();
  });
});
