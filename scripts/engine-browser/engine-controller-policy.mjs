/**
 * Engine controller policy: who may control the OpenCloud DEV engine canisters.
 *
 * - The OpenCloud owner identity keeps console control of every part.
 * - The DEV governor key is the identity "[TEST] Upgrade backend" signs with
 *   (see .github/workflows/upgrade-all-groups.yml, which asserts it), so it must
 *   be a controller of every part AND the internal governor handed to every
 *   service that takes one at install — governor-only tools (app-admin grants,
 *   sign-in reopen, rekey) refuse any other caller.
 * - The web-app publishing key only ever publishes the web app, so it is a
 *   controller of the web-app part alone.
 */
export const ENGINE_OWNER = '4sf7q-x5j7l-a3cwp-dt7rd-evzpu-gextt-cmqum-fmzsg-avqpp-wk7ga-sae';
export const DEV_GOVERNOR = 'vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae';
export const WEB_APP_KEY = 'jfagr-a4uwo-nlikz-ysri5-ipbrt-k4qa2-vkofo-it7lz-eha3w-4wix6-oqe';
export const WEB_APP_PART = 'frontend';

/** Every part the combined DEV engine app installs. */
export const EXPECTED_PARTS = Object.freeze([
  'club_domain', 'club_points_domain', 'competition_domain', 'events_domain',
  'identity_access', 'insights_domain', 'media_blob_store', 'media_metadata',
  'messaging_domain', 'migration_coordinator', 'mini_league_domain',
  'notification_queue', 'pii_access_control', 'placement_registry',
  'secret_workload_identity', 'shard_router', 'timer_jobs', 'vault_domain',
  WEB_APP_PART,
]);

/** Services whose constructor takes no argument, so they get no governor at install. */
export const NO_INIT_ARG_PARTS = Object.freeze(['media_blob_store', 'timer_jobs', WEB_APP_PART]);

export function controllersFor(name) {
  return name === WEB_APP_PART
    ? [ENGINE_OWNER, DEV_GOVERNOR, WEB_APP_KEY]
    : [ENGINE_OWNER, DEV_GOVERNOR];
}

/** Rewrites one install argument so the service's internal governor is the DEV governor key. */
export function initArgValueFor(value) {
  if (typeof value !== 'string') throw Error('install argument must be text');
  if (!value.includes(ENGINE_OWNER)) throw Error('install argument does not name the engine owner');
  return value.split(ENGINE_OWNER).join(DEV_GOVERNOR);
}

/** Returns a new manifest with the required controllers and install arguments. */
export function applyEngineControllerSettings(manifest) {
  const next = JSON.parse(JSON.stringify(manifest));
  for (const canister of next.canisters) {
    canister.settings = canister.settings || {};
    canister.settings.controllers = controllersFor(canister.name);
    if (canister.init_args && typeof canister.init_args.value === 'string') {
      canister.init_args = { ...canister.init_args, value: initArgValueFor(canister.init_args.value) };
    }
  }
  return next;
}

/** Throws when a manifest would leave GitHub unable to update or govern a part. */
export function assertEngineControllerSettings(manifest) {
  const names = manifest.canisters.map((c) => c.name);
  if (names.length !== EXPECTED_PARTS.length || EXPECTED_PARTS.some((n) => !names.includes(n))) {
    throw Error('manifest parts do not match the 19 expected DEV engine parts');
  }
  for (const canister of manifest.canisters) {
    const want = controllersFor(canister.name);
    const got = canister.settings?.controllers || [];
    if (want.length !== got.length || want.some((p) => !got.includes(p))) {
      throw Error(`${canister.name}: controllers must be exactly ${want.join(', ')}`);
    }
    if (canister.name !== WEB_APP_PART && got.includes(WEB_APP_KEY)) {
      throw Error(`${canister.name}: the web-app publishing key must not control backend parts`);
    }
    const value = canister.init_args?.value;
    if (NO_INIT_ARG_PARTS.includes(canister.name)) {
      if (value !== undefined) throw Error(`${canister.name}: takes no install argument`);
      continue;
    }
    if (typeof value !== 'string' || !value.includes(DEV_GOVERNOR) || value.includes(ENGINE_OWNER)) {
      throw Error(`${canister.name}: install argument must name the DEV governor key, not the owner`);
    }
  }
}
