import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GROUP_BUILD_SERVICES } from '../stage-group-wasm.mjs';
import { SHARED_SERVICES } from '../all-group-upgrade-policy.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(ROOT, 'frontend/package.json'));
const YAML = require('yaml');
const { Principal } = require('@icp-sdk/core/principal');
export const ENVIRONMENTS = Object.freeze({
  'opencloud-dev': { appKey: 'ignite_dev_v2', branch: 'main', databaseRef: 'ecsdwrarzfexssxtrymj' },
  'opencloud-prod': { appKey: 'ignite_prod_v2', branch: 'prod', databaseRef: 'yabcfiuntwqjwvschnji' },
});
const RUST = new Set(['identity_access', 'placement_registry', 'shard_router', 'timer_jobs']);
const NO_ARGS = new Set(['frontend', 'timer_jobs', 'media_blob_store']);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const read = file => readFileSync(file, 'utf8');
const principal = value => {
  if (typeof value !== 'string') throw Error('A populated principal is required');
  const p = Principal.fromText(value);
  if (p.isAnonymous() || p.toText() === 'aaaaa-aa' || p.toText() !== value) throw Error('Invalid infrastructure principal');
  return value;
};

export function inventory(config) {
  return [{ name: 'frontend', service: 'frontend', scope: 'shared', id: config.shared.frontend },
    ...SHARED_SERVICES.map(service => ({ name: service, service, scope: 'shared', id: config.shared[service] })),
    ...config.groups.flatMap(group => GROUP_BUILD_SERVICES.map(service => ({
      name: `${group.id}_${service}`, service, scope: group.id, id: group.canisterIds[service],
    })))];
}

export function template(environment) {
  const env = ENVIRONMENTS[environment];
  if (!env) throw Error('Explicit opencloud-dev or opencloud-prod required');
  return { schema: 1, environment, applicationKey: env.appKey, branch: env.branch,
    networkKind: 'cloud_engine', engineName: 'ignite-prod', engineId: null,
    subnetId: 'nwgxr-6ses4-xcorg-yudu5-ag37q-hzicn-7hxoz-3nx5u-yk6gv-tupik-rae',
    apiHost: null, operatorId: null, consoleProxyId: null,
    controllers: { owner: null, governor: null, frontendPublisher: null },
    supabase: { url: `https://${env.databaseRef}.supabase.co`, publishableKey: null },
    shared: Object.fromEntries(['frontend', ...SHARED_SERVICES].map(name => [name, null])),
    groups: ['g1', 'g2'].map(id => ({ id, maxClubs: null, heapBudgetBytes: null,
      canisterIds: Object.fromEntries(GROUP_BUILD_SERVICES.map(name => [name, null])) })),
    engineSettings: { devWasmMemoryLimit: null, prodComputeAllocation: null },
    push: { workerPrincipal: null, senderUrl: null, enabled: false },
    routingSnapshot: null,
  };
}

function strings(value, out = new Set()) {
  if (typeof value === 'string' && /-cai$/.test(value)) out.add(value);
  else if (Array.isArray(value)) value.forEach(v => strings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach(v => strings(v, out));
  return out;
}
export function mainnetIds() {
  const ids = new Set();
  for (const dir of ['mainnet', 'prod', 'frontend', 'frontend-prod', 'groups']) {
    const base = path.join(ROOT, 'deploy', dir);
    const visit = folder => {
      if (!existsSync(folder)) return;
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        if (entry.isSymbolicLink() || entry.name === 'cache' || entry.name === 'target') continue;
        const file = path.join(folder, entry.name);
        if (entry.isDirectory()) visit(file);
        else if (entry.name.endsWith('.json')) { try { strings(JSON.parse(read(file)), ids); } catch { /* not a mapping */ } }
      }
    };
    visit(base);
  }
  return ids;
}

