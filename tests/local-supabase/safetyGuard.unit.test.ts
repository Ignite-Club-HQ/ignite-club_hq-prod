import { describe, expect, it } from "vitest";
import { assertLocalSupabaseEnvironment } from "./safetyGuard";

const jwt = "local.header.signature";
const publishableKey = `sb_publishable_${"a".repeat(24)}`;
const secretKey = `sb_secret_${"b".repeat(24)}`;

describe("local Supabase safety guard", () => {
  it.each(["http://127.0.0.1:54321", "http://localhost:54321"])("accepts the expected local API %s", (url) => {
    expect(assertLocalSupabaseEnvironment({
      LOCAL_SUPABASE_URL: url,
      LOCAL_SUPABASE_ANON_KEY: jwt,
      LOCAL_SUPABASE_SERVICE_ROLE_KEY: jwt,
    }).url).toBe(url);
  });

  it.each([
    "https://example.supabase.co",
    "http://192.0.2.10:54321",
    "http://127.0.0.1:8000",
    "https://127.0.0.1:54321",
    "http://user:password@127.0.0.1:54321",
  ])("rejects a non-approved API target %s", (url) => {
    expect(() => assertLocalSupabaseEnvironment({
      LOCAL_SUPABASE_URL: url,
      LOCAL_SUPABASE_ANON_KEY: jwt,
      LOCAL_SUPABASE_SERVICE_ROLE_KEY: jwt,
    })).toThrow(/Refusing to run/);
  });

  it("accepts modern local publishable and secret API keys", () => {
    expect(assertLocalSupabaseEnvironment({
      LOCAL_SUPABASE_URL: "http://127.0.0.1:54321",
      LOCAL_SUPABASE_ANON_KEY: publishableKey,
      LOCAL_SUPABASE_SERVICE_ROLE_KEY: secretKey,
    })).toMatchObject({ anonKey: publishableKey, serviceRoleKey: secretKey });
  });

  it("does not allow the privileged and public modern key types to be swapped", () => {
    expect(() => assertLocalSupabaseEnvironment({
      LOCAL_SUPABASE_URL: "http://127.0.0.1:54321",
      LOCAL_SUPABASE_ANON_KEY: secretKey,
      LOCAL_SUPABASE_SERVICE_ROLE_KEY: publishableKey,
    })).toThrow(/sb_publishable_/);
  });

  it("rejects missing or malformed local credentials", () => {
    expect(() => assertLocalSupabaseEnvironment({
      LOCAL_SUPABASE_URL: "http://127.0.0.1:54321",
      LOCAL_SUPABASE_ANON_KEY: "not-a-jwt",
      LOCAL_SUPABASE_SERVICE_ROLE_KEY: jwt,
    })).toThrow(/local JWT or sb_publishable_/);
  });
});
