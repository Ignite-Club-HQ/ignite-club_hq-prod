// Three exact candidate Wasms; local emulator proxy only, never a real engine.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PocketIc } from '@dfinity/pic';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { DerivedPublicKey, EncryptedVetKey, TransportSecretKey, IbeCiphertext, IbeIdentity, IbeSeed } from '@icp-sdk/vetkeys';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import { idlFactory as piiIdl } from '../src/lab/bindings/pii_access_control/declarations/pii_access_control.did.js';
import { idlFactory as storeIdl } from '../src/lab/bindings/media_blob_store/declarations/media_blob_store.did.js';
import { removalHostPreflight } from './removal-host-preflight.mjs';
import { startRemovalLocalServer, finishRemovalLocalTest } from './removal-local-supervisor.mjs';
import { allowLongUpdates } from './pocket-ic-long-updates.mjs';

const owner = Principal.fromText('4sf7q-x5j7l-a3cwp-dt7rd-evzpu-gextt-cmqum-fmzsg-avqpp-wk7ga-sae');
const uploader = Principal.fromUint8Array(Uint8Array.from([2, 1]));
const member = Principal.fromUint8Array(Uint8Array.from([3, 1]));
const outsider = Principal.fromUint8Array(Uint8Array.from([4, 1]));
const proxyId = Principal.fromText('ynolw-eyaaa-aaaaj-qspkq-cai');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const ok = result => { assert.ok(result && 'Ok' in result, String(result?.Err)); return result.Ok; };
const report = { kind: 'engine-encrypted-media-local-acceptance', passed: false, modules: {}, checks: [],
  realConsoleProxyVerified: false, browserPluginVerified: false, fullBundleInstalled: false, uploadReady: false, productionChanged: false };
