import { describe, expect, it } from 'vitest';
import { ADMISSION_DOMAINS, verifyRemovalWiring, admissionSwitchPatch, admissionSwitchApplied, mergeEnvironment } from './groupRemovalWiring';

const group = { id: 'g2', targetAlias: 'mainnet', photoStore: 'store',
  domains: ADMISSION_DOMAINS.map(d => ({ domain: d, canisterId: d })) } as never;
const run = (env: { name: string; value: string }[]) =>
  verifyRemovalWiring({ revision: 1n, groups: [group] }, 'ident', async () => env, 0);
const authority = { name: 'IGNITE_ACCOUNT_SERVICE_IDENTITY', value: 'ident' };

describe('removal wiring', () => {
  it('accepts PROD commissioned member access as removal checks on', async () => {
    expect((await run([authority, { name: 'IGNITE_ACCOUNT_ADMISSION_RELEASE', value: '1' }])).evidence).not.toBeNull();
  });
  it('accepts the DEV flag', async () => {
    expect((await run([authority, { name: 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL', value: '1' }])).evidence).not.toBeNull();
  });
  it('refuses when neither switch is on or the account service differs', async () => {
    expect((await run([authority])).problems[0]).toMatch(/removal checks off/);
    expect((await run([{ ...authority, value: 'other' }, { name: 'IGNITE_ACCOUNT_ADMISSION_RELEASE', value: '1' }])).evidence).toBeNull();
  });
  it('refuses services carrying both member switches', async () => {
    expect((await run([authority, { name: 'IGNITE_ACCOUNT_ADMISSION_RELEASE', value: '1' },
      { name: 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL', value: '1' }])).problems[0]).toMatch(/conflicting member switches/);
  });
});

describe('admission switch for group settings', () => {
  const rehearsal = { name: 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL', value: '1' };
  it('PROD writes the release switch and clears the test-only switch, keeping other settings', () => {
    const rows = [authority, rehearsal, { name: 'OTHER', value: 'x' }];
    const p = admissionSwitchPatch(rows, true);
    const next = mergeEnvironment(rows, p.set, p.remove);
    expect(next.find(r => r.name === 'IGNITE_ACCOUNT_ADMISSION_RELEASE')?.value).toBe('1');
    expect(next.some(r => r.name === 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL')).toBe(false);
    expect(next.find(r => r.name === 'OTHER')?.value).toBe('x');
    expect(admissionSwitchApplied(next, true)).toBe(true);
    expect(admissionSwitchApplied(rows, true)).toBe(false);
  });
  it('PROD refuses where global removal is already released', () => {
    expect(() => admissionSwitchPatch([{ name: 'IGNITE_ACCOUNT_REMOVAL_RELEASE', value: '1' }], true)).toThrow(/Global account removal/);
  });
  it('DEV keeps its rehearsal switch', () => {
    expect(admissionSwitchPatch([], false)).toEqual({ set: { IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL: '1' }, remove: [] });
  });
});

