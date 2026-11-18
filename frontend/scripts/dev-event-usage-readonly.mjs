/**
 * Read-only DEV capacity audit: public, anonymous, no credentials, no writes.
 * Calls ONLY the existing usage_stats() Candid QUERY on the two pinned DEV
 * events_domain canisters. Report total stored events (including deleted),
 * RSVPs and children; do not mistake these totals for caller-visible events.
 *
 * This diagnostic cannot measure protected event-listing latency, internal
 * authorization fan-out or non-event canisters.
 */
import { performance } from "node:perf_hooks";
import { Actor, AnonymousIdentity, HttpAgent } from "@icp-sdk/core/agent";
import { IDL } from "@icp-sdk/core/candid";

const HOST = "https://icp-api.io";
const DEV_EVENT_CANISTERS = Object.freeze({
  "DEV Group 1": "m6y7b-6yaaa-aaaal-qxlra-cai",
  "DEV Group 2": "ymvtj-3qaaa-aaaal-qxpza-cai",
});
const usageIdl = () => IDL.Service({
  usage_stats: IDL.Func([], [IDL.Record({
    events: IDL.Nat,
    rsvps: IDL.Nat,
    children: IDL.Nat,
  })], ["query"]),
});

const agent = await HttpAgent.create({
  host: HOST,
  identity: new AnonymousIdentity(),
});

async function getStats(group, canisterId) {
  const start = performance.now();
  try {
    const actor = Actor.createActor(usageIdl, { agent, canisterId });
    const result = await actor.usage_stats();
    return {
      group,
      canister_id: canisterId,
      status: "ok",
      stored_event_records_including_deleted: result.events.toString(),
      rsvp_records: result.rsvps.toString(),
      child_records: result.children.toString(),
      anonymous_query_wall_ms: Math.round(performance.now() - start),
    };
  } catch (error) {
    // A method missing on deployed Wasm is a valid diagnostic result.
    // Never print stacks, tokens, user profiles or raw response bodies.
    return {
      group,
      canister_id: canisterId,
      status: "unavailable",
      reason: error instanceof Error
        ? error.message.replace(/\s+/g, " ").slice(0, 240)
        : "Unknown read failure",
      anonymous_query_wall_ms: Math.round(performance.now() - start),
    };
  }
}

const results = await Promise.all(
  Object.entries(DEV_EVENT_CANISTERS).map(([group, canisterId]) => getStats(group, canisterId)),
);
console.log(JSON.stringify({
  scope: "DEV-only public anonymous queries",
  query: "events_domain.usage_stats()",
  mutation_count: 0,
  results,
}, null, 2));
if (results.some((r) => r.status !== "ok")) process.exitCode = 1;
