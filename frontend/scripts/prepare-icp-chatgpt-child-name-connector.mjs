/**
 * Offline bridge from DFINITY ICP ChatGPT tool receipts to Ignite's existing
 * local vetKeys IBE child-name encryption. No canister calls or signing here.
 *
 * Input receipts MUST come from the actual, verified connector responses.
 * JSON is not a signature; the caller must preserve tool-result provenance.
 * This requires an existing successful single create_own_child() result;
 * NEVER create or retry a child just to obtain a valid input.
 */
import { prepareEncryptedChatgptChildName } from './prepare-icp-chatgpt-child-name.mjs';

export const DEV_CHATGPT_CHILD_TARGET = Object.freeze({
  appUrl: 'https://proe7-kqaaa-aaaas-qg6gq-cai.icp0.io',
  derivationOrigin: 'https://proe7-kqaaa-aaaas-qg6gq-cai.ic0.app',
  clubCanister: 'yfwyv-nyaaa-aaaal-qxpyq-cai',
  piiCanister: 'zt5a6-yiaaa-aaaal-qxp5q-cai',
  clubId: '177f8c01-3617-402a-aedd-5c5c17ccfde1',
  teamId: 'a3e9341e-bc61-4e4d-9ebf-2f2c9f347128',
  test3Principal: 'mfmwy-tuspw-6ikuj-mfaqb-le2p3-ndi4w-a5caq-cwcit-xhnob-lidne-fae',
});

const T = DEV_CHATGPT_CHILD_TARGET;
const CHILD_ID = /^child-own-[0-9]+-[0-9]+$/;

function check(ok, reason) {
  if (!ok) throw Error(reason);
}

function compact(text) {
  return text.replace(/\s+/g, ' ');
}

function checkReceipt(r, method, canister) {
  check(r && typeof r === 'object' && !Array.isArray(r), 'Missing connector receipt');
  check(r.method === method && r.canister_id === canister, 'Incorrect connector method or canister');
  check(r.declared_by === T.appUrl && r.declared_at === '/.well-known/ic-architecture',
    'Incorrect DEV manifest authority');
  check(r.derived_for_origin === T.derivationOrigin && r.is_anonymous === false,
    'Wrong or anonymous Internet Identity derivation');
  check(typeof r.reply === 'string' && r.reply.length > 0 && r.reply.length < 100_000,
    'Missing or oversized connector Candid reply');
  return r.reply;
}

/** Accept only the exact 96 bytes of a textual-Candid public verification key. */
export function parseCandidPublicKey(reply) {
  check(typeof reply === 'string', 'Missing Candid key');
  const match = /^\(\s*blob\s+"((?:\\[0-9a-fA-F]{2}){96})"\s*,?\s*\)$/.exec(reply.trim());
  check(match, 'Expected exactly 96 escaped public key bytes');
  const bytes = [...match[1].matchAll(/\\([0-9a-fA-F]{2})/g)]
    .map(m => Number.parseInt(m[1], 16));
  check(bytes.length === 96, 'Invalid verification-key length');
  return Uint8Array.from(bytes);
}

function checkParentRole(reply) {
  check(typeof reply === 'string' && reply.length < 50_000, 'Missing Parent role grant');
  // Each Candid role grant has a flat record body. NEVER combine fragments from
  // separate records: a club_admin role elsewhere is not an U10 parent role.
  const records = [...reply.matchAll(/\brecord\s*\{([^{}]{1,1500})\}/g)]
    .map(m => compact(m[1]));
  const found = records.some(r =>
    r.includes('club = opt "' + T.clubId + '"') &&
    r.includes('team = opt "' + T.teamId + '"') &&
    r.includes('user = principal "' + T.test3Principal + '"') &&
    r.includes('role = "parent"'));
  check(found, 'Missing exact Test3 Parent grant for ChatGPT Plugin Test U10');
}