export function validateMappings(config, peer, forbidden = mainnetIds()) {
  const env = ENVIRONMENTS[config?.environment];
  if (config?.schema !== 1 || !env || config.applicationKey !== env.appKey || config.branch !== env.branch ||
      config.networkKind !== 'cloud_engine') throw Error('Exact dedicated OpenCloud environment required');
  principal(config.subnetId); principal(config.operatorId);
  if (!Array.isArray(config.groups) || config.groups.length < 2 || config.groups.length > 3 ||
      config.groups.some((g, i) => g.id !== `g${i + 1}`)) throw Error('Ordered g1/g2 groups required; further groups use the same complete recipe (50-canister app limit)');
  const exact = (obj, keys) => obj && Object.keys(obj).length === keys.length && keys.every(k => Object.hasOwn(obj, k));
  if (!exact(config.shared, ['frontend', ...SHARED_SERVICES]) || config.groups.some(g => !exact(g.canisterIds, GROUP_BUILD_SERVICES))) throw Error('Complete six shared and thirteen group service mappings required');
  const rows = inventory(config); const ids = rows.map(row => principal(row.id));
  if (new Set(ids).size !== ids.length || ids.some(id => forbidden.has(id))) throw Error('Unique OpenCloud IDs required; existing mainnet IDs forbidden');
  const peerIds = peer ? inventory(peer).map(row => row.id).filter(Boolean) : [];
  if (peer && (peer.environment === config.environment || !ENVIRONMENTS[peer.environment])) throw Error('Opposite OpenCloud environment required');
  if (ids.some(id => peerIds.includes(id))) throw Error('OpenCloud DEV/PROD canister overlap');
  return rows;
}

export function validate(config, peer, forbidden = mainnetIds()) {
  const rows = validateMappings(config, peer, forbidden);
  const ids = rows.map(row => row.id); const env = ENVIRONMENTS[config.environment];
  if (typeof config.engineId !== 'string' || !config.engineId.trim()) throw Error('Verified engine ID required');
  principal(config.consoleProxyId);
  if (config.consoleProxyId === config.operatorId || ids.includes(config.consoleProxyId)) throw Error('Console chain-key proxy is distinct from the engine deployment operator');
  const host = new URL(config.apiHost);
  if (host.protocol !== 'https:' || host.username || host.password || host.origin !== config.apiHost ||
      ['icp-api.io', 'ic0.app', 'icp0.io'].includes(host.hostname)) throw Error('Explicit engine HTTPS API host required, no mainnet endpoint default');
  const controllers = Object.values(config.controllers).map(principal);
  if (new Set(controllers).size !== 3 || controllers.includes(config.operatorId) || ids.some(id => controllers.includes(id))) throw Error('Distinct owner, internal governor and frontend publisher required');
  if (peer && [config.controllers.governor, config.controllers.frontendPublisher].some(p =>
      [peer.controllers.governor, peer.controllers.frontendPublisher].includes(p))) throw Error('DEV/PROD signing identities must be separate');
  if (config.supabase?.url !== `https://${env.databaseRef}.supabase.co` ||
      typeof config.supabase.publishableKey !== 'string' || !config.supabase.publishableKey.trim()) throw Error('Existing matching email environment publishable configuration required');
  if (config.supabase.publishableKey.startsWith('sb_secret_')) throw Error('Private database keys forbidden');
  try { if (JSON.parse(Buffer.from(config.supabase.publishableKey.split('.')[1] || '', 'base64url')).role === 'service_role') throw Error('Private database keys forbidden'); }
  catch (error) { if (error.message === 'Private database keys forbidden') throw error; }
  for (const group of config.groups) {
    if (!Number.isInteger(group.maxClubs) || group.maxClubs < 1 || group.maxClubs > 100000 ||
        !/^[1-9][0-9]*$/.test(group.heapBudgetBytes || '') || BigInt(group.heapBudgetBytes) > 3n * 1024n ** 3n) throw Error('Measured group capacities required within existing router bounds (heap bytes as decimal text)');
  }
  if (config.environment === 'opencloud-dev' && (!/^[1-9][0-9]*$/.test(config.engineSettings.devWasmMemoryLimit || ''))) throw Error('Reviewed DEV wasm memory limit required');
  if (config.environment === 'opencloud-prod' && (!Number.isInteger(config.engineSettings.prodComputeAllocation) || config.engineSettings.prodComputeAllocation < 1 || config.engineSettings.prodComputeAllocation > 100)) throw Error('Reviewed PROD compute reservation required');
  if (config.push?.enabled !== false || config.push.workerPrincipal || config.push.senderUrl) throw Error('Push commissioning is separate; no shared sender or automatic activation');
  return rows;
}

export function initArgs(service, governor) {
  if (NO_ARGS.has(service)) return '()';
  if (!governor) return null;
  return RUST.has(service) ? `(record { governor = principal "${governor}" })` : `(principal "${governor}")`;
}

export function serviceSettings(config, row) {
  const variables = { IGNITE_CLOUD_ENGINE: '1', GOVERNOR_PRINCIPAL: config.controllers.governor };
  if (row.service === 'pii_access_control') Object.assign(variables, { VETKD_KEY_NAME: 'key_1', PROXY_CANISTER_ID: config.consoleProxyId });
  // Lifecycle/recovery/admission/name-release flags are intentionally NOT synthesized.
  // Set them only using existing reviewed commissioning protocols, after live evidence.
  return { environmentVariables: variables,
    controllerPolicy: 'preserve-effective-controller-list; verify-operator-and-approved-signer-access; no-controller-mutation',
    requiredControllerRoles: row.service === 'frontend' ? ['engine-operator', 'owner', 'frontend-publisher'] : ['engine-operator', 'owner', 'internal-governor'],
    ...(config.environment === 'opencloud-dev' ? { wasmMemoryLimit: config.engineSettings.devWasmMemoryLimit } :
      { computeAllocation: config.engineSettings.prodComputeAllocation }),
    attachedCycles: '0' };
}

export function connectionCalls(config) {
  const rows = inventory(config);
  const lookup = (group, service) => rows.find(row => row.service === service && row.scope === (SHARED_SERVICES.includes(service) ? 'shared' : group));
  const calls = [];
  for (const group of config.groups) {
    for (const line of read(path.join(ROOT, 'scripts/engine-browser/links.txt')).trim().split('\n')) {
      const [service, method, shape, names] = line.split('|');
      // One complete multi-group authority write, not an intermediate
      // single-group value followed by a replacement later.
      if (['set_competition_authorities', 'set_participant_club_authorities'].includes(method)) continue;
      const did = read(path.join(ROOT, `backend/${service}/${service}.did`));
      if (!new RegExp(`\\b${method}\\s*:`).test(did)) throw Error(`Missing Candid method ${service}.${method}`);
      const ids = names ? names.split(',').map(name => lookup(group.id, name)?.id) : [];
      if (ids.some(id => !id)) throw Error('Incomplete wiring target');
      const args = shape === 'none' ? '()' : shape === 'vec' ? `(vec { principal "${ids[0]}" })` :
        `(${ids.map(id => `principal "${id}"`).join(', ')})`;
      calls.push({ target: lookup(group.id, service).id, service: `${group.id}_${service}`, method,
        candidArgs: args, signer: 'internal-governor', interfaceSha256: sha(did),
        verify: 'read_group_opening_configuration', uncertainOutcome: 'stop-readback-no-blind-replay' });
    }
    // Role and participant relationships are reciprocal across the complete deployment.
    calls.push({ target: lookup(group.id, 'club_domain').id, method: 'set_competition_authorities',
      service: `${group.id}_club_domain`,
      candidArgs: `(vec { ${config.groups.map(g => `principal "${lookup(g.id, 'competition_domain').id}"`).join('; ')} })`, signer: 'internal-governor', verify: 'read_group_opening_configuration' });
    calls.push({ target: lookup(group.id, 'competition_domain').id, method: 'set_participant_club_authorities',
      service: `${group.id}_competition_domain`,
      candidArgs: `(vec { ${config.groups.map(g => `principal "${lookup(g.id, 'club_domain').id}"`).join('; ')} })`, signer: 'internal-governor', verify: 'read_group_opening_configuration' });
  }
  return calls;
}

