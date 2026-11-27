import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import iiOrigin from '../../netlify/edge-functions/ii-origin';
import { opencloudDerivationOrigin } from './opencloudEnvironment';
import { resolveDerivationOriginFor } from './internetIdentityAuth';
import prod from '../../../deploy/opencloud/prod.json';

afterEach(() => vi.unstubAllEnvs());
const invoke = (url = 'https://igniteclubhq.app/', method = 'HEAD', response = new Response('unchanged site', {
  headers: { 'content-type': 'text/html', 'content-security-policy': "default-src 'none'" },
}), deployContext = 'production') => iiOrigin(new Request(url, { method }), {
  next: async () => response, deploy: { context: deployContext },
});

it('PROD HEAD exposes the allocated OpenCloud canister for II discovery', async () => {
  const response = await invoke();
  expect(response.headers.get('x-ic-canister-id')).toBe('f7fgd-eiaaa-aaac5-aaeaa-cai');
  expect(response.headers.get('access-control-allow-origin')).toBe('*');
  expect(response.headers.get('access-control-expose-headers')).toContain('X-IC-Canister-ID');
  expect(response.headers.get('content-security-policy')).toBe("default-src 'none'");
  expect(await response.text()).toBe('');
});
it('GET retains the original website body and content type', async () => {
  const response = await invoke('https://igniteclubhq.app/', 'GET');
  expect(await response.text()).toBe('unchanged site');
  expect(response.headers.get('content-type')).toBe('text/html');
});
it('DEV cannot advertise PROD identity metadata', async () => {
  for (const context of ['branch-deploy', 'deploy-preview', 'dev']) {
    expect((await invoke(undefined, undefined, undefined, context)).headers.has('x-ic-canister-id')).toBe(false);
  }
  expect((await iiOrigin(new Request('https://igniteclubhq.app/'), {
    next: async () => new Response('site'),
  })).headers.has('x-ic-canister-id')).toBe(false);
});
it('does not alter other origins, email endpoints, or deep-link paths', async () => {
  for (const url of ['https://example.com/', 'https://igniteclubhq.app/auth', 'https://igniteclubhq.app/join/abc', 'https://igniteclubhq.app/api/register-club-backend']) {
    expect((await invoke(url)).headers.has('x-ic-canister-id')).toBe(false);
  }
  expect((await invoke('https://igniteclubhq.app/', 'POST')).headers.has('x-ic-canister-id')).toBe(false);
});
it('fails closed on a foreign upstream canister and never hides an upstream failure', async () => {
  expect((await invoke(undefined, undefined, new Response('', { headers: { 'x-ic-canister-id': 'h2knm-vaaaa-aaac5-aadqa-cai' } }))).status).toBe(503);
  const failed = await invoke(undefined, undefined, new Response('failed', { status: 502 }));
  expect(failed.status).toBe(502);
  expect(failed.headers.has('x-ic-canister-id')).toBe(false);
});
it('PROD custom and canister origins preserve the established member derivation', () => {
  vi.stubEnv('IGNITE_LIVE_OPENCLOUD_ENV', 'opencloud-prod');
  vi.stubEnv('IGNITE_LIVE_OPENCLOUD_IDS_JSON', JSON.stringify({ frontend: prod.shared.frontend }));
  vi.stubEnv('IGNITE_LIVE_II_DERIVATION_ORIGIN', 'https://igniteclubhq.app');
  for (const origin of ['https://igniteclubhq.app', 'https://f7fgd-eiaaa-aaac5-aaeaa-cai.icp.net']) {
    expect(resolveDerivationOriginFor(origin)).toBe('https://igniteclubhq.app');
  }
  vi.stubEnv('IGNITE_LIVE_II_DERIVATION_ORIGIN', 'https://f7fgd-eiaaa-aaac5-aaeaa-cai.icp.net');
  expect(() => opencloudDerivationOrigin()).toThrow(/bound/);
});
it('discovery metadata matches the actual PROD proxy destination', () => {
  const config = readFileSync('../netlify.toml', 'utf8');
  const proxies = [...config.matchAll(/\[\[redirects\]\]\s+from = "\/\*"\s+to = "([^"]+)"/g)];
  expect(proxies[0]?.[1]).toBe(`https://${prod.shared.frontend}.icp.net/:splat`);
  expect(config).toMatch(/\[\[edge_functions\]\]\s+function = "ii-origin"\s+path = "\/"/);
});