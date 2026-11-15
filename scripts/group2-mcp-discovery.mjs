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

// Explicitly opt-in only on the pinned DEV frontend for the child-name test.
// Discovery exposes the WHOLE canister interface, not just registration methods.
// The vault must continue to enforce owner/guardian/club authorization on-chain.
// Never publish governor or worker services through this path.
const DEV_G2_CHILD_PII_PIN = "zt5a6-yiaaa-aaaal-qxp5q-cai";
const GROUP2_CHILD_NAME_PII_SERVICE = Object.freeze([
  "pii_access_control",
  "Encrypted child-name vault; owner-authorized writes and scoped reads. No plaintext.",
]);

// Not exposed on Group 2 by this DEV integration:
// pii_access_control, notification_queue, timer_jobs, secret_workload_identity,
// governor/deployment controls. The PII exception above is disabled by default
// and requires explicit opt-in on the pinned DEV frontend; queue/worker services
// stay excluded in all cases. No PROD frontend may advertise these G2 ids.
const CANISTER_ID = /^[a-z0-9]{5}(?:-[a-z0-9]{5}){3}-cai$/;
const SHA256 = /^[a-f0-9]{64}$/;

export function validateGroup2CustomerCanisters({ provision, approval, sharedIds, frontendId, includeChildNamePii = false }) {
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
  // Fail closed if the reviewed DEV PII identity, independent module approval,
  // or subnet binding changes. Never accept a caller-supplied arbitrary PII ID.
  if (includeChildNamePii) {
    const pii = approval.services.find(s => s.name === "pii_access_control");
    const club = approval.services.find(s => s.name === "club_domain");
    if (provision.canisters?.pii_access_control !== DEV_G2_CHILD_PII_PIN ||
        pii?.canisterId !== DEV_G2_CHILD_PII_PIN ||
        !pii?.subnetId || pii.subnetId !== club?.subnetId) {
      throw Error("Unreviewed DEV Group 2 child-name PII authority");
    }
  }
  const result = [];
  const domains = includeChildNamePii
    ? [...GROUP2_CUSTOMER_SERVICES, GROUP2_CHILD_NAME_PII_SERVICE]
    : GROUP2_CUSTOMER_SERVICES;
  for (const [name, description] of domains) {
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

export function reviewedDevGroup2Canisters({ sharedIds, frontendId, includeChildNamePii = false }) {
  const provision = JSON.parse(readFileSync(new URL("../deploy/groups/g2/provision.json", import.meta.url), "utf8"));
  const approval = JSON.parse(readFileSync(new URL("../deploy/groups/g2/general-opening.json", import.meta.url), "utf8"));
  return validateGroup2CustomerCanisters({ provision, approval, sharedIds, frontendId, includeChildNamePii });
}