export function frontendEnv(config) {
  const rows = inventory(config);
  const ids = Object.fromEntries(rows.filter(row => row.scope === 'shared' && row.service !== 'frontend' || row.scope === 'g1').map(row => [row.service, row.id]));
  const target = { provider: 'icp', alias: config.environment, host: config.apiHost, networkKind: 'cloud_engine',
    deploymentClass: 'cloud_engine', canisterIds: ids, status: 'active' };
  return { IGNITE_LIVE_BUILD: '1', IGNITE_LIVE_OPENCLOUD_ENV: config.environment,
    IGNITE_LIVE_ICP_NETWORK_KIND: 'cloud_engine', IGNITE_LIVE_ICP_ALIAS: config.environment,
    IGNITE_LIVE_ICP_HOST: config.apiHost, IGNITE_LIVE_ICP_CANISTER_IDS_JSON: JSON.stringify(ids),
    IGNITE_LIVE_ICP_TARGETS_JSON: JSON.stringify([target]), IGNITE_LIVE_ACTIVE_ICP_ALIAS: config.environment,
    IGNITE_LIVE_OPENCLOUD_IDS_JSON: JSON.stringify(Object.fromEntries(rows.map(row => [row.name, row.id]))),
    IGNITE_LIVE_II_DERIVATION_ORIGIN: `https://${config.shared.frontend}.icp.net`,
    IGNITE_LIVE_NATIVE_II_BRIDGE_ORIGIN: `https://${config.shared.frontend}.icp.net`,
    IGNITE_LIVE_SUPABASE_URL: config.supabase.url, IGNITE_LIVE_SUPABASE_ANON_KEY: config.supabase.publishableKey,
    IGNITE_LIVE_BACKEND_ROUTING_JSON: JSON.stringify({ defaultBackend: 'icp', countryRules: {}, targets: [],
      countryTargets: {}, clubBackendOverrides: {}, emailAuthClubs: [] }),
    IGNITE_FRONTEND_ENV: config.environment, FRONTEND_CANISTER_ID: config.shared.frontend };
}

export function manifest(config, peer, forbidden, allowUnresolved = false) {
  const rows = allowUnresolved ? validateMappings(config, peer, forbidden) : validate(config, peer, forbidden);
  const base = { schema: 'ignite-opencloud-deployment/v1', environment: config.environment,
    applicationKey: config.applicationKey, sourceMode: 'existing-application-fresh-dev-data',
    engine: { id: config.engineId, operatorId: config.operatorId, subnetId: config.subnetId,
      apiHost: config.apiHost, consoleProxyId: config.consoleProxyId },
    restrictions: { createCanisters: false, reinstall: false, deployProd: false, automateCI: false,
      changeControllers: false, changeMainnet: false, changeSupabase: false, changeDNS: false, migrateData: false },
    executable: false, status: 'prepared-not-deployed',
    tooling: { icpCli: '1.7.0', moc: '1.16.1', motokoRecipe: '@dfinity/motoko@v5.1.0', rustRecipe: '@dfinity/rust@v3.3.0', frontendRecipe: '@dfinity/static-site@v0.4.0' },
    canisters: rows.map(row => ({ ...row, wasm: `artifacts/${row.service}.wasm.gz`,
      candid: row.service === 'frontend' ? null : `candid/${row.service}.did`,
      wasmSha256: null, moduleSha256: null, initArgs: initArgs(row.service, config.controllers.governor),
      settings: serviceSettings(config, row), installMode: 'install-only-if-module-hash-null',
      upgradePersistence: RUST.has(row.service) || row.service === 'frontend' ? null : 'keep' })),
    installOrder: [...SHARED_SERVICES.filter(s => s !== 'shard_router'), 'shard_router',
      ...config.groups.flatMap(g => GROUP_BUILD_SERVICES.map(s => `${g.id}_${s}`)), 'frontend'],
    postInstallCalls: connectionCalls(config),
    groups: config.groups.map(g => ({ groupId: g.id, targetAlias: config.environment,
      deploymentId: config.environment, photoStore: g.canisterIds.media_blob_store,
      piiAuthority: g.canisterIds.pii_access_control, maxClubs: g.maxClubs, heapBudgetBytes: g.heapBudgetBytes,
      domains: Object.entries(g.canisterIds).filter(([service]) => service !== 'media_blob_store').concat([['secret_workload_identity', config.shared.secret_workload_identity]]),
      minCycles: '0', accepting: false, registrationExecutable: false,
      registrationBlocker: 'Current router rejects min_cycles=0. Do not substitute fake positive engine cycles; engine-aware resource admission requires implementation and validation.',
      primarySubnet: config.subnetId, additionalSubnetsEnabled: false })),
    sharedCommissioning: [
      { target: config.shared.migration_coordinator, action: 'constructor-only-no-migration' },
      { target: config.shared.placement_registry, action: 'constructor-only; set_policy/set_target after reviewed semantics; no invented set_router' },
      { target: config.shared.identity_access, method: 'provision_production_account_inventory', status: 'held', reason: 'Independent witness/signed lifecycle evidence required; 32 provisioned canisters do not supply it' },
      { target: config.shared.identity_access, method: 'pin_owner_test_deletion_registry', status: 'held', argumentType: 'Binding from identity_access.did' },
      { target: config.shared.identity_access, method: 'configure_membership_directory', status: 'held', arguments: 'Binding, vec principal of all verified receiver services, nat64 capacity' },
      { target: config.shared.shard_router, method: 'set_deletion_authority', status: 'held', candidArgs: `(principal "${config.shared.identity_access}")` },
      { target: config.shared.secret_workload_identity, method: 'register_workload', status: 'held-until-approved-worker-and-scopes' },
    ],
    placementPolicy: 'g1-first; g2-closed-until-capacity-and-verified-opening; existing-assignments-immutable',
    prerequisites: ['owner-verified-exact-empty-inventory-and-controllers', 'console-proxy-allowed-subnet-and-funding',
      'engine-host-api-and-certification', 'artifacts-built-and-hashed', 'shared-identity-lifecycle-and-routing-commissioning',
      'direct-governor-call-transport', 'frontend-asset-upload-transport', 'fresh-signed-in-functional-acceptance',
      'zero-cycle-router-resource-policy', 'fresh-group1-signed-inventory-bootstrap', 'engine-specific-club-name-authority-commissioning'],
  };
  return { ...base, preparationSha256: sha(json(base)) };
}