/** One newly returned caller-owned unassigned child; never parse an Err. */
export function parseCreatedChildId(reply) {
  check(typeof reply === 'string' && reply.length < 16_000, 'Missing child creation response');
  const success = [...reply.matchAll(/\b(?:Ok|"Ok")\s*=\s*record\s*\{/g)];
  check(success.length === 1 && !/\bErr\s*=/.test(reply), 'Expected one successful create_own_child result');
  // A child record contains "teams = vec {}", so a flat record regex would
  // falsely reject every legitimate reply. Parse balanced Candid braces.
  const start = success[0].index + success[0][0].length - 1;
  let depth = 0;
  let end = -1;
  for (let i = start; i < reply.length; i++) {
    const c = reply[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
    check(depth >= 0 && depth <= 4, 'Malformed child creation reply');
  }
  check(end > start && depth === 0, 'Unbalanced child creation reply');
  const body = compact(reply.slice(start + 1, end));
  const ids = [...body.matchAll(/\bid\s*=\s*"([^"]+)"/g)];
  check(ids.length === 1 && CHILD_ID.test(ids[0][1]), 'Unverified new child ID');
  check(body.includes('parent = opt principal "' + T.test3Principal + '"'),
    'New child not owned by Test3');
  check(/\bteams\s*=\s*vec\s*\{\s*\}/.test(body) && /\bclub_id\s*=\s*null\b/.test(body),
    'New child already has unexpected assignments');
  return ids[0][1];
}

function checkApp(app) {
  check(app && app.app_url === T.appUrl && app.derivation_origin === T.derivationOrigin &&
    !app.discovery_error, 'Wrong application or Internet Identity origin');
  check(Array.isArray(app.canisters), 'No ICP service discovery');
  for (const canister of [T.clubCanister, T.piiCanister]) {
    const matches = app.canisters.filter(c =>
      c.canister_id === canister && c.declared === true &&
      Array.isArray(c.sources) && c.sources.includes('ic-architecture'));
    check(matches.length === 1, 'Group 2 service is not uniquely declared in the canonical manifest');
  }
}

function checkIdentity(identity) {
  check(identity && identity.principal === T.test3Principal &&
    identity.requested === T.derivationOrigin &&
    identity.derived_for_origin === T.derivationOrigin &&
    identity.read_only === false, 'Wrong or read-only Test3 Internet Identity');
}

/**
 * Translate authenticated connector receipts into encrypted Candid arguments.
 * No writes, encryption of plaintext is local using the existing ICP SDK.
 *
 * @param {object} input
 * @returns {object} Candid arguments for individually approved connector calls.
 */
export function prepareChildNameFromIcpConnector(input) {
  check(input && typeof input === 'object' && !Array.isArray(input), 'Missing input');
  checkApp(input.app);
  checkIdentity(input.identity);
  checkParentRole(checkReceipt(input.roleReceipt, 'read_account_my_role_grants', T.clubCanister));
  const childId = parseCreatedChildId(
    checkReceipt(input.childReceipt, 'create_own_child', T.clubCanister));
  const verificationKey = parseCandidPublicKey(
    checkReceipt(input.publicKeyReceipt, 'pii_vetkey_verification_key', T.piiCanister));
  const p = prepareEncryptedChatgptChildName({
    childId,
    childName: input.childName,
    callerPrincipal: T.test3Principal,
    clubId: T.clubId,
    teamId: T.teamId,
    piiCanisterId: T.piiCanister,
    verificationKey,
  });
  return {
    version: 1,
    appUrl: T.appUrl,
    derivationOrigin: T.derivationOrigin,
    ownerPrincipal: T.test3Principal,
    childId,
    clubId: T.clubId,
    teamId: T.teamId,
    piiCanisterId: T.piiCanister,
    ciphertextLength: p.ciphertext.length,
    // Each write requires explicit approval and must use signed DFINITY calls.
    registration: {canister_id:T.piiCanister,method:'register_pii',args:p.registrationArgs},
    readback: {canister_id:T.piiCanister,method:'get_encrypted_pii_batch',args:p.readbackArgs},
    clubGrant: {canister_id:T.piiCanister,method:'grant_pii_read_club',args:p.clubGrantArgs},
    parentGrant: {canister_id:T.piiCanister,method:'grant_pii_read',args:p.parentGrantArgs},
    assignment: {canister_id:T.clubCanister,method:'set_own_child_team',
      args:'(' + JSON.stringify(childId) + ', ' + JSON.stringify(T.teamId) + ', true)'},
  };
}
