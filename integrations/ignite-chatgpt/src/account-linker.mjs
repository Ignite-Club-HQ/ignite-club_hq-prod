/**
 * Explicit OAuth-to-Internet-Identity account-link handshake for Ignite DEV.
 *
 * The host's OAuth authorization server owns PKCE, state, consent and tokens.
 * After OAuth, this two-phase handshake binds a signed-in OAuth subject to a
 * short-lived II delegation challenge. This module NEVER validates II proof
 * by itself: it REQUIRES a cryptographically verifying, origin-pinned trusted
 * II adapter and a transactional, encrypted server-owned session registry.
 * The existing DFINITY connector token/delegation is never imported.
 */
import {randomBytes,createHash,timingSafeEqual} from "node:crypto";
import {DEV_ORIGIN} from "./core.mjs";

const TTL_MS=5*60_000;
const MAX_SCOPES=new Set(["ignite:read","ignite:chat:send"]);
function deny(message){const e=new Error(message);e.code="LINK_DENIED";throw e;}
const random=()=>randomBytes(32).toString("base64url");
const digest=value=>createHash("sha256").update(value).digest("hex");
const safeSame=(a,b)=>{
  if(typeof a!=="string"||typeof b!=="string")return false;
  const aa=Buffer.from(a,"utf8"),bb=Buffer.from(b,"utf8");
  return aa.length===bb.length&&timingSafeEqual(aa,bb);
};
const eligible=(scopes)=>Array.isArray(scopes)&&scopes.length>=1&&scopes.length<=2 &&
  scopes.every(s=>MAX_SCOPES.has(s))&&scopes.includes("ignite:read")&&new Set(scopes).size===scopes.length;
const scopeSubset=(requested,approved)=>requested.every(s=>approved.includes(s));

/**
 * Required trusted adapters:
 * - pendingStore.create(key,record): atomic insert with unique random key
 * - pendingStore.consume(key): atomic destructive take, safe against concurrent
 *   requests and multiple instances; expired/revoked records are not returned
 * - verifyInternetIdentityProof({origin,nonce,proof}): CRYPTOGRAPHIC proof
 *   validation including delegation chains, audience, expiration, expected
 *   nonce binding and correct canonical DEV derivation origin. It returns an
 *   opaque, caller-signed actorFactory and the derivation principal.
 * - delegatedRegistry.link(subject,record): encrypted, consented storage
 *   with revocation, TTL, and no service/admin identity fallback.
 */
export function createIgniteAccountLinker({
  pendingStore,verifyInternetIdentityProof,delegatedRegistry,
  clock=Date.now,ttlMs=TTL_MS,
}={}){
  if(!pendingStore||typeof pendingStore.create!=="function"||
     typeof pendingStore.consume!=="function"||
     typeof verifyInternetIdentityProof!=="function"||
     !delegatedRegistry||typeof delegatedRegistry.link!=="function"||
     !Number.isInteger(ttlMs)||ttlMs<60_000||ttlMs>10*60_000)
    throw Error("Atomic linking store, verified II adapter and encrypted delegated registry required");

  async function begin({oauthSubject,oauthScopes,requestedScopes}={}){
    if(typeof oauthSubject!=="string"||!oauthSubject||oauthSubject.length>512||
       !eligible(requestedScopes)||!eligible(oauthScopes)||
       !scopeSubset(requestedScopes,oauthScopes))deny("OAuth subject or consent scope invalid");
    const linkId=random(),nonce=random(),state=random(),now=clock();
    await pendingStore.create(digest(linkId),{
      subjectHash:digest(oauthSubject),requestedScopes:[...requestedScopes],
      stateHash:digest(state),nonceHash:digest(nonce),
      nonce,expiresAtMs:now+ttlMs,createdAtMs:now,
    });
    // A nonce is a challenge, not a credential. Never send a bearer token,
    // a signed delegation, or raw OAuth subject to the client.
    return {link_id:linkId,state,challenge:nonce,
      derivation_origin:DEV_ORIGIN,expires_at_ms:now+ttlMs};
  }
  async function complete({oauthSubject,linkId,state,proof}={}){
    if(typeof oauthSubject!=="string"||!oauthSubject||
       typeof linkId!=="string"||linkId.length!==43||
       typeof state!=="string"||state.length!==43||!proof)
      deny("Invalid or missing linking response");
    const record=await pendingStore.consume(digest(linkId));
    // Consume BEFORE any cryptographic validation: every attempt is one-use.
    if(!record||record.expiresAtMs<=clock()||
       !safeSame(record.subjectHash,digest(oauthSubject))||
       !safeSame(record.stateHash,digest(state))||
       !safeSame(record.nonceHash,digest(record.nonce)))
      deny("Account-link challenge is expired, replayed or mismatched");
    const verified=await verifyInternetIdentityProof({
      origin:DEV_ORIGIN,nonce:record.nonce,proof});
    if(!verified||verified.derivationOrigin!==DEV_ORIGIN||
       typeof verified.principal!=="string"||!verified.principal||
       verified.delegationVerified!==true||
       typeof verified.actorFactory!=="function"||
       !Number.isSafeInteger(verified.expiresAtMs)||
       verified.expiresAtMs<=clock()+15_000)
      deny("Internet Identity delegation validation failed");
    // Never grant scopes not already present in OAuth consent.
    await delegatedRegistry.link(oauthSubject,{
      oauthSubject,principal:verified.principal,derivationOrigin:DEV_ORIGIN,
      environment:"dev",delegationVerified:true,
      delegationExpiresAtMs:verified.expiresAtMs,
      actorFactory:verified.actorFactory,approvedScopes:record.requestedScopes,
    });
    return {linked:true,environment:"dev",principal:verified.principal,
      expires_at_ms:verified.expiresAtMs};
  }
  return Object.freeze({begin,complete});
}
