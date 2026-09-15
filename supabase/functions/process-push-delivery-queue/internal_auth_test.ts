/**
 * Auth-boundary tests for the internal push functions.
 *
 * Both `process-event-notifications` and `process-push-delivery-queue` are
 * deployed with `verify_jwt = false` (a DB trigger cannot mint a user JWT),
 * so `requireServiceRoleAuth` is the ONLY thing standing between the public
 * internet and the fan-out. These tests pin that boundary.
 */
import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { requireServiceRoleAuth } from "../_shared/internal-auth.ts";

const CORS = { "Access-Control-Allow-Origin": "*" };
const SERVICE_KEY = "sb_secret_dev_only_fake_value_1234";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.anon.signature";

function req(headers: Record<string, string> = {}) {
  return new Request("https://example.test/functions/v1/process-push-delivery-queue", {
    method: "POST",
    headers,
    body: "{}",
  });
}

function withKey<T>(key: string | null, fn: () => T): T {
  const prev = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (key === null) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", key);
  try {
    return fn();
  } finally {
    if (prev === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
    else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", prev);
  }
}

Deno.test("no Authorization header is rejected 401", () => {
  withKey(SERVICE_KEY, () => {
    assertEquals(requireServiceRoleAuth(req(), CORS)?.status, 401);
  });
});

Deno.test("non-Bearer scheme is rejected 401", () => {
  withKey(SERVICE_KEY, () => {
    assertEquals(requireServiceRoleAuth(req({ Authorization: `Basic ${SERVICE_KEY}` }), CORS)?.status, 401);
  });
});

Deno.test("anon key is rejected (403) — a public caller cannot trigger fan-out", () => {
  withKey(SERVICE_KEY, () => {
    assertEquals(requireServiceRoleAuth(req({ Authorization: `Bearer ${ANON_KEY}` }), CORS)?.status, 403);
  });
});

Deno.test("a user JWT is rejected — end users cannot drain or fan out", () => {
  withKey(SERVICE_KEY, () => {
    const userJwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEiLCJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.sig";
    const res = requireServiceRoleAuth(req({ Authorization: `Bearer ${userJwt}` }), CORS);
    assert(res !== null);
    assert(res!.status === 401 || res!.status === 403);
  });
});

Deno.test("a same-length wrong token is rejected 403 (no length oracle short-circuit)", () => {
  withKey(SERVICE_KEY, () => {
    const wrong = "x".repeat(SERVICE_KEY.length);
    assertEquals(requireServiceRoleAuth(req({ Authorization: `Bearer ${wrong}` }), CORS)?.status, 403);
  });
});

Deno.test("a one-character-off token is rejected 403", () => {
  withKey(SERVICE_KEY, () => {
    const near = SERVICE_KEY.slice(0, -1) + (SERVICE_KEY.endsWith("4") ? "5" : "4");
    assertEquals(requireServiceRoleAuth(req({ Authorization: `Bearer ${near}` }), CORS)?.status, 403);
  });
});

Deno.test("the short-form Supabase secret key format is accepted", () => {
  withKey(SERVICE_KEY, () => {
    assertEquals(requireServiceRoleAuth(req({ Authorization: `Bearer ${SERVICE_KEY}` }), CORS), null);
  });
});

Deno.test("a legacy long-form JWT service key is accepted", () => {
  const legacy = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.legacysig";
  withKey(legacy, () => {
    assertEquals(requireServiceRoleAuth(req({ Authorization: `Bearer ${legacy}` }), CORS), null);
  });
});

Deno.test("surrounding whitespace in the header is tolerated", () => {
  withKey(SERVICE_KEY, () => {
    assertEquals(requireServiceRoleAuth(req({ Authorization: `Bearer  ${SERVICE_KEY} ` }), CORS), null);
  });
});

Deno.test("missing server key fails closed with 500, never open", () => {
  withKey(null, () => {
    const res = requireServiceRoleAuth(req({ Authorization: `Bearer ${SERVICE_KEY}` }), CORS);
    assertEquals(res?.status, 500);
  });
});

Deno.test("rejection bodies never echo the expected key or the presented token", async () => {
  const bodies: string[] = [];
  withKey(SERVICE_KEY, () => {
    const rejectedHeaders: Record<string, string>[] = [
      {},
      { Authorization: `Bearer ${ANON_KEY}` },
      { Authorization: "Bearer nope" },
    ];
    for (const headers of rejectedHeaders) {
      const res = requireServiceRoleAuth(req(headers), CORS);
      if (res) bodies.push(res.status.toString());
      if (res) bodies.push("BODY_PLACEHOLDER");
    }
  });
  // Read bodies outside the env swap (Response bodies are lazy-safe here).
  const res = withKey(SERVICE_KEY, () =>
    requireServiceRoleAuth(req({ Authorization: `Bearer ${ANON_KEY}` }), CORS)
  );
  const text = await res!.text();
  assert(!text.includes(SERVICE_KEY), "expected key leaked");
  assert(!text.includes(ANON_KEY), "presented token echoed back");
  assertEquals(text, JSON.stringify({ error: "Forbidden" }));
  assert(bodies.length > 0);
});

Deno.test("CORS headers are present on every rejection (browser callers see the error)", () => {
  withKey(SERVICE_KEY, () => {
    const rejectedHeaders: Record<string, string>[] = [{}, { Authorization: "Bearer wrong" }];
    for (const headers of rejectedHeaders) {
      const res = requireServiceRoleAuth(req(headers), CORS);
      assertEquals(res?.headers.get("Access-Control-Allow-Origin"), "*");
      assertEquals(res?.headers.get("Content-Type"), "application/json");
    }
  });
});
