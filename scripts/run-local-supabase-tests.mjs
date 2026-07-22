import { spawnSync } from "node:child_process";

const url = process.env.LOCAL_SUPABASE_URL;
let parsed;
try { parsed = new URL(url); } catch { parsed = null; }
const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
if (!parsed || parsed.protocol !== "http:" || !localHosts.has(parsed.hostname) || parsed.port !== "54321") {
  console.error("Refusing to run: LOCAL_SUPABASE_URL must be local HTTP on port 54321.");
  process.exit(2);
}
const keyContracts = [
  ["LOCAL_SUPABASE_ANON_KEY", "sb_publishable_"],
  ["LOCAL_SUPABASE_SERVICE_ROLE_KEY", "sb_secret_"],
];
for (const [name, modernPrefix] of keyContracts) {
  const value = process.env[name];
  if (!value || (value.split(".").length !== 3 && !value.startsWith(modernPrefix))) {
    console.error(`Refusing to run: ${name} must contain a local JWT or ${modernPrefix} API key.`);
    process.exit(2);
  }
}

// Deliberately pass a narrow environment to Vitest. Application Supabase URLs,
// database passwords, access tokens, and hosted credentials are not inherited.
const childEnvironment = {
  PATH: process.env.PATH,
  NODE_ENV: "test",
  TZ: "UTC",
  LOCAL_SUPABASE_URL: parsed.origin,
  LOCAL_SUPABASE_ANON_KEY: process.env.LOCAL_SUPABASE_ANON_KEY,
  LOCAL_SUPABASE_SERVICE_ROLE_KEY: process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY,
  ...(process.env.LOCAL_SUPABASE_REALTIME_ENABLED === "true"
    ? { LOCAL_SUPABASE_REALTIME_ENABLED: "true" }
    : {}),
  ...(process.env.LOCAL_SUPABASE_EDGE_ENABLED === "true"
    ? { LOCAL_SUPABASE_EDGE_ENABLED: "true" }
    : {}),
};
const result = spawnSync(
  "npx",
  ["vitest", "run", "--config", "vitest.local-supabase.config.ts"],
  { cwd: process.cwd(), env: childEnvironment, stdio: "inherit", shell: false },
);
process.exit(result.status ?? 1);
