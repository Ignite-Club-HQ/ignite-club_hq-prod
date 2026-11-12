/**
 * Configured per-user ICP backend entrypoint.
 * The private routing module must derive server-authoritative placement from
 * the signed DEV principal and guarantee that actorFactory uses that caller.
 * No admin key, anonymous or hardcoded test data is accepted.
 */
import {createCallerIcpBackend} from "./icp-backend-adapter.mjs";
const moduleUrl=process.env.IGNITE_DEV_ROUTING_ADAPTER_MODULE;
if(!moduleUrl)throw Error("Verified DEV placement resolver module required");
const router=await import(moduleUrl);
if(typeof router.listDevGroups!=="function" ||
   typeof router.resolveClubPlacement!=="function")
  throw Error("DEV group discovery and placement resolver are required");
export const backend=createCallerIcpBackend({
  listDevGroups:router.listDevGroups,
  resolveClubPlacement:router.resolveClubPlacement
});
