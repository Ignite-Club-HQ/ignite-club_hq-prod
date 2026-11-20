/**
 * Local, synthetic-only rehearsal of secure name-form output against REAL
 * disposable PocketIC PII + identity canisters. Does not expose a ChatGPT UI,
 * connect to mainnet, create II delegations, or exercise an MCP host bridge.
 * Unlike a mock, the VetKeys key relay and decryption are cryptographic.
 *
 * The identity fixture does not activate production secure-name release
 * settings; real release enforcement and certified host handoff remain separate
 * gates. Never turn a green result into a claim of live signup readiness.
 */
import assert from 'node:assert/strict';
import { PocketIc, PocketIcServer } from '@dfinity/pic';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import {
  DerivedPublicKey, EncryptedVetKey, TransportSecretKey, IbeCiphertext
} from '@icp-sdk/vetkeys';
import { idlFactory as piiIdl } from '../src/lab/bindings/pii_access_control/declarations/pii_access_control.did.js';
import { idlFactory as identityIdl } from '../src/lab/bindings/identity_access/declarations/identity_access.did.js';
import {
  prepareEncryptedChatgptProfileName, matchesPrivateNameRegistration
} from './prepare-icp-chatgpt-private-name.mjs';

const id = n => Principal.fromUint8Array(Uint8Array.from([n, 1]));
const governor = id(1), coach = id(2), stranger = id(3);
const subject = coach.toText(), field = 'display_name';
const inventedName = 'Example Coach';
const codec = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();
const requireOk = result => {
  assert.ok(result && Object.hasOwn(result, 'Ok'), 'Expected a successful canister response');
  return result.Ok;
};

const server = await PocketIcServer.start();
let pic;
try {
  pic = await PocketIc.create(server.getUrl(), { fiduciary: { state: { type: 'new' } } });
  const pii = await pic.setupCanister({
    idlFactory: piiIdl,
    wasm: process.env.CHATGPT_NAME_PII_WASM,
    sender: governor, controllers: [governor],
    arg: IDL.encode([IDL.Principal], [governor]),
    environmentVariables: [{ name: 'VETKD_KEY_NAME', value: 'key_1' }],
  });
  const identity = await pic.setupCanister({
    idlFactory: identityIdl,
    wasm: process.env.CHATGPT_NAME_IDENTITY_WASM,
    sender: governor, controllers: [governor],
    arg: IDL.encode([IDL.Record({ governor: IDL.Principal })], [{ governor }]),
  });
  const asPii = who => { pii.actor.setPrincipal(who); return pii.actor; };
  const asIdentity = who => { identity.actor.setPrincipal(who); return identity.actor; };
  assert.ok('Err' in await asIdentity(coach).whoami());
  const account = requireOk(await asIdentity(coach).register_account());
  assert.equal(requireOk(await asIdentity(coach).register_account()).id, account.id, 'Idempotent registration');
  assert.ok('Err' in await asIdentity(coach).get_profile());
  assert.deepEqual(requireOk(await asIdentity(coach).my_terms_acceptance()), []);

  const publicKeyBytes = Uint8Array.from(await asPii(coach).pii_vetkey_verification_key());
  const verification = DerivedPublicKey.deserialize(publicKeyBytes);
  assert.equal(publicKeyBytes.length, 96);
  const prepared = prepareEncryptedChatgptProfileName({
    displayName: inventedName, callerPrincipal: subject,
    piiAuthority: pii.canisterId.toText(), verificationKey: publicKeyBytes,
  });
  assert.ok(prepared.ciphertext.length > 40);
  assert.ok(!prepared.registrationArgs.includes(inventedName), 'Only ciphertext may enter signed tool args');
  assert.ok(!prepared.profileArgs.includes(inventedName), 'Profile contains only original PII reference');
  assert.ok('Err' in await asPii(stranger).register_pii(subject, field, prepared.ciphertext, coach),
    'Different principal cannot write owner ciphertext');
  assert.deepEqual(requireOk(await asPii(stranger).get_encrypted_pii_batch([subject], field, 'read', 'synthetic')), [],
    'Stranger cannot read owner ciphertext');

  // The following simulated client-side call sequence mirrors the official
  // connector's required authenticated API; actor identity is test-only.
  const recorded = requireOk(await asPii(coach).register_pii(subject, field, prepared.ciphertext, coach));
  assert.ok(matchesPrivateNameRegistration(recorded, subject, prepared.ciphertext));
  const rows = requireOk(await asPii(coach).get_encrypted_pii_batch([subject], field, 'read', 'synthetic owner verification'));
  assert.equal(rows.length, 1);
  assert.ok(matchesPrivateNameRegistration(rows[0], subject, prepared.ciphertext));

  const transport = TransportSecretKey.random();
  const sealedKeys = requireOk(await asPii(coach).get_encrypted_pii_vetkeys_batch([subject], field, transport.publicKeyBytes()));
  assert.equal(sealedKeys.length, 1);
  assert.ok(sealedKeys[0]?.[0]);
  const identityBytes = encoder.encode(subject + '\u001f' + field);
  const privateKey = EncryptedVetKey.deserialize(Uint8Array.from(sealedKeys[0][0]))
    .decryptAndVerify(transport, verification, identityBytes);
  const reopenedName = codec.decode(IbeCiphertext.deserialize(Uint8Array.from(rows[0].ciphertext)).decrypt(privateKey));
  assert.equal(reopenedName, inventedName, 'REAL VetKeys decryption must match invented input');

  // A wrong field or altered ciphertext must not decrypt using this key.
  const tampered = Uint8Array.from(rows[0].ciphertext);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => IbeCiphertext.deserialize(tampered).decrypt(privateKey), 'Tampered ciphertext denied');
  assert.deepEqual(requireOk(await asPii(stranger).get_encrypted_pii_vetkeys_batch([subject], field, TransportSecretKey.random().publicKeyBytes())), [[]],
    'Stranger cannot obtain an owner vetKey');

  // Profile reference is published only after exact signed ciphertext
  // readback AND authenticated decryption succeeded.
  const profile = requireOk(await asIdentity(coach).set_profile(prepared.reference, []));
  assert.equal(profile.display_name, prepared.reference);
  assert.equal(requireOk(await asIdentity(coach).get_profile()).display_name, prepared.reference);
  assert.ok('Err' in await asIdentity(stranger).set_profile(prepared.reference, []));
  assert.deepEqual(requireOk(await asIdentity(coach).my_terms_acceptance()), [],
    'Private-name registration must not silently record legal consent');
  assert.equal(requireOk(await asIdentity(coach).set_terms_acceptance(1)).terms_version, 1,
    'Consent occurs only as an independently authorised action in the test');
  assert.equal(requireOk(await asIdentity(coach).my_terms_acceptance())[0].terms_version, 1);

  // Immutable authority reference is not a substitute for a new session's
  // original PII authorisation checks; do not copy this into an MCP signer.
  assert.equal(prepared.reference, 'pii-display-name:v1:' + pii.canisterId.toText() + ':' + subject);
  prepared.ciphertext.fill(0);
  transport /* retained only in this discarded PocketIC test process */;
  console.log('PASS: synthetic real PocketIC private-name ciphertext, signed-as-owner writes, authorized vetKey decrypt, tamper and outsider denial, profile reference and separate consent. No live canister writes.');
} finally {
  if (pic) await pic.tearDown();
  await server.stop();
}
