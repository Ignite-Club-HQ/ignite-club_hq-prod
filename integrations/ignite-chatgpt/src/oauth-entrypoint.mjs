/**
 * Configured OAuth verifier entrypoint for the Ignite DEV MCP server.
 * Requires a separately hosted authorization server and trusted encrypted
 * Internet Identity delegation registry; no fake or local bearer fallback.
 */
import {createOauthDelegationVerifier} from "./oauth-verifier.mjs";
const {IGNITE_DEV_OAUTH_ISSUER:issuer,
  IGNITE_DEV_MCP_AUDIENCE:audience,
  IGNITE_DEV_OAUTH_JWKS_URL:jwksUrl,
  IGNITE_DELEGATION_REGISTRY_MODULE:registryModule}=process.env;
if(!issuer||!audience||!jwksUrl||!registryModule)
  throw Error("OAuth issuer, audience, trusted JWKS URL and delegation registry module required");
const registry=await import(registryModule);
if(typeof registry.resolveDelegatedSession!=="function")
  throw Error("Trusted Internet Identity delegation registry is unavailable");
export const verifyBearerToken=createOauthDelegationVerifier({
  issuer,audience,jwksUrl,resolveDelegatedSession:registry.resolveDelegatedSession
});