/** Only copies source. No spawn, signing credentials, agents, workflow or network. */
export function prepare(config, peer, output) {
  if (config.environment !== 'opencloud-dev') throw Error('PROD is template-only; no PROD package generation');
  // Compilation does not require a signing identity or funded/commissioned engine.
  // Preserve unresolved init/settings in the held manifest, never guess them.
  const m = manifest(config, peer, undefined, true); const out = path.resolve(output);
  const allowed = path.join(ROOT, 'deploy/opencloud/work');
  if (!out.startsWith(allowed + path.sep) || existsSync(out)) throw Error('A new directory under deploy/opencloud/work is required');
  mkdirSync(out, { recursive: true });
  const workspace = path.join(out, 'build'); mkdirSync(workspace);
  const filtered = src => !src.split(path.sep).some(p => ['.git', '.jj', '.mops', '.icp', 'target', 'node_modules'].includes(p)) && !/\.pem$/.test(src);
  cpSync(path.join(ROOT, 'backend'), path.join(workspace, 'backend'), { recursive: true, filter: filtered });
  for (const name of ['Cargo.toml', 'Cargo.lock', 'mops.toml', 'mops.lock']) cpSync(path.join(ROOT, name), path.join(workspace, name));
  const source = path.join(workspace, 'backend/pii_access_control/src/main.mo');
  const marker = 'let freshEngineBuild = false; // IGNITE_FRESH_ENGINE_BUILD';
  const text = read(source);
  if (text.split(marker).length !== 2) throw Error('Fresh engine source sentinel drift');
  writeFileSync(source, text.replace(marker, 'let freshEngineBuild = true; // IGNITE_FRESH_ENGINE_BUILD'));
  // Preserve source recipes, rewriting only governor init/settings inside the isolated copy.
  for (const service of [...SHARED_SERVICES, ...GROUP_BUILD_SERVICES]) {
    const file = path.join(workspace, `backend/${service}/canister.yaml`);
    const recipe = YAML.parse(read(file));
    const args = initArgs(service, config.controllers.governor);
    if (args) recipe.init_args = args; else delete recipe.init_args;
    recipe.settings = { environment_variables: { IGNITE_CLOUD_ENGINE: '1', ...(config.controllers.governor ? { GOVERNOR_PRINCIPAL: config.controllers.governor } : {}),
      ...(service === 'pii_access_control' ? { VETKD_KEY_NAME: 'key_1', PROXY_CANISTER_ID: config.consoleProxyId } : {}) } };
    writeFileSync(file, YAML.stringify(recipe));
  }
  writeFileSync(path.join(workspace, 'icp.yaml'), YAML.stringify({ canisters: [...SHARED_SERVICES, ...GROUP_BUILD_SERVICES].map(s => `backend/${s}`) }));
  mkdirSync(path.join(out, 'candid'));
  for (const service of [...SHARED_SERVICES, ...GROUP_BUILD_SERVICES]) cpSync(path.join(ROOT, `backend/${service}/${service}.did`), path.join(out, `candid/${service}.did`));
  writeFileSync(path.join(out, 'manifest.json'), json(m));
  writeFileSync(path.join(out, 'frontend-env.json'), json(frontendEnv(config)));
  writeFileSync(path.join(out, 'config.json'), json(config));
  return m;
}

