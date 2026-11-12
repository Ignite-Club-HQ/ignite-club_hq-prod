/**
 * Ignite plugin read-only account/role preflight, using the SAME delegated
 * Internet Identity as the native app. This is library code, NOT an MCP
 * endpoint or a deployment. No account creation, permissions or service bypass.
 *
 * The caller supplies actors created with this exact authenticated identity.
 * Do not trust a user-provided principal or an MCP connection's display name.
 */
import { adaptRemoteAccountReads } from '../frontend/src/live/accountReadAdapter.mjs';
import {
  DEV_G2_CLUB, DEV_IDENTITY, DEV_ROUTER, validateDiscovery,
} from './ignite-plugin-discovery-parity.mjs';

export const DEV_SHARED_CLUB = 'mzzzv-taaaa-aaaal-qxlrq-cai';
const SELF_READ_ERROR = /account admission denied|service admission not released|configured identity authority|required|account authority changed|use protected consensus account read|linked account authority unavailable/i;

const asText = value =>
  typeof value === 'string' ? value : typeof value?.toText === 'function' ? value.toText() : null;

function requireVerifiedIdentity(accountReply, caller) {
  if (!accountReply || !('Ok' in accountReply)) throw new Error('Ignite account not available to signed-in principal');
  const account = accountReply.Ok;
  if (!account || !('Active' in account.status) ||
      !Array.isArray(account.principals) ||
      !account.principals.some(p=>asText(p)===caller)) {
    throw new Error('Ignite identity is not an active account linked to the connected principal');
  }
  if (typeof account.id !== 'string' || !account.id) throw new Error('Identity account record invalid');
  return account;
}

function projectGrants(rows) {
  if (!Array.isArray(rows)) throw new Error('Unexpected club role-grant reply');
  return rows.map(row => {
    if (!row || typeof row.role !== 'string') throw new Error('Invalid role grant');
    const club = Array.isArray(row.club) ? row.club[0] ?? null : null;
    const team = Array.isArray(row.team) ? row.team[0] ?? null : null;
    if (club!==null && typeof club!=='string' || team!==null && typeof team!=='string') {
      throw new Error('Invalid club/team scope');
    }
    return {role:row.role, club, team};
  });
}

/**
 * Returns an explicit status for EACH group; denied/unreachable is NEVER an
 * empty successful grant inventory. The identities/actors must be built by the
 * trusted Ignite transport from one and the same Internet Identity delegation.
 *
 * createClubActor: async (canisterId, identity) => { actor, service } where
 * service is the matching IDL.Service including exact protected method twins.
 */
export async function readNativePluginAccess({
  identity, identityAccess, manifest, createClubActor,
  groupCanisters={base:DEV_SHARED_CLUB,g2:DEV_G2_CLUB},
}) {
  if (!identity || typeof identity.getPrincipal !== 'function' ||
      !identityAccess || typeof identityAccess.whoami !== 'function' ||
      typeof createClubActor !== 'function') throw new Error('Authenticated Ignite transport required');

  const principal=asText(identity.getPrincipal());
  if (!principal || principal==='2vxsx-fae') throw new Error('Internet Identity principal required');
  validateDiscovery(manifest);
  const allowed=new Set(manifest.canisters.map(v=>v.id));
  if (!allowed.has(DEV_IDENTITY) || !allowed.has(DEV_ROUTER)) throw new Error('Missing shared control plane');

  const account=requireVerifiedIdentity(await identityAccess.whoami(),principal);
  const groupIds=Object.entries(groupCanisters);
  if (groupIds.length===0 || new Set(groupIds.map(([,id])=>id)).size!==groupIds.length ||
      groupIds.some(([group,id])=>!group || typeof id!=='string' || !id)) throw new Error('Invalid group inventory');

  const results=await Promise.all(groupIds.map(async([group,canisterId])=>{
    if (!allowed.has(canisterId)) return {group,canisterId,status:'not_declared'};
    try {
      // The same identity object is passed unchanged; never mint an agent
      // principal, use a privileged signer or derive a new login here.
      const connected=await createClubActor(canisterId,identity);
      if (!connected || typeof connected.actor?.my_role_grants!=='function' ||
          !connected.service?._fields) throw new Error('Missing native role-grant contract');
      const actor=adaptRemoteAccountReads(connected.actor,connected.service,canisterId);
      const grants=projectGrants(await actor.my_role_grants());
      return {group,canisterId,status:'available',grants};
    } catch(error) {
      const message=String(error?.message ?? error);
      if (SELF_READ_ERROR.test(message)) return {group,canisterId,status:'admission_unavailable'};
      return {group,canisterId,status:'read_failed'};
    }
  }));

  // Only a fully verified current inventory should drive permissions or a
  // "you have no clubs" message. Partial success is display-only.
  const complete=results.every(r=>r.status==='available');
  return {
    principal,accountId:account.id,identityVerified:true,complete,
    groups:results,
    roles:complete?results.flatMap(r=>r.grants.map(g=>({...g,group:r.group}))):null,
  };
}
