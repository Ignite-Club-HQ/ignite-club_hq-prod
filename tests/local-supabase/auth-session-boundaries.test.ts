import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertSyntheticLocalMarker, service } from "./fixtures";

describe("local Auth: revocation and account boundaries", () => {
  const createdUsers: string[] = [];
  beforeEach(assertSyntheticLocalMarker);
  afterEach(async () => {
    await Promise.all(createdUsers.splice(0).map((id) => service.auth.admin.deleteUser(id)));
  });

  async function user(label: string) {
    const email = `${label}.${crypto.randomUUID()}@local.invalid`;
    const password = `Local-only-${crypto.randomUUID()}!`;
    const made = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (made.error || !made.data.user) throw made.error ?? new Error("Local user creation failed");
    createdUsers.push(made.data.user.id);
    const client = createClient(process.env.LOCAL_SUPABASE_URL!, process.env.LOCAL_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error || !signedIn.data.session) throw signedIn.error ?? new Error("Local sign-in failed");
    return { id: made.data.user.id, client, session: signedIn.data.session };
  }

  it("does not refresh a session after its Auth user is deleted", async () => {
    const account = await user("deleted-session");
    expect((await service.auth.admin.deleteUser(account.id)).error).toBeNull();
    createdUsers.splice(createdUsers.indexOf(account.id), 1);
    const refreshed = await account.client.auth.refreshSession({ refresh_token: account.session.refresh_token });
    expect(refreshed.error).not.toBeNull();
    expect(refreshed.data.session).toBeNull();
  });

  it("keeps two account sessions bound to their own identities", async () => {
    const first = await user("account-a");
    const second = await user("account-b");
    expect((await first.client.auth.getUser()).data.user?.id).toBe(first.id);
    expect((await second.client.auth.getUser()).data.user?.id).toBe(second.id);
    expect((await first.client.auth.getUser()).data.user?.id).not.toBe(second.id);
  });

  it("rejects an expired-shaped token rather than trusting its claims", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: crypto.randomUUID(), exp: 1, role: "authenticated" })).toString("base64url");
    const result = await createClient(
      process.env.LOCAL_SUPABASE_URL!, process.env.LOCAL_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    ).auth.getUser(`${header}.${payload}.invalid`);
    expect(result.error).not.toBeNull();
    expect(result.data.user).toBeNull();
  });
});
