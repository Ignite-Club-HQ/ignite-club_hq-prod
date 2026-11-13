// TEMPORARY DEV Test3-only synthetic profile encryption rehearsal. NOT for production use.
// This file never contacts mainnet, signs a message or writes to canisters.
import { DerivedPublicKey, IbeCiphertext, IbeIdentity, IbeSeed } from '@icp-sdk/vetkeys';
const canister = 'iui5p-aaaaa-aaaal-qxllq-cai';
const principal = 'mfmwy-tuspw-6ikuj-mfaqb-le2p3-ndi4w-a5caq-cwcit-xhnob-lidne-fae';
const key = Uint8Array.from([177,78,48,240,39,234,226,250,163,45,107,185,179,87,249,4,113,97,47,2,140,204,166,139,115,233,231,155,126,96,58,13,177,58,235,166,72,77,108,230,164,14,171,99,8,189,77,249,5,252,123,102,83,62,240,95,130,46,204,29,55,217,215,12,228,80,86,157,252,41,64,98,116,136,172,236,41,43,138,10,130,223,174,28,225,98,96,53,85,12,213,228,186,91,161,192]);
const field = 'display_name';
const name = 'Test3';
const identity = new TextEncoder().encode(principal + '\u001f' + field);
const encrypted = IbeCiphertext.encrypt(DerivedPublicKey.deserialize(key), IbeIdentity.fromBytes(identity), new TextEncoder().encode(name), IbeSeed.random()).serialize();
const reloaded=IbeCiphertext.deserialize(encrypted);
if (!encrypted.length || encrypted.length>4096 || !reloaded)throw Error('Encrypted IBE ciphertext invalid');
console.log('IGNITE_TEST3_DEV_ENCRYPTED_HEX='+Buffer.from(encrypted).toString('hex'));
console.log('IGNITE_TEST3_DEV_ENCRYPTED_FOR='+canister+'|'+principal+'|'+field);
