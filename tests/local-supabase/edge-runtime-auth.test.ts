import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSyntheticLocalMarker, createSecurityFixture, type SecurityFixture, type SyntheticUser } from "./fixtures";

const edgeEnabled = process.env.LOCAL_SUPABASE_EDGE_ENABLED === "true";
const edgeDescribe = edgeEnabled ? describe : describe.skip;

async function tokenFor(user: SyntheticUser) {
  const session = await user.client.auth.getSession();
  if (!session.data.session) throw new Error("Synthetic user has no local session");
  return session.data.session.access_token;
}

async function invoke(body: string, token?: string) {
  return fetch(`${process.env.LOCAL_SUPABASE_URL}/functions/v1/local-security-probe`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body,
  });
}

edgeDescribe("local Edge Runtime: authentication and club authorization", () => {
  let fixture: SecurityFixture;
  beforeAll(async () => { await assertSyntheticLocalMarker(); fixture = await createSecurityFixture(); });
  afterAll(async () => { await fixture?.cleanup(); });

  it("rejects a missing bearer token", async () => {
    expect((await invoke(JSON.stringify({ clubId: fixture.clubA }))).status).toBe(401);
  });

  it("rejects a malformed bearer token", async () => {
    expect((await invoke(JSON.stringify({ clubId: fixture.clubA }), "not-a-jwt")).status).toBe(401);
  });

  it("rejects invalid JSON and invalid identifiers", async () => {
    const token = await tokenFor(fixture.memberA);
    expect((await invoke("{", token)).status).toBe(400);
    expect((await invoke(JSON.stringify({ clubId: "not-a-uuid" }), token)).status).toBe(400);
  });

  it("denies a valid user from another club", async () => {
    const response = await invoke(JSON.stringify({ clubId: fixture.clubA }), await tokenFor(fixture.outsiderB));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "club_access_denied" });
  });

  it("allows a current club member and returns only their own identity", async () => {
    const response = await invoke(JSON.stringify({ clubId: fixture.clubA }), await tokenFor(fixture.memberA));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, userId: fixture.memberA.id, clubId: fixture.clubA });
  });
});
