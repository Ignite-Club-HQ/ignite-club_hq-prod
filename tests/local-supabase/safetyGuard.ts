const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const EXPECTED_API_PORT = "54321";

export type LocalSupabaseEnvironment = {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
};

function requireLocalUrl(raw: string | undefined) {
  if (!raw) throw new Error("LOCAL_SUPABASE_URL is required");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("LOCAL_SUPABASE_URL must be a valid URL");
  }
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname) || url.port !== EXPECTED_API_PORT) {
    throw new Error("Refusing to run: Supabase API must be local HTTP on port 54321");
  }
  if (url.username || url.password || url.pathname !== "/") {
    throw new Error("Refusing to run: local API URL contains unexpected credentials or path");
  }
  return url.origin;
}

function requireLocalApiKey(value: string | undefined, label: string, modernPrefix: string) {
  const isLegacyJwt = value?.split(".").length === 3;
  const isModernLocalKey = value?.startsWith(modernPrefix) && value.length > modernPrefix.length + 16;
  if (!isLegacyJwt && !isModernLocalKey) {
    throw new Error(`${label} must be a local JWT or ${modernPrefix} API key`);
  }
  return value;
}

export function assertLocalSupabaseEnvironment(
  source: Record<string, string | undefined>,
): LocalSupabaseEnvironment {
  return {
    url: requireLocalUrl(source.LOCAL_SUPABASE_URL),
    anonKey: requireLocalApiKey(source.LOCAL_SUPABASE_ANON_KEY, "LOCAL_SUPABASE_ANON_KEY", "sb_publishable_"),
    serviceRoleKey: requireLocalApiKey(source.LOCAL_SUPABASE_SERVICE_ROLE_KEY, "LOCAL_SUPABASE_SERVICE_ROLE_KEY", "sb_secret_"),
  };
}
