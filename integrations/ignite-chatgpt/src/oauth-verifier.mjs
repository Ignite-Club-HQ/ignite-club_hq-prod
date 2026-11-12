/**
 * Verification boundary for an external OAuth/OIDC authorization service.
 *
 * This module NEVER generates or accepts self-asserted user identities.
 * A JWT proves authorization only after signature + standard claim checks,
 * then a separate secure delegation vault must supply an active caller-owned
 * ICP signing identity for exactly the DEV derivation origin.
 *
 * Intended for a hosted trusted authorization service; NOT an OAuth issuer,
 * session store, delegated-key generator or token refresh implementation.
 */
import {createPublicKey, verify as verifySignature} from "node:crypto";
import {DEV_ORIGIN} from "./core.mjs";

const MAX_TOKEN_BYTES=16_384;
const MAX_JWKS_BYTES=131_072;
function fail(message){const error=new Error(message);error.code="UNAUTHORIZED";throw error;}
function validHttps(url){
  let value;
  try {value=new URL(url);}catch{throw Error("Invalid OAuth URL");}
  if(value.protocol!=="https:"||value.username||value.password||value.hash||
     !value.hostname || value.port)throw Error("OAuth URLs must use canonical HTTPS");
  return value.href;
}
function decodeSegment(text,label){
  if(typeof text!=="string"||!text||!/^[A-Za-z0-9_-]+$/.test(text))fail("Invalid "+label);
  let bytes;
  try{bytes=Buffer.from(text.replace(/-/g,"+").replace(/_/g,"/"),"base64");}
  catch{fail("Invalid "+label);}
  if(bytes.toString("base64url")!==text)fail("Non-canonical "+label);
  return bytes;
}
function jsonSegment(text,label){
  const bytes=decodeSegment(text,label);
  try{
    const data=JSON.parse(bytes.toString("utf8"));
    if(!data||typeof data!=="object"||Array.isArray(data))fail("Invalid "+label);
    return data;
  }catch{fail("Invalid "+label);}
}
function sameOrigin(a,b){
  try{return new URL(a).origin===new URL(b).origin;}catch{return false;}
}
function textList(s){return typeof s==="string"?s.split(/\s+/).filter(Boolean):[];}
function parseBearerJwt(jwt){
  if(typeof jwt!=="string"||jwt.length>MAX_TOKEN_BYTES||jwt.length<40)fail("Invalid access token");
  const segments=jwt.split(".");
  if(segments.length!==3)fail("Invalid token structure");
  const [h,p,s]=segments;
  const header=jsonSegment(h,"token header");
  const claims=jsonSegment(p,"token payload");
  const signature=decodeSegment(s,"token signature");
  if(!["RS256","ES256"].includes(header.alg)||typeof header.kid!=="string"||!header.kid||
     header.kid.length>128||header.crit||header.jku||header.jwk||
     header.x5u||header.b64===false||header.typ&&
     !["JWT","at+jwt","application/at+jwt"].includes(header.typ))fail("Unsupported token header");
  return {header,claims,signature,signingInput:Buffer.from(h+"."+p)};
}
function requireClaims(claims,{issuer,audience,nowMs,leewayMs}){
  const now=Math.floor(nowMs/1000),slack=Math.floor(leewayMs/1000);
  if(claims.iss!==issuer||typeof claims.sub!=="string"||!claims.sub||
     claims.sub.length>512||!(claims.aud===audience||
      Array.isArray(claims.aud)&&claims.aud.includes(audience))||
     !Number.isSafeInteger(claims.exp)||claims.exp<=now-slack||
     claims.nbf!=null&&(!Number.isSafeInteger(claims.nbf)||claims.nbf>now+slack)||
     claims.iat!=null&&(!Number.isSafeInteger(claims.iat)||claims.iat>now+slack)){
    fail("Access token issuer, audience or validity invalid");
  }
  if(claims.exp-now>3600*24)fail("Token lifetime exceeds server policy");
  // Ory may use either a scope string or an scp array. Offline Access
  // grants refresh-token renewal only; it is never an Ignite data permission.
  const known=new Set(["ignite:read","ignite:chat:send","offline_access","openid"]);
  if(claims.scope!==undefined && typeof claims.scope!=="string")
    fail("OAuth scope claim has invalid type");
  if(claims.scp!==undefined &&
     (!Array.isArray(claims.scp)||claims.scp.some(x=>typeof x!=="string")))
    fail("OAuth scp claim has invalid type");
  const fromText=textList(claims.scope), fromList=claims.scp??[];
  if(fromText.length && fromList.length &&
     (fromText.length!==fromList.length || fromText.some(x=>!fromList.includes(x))))
    fail("OAuth scope claims disagree");
  const granted=fromText.length?fromText:fromList;
  if(granted.length===0||granted.length>12||
     granted.some(x=>!known.has(x)) || new Set(granted).size!==granted.length ||
     !granted.includes("ignite:read"))
    fail("OAuth token has invalid or missing Ignite scopes");
  const scopes=granted.filter(x=>x.startsWith("ignite:"));
  return {scopes,expiresAtMs:claims.exp*1000};
}
/**
 * @param {object} config
 * @param {string} config.issuer Exact trusted OAuth issuer (HTTPS).
 * @param {string} config.audience Exact DEV MCP resource identifier.
 * @param {string} config.jwksUrl Trusted issuer's allowlisted key URL (HTTPS).
 * @param {Function} config.resolveDelegatedSession Trusted, encrypted, server-
 * side session store lookup. It MUST verify II delegation proof cryptographically
 * and return a still-live caller-signed actorFactory.
 * @param {Function} [config.fetchJwks] Optional injected HTTPS key fetcher.
 * @param {Function} [config.clock] Test clock (milliseconds).
 */