export function collect(output) {
  const out = path.resolve(output);
  if (!out.startsWith(path.join(ROOT, 'deploy/opencloud/work') + path.sep)) throw Error('Only isolated OpenCloud work directories');
  const m = JSON.parse(read(path.join(out, 'manifest.json')));
  if (m.environment !== 'opencloud-dev' || m.restrictions.createCanisters !== false) throw Error('DEV-only manifest required');
  const artifacts = new Map();
  const { gzipSync, gunzipSync } = require('node:zlib');
  for (const service of [...SHARED_SERVICES, ...GROUP_BUILD_SERVICES]) {
    const file = path.join(out, `build/.icp/cache/artifacts/${service}`);
    const bytes = readFileSync(file);
    const raw = bytes[0] === 31 && bytes[1] === 139 ? gunzipSync(bytes) : bytes;
    if (!raw.subarray(0, 8).equals(Buffer.from([0,97,115,109,1,0,0,0]))) throw Error(`Invalid module ${service}`);
    artifacts.set(service, raw);
  }
  // All source artifacts must be valid before publishing any.
  mkdirSync(path.join(out, 'artifacts'), { recursive: true });
  for (const [service, raw] of artifacts) {
    const compressed = gzipSync(raw, { level: 9 });
    writeFileSync(path.join(out, `artifacts/${service}.wasm.gz`), compressed);
    for (const row of m.canisters.filter(r => r.service === service)) {
      row.wasmSha256 = sha(compressed); row.moduleSha256 = sha(raw);
      row.candidSha256 = sha(readFileSync(path.join(out, row.candid)));
    }
  }
  m.status = 'backend-artifacts-collected-frontend-and-live-acceptance-pending';
  writeFileSync(path.join(out, 'manifest.json'), json(m));
  return m;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [cmd, ...args] = process.argv.slice(2);
  const load = file => { if (statSync(file).size > 262144) throw Error('Configuration exceeds 256 KiB'); return JSON.parse(read(file)); };
  if (cmd === 'template' && args.length === 1) console.log(json(template(args[0])));
  else if (cmd === 'check' && args.length === 2) { validate(load(args[0]), load(args[1])); console.log('Configuration isolated; live deployment still unverified'); }
  else if (cmd === 'manifest' && args.length === 2) console.log(json(manifest(load(args[0]), load(args[1]), undefined, true)));
  else if (cmd === 'prepare' && args.length === 3) { prepare(load(args[0]), load(args[1]), args[2]); console.log('Offline DEV build source prepared; unresolved install/signing fields remain held; no network operations'); }
  else if (cmd === 'collect' && args.length === 1) { collect(args[0]); console.log('Backend artifacts hashed; frontend and live acceptance still required'); }
  else throw Error('Usage: template <opencloud-dev|opencloud-prod> | check|manifest <config> <peer> | prepare <dev-config> <prod-config> <new-work-dir> | collect <work-dir>');
}