export const LOCAL_PROJECT = "ignite-club-local-security-tests";
export const LOCAL_URL = "http://127.0.0.1:54321";

export const LOCAL_CONTAINERS = [
  "supabase_edge_runtime_ignite-club-local-security-tests",
  "supabase_storage_ignite-club-local-security-tests",
  "supabase_rest_ignite-club-local-security-tests",
  "supabase_realtime_ignite-club-local-security-tests",
  "supabase_inbucket_ignite-club-local-security-tests",
  "supabase_auth_ignite-club-local-security-tests",
  "supabase_kong_ignite-club-local-security-tests",
  "supabase_db_ignite-club-local-security-tests",
];

export const LOCAL_VOLUMES = [
  "supabase_db_ignite-club-local-security-tests",
  "supabase_edge_runtime_ignite-club-local-security-tests",
  "supabase_storage_ignite-club-local-security-tests",
];

export function expectedMigrationVersions(fileNames) {
  return fileNames
    .map((name) => /^(\d{14})_[a-zA-Z0-9_-]+\.sql$/.exec(name)?.[1])
    .filter(Boolean)
    .sort();
}

export function migrationLedgersMatch(expected, applied) {
  return expected.length > 0
    && expected.length === applied.length
    && expected.every((version, index) => version === applied[index]);
}

export function parseLocalGatewayKeys(contents) {
  const publishableKey = contents.match(/apikey == '(sb_publishable_[A-Za-z0-9_-]+)'/)?.[1];
  const secretKey = contents.match(/apikey == '(sb_secret_[A-Za-z0-9_-]+)'/)?.[1];
  if (!publishableKey || !secretKey) {
    throw new Error("Local gateway did not expose both generated local API keys");
  }
  return { publishableKey, secretKey };
}

export function assertOnlyAllowedLocalNames(names, allowedNames) {
  const allowed = new Set(allowedNames);
  const unexpected = names.filter((name) => !allowed.has(name));
  if (unexpected.length) {
    throw new Error(`Refusing local lifecycle action for unexpected target(s): ${unexpected.join(", ")}`);
  }
}

export const LOCAL_PARITY_REVIEWED_THROUGH =
  "20260809232528_d284eb4c-2205-4a09-80f0-778f37558781.sql";

const MIRRORED_CONTRACT_PATTERN = new RegExp([
  "can_view_competition",
  "competitions[^a-z_]+for\\s+select",
  "remove_team_member",
  "remove_club_member",
  "team_member_exclusions",
  "club_member_exclusions",
  "is_team_member",
  "is_club_member",
].join("|"), "i");

export function findUnreviewedMirroredMigrations(migrations, reviewedThrough = LOCAL_PARITY_REVIEWED_THROUGH) {
  return migrations
    .filter(({ name, sql }) => name > reviewedThrough && MIRRORED_CONTRACT_PATTERN.test(sql))
    .map(({ name }) => name)
    .sort();
}

export function validateCurrentLocalParity(localSql) {
  const required = [
    { label: "direct competition creator visibility", pattern: /created_by\s*=\s*\(select\s+auth\.uid\(\)\)/i },
    { label: "scoped team-member removal RPC", pattern: /function\s+public\.remove_team_member\s*\(/i },
    { label: "guardian-derived membership exclusions", pattern: /table\s+public\.team_member_exclusions/i },
    { label: "role-scoped club-wide photo publishing", pattern: /function\s+public\.can_publish_club_wide_photo\s*\(/i },
    { label: "single scoped photo upload policy", pattern: /policy\s+"Scoped role-checked photo uploads"/i },
  ];
  return required.filter(({ pattern }) => !pattern.test(localSql)).map(({ label }) => label);
}

export const LOCAL_SESSION_APPROVAL_FLAG = "--approved-local-session";

export function hasExplicitLocalSessionApproval(args) {
  return args.filter((arg) => arg === LOCAL_SESSION_APPROVAL_FLAG).length === 1;
}

export function worktreeUpdateMode(statusCode, porcelainOutput) {
  if (statusCode !== 0) return "error";
  return porcelainOutput.trim() ? "test-current" : "update";
}
