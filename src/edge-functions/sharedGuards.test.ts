import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireServiceRoleAuth } from "../../supabase/functions/_shared/internal-auth";
import {
  requireAnyClubPro,
  requireClubPro,
  requireTeamPro,
} from "../../supabase/functions/_shared/proGuard";

const cors = { "Access-Control-Allow-Origin": "https://app.example" };

async function body(response: Response | null) {
  return response ? response.json() : null;
}

describe("Edge Function service-role authentication guard", () => {
  const envGet = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("Deno", { env: { get: envGet } });
    envGet.mockImplementation((name: string) =>
      name === "SUPABASE_SERVICE_ROLE_KEY" ? "secret-service-key" : undefined,
    );
  });

  it("fails closed when the server secret is missing", async () => {
    envGet.mockReturnValue(undefined);
    const response = requireServiceRoleAuth(
      new Request("https://test.local/function"),
      cors,
    );

    expect(response?.status).toBe(500);
    expect(await body(response)).toEqual({ error: "Server misconfigured" });
    expect(response?.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://app.example",
    );
  });

  it("rejects a missing bearer credential as unauthenticated", async () => {
    const response = requireServiceRoleAuth(
      new Request("https://test.local/function"),
      cors,
    );

    expect(response?.status).toBe(401);
    expect(await body(response)).toEqual({ error: "Unauthorized" });
  });

  it.each([
    "Bearer wrong-length",
    "Bearer secret-service-keY",
    "Basic secret-service-key",
  ])("rejects an invalid credential without exposing comparison details", async (authorization) => {
    const response = requireServiceRoleAuth(
      new Request("https://test.local/function", { headers: { authorization } }),
      cors,
    );

    expect(response?.status).toBe(authorization.startsWith("Bearer ") ? 403 : 401);
    expect(await body(response)).toEqual({
      error: authorization.startsWith("Bearer ") ? "Forbidden" : "Unauthorized",
    });
  });

  it("accepts only the exact service-role bearer token", () => {
    const response = requireServiceRoleAuth(
      new Request("https://test.local/function", {
        headers: { authorization: "Bearer secret-service-key" },
      }),
      cors,
    );

    expect(response).toBeNull();
  });

  it("accepts the authorization header case-insensitively through the Fetch API", () => {
    const response = requireServiceRoleAuth(
      new Request("https://test.local/function", {
        headers: { authorization: "Bearer secret-service-key" },
      }),
      cors,
    );
    expect(response).toBeNull();
  });

  it.each([
    "Bearer",
    "Bearer ",
    "Bearer    ",
    "Bearer secret-service-key extra",
    "bearer secret-service-key",
  ])("rejects malformed bearer syntax %j", async authorization => {
    const response = requireServiceRoleAuth(
      new Request("https://test.local/function", { headers: { authorization } }),
      cors,
    );

    expect(response).not.toBeNull();
    expect([401, 403]).toContain(response?.status);
  });

  it("rejects a same-length Unicode credential", async () => {
    const response = requireServiceRoleAuth(
      new Request("https://test.local/function", {
        headers: { authorization: "Bearer secret-service-keý" },
      }),
      cors,
    );
    expect(response?.status).toBe(403);
    expect(await body(response)).toEqual({ error: "Forbidden" });
  });

  it("returns JSON content type on every rejection", () => {
    const response = requireServiceRoleAuth(
      new Request("https://test.local/function"),
      cors,
    );
    expect(response?.headers.get("Content-Type")).toBe("application/json");
  });
});

describe("Edge Function Pro entitlement guards", () => {
  const rpc = vi.fn();
  const client = { rpc };

  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: true, error: null });
  });

  it.each([
    ["club", () => requireClubPro(client, "", cors), "missing_club_id"],
    ["team", () => requireTeamPro(client, "", cors), "missing_team_id"],
    ["user", () => requireAnyClubPro(client, "", cors), "missing_user_id"],
  ] as const)("rejects a missing %s scope before calling the entitlement RPC", async (_scope, call, error) => {
    const response = await call();

    expect(response?.status).toBe(400);
    expect(await body(response)).toEqual({ error });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("uses the exact club entitlement RPC and permits an active entitlement", async () => {
    await expect(requireClubPro(client, "club-1", cors)).resolves.toBeNull();
    expect(rpc).toHaveBeenCalledWith("has_active_pro_for_club", {
      _club_id: "club-1",
    });
  });

  it("uses the exact team entitlement RPC and denies an inactive entitlement", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const response = await requireTeamPro(client, "team-1", cors);

    expect(rpc).toHaveBeenCalledWith("has_active_pro_for_team", {
      _team_id: "team-1",
    });
    expect(response?.status).toBe(403);
    expect(await body(response)).toEqual({
      error: "pro_required",
      team_id: "team-1",
    });
  });

  it("checks any-club entitlement against the requested user identity", async () => {
    await expect(
      requireAnyClubPro(client, "user-1", cors),
    ).resolves.toBeNull();
    expect(rpc).toHaveBeenCalledWith("user_has_any_club_pro", {
      _user_id: "user-1",
    });
  });

  it.each([
    ["club", () => requireClubPro(client, "club-1", cors)],
    ["team", () => requireTeamPro(client, "team-1", cors)],
    ["any-club", () => requireAnyClubPro(client, "user-1", cors)],
  ] as const)("fails closed when the %s entitlement lookup errors", async (_scope, call) => {
    rpc.mockResolvedValue({ data: null, error: { message: "RPC unavailable" } });
    const response = await call();

    expect(response?.status).toBe(500);
    expect(await body(response)).toEqual({ error: "pro_check_failed" });
  });

  it("does not treat truthy non-boolean RPC data as an active entitlement", async () => {
    rpc.mockResolvedValue({ data: "true", error: null });
    const response = await requireClubPro(client, "club-1", cors);

    expect(response?.status).toBe(403);
    expect(await body(response)).toEqual({
      error: "pro_required",
      club_id: "club-1",
    });
  });

  it("fails closed when the RPC returns true alongside an error", async () => {
    rpc.mockResolvedValue({ data: true, error: { message: "ambiguous result" } });
    const response = await requireClubPro(client, "club-1", cors);

    expect(response?.status).toBe(500);
    expect(await body(response)).toEqual({ error: "pro_check_failed" });
  });

  it.each([
    [null, "null"],
    [undefined, "undefined"],
    [1, "numeric"],
    [{ active: true }, "object"],
  ])("denies malformed %s entitlement data without throwing", async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    const response = await requireTeamPro(client, "team-1", cors);

    expect(response?.status).toBe(403);
    expect(await body(response)).toEqual({ error: "pro_required", team_id: "team-1" });
  });

  it.each([
    ["club", () => requireClubPro(client, "club-1", cors)],
    ["team", () => requireTeamPro(client, "team-1", cors)],
    ["any-club", () => requireAnyClubPro(client, "user-1", cors)],
  ] as const)("must convert a thrown %s entitlement lookup into a safe denial response", async (_scope, call) => {
    rpc.mockRejectedValue(new Error("database adapter unavailable: secret details"));

    const response = await call();

    expect(response?.status).toBe(500);
    expect(await body(response)).toEqual({ error: "pro_check_failed" });
  });

  it("never includes the database error details in the client response", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "connection string and internal table details" },
    });
    const response = await requireAnyClubPro(client, "user-1", cors);
    const text = await response!.text();

    expect(text).toBe('{"error":"pro_check_failed"}');
    expect(text).not.toContain("connection string");
  });

  it("preserves CORS and JSON headers for entitlement denials", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const response = await requireClubPro(client, "club-1", cors);

    expect(response?.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example");
    expect(response?.headers.get("Content-Type")).toBe("application/json");
  });
});
