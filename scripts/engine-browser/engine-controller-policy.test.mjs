import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  ENGINE_OWNER, DEV_GOVERNOR, WEB_APP_KEY, WEB_APP_PART,
  EXPECTED_PARTS, NO_INIT_ARG_PARTS,
  controllersFor, applyEngineControllerSettings, assertEngineControllerSettings,
} from './engine-controller-policy.mjs';

const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { Principal } = require('@icp-sdk/core/principal');

const OWNER = '4sf7q-x5j7l-a3cwp-dt7rd-evzpu-gextt-cmqum-fmzsg-avqpp-wk7ga-sae';
const GOVERNOR = 'vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae';
const WEB = 'jfagr-a4uwo-nlikz-ysri5-ipbrt-k4qa2-vkofo-it7lz-eha3w-4wix6-oqe';

/** The three Rust services take a named governor field; the Motoko services take a bare principal. */
const RECORD_FORM_PARTS = ['identity_access', 'placement_registry', 'shard_router'];

function manifestWith(ownerControlled) {
  return {
    canisters: EXPECTED_PARTS.map((name) => ({
      name,
      settings: { controllers: ownerControlled ? [OWNER, WEB] : controllersFor(name) },
      ...(NO_INIT_ARG_PARTS.includes(name)
        ? {}
        : {
          init_args: {
            value: RECORD_FORM_PARTS.includes(name)
              ? `(record { governor = principal "${OWNER}" })`
              : `(principal "${OWNER}")`,
            format: 'candid',
          },
        }),
    })),
  };
}

test('the three engine keys are distinct valid principals', () => {
  assert.equal(Principal.fromText(ENGINE_OWNER).toText(), OWNER);
  assert.equal(Principal.fromText(DEV_GOVERNOR).toText(), GOVERNOR);
  assert.equal(Principal.fromText(WEB_APP_KEY).toText(), WEB);
  assert.notEqual(ENGINE_OWNER, DEV_GOVERNOR);
  assert.notEqual(DEV_GOVERNOR, WEB_APP_KEY);
});

test('only the web-app part is controlled by the web-app publishing key', () => {
  assert.deepEqual(controllersFor('club_domain'), [OWNER, GOVERNOR]);
  assert.deepEqual(controllersFor(WEB_APP_PART), [OWNER, GOVERNOR, WEB]);
});

test('a manifest that only lists the owner and web-app key is refused', () => {
  const bad = manifestWith(true);
  assert.throws(() => assertEngineControllerSettings(bad), /controllers must be exactly/);
});

test('applying the policy makes the governor both controller and internal governor', () => {
  const fixed = applyEngineControllerSettings(manifestWith(true));
  assertEngineControllerSettings(fixed);
  const club = fixed.canisters.find((c) => c.name === 'club_domain');
  assert.deepEqual(club.settings.controllers, [OWNER, GOVERNOR]);
  assert.equal(club.init_args.value, `(principal "${GOVERNOR}")`);
  assert.equal(club.init_args.format, 'candid');
  const router = fixed.canisters.find((c) => c.name === 'shard_router');
  assert.equal(router.init_args.value, `(record { governor = principal "${GOVERNOR}" })`);
  for (const name of NO_INIT_ARG_PARTS) {
    assert.equal(fixed.canisters.find((c) => c.name === name).init_args, undefined);
  }
});

test('a manifest missing a part is refused', () => {
  const short = applyEngineControllerSettings(manifestWith(false));
  short.canisters = short.canisters.filter((c) => c.name !== 'vault_domain');
  assert.throws(() => assertEngineControllerSettings(short), /19 expected DEV engine parts/);
});
