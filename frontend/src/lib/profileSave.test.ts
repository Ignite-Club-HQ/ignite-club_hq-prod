import { describe, it, expect, vi } from 'vitest';
import { saveProfileCompatible } from './profileSave';

const fields = { display_name: 'Paul', avatar_url: null, leaderboard_opt_out: true };

describe('profile saving on older and newer schemas', () => {
  it('saves existing fields without country when that column is absent', async () => {
    const update = vi.fn().mockResolvedValue({ error: null });
    expect(await saveProfileCompatible(fields, 'AU', false, update)).toEqual({ error: null, countrySaved: false });
    expect(update.mock.calls).toEqual([[fields]]);
  });
  it('saves and clears country on schemas that support it', async () => {
    const update = vi.fn().mockResolvedValue({ error: null });
    expect((await saveProfileCompatible(fields, 'AU', true, update)).countrySaved).toBe(true);
    await saveProfileCompatible(fields, null, true, update);
    expect(update.mock.calls).toEqual([[{ ...fields, country: 'AU' }], [{ ...fields, country: null }]]);
  });
  it.each([
    { code: 'PGRST204', message: "Could not find the 'country' column of 'profiles' in the schema cache" },
    { code: '42703', message: 'column "country" of relation "profiles" does not exist' },
  ])('retries only a confirmed missing country column: $code', async error => {
    const update = vi.fn().mockResolvedValueOnce({ error }).mockResolvedValueOnce({ error: null });
    expect(await saveProfileCompatible(fields, 'AU', true, update)).toEqual({ error: null, countrySaved: false });
    expect(update.mock.calls).toEqual([[{ ...fields, country: 'AU' }], [fields]]);
  });
  it.each([
    { code: '42501', message: 'permission denied' },
    { code: 'PGRST204', message: "Could not find the 'display_name' column of 'profiles' in the schema cache" },
    { code: '42703', message: 'column country of relation teams does not exist' },
    { code: 'NETWORK', message: 'connection lost' },
  ])('propagates unrelated failures without retrying: $message', async error => {
    const update = vi.fn().mockResolvedValue({ error });
    expect((await saveProfileCompatible(fields, 'AU', true, update)).error).toEqual(error);
    expect(update).toHaveBeenCalledTimes(1);
  });
  it('propagates a failed fallback save', async () => {
    const error = { code: '42501', message: 'permission denied' };
    const update = vi.fn().mockResolvedValueOnce({ error: { code: 'PGRST204', message: "Could not find the 'country' column of 'profiles' in the schema cache" } }).mockResolvedValueOnce({ error });
    expect((await saveProfileCompatible(fields, 'AU', true, update)).error).toEqual(error);
  });
});