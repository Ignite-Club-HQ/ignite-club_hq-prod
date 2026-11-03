import { describe, expect, it } from 'vitest';
import { ADMISSION_DOMAINS, verifyRemovalWiring } from './groupRemovalWiring';

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
});
