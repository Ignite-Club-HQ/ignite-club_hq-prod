import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertOpenCloudGroupCanister } from './opencloudEnvironment';

const ids = { g1_club_domain: 'him2v-zqaaa-aaac5-aadta-cai', g2_club_domain: 'aaaaa-bbbbb-ccccc-ddddd-cai', secret_workload_identity: 'hbprj-pyaaa-aaac5-aadsq-cai' };
afterEach(() => vi.unstubAllEnvs());

describe('OpenCloud group routing', () => {
  it('accepts only each group\'s own pinned service', () => {
    vi.stubEnv('IGNITE_LIVE_OPENCLOUD_ENV', 'opencloud-dev');
    vi.stubEnv('IGNITE_LIVE_OPENCLOUD_IDS_JSON', JSON.stringify(ids));
    expect(() => assertOpenCloudGroupCanister('base', 'club_domain', ids.g1_club_domain)).not.toThrow();
    expect(() => assertOpenCloudGroupCanister('g2', 'club_domain', ids.g2_club_domain)).not.toThrow();
    expect(() => assertOpenCloudGroupCanister('g2', 'club_domain', ids.g1_club_domain)).toThrow();
    expect(() => assertOpenCloudGroupCanister('base', 'club_domain', 'mzzzv-taaaa-aaaal-qxlrq-cai')).toThrow();
    expect(() => assertOpenCloudGroupCanister('g3', 'club_domain', ids.g1_club_domain)).toThrow();
    expect(() => assertOpenCloudGroupCanister('g2', 'secret_workload_identity', ids.secret_workload_identity)).not.toThrow();
  });
  it('changes nothing for today\'s mainnet DEV builds', () => {
    vi.stubEnv('IGNITE_LIVE_OPENCLOUD_ENV', '');
    expect(() => assertOpenCloudGroupCanister('base', 'club_domain', 'mzzzv-taaaa-aaaal-qxlrq-cai')).not.toThrow();
  });
});