let pic, server, primaryError;
try {
  assert.ok(process.env.ENGINE_MEDIA_REPORT, 'Report path required');
  report.host = removalHostPreflight();
  const pins = JSON.parse(readFileSync(new URL('../../scripts/engine-browser/candidate-pins.json', import.meta.url)));
  const inputs = [['club_domain', clubIdl, process.env.CLUB_DOMAIN_WASM],
    ['pii_access_control', piiIdl, process.env.PII_ACCESS_CONTROL_WASM],
    ['media_blob_store', storeIdl, process.env.MEDIA_BLOB_STORE_WASM]];
  for (const [name, , path] of inputs) {
    assert.ok(path, `${name} module required`);
    report.modules[name] = hash(readFileSync(path));
    assert.equal(report.modules[name], pins.modules[name], `Exact candidate ${name} bytes required`);
  }
  report.proxyFixtureSha256 = hash(readFileSync(process.env.ENGINE_TEST_PROXY_WASM));
  server = await startRemovalLocalServer({ binary: process.env.POCKET_IC_BIN, hardTtlSeconds: 300 });
  pic = await PocketIc.create(server.url, { fiduciary: { state: { type: 'new' } }, processingTimeoutMs: 60000 });
  allowLongUpdates(pic);
  // Fixed ID exists ONLY inside this newly owned emulator. No HttpAgent/live URL.
  await pic.setupCanister({ idlFactory: ({ IDL }) => IDL.Service({}), wasm: process.env.ENGINE_TEST_PROXY_WASM,
    targetCanisterId: proxyId, sender: owner, controllers: [owner] });
  const arg = IDL.encode([IDL.Principal], [owner]);
  const fixtures = [];
  for (const [name, idlFactory, wasm] of inputs) {
    const variables = [{ name: 'IGNITE_CLOUD_ENGINE', value: '1' }];
    if (name === 'pii_access_control') variables.push({ name: 'PROXY_CANISTER_ID', value: proxyId.toText() }, { name: 'VETKD_KEY_NAME', value: 'key_1' });
    if (name === 'media_blob_store') variables.push({ name: 'GOVERNOR_PRINCIPAL', value: owner.toText() });
    fixtures.push(await pic.setupCanister({ idlFactory, wasm, sender: owner, controllers: [owner],
      arg: name === 'media_blob_store' ? undefined : arg, environmentVariables: variables }));
  }
  const [club, pii, store] = fixtures;
  for (const fixture of fixtures) fixture.actor.setPrincipal(owner);
  const clubId = 'engine-media-acceptance';
  ok(await club.actor.create_club(clubId, 'Isolated encrypted media', 'isolated-encrypted-media', [], []));
  ok(await club.actor.add_role_grant(uploader, clubId, 'player', []));
  ok(await club.actor.add_role_grant(member, clubId, 'member', []));
  ok(await pii.actor.set_club_domain_canister(club.canisterId));
  ok(await store.actor.set_club_domain_canister(club.canisterId));
  ok(await club.actor.register_media_quota_store(store.canisterId));
  const publicBytes = Uint8Array.from(await pii.actor.pii_vetkey_verification_key());
  assert.equal(publicBytes.length, 96);
  const verification = DerivedPublicKey.deserialize(publicBytes);
  const samples = [
    { name: 'photo.png', mime: 'image/png', bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') },
    { name: 'document.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n') },
  ];
  const saved = [];
  const derive = async (who, path) => {
    pii.actor.setPrincipal(who);
    const transport = TransportSecretKey.random();
    const rows = ok(await pii.actor.get_encrypted_pii_vetkeys_batch([path], 'blob', transport.publicKeyBytes()));
    const encrypted = rows[0]?.[0];
    if (!encrypted) return null;
    return EncryptedVetKey.deserialize(Uint8Array.from(encrypted)).decryptAndVerify(transport, verification, new TextEncoder().encode(`${path}\u001fblob`));
  };
  const download = async path => {
    const response = await store.actor.http_request({ url: `/${path}`, method: 'GET', headers: [], body: [] });
    assert.equal(response.status_code, 200);
    return { bytes: Buffer.from(response.body), headers: response.headers };
  };
  for (const sample of samples) {
    const path = `clubs/${clubId}/photos/${sample.name}`;
    const identity = new TextEncoder().encode(`${path}\u001fblob`);
    const ciphertext = IbeCiphertext.encrypt(verification, IbeIdentity.fromBytes(identity), sample.bytes, IbeSeed.random()).serialize();
    assert.notDeepEqual(Buffer.from(ciphertext), sample.bytes);
    store.actor.setPrincipal(outsider);
    assert.ok('Err' in await store.actor.begin_upload(path, sample.mime, BigInt(ciphertext.length), 1), 'Nonmember upload must fail');
    store.actor.setPrincipal(uploader);
    const upload = ok(await store.actor.begin_upload(path, sample.mime, BigInt(ciphertext.length), 1));
    ok(await store.actor.put_chunk(upload, 0, ciphertext));
    ok(await store.actor.finalize_upload(upload));
    pii.actor.setPrincipal(uploader);
    ok(await pii.actor.register_pii(path, 'blob', [], uploader));
    ok(await pii.actor.grant_pii_read_club(path, 'blob', clubId));
    const downloaded = await download(path);
    assert.deepEqual(downloaded.bytes, Buffer.from(ciphertext));
    assert.ok(downloaded.headers.some(([key, value]) => key.toLowerCase() === 'content-type' && value === sample.mime));
    for (const who of [uploader, member]) {
      const key = await derive(who, path); assert.ok(key, 'Authorized member key required');
      assert.deepEqual(Buffer.from(IbeCiphertext.deserialize(downloaded.bytes).decrypt(key)), sample.bytes);
    }
    assert.equal(await derive(outsider, path), null, 'Outsider must receive no decryption key');
    saved.push({ path, sample });
    report.checks.push(`${sample.name}: encrypted upload/download, exact-byte member decryption, MIME preserved, outsider upload/key denied`);
  }
  for (let i = 0; i < fixtures.length; i++) await pic.upgradeCanister({ canisterId: fixtures[i].canisterId,
    wasm: inputs[i][2], sender: owner, arg: i === 2 ? undefined : arg,
    upgradeModeOptions: { skip_pre_upgrade: [], wasm_memory_persistence: [{ keep: null }] } });
  pii.actor.setPrincipal(owner);
  assert.deepEqual(Uint8Array.from(await pii.actor.pii_vetkey_verification_key()), publicBytes, 'Upgrade preserves proxy-derived public key');
  for (const { path, sample } of saved) {
    const key = await derive(member, path); assert.ok(key);
    assert.deepEqual(Buffer.from(IbeCiphertext.deserialize((await download(path)).bytes).decrypt(key)), sample.bytes);
    assert.equal(await derive(outsider, path), null);
  }
  club.actor.setPrincipal(owner); ok(await club.actor.remove_member(clubId, member));
  for (const { path } of saved) assert.equal(await derive(member, path), null, 'Removed member receives no new key');
  report.checks.push('Club membership and encrypted media survive upgrades; removed members lose fresh key access');
  report.passed = true;
} catch (error) { primaryError = error; }
finally {
  await finishRemovalLocalTest({ pic, server, report, primaryError,
    writeReport: async () => { if (process.env.ENGINE_MEDIA_REPORT) writeFileSync(process.env.ENGINE_MEDIA_REPORT, JSON.stringify(report, null, 2)); } });
}