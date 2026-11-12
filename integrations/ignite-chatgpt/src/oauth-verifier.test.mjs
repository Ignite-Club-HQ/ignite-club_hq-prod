import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync, createSign} from "node:crypto";
import {createOauthDelegationVerifier} from "./oauth-verifier.mjs";
import {DEV_ORIGIN} from "./core.mjs";
const {privateKey,publicKey}=generateKeyPairSync("rsa",{modulusLength:2048,publicExponent:0x10001});
const issuer="https://auth-dev.example.invalid", audience="https://ignite-dev-mcp.example.invalid/mcp",jwksUrl=issuer+"/.well-known/jwks.json";
const now=Date.parse("2026-11-13T00:00:00Z");
const jwk={...publicKey.export({format:"jwk"}),kid:"test-key-1",alg:"RS256",use:"sig"};
const b64=value=>Buffer.from(JSON.stringify(value)).toString("base64url");
function jwt(claims={},header={}){
  const tokenHeader={typ:"at+jwt",alg:"RS256",kid:jwk.kid,...header};
  const tokenClaims={iss:issuer,sub:"signed-in-user-123",aud:audience,
    exp:Math.floor(now/1000)+1800,iat:Math.floor(now/1000)-10,
    scope:"ignite:read ignite:chat:send",jti:"token-one",...claims};
  const input=b64(tokenHeader)+"."+b64(tokenClaims);
  const signer=createSign("RSA-SHA256");signer.update(input);signer.end();
  const sig=signer.sign(privateKey).toString("base64url");
  return input+"."+sig;
}
const baseRecord={
  oauthSubject:"signed-in-user-123",delegationVerified:true,environment:"dev",
  derivationOrigin:DEV_ORIGIN,principal:"test-principal-123",
  actorFactory:()=>({}),approvedScopes:["ignite:read","ignite:chat:send"],
  delegationExpiresAtMs:now+1_800_000,
};
const setup=(config={})=>{
  const calls=[];
  const verify=createOauthDelegationVerifier({
    issuer,audience,jwksUrl,clock:()=>now,
    fetchJwks:async(url,request)=>{calls.push({url,request});return {ok:true,text:async()=>JSON.stringify({keys:[jwk]})};},
    resolveDelegatedSession:async(subject,ctx)=>{calls.push({subject,ctx});return config.session??baseRecord;},
  });
  return {verify,calls};
};
const denies=async(p)=>assert.rejects(p,/token|scope|[Aa]uthoriz|delegation|identity|signing|[Kk]ey|expired|issuer|audience|access/i);
test("accepts a signed, scoped access token only with verified caller delegation",async()=>{
  const {verify,calls}=setup();const session=await verify(jwt());
  assert.equal(session.principal,baseRecord.principal);
  assert.deepEqual(session.scopes,["ignite:read","ignite:chat:send"]);
  assert.equal(session.internetIdentityDelegationVerified,true);
  assert.equal(calls[0].url,jwksUrl);
  assert.equal(calls[1].subject,"signed-in-user-123");
  assert.equal("token" in session,false);
});
test("valid signature never compensates for wrong issuer, audience or expired token",async()=>{
  const {verify}=setup();
  await denies(verify(jwt({iss:"https://evil.example.invalid"})));
  await denies(verify(jwt({aud:"https://other.example.invalid/mcp"})));
  await denies(verify(jwt({exp:Math.floor(now/1000)-120})));
  await denies(verify(jwt({nbf:Math.floor(now/1000)+120})));
});
test("forged signature, unsupported algorithm and attacker key URLs are rejected",async()=>{
  const {verify}=setup();
  const parts=jwt().split(".");
  const forged=b64({sub:"intruder",aud:audience})+"";
  await denies(verify(parts[0]+"."+forged+"."+parts[2]));
  await denies(verify(jwt({}, {alg:"none"})));
  await denies(verify(jwt({}, {jku:"https://evil.example.invalid/keys"})));
  await denies(verify(jwt({}, {kid:"missing-key"})));
});
test("no unsigned service-account impersonation, wrong origin or expired delegation",async()=>{
  for (const record of [
    {...baseRecord,oauthSubject:"someone-else"},
    {...baseRecord,delegationVerified:false},
    {...baseRecord,derivationOrigin:"https://igniteclubhq.app"},
    {...baseRecord,delegationExpiresAtMs:now-1},
    {...baseRecord,actorFactory:null},
    {...baseRecord,environment:"prod"}
  ]){const {verify}=setup({session:record});await denies(verify(jwt()));}
});
test("tokens cannot grant scopes beyond the delegation registry",async()=>{
  const {verify}=setup({session:{...baseRecord,approvedScopes:["ignite:read"]}});
  const result=await verify(jwt());
  assert.deepEqual(result.scopes,["ignite:read"]);
  const {verify:missingRead}=setup({session:{...baseRecord,approvedScopes:["ignite:chat:send"]}});
  await denies(missingRead(jwt()));
});
test("rejects JWTs without scope or with unknown scope",async()=>{
  const {verify}=setup();
  await denies(verify(jwt({scope:""})));
  await denies(verify(jwt({scope:"ignite:admin"})));
});
test("requires pinned HTTPS issuer/JWKS on same origin and delegation store",()=>{
  assert.throws(()=>createOauthDelegationVerifier({issuer:"http://localhost",audience,jwksUrl,resolveDelegatedSession:async()=>baseRecord}),/HTTPS/);
  assert.throws(()=>createOauthDelegationVerifier({issuer,audience,jwksUrl:"https://attacker.invalid/jwks",resolveDelegatedSession:async()=>baseRecord}),/issuer origin/);
  assert.throws(()=>createOauthDelegationVerifier({issuer,audience,jwksUrl}),/delegated session lookup/i);
});
