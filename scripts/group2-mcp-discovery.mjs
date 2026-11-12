// Shared, reviewed DEV-only MCP discovery for Group 2. Publication of an ID
// is not an authorisation grant: every canister still checks caller privileges.
import { readFileSync } from "node:fs";

export const GROUP2_CUSTOMER_SERVICES = Object.freeze([
  ["club_domain", "Clubs, teams, memberships and roles; caller-scoped."],
  ["events_domain", "Club and team schedules, event attendance and RSVPs."],
  ["messaging_domain", "Team chat, direct messages, polls and reactions; scoped by conversation."],
  ["vault_domain", "Club/team files and folders; role-scoped."],
  ["competition_domain", "Competitions, fixtures, ladders and registrations."],
  ["club_points_domain", "Club rewards, points and leaderboards."],
  ["mini_league_domain", "Mini leagues, sessions and match-day activities."],
  ["media_metadata", "Club gallery metadata, comments and reactions."],
  ["media_blob_store", "Club media blobs; ciphertext and storage permissions remain enforced."],
  ["insights_domain", "Club analytics; existing admin permissions remain enforced."],
]);

// Not exposed on Group 2 by this DEV integration:
// pii_access_control, notification_queue, timer_jobs, secret_workload_identity,
// governor/deployment controls. No PROD frontend may advertise these G2 ids.
const CANISTER_ID = /^[a-z0-9]{5}(?:-[a-z0-9]{5}){3}-cai$/;
const SHA256 = /^[a-f0-9]{64}$/;

export function validateGroup2CustomerCanisters({ provision, approval, sharedIds, frontendId }) {
  if (provision?.groupId !== "g2" || provision?.deploymentId !== "mainnet" ||
      provision?.phase !== "checked" || approval?.targetAlias !== "mainnet" ||
      approval?.deploymentId !== "mainnet" ||
      approval?.routerId !== sharedIds?.shard_router ||
      approval?.identityAccess !== sharedIds?.identity_access ||
      !Array.isArray(approval?.services) || !Array.isArray(provision?.installedDomains)) {
    throw new Error("Pinned DEV Group 2 provision and approval required for MCP discovery");
  }
  const installed = new Set(provision.installedDomains);
  const approved = new Map(approval.services.map(service => [service.name, service]));
  if (approved.size !== approval.services.length) throw new Error("Duplicate Group 2 approval service");
  const occupied = new Set([frontendId, ...Object.values(sharedIds)]);
  const result = [];
  for (const [name, description] of GROUP2_CUSTOMER_SERVICES) {
    const isBlob = name === "media_blob_store";
    const canisterId = isBlob ? provision.dedicatedBlobStore?.canisterId : provision.canisters?.[name];
    const service = approved.get(name);
    if ((!isBlob && !installed.has(name)) ||
        (isBlob && provision.dedicatedBlobStore?.installed !== true) ||
        typeof canisterId !== "string" || !CANISTER_ID.test(canisterId) ||
        service?.canisterId !== canisterId || !SHA256.test(service?.moduleHash ?? "") ||
        occupied.has(canisterId)) {
      throw new Error(`Missing, unapproved, or duplicate DEV Group 2 customer service: ${name}`);
    }
    occupied.add(canisterId);
    result.push({ id: canisterId, name: `g2/${name}`, role: "backend", description: `DEV Group 2 — ${description}` });
  }
  return result;
}

export function reviewedDevGroup2Canisters({ sharedIds, frontendId }) {
  const provision = JSON.parse(readFileSync(new URL("../deploy/groups/g2/provision.json", import.meta.url), "utf8"));
  const approval = JSON.parse(readFileSync(new URL("../deploy/groups/g2/general-opening.json", import.meta.url), "utf8"));
  return validateGroup2CustomerCanisters({ provision, approval, sharedIds, frontendId });
}
