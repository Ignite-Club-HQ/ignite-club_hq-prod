// Test-only comparison across ESM/CJS Principal constructors. Keep every field,
// vector order, numeric type and digest byte strict; never compare display text.
import assert from 'node:assert/strict';
import { Principal } from '@icp-sdk/core/principal';

function comparable(value) {
 if (value && value._isPrincipal === true && typeof value.toUint8Array === 'function') {
  return Principal.fromUint8Array(Uint8Array.from(value.toUint8Array()));
 }
 if (Array.isArray(value)) return value.map(comparable);
 if (value && Object.getPrototypeOf(value) === Object.prototype) {
  return Object.fromEntries(Object.entries(value).map(([key,entry])=>[key,comparable(entry)]));
 }
 return value;
}

export function assertCandidEqual(actual,expected,message) {
 assert.deepEqual(comparable(actual),comparable(expected),message);
}