// Turns the live build (dist-live) into the folder the ICP frontend canister
// serves (dist-canister): index.html entry, SPA fallback (_redirects) and the
// security/cache headers Netlify used to apply (_headers). Read by the
// @dfinity/static-site recipe; see deploy/frontend/icp.yaml.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PROD_MEMBER_II_ORIGIN, DEV_FRONTEND_II_CANISTER, alternativeOriginsForBuild, derivationOriginForBuild } from "./iiOriginPolicy.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const src = `${root}dist-live`;
const out = `${root}dist-canister`;
if (!existsSync(src)) throw new Error("dist-live missing — run `npm run build:live` first");

rmSync(out, { recursive: true, force: true });
cpSync(src, out, { recursive: true });
rmSync(`${out}/bundle-analysis.html`, { force: true });
rmSync(`${out}/bundle-analysis.json`, { force: true });
if (!existsSync(`${out}/index.html`)) copyFileSync(`${out}/live-index.html`, `${out}/index.html`);

// Missing hashed files must 404, never get index.html: old tabs would run HTML
// as JavaScript ("Unexpected token '<'") instead of failing cleanly and
// reloading once (src/lib/chunkRecovery.ts).
writeFileSync(`${out}/asset-not-found.txt`, "Not found\n");
writeFileSync(`${out}/_redirects`, "/assets/*  /asset-not-found.txt  404\n/*  /index.html  200\n");

// Every address of this canister signs in to Internet Identity as
// https://<id>.icp0.io (see resolveDerivationOriginFor in
// src/live/internetIdentityAuth.ts), so the canonical address must list the
// others here — otherwise icp.net and icp0.io give one person two identities.
// PROD builds must name their own frontend canister: the DEV default here
// once leaked into PROD's sign-in and AI-agent discovery files.
const isProdBuild = process.env.IGNITE_FRONTEND_ENV === "prod";
if (isProdBuild && !process.env.FRONTEND_CANISTER_ID) {
  throw new Error("FRONTEND_CANISTER_ID is required for PROD frontend builds");
}
const frontendCanisterId = process.env.FRONTEND_CANISTER_ID || DEV_FRONTEND_II_CANISTER;
mkdirSync(`${out}/.well-known`, { recursive: true });
writeFileSync(
  `${out}/.well-known/ii-alternative-origins`,
  JSON.stringify(
    {
      alternativeOrigins: alternativeOriginsForBuild({ isProdBuild, frontendCanisterId }),
    },
    null,
    2,
  ) + "\n",
);

// Phones sign in by sending the whole page to Internet Identity and back
// (see shouldUseRedirectSignIn in src/live/internetIdentityAuth.ts). II only
// returns to an address listed here, matched exactly, for each canister host.
const callbackHosts = ["icp0.io", "raw.icp0.io", "icp.net", "raw.icp.net", "ic0.app", "raw.ic0.app"];
writeFileSync(
  `${out}/.well-known/ii-auth-callbacks`,
  JSON.stringify({ callbacks: callbackHosts.flatMap((h) => ["/auth", "/native-sign-in.html", "/native-sign-in"].map((p) => `https://${frontendCanisterId}.${h}${p}`)).concat(isProdBuild ? ["/auth", "/native-sign-in.html", "/native-sign-in"].map((p) => `${PROD_MEMBER_II_ORIGIN}${p}`) : []) }, null, 2) + "\n",
);

// ICP MCP Layer 1 (required): the canister manifest AI agents use to
// discover this app (docs.internetcomputer.org/guides/frontends/
// service-discoverability). Served as real JSON at the extensionless path;
// real files win over the /* SPA rewrite on the static-site recipe.
// Canister IDs come from the same sources the app itself uses: the
// IGNITE_LIVE_ICP_CANISTER_IDS_JSON build env, falling back to the deployed
// mainnet ID table committed at deploy/mainnet/.icp/data/mappings/ic.ids.json.

const CANISTER_ROLES = {
  club_domain: ["clubs", "Clubs, teams, memberships and role grants. Call getApiDoc() first."],
  events_domain: ["events", "Club/team events, RSVPs, attendance and fixtures. Call getApiDoc() first."],
  messaging_domain: ["messaging", "Club/team conversations and messages; participant-scoped."],
  vault_domain: ["vault", "Club file vault: folders, files and backups; role-scoped."],
  competition_domain: ["competitions", "Competitions, seasons, matches and public competition pages."],
  notification_queue: ["notifications", "Per-account notification inbox; reads are owner-only."],
  insights_domain: ["insights", "Club engagement analytics; club-admin scoped."],
  mini_league_domain: ["mini-leagues", "Mini leagues, sessions, players and duties."],
  club_points_domain: ["rewards", "Club points, leaderboards and rewards."],
  media_metadata: ["media", "Media asset metadata, galleries, reactions and comments."],
  media_blob_store: ["media-blobs", "Encrypted media blob storage; serves ciphertext only."],
  pii_access_control: ["pii-access", "Encrypted PII access control and vetKey derivation grants."],
  identity_access: ["identity", "Account/principal binding, profiles and entitlements."],
  secret_workload_identity: ["workload-identity", "Internal workload secrets; governor-only."],
  migration_coordinator: ["migration", "Backend migration coordination; public status only."],
  shard_router: ["shard-router", "Internal shard routing."],
  timer_jobs: ["timer-jobs", "Internal scheduled jobs."],
  placement_registry: ["placement", "Internal placement registry."],
};

function loadCanisterIds() {
  if (process.env.IGNITE_LIVE_ICP_CANISTER_IDS_JSON) {
    return JSON.parse(process.env.IGNITE_LIVE_ICP_CANISTER_IDS_JSON);
  }
  const tablePath = `${root}../deploy/mainnet/.icp/data/mappings/ic.ids.json`;
  if (existsSync(tablePath)) return JSON.parse(readFileSync(tablePath, "utf8"));
  return {};
}

const canisterIds = loadCanisterIds();

// The ICP MCP connector permits calls only to canisters listed in this
// discoverability manifest. The shared canister table does not include Group 2.
// Opt-in is DEV-only, only for the reviewed, fixed DEV frontend identity. This
// publishes addresses, not authorisation: the canisters must still enforce
// caller-scoped access, and club creation must first pass shard_router placement.
function devGroup2Discovery() {
  if (isProdBuild || frontendCanisterId !== DEV_FRONTEND_II_CANISTER ||
      process.env.IGNITE_MCP_DEV_GROUP2_DISCOVERY !== "1") return [];
  const location = fileURLToPath(new URL("../../deploy/groups/g2/provision.json", import.meta.url));
  if (!existsSync(location)) throw new Error("DEV MCP Group 2 discovery requires its checked provision.json");
  const provision = JSON.parse(readFileSync(location, "utf8"));
  if (provision.groupId !== "g2" || provision.deploymentId !== "mainnet" ||
      provision.phase !== "checked" || !provision.installedDomains?.includes("club_domain")) {
    throw new Error("DEV MCP Group 2 discovery requires reviewed, installed club_domain");
  }
  // Least privilege: club/team onboarding only. Do not advertise Group 2's
  // messaging, vault, PII, or other sensitive canisters to the general MCP
  // connector until a specific workflow needs them and is separately reviewed.
  const id = provision.canisters?.club_domain;
  if (typeof id !== "string" || !/^[a-z0-9]{5}(?:-[a-z0-9]{5}){3}-cai$/.test(id) ||
      id === frontendCanisterId || Object.values(canisterIds).includes(id)) {
    throw new Error("Invalid or duplicate DEV Group 2 club_domain");
  }
  return [{
    id,
    name: "g2/club_domain",
    role: "backend",
    description: "DEV Group 2 — clubs, teams and creator permissions; caller-scoped access.",
  }];
}

const manifest = {
  version: "1.0.0",
  canisters: [
    { id: frontendCanisterId, name: "frontend", role: "the frontend" },
    ...Object.entries(canisterIds).map(([key, id]) => {
      const [name, description] = CANISTER_ROLES[key] ?? [key, undefined];
      return description ? { id, name, role: "backend", description } : { id, name, role: "backend" };
    }),
    ...devGroup2Discovery(),
  ],
};
writeFileSync(`${out}/.well-known/ic-architecture`, JSON.stringify(manifest, null, 2) + "\n");

// ICP MCP Layer 5: every address of this canister derives Internet Identity
// principals against the canonical icp0.io origin (see
// resolveDerivationOriginFor in src/live/internetIdentityAuth.ts), so agents
// must request derivations for that origin to get the user's real principal.
// PROD members sign in on igniteclubhq.app (it derives as itself), so PROD
// agents must request that identity, not the canister's, or they see an
// empty account. Website/phone sign-in is unchanged.
writeFileSync(
  `${out}/.well-known/ii-derivation-origin`,
  `${derivationOriginForBuild({ isProdBuild, frontendCanisterId })}\n`,
);

// The canister must reach the same database the bundle was built against
// (DEV or PROD); a hardcoded DEV host blocked PROD routing/auth reads.
const supabaseOrigin = new URL(
  process.env.IGNITE_LIVE_SUPABASE_URL || "https://ecsdwrarzfexssxtrymj.supabase.co",
).origin;
const supabaseWs = supabaseOrigin.replace(/^https:/, "wss:");

const csp = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  `connect-src 'self' https://api.giphy.com ${supabaseOrigin} ${supabaseWs} https://icp-api.io https://*.icp0.io https://*.ic0.app https://*.icp.net https://id.ai https://api.country.is https://photon.komoot.io`,
  "frame-src https://id.ai https://www.google.com https://www.youtube.com",
  "object-src 'none'",
  "worker-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "media-src 'self' blob:",
].join("; ");

// Cache-Control must never come from "/*": rules merge, so hashed /assets/*
// files were served "no-cache, public, max-age=31536000, immutable". Only the
// HTML entry points (SPA fallback serves /index.html) and sign-in files
// revalidate; hashed assets are immutable.
writeFileSync(
  `${out}/_headers`,
  `/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Content-Security-Policy: ${csp}

/index.html
  Cache-Control: no-cache

/live-index.html
  Cache-Control: no-cache

/native-sign-in.html
  Cache-Control: no-cache

/native-sign-in.js
  Cache-Control: no-cache

/.well-known/*
  Cache-Control: no-cache

/.well-known/ii-alternative-origins
  Access-Control-Allow-Origin: *
  Content-Type: application/json

/.well-known/ii-auth-callbacks
  Access-Control-Allow-Origin: *
  Content-Type: application/json

/.well-known/ic-architecture
  Access-Control-Allow-Origin: *
  Content-Type: application/json

/.well-known/ii-derivation-origin
  Access-Control-Allow-Origin: *
  Content-Type: text/plain

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`,
);
console.log("dist-canister ready");