export function createOauthDelegationVerifier({
  issuer,audience,jwksUrl,resolveDelegatedSession,
  fetchJwks=fetch,clock=Date.now,jwksTtlMs=300_000,leewayMs=15_000,
}={}){
  const trustedIssuer=validHttps(issuer).replace(/\/$/,"");
  const keysUri=validHttps(jwksUrl);
  if(!sameOrigin(keysUri,trustedIssuer))throw Error("JWKS must be from the configured issuer origin");
  if(typeof audience!=="string"||!audience.startsWith("https://")||audience.length>256)
    throw Error("Invalid DEV MCP audience");
  if(typeof resolveDelegatedSession!=="function")throw Error("Verified delegated session lookup required");
  if(typeof fetchJwks!=="function"||typeof clock!=="function")throw Error("Invalid trust dependencies");
  let jwksCache=null;
  let cachedUntil=0;
  async function trustedKey(kid,alg){
    if(!jwksCache||clock()>=cachedUntil){
      const response=await fetchJwks(keysUri,{headers:{accept:"application/json"},redirect:"error"});
      if(!response?.ok)fail("Authorization keys unavailable");
      const buf=await response.text();
      if(buf.length>MAX_JWKS_BYTES)fail("Authorization key set too large");
      let raw;
      try{raw=JSON.parse(buf);}catch{fail("Invalid authorization key set");}
      if(!Array.isArray(raw?.keys)||raw.keys.length<1||raw.keys.length>30)fail("Invalid authorization key set");
      jwksCache=raw.keys;
      cachedUntil=clock()+jwksTtlMs;
    }
    const matches=jwksCache.filter(x=>x.kid===kid);
    if(matches.length!==1)fail("Unknown access-token signing key");
    const jwk=matches[0];
    const matchingKey = (
      alg==="RS256" &&
      jwk.kty==="RSA" && typeof jwk.n==="string" &&
      typeof jwk.e==="string" && !jwk.d
    ) || (
      alg==="ES256" &&
      jwk.kty==="EC" && jwk.crv==="P-256" &&
      typeof jwk.x==="string" && typeof jwk.y==="string" && !jwk.d
    );
    if(!matchingKey||(jwk.use&&jwk.use!=="sig")||
       (jwk.alg&&jwk.alg!==alg))
       fail("Untrusted access-token signing key");
    return createPublicKey({key:jwk,format:"jwk"});
  }
  return async function verifyBearerToken(bearer,context={}){
    const {header,claims,signature,signingInput}=parseBearerJwt(bearer);
    const key=await trustedKey(header.kid,header.alg);
    const valid=header.alg==="ES256"
      ?verifySignature("sha256",signingInput,{key,dsaEncoding:"ieee-p1363"},signature)
      :verifySignature("RSA-SHA256",signingInput,key,signature);
    if(!valid)fail("Invalid access-token signature");
    const {scopes,expiresAtMs}=requireClaims(claims,{
      issuer:trustedIssuer,audience,nowMs:clock(),leewayMs});
    // No actor is accepted from a token/header or browser. The lookup happens
    // ONLY in the trusted server-owned secure delegation registry.
    const record=await resolveDelegatedSession(claims.sub,{
      issuer:trustedIssuer,tokenJti:claims.jti??null,clientId:claims.client_id??null,
      grantedScopes:scopes,expiresAtMs,context});
    if(!record||record.oauthSubject!==claims.sub||record.delegationVerified!==true||
       record.environment!=="dev"||record.derivationOrigin!==DEV_ORIGIN||
       !record.principal||typeof record.actorFactory!=="function"||
       !Number.isSafeInteger(record.delegationExpiresAtMs)||
       record.delegationExpiresAtMs<=clock()+leewayMs)fail("Internet Identity delegation unavailable or expired");
    const permitted=Array.isArray(record.approvedScopes)?record.approvedScopes:[];
    const effectiveScopes=scopes.filter(scope=>permitted.includes(scope));
    if(!effectiveScopes.includes("ignite:read"))fail("Ignite data access not authorized");
    return Object.freeze({
      oauthVerified:true,internetIdentityDelegationVerified:true,
      environment:"dev",derivationOrigin:DEV_ORIGIN,
      principal:record.principal,actorFactory:record.actorFactory,
      scopes:Object.freeze(effectiveScopes),
    });
  };
}
