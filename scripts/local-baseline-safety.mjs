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
