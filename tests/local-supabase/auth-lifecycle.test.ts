import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSyntheticLocalMarker, service } from "./fixtures";

describe("local Auth: session lifecycle", () => {
  const email = `auth-lifecycle.${crypto.randomUUID()}@local.invalid`;
  const password = `Local-only-${crypto.randomUUID()}!`;
  let userId: string;

  beforeAll(async () => {
    await assertSyntheticLocalMarker();
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw created.error ?? new Error("Local auth fixture failed");
    userId = created.data.user.id;
  });
  afterAll(async () => { if (userId) await service.auth.admin.deleteUser(userId); });

  const client = () => createClient(process.env.LOCAL_SUPABASE_URL!, process.env.LOCAL_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  it("creates a confirmed local user and signs in with the correct password", async () => {
    const result = await client().auth.signInWithPassword({ email, password });
    expect(result.error).toBeNull();
    expect(result.data.user?.id).toBe(userId);
    expect(result.data.session?.access_token).toBeTruthy();
  });

  it("rejects an incorrect password without issuing a session", async () => {
    const result = await client().auth.signInWithPassword({ email, password: `${password}-wrong` });
    expect(result.error).not.toBeNull();
    expect(result.data.session).toBeNull();
  });

  it("rejects malformed access tokens", async () => {
    const result = await client().auth.getUser("malformed.local.token");
    expect(result.error).not.toBeNull();
    expect(result.data.user).toBeNull();
  });

  it("refreshes a valid local session and preserves the user identity", async () => {
    const auth = client();
    const signedIn = await auth.auth.signInWithPassword({ email, password });
    const refreshed = await auth.auth.refreshSession({ refresh_token: signedIn.data.session!.refresh_token });
    expect(refreshed.error).toBeNull();
    expect(refreshed.data.user?.id).toBe(userId);
  });

  it("clears the client session on sign-out", async () => {
    const auth = client();
    expect((await auth.auth.signInWithPassword({ email, password })).error).toBeNull();
    expect((await auth.auth.signOut()).error).toBeNull();
    expect((await auth.auth.getSession()).data.session).toBeNull();
  });

  it("enforces the configured minimum password length for signup", async () => {
    const result = await client().auth.signUp({
      email: `short-password.${crypto.randomUUID()}@local.invalid`,
      password: "short",
    });
    expect(result.error).not.toBeNull();
    expect(result.data.user).toBeNull();
  });
});
