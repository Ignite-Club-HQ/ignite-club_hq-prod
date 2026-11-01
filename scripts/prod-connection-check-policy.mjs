import { UPGRADE_ORDER, assertGovernor } from './icp-environments.mjs';

// Exact provisioned PROD base inventory: not a frontend default or routing change.
export const PROD_CHECK_IDS = Object.freeze({
  club_domain: 'tbeh7-5qaaa-aaaai-ayenq-cai',
  club_points_domain: 'wg2b7-maaaa-aaaai-ayeqq-cai',
  competition_domain: 'scioz-jiaaa-aaaai-ayela-cai',
  events_domain: 'sfjin-eqaaa-aaaai-ayelq-cai',
  identity_access: 'wb3hl-byaaa-aaaai-ayeqa-cai',
  insights_domain: 'wiymx-xqaaa-aaaai-ayerq-cai',
  media_blob_store: 'w5752-wyaaa-aaaai-ayesa-cai',
  media_metadata: 'wt5qs-niaaa-aaaai-ayeta-cai',
  messaging_domain: 'ttcqg-raaaa-aaaai-ayeoq-cai',
  migration_coordinator: 'sllff-7aaaa-aaaai-ayekq-cai',
  mini_league_domain: 'wpzkd-2iaaa-aaaai-ayera-cai',
  notification_queue: 'w263o-3aaaa-aaaai-ayesq-cai',
  pii_access_control: 'tihmd-lyaaa-aaaai-ayema-cai',
  placement_registry: 't5a5o-kqaaa-aaaai-ayepq-cai',
  secret_workload_identity: 't2b32-hiaaa-aaaai-ayepa-cai',
  shard_router: 'tgfbl-qiaaa-aaaai-ayena-cai',
  timer_jobs: 'tpgkx-gaaaa-aaaai-ayemq-cai',
  vault_domain: 'tudws-4yaaa-aaaai-ayeoa-cai',
});

export const CONFIG_READERS = Object.freeze(UPGRADE_ORDER.filter(name =>
  !['placement_registry', 'migration_coordinator', 'secret_workload_identity'].includes(name)));

export function assertCheckContext(ids, env, principal) {
  if (env.GITHUB_REPOSITORY !== 'Ignite-Club-HQ/ignite-club_hq-prod' ||
      env.GITHUB_REF !== 'refs/heads/prod' || env.IGNITE_ICP_ENV !== 'prod') {
    throw new Error('Connection check requires the live repository prod branch');
  }
  assertGovernor('prod', principal, env);
  const names = Object.keys(ids).sort();
  if (JSON.stringify(names) !== JSON.stringify(Object.keys(PROD_CHECK_IDS).sort()) ||
      names.some(name => ids[name] !== PROD_CHECK_IDS[name])) {
    throw new Error('Connection check requires the exact recorded 18-service PROD inventory');
  }
}

export function checkCalls(ids) {
  return [
    ...CONFIG_READERS.map(name => ({ name, id: ids[name], method: 'read_group_opening_configuration', args: '()', query: false })),
    { name: 'shard_router', id: ids.shard_router, method: 'list_groups', args: '()', query: true },
    // mainnet is the deployment alias used by the existing group tooling. An absent
    // approval is reported, never repaired or interpreted as activation authority.
    { name: 'shard_router', id: ids.shard_router, method: 'read_routing_approval', args: '("mainnet")', query: false },
  ];
}

export function callArguments(call, ids) {
  const allowed = checkCalls(ids).some(row => Object.keys(row).every(k => row[k] === call[k]));
  if (!allowed) throw new Error('Method or target is not an approved infrastructure reader');
  return ['canister', 'call', call.id, call.method, call.args, '-n', 'ic',
    '--identity', 'ignite-prod-governor', '--output', 'candid', ...(call.query ? ['--query'] : [])];
}

export const EXPECTED_LINKS = Object.freeze({
  club_domain: ['club_domain', 'notification_queue', 'mini_league_domain', 'competition_domain', 'events_domain', 'messaging_domain', 'pii_access_control'],
  club_points_domain: ['club_domain'],
  competition_domain: ['club_domain', 'events_domain', 'vault_domain', 'pii_access_control'],
  events_domain: ['club_domain', 'notification_queue', 'mini_league_domain', 'competition_domain'],
  messaging_domain: ['club_domain', 'notification_queue', 'competition_domain'],
  notification_queue: ['club_domain', 'messaging_domain', 'identity_access'],
  pii_access_control: ['club_domain', 'competition_domain'],
  mini_league_domain: ['club_domain', 'events_domain'],
  vault_domain: ['club_domain', 'competition_domain'],
  media_blob_store: ['club_domain'],
});

export function assessLinks(name, pairs, ids) {
  if (!Array.isArray(pairs) || pairs.length > 128 ||
      pairs.some(p => !Array.isArray(p) || p.length !== 2 || p.some(s => typeof s !== 'string' || s.length > 512))) {
    throw new Error('Invalid bounded infrastructure configuration');
  }
  return (EXPECTED_LINKS[name] || []).map(key => {
    const values = pairs.filter(p => p[0] === key).map(p => p[1]);
    return { key, expected: ids[key], observed: values, matches: values.length === 1 && values[0] === ids[key] };
  });
}
// Bounded, secret-free explanation of a failed read. Only the canister's own
// reject/trap text or the CLI's first error line survives; paths, key material
// and long encoded blobs are removed. Subprocess output is otherwise discarded.
export function failureReason(stderr) {
  const text = String(stderr ?? '').split(/Stack backtrace:/)[0];
  if (/PRIVATE KEY|BEGIN [A-Z ]+-----/.test(text)) return 'Tool failed (details withheld)';
  const trap = text.match(/with message: '([^'\n]{1,200})'/);
  const reject = text.match(/was rejected: ([^\n]{1,300})/);
  const first = text.split('\n').map(s => s.trim()).find(s => /^Error\b/i.test(s));
  let reason = trap ? `Canister refused: ${trap[1]}` : reject ? `Rejected: ${reject[1]}` : first || '';
  reason = reason
    .replace(/(?:\/[\w.@-]+){2,}/g, '<path>')
    .replace(/[A-Za-z0-9+/=_]{40,}/g, '<redacted>')
    .replace(/[|`\r]/g, ' ')
    .trim()
    .slice(0, 160);
  return reason || 'Tool failed (no details)';
}

// The CLI may print notices around a reply; keep only a pure hex line.
export function hexReply(stdout) {
  const line = String(stdout).split('\n').map(s => s.trim()).reverse().find(s => /^(?:0x)?[a-fA-F0-9]+$/.test(s));
  if (!line) throw new Error('Unexpected hex reply');
  return line;
}
