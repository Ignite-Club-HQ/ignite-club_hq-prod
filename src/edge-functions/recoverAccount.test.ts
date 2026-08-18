import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";

const sourcePath = "supabase/functions/recover-account/index.ts";
const source = readFileSync(sourcePath, "utf8");
const syntaxResult = ts.transpileModule(source, {
  fileName: sourcePath,
  reportDiagnostics: true,
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    jsx: ts.JsxEmit.ReactJSX,
  },
});
const syntaxErrors = (syntaxResult.diagnostics ?? []).filter(
  (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
);

type QueryResult = { data?: unknown; error?: unknown };

interface HarnessOptions {
  userId?: string;
  userError?: unknown;
  getUserThrows?: unknown;
  rateLimitRecord?: Record<string, unknown> | null;
  profileUpdateResult?: QueryResult;
}

interface Harness {
  handler: (request: Request) => Promise<Response>;
  createClient: ReturnType<typeof vi.fn>;
  getUser: ReturnType<typeof vi.fn>;
  rateInsert: ReturnType<typeof vi.fn>;
  rateUpdate: ReturnType<typeof vi.fn>;
  profileUpdate: ReturnType<typeof vi.fn>;
  profileEq: ReturnType<typeof vi.fn>;
}

function diagnosticText() {
  return syntaxErrors.map((diagnostic) => {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    if (diagnostic.start === undefined) return message;
    const position = syntaxResult.sourceMapText
      ? undefined
      : ts.createSourceFile(sourcePath, source, ts.ScriptTarget.ES2022, true).getLineAndCharacterOfPosition(diagnostic.start);
    return position ? `${sourcePath}:${position.line + 1}:${position.character + 1} ${message}` : message;
  }).join("\n");
}

async function loadHarness(options: HarnessOptions = {}): Promise<Harness> {
  const getUser = vi.fn(async () => {
    if (options.getUserThrows) throw options.getUserThrows;
    return {
      data: { user: options.userError ? null : { id: options.userId ?? "synthetic-user-a" } },
      error: options.userError ?? null,
    };
  });
  const userClient = { auth: { getUser } };

  const rateInsert = vi.fn(async () => ({ error: null }));
  const rateUpdateEq = vi.fn(async () => ({ error: null }));
  const rateUpdate = vi.fn(() => ({ eq: rateUpdateEq }));
  const rateQuery = {
    select: vi.fn(() => rateQuery),
    eq: vi.fn(() => rateQuery),
    single: vi.fn(async () => ({ data: options.rateLimitRecord ?? null, error: null })),
    insert: rateInsert,
    update: rateUpdate,
  };

  const profileEq = vi.fn(async () => options.profileUpdateResult ?? { error: null });
  const profileUpdate = vi.fn(() => ({ eq: profileEq }));
  const profileQuery = { update: profileUpdate };
  const adminClient = {
    from: vi.fn((table: string) => {
      if (table === "rate_limits") return rateQuery;
      if (table === "profiles") return profileQuery;
      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  const createClient = vi.fn()
    .mockReturnValueOnce(userClient)
    .mockReturnValueOnce(adminClient);
  let handler: Harness["handler"] | undefined;

  const instrumented = source
    .replace(
      /import\s+\{\s*serve\s*\}\s+from\s+["'][^"']+["'];?/,
      "const serve = globalThis.__recoverAccountServe;",
    )
    .replace(
      /import\s+\{\s*createClient\s*\}\s+from\s+["'][^"']+["'];?/,
      "const createClient = globalThis.__recoverAccountCreateClient;",
    );
  const compiled = ts.transpileModule(instrumented, {
    fileName: sourcePath,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;

  Object.assign(globalThis, {
    __recoverAccountServe: (candidate: Harness["handler"]) => { handler = candidate; },
    __recoverAccountCreateClient: createClient,
    Deno: {
      env: {
        get: (name: string) => ({
          SUPABASE_URL: "http://127.0.0.1:54321",
          SUPABASE_ANON_KEY: "synthetic-local-anon-key",
          SUPABASE_SERVICE_ROLE_KEY: "synthetic-local-service-key",
        })[name],
      },
    },
  });

  const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}#${crypto.randomUUID()}`;
  await import(/* @vite-ignore */ moduleUrl);
  if (!handler) throw new Error("recover-account did not register an Edge Function handler");
  return { handler, createClient, getUser, rateInsert, rateUpdate, profileUpdate, profileEq };
}

function request(token?: string, init: RequestInit = {}) {
  return new Request("http://127.0.0.1:54321/functions/v1/recover-account", {
    method: "POST",
    body: "{}",
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...init.headers,
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).__recoverAccountServe;
  delete (globalThis as Record<string, unknown>).__recoverAccountCreateClient;
});

describe("recover-account Edge Function deployability", () => {
  it("parses without TypeScript syntax errors", () => {
    expect(syntaxErrors.length, diagnosticText()).toBe(0);
  });
});

describe.skipIf(syntaxErrors.length > 0)("recover-account Edge Function security behaviour", () => {
  it.each([undefined, "", "   ", "undefined", "null"])(
    "rejects a missing or unusable bearer token %# before creating a Supabase client",
    async (token) => {
      const harness = await loadHarness();
      const response = await harness.handler(request(token));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Authentication required" });
      expect(harness.createClient).not.toHaveBeenCalled();
    },
  );

  it("rejects an invalid authenticated session before creating the service-role client", async () => {
    const harness = await loadHarness({ userError: { message: "invalid JWT" } });
    const response = await harness.handler(request("malformed-token"));
    expect(response.status).toBe(401);
    expect(harness.getUser).toHaveBeenCalledOnce();
    expect(harness.createClient).toHaveBeenCalledTimes(1);
  });

  it("clears only the authenticated user's scheduled deletion date", async () => {
    const harness = await loadHarness({ userId: "synthetic-user-a" });
    const response = await harness.handler(request("valid-local-token", {
      body: JSON.stringify({ userId: "synthetic-user-b" }),
    }));
    expect(response.status).toBe(200);
    expect(harness.profileUpdate).toHaveBeenCalledWith({ scheduled_deletion_at: null });
    expect(harness.profileEq).toHaveBeenCalledWith("id", "synthetic-user-a");
    expect(harness.profileEq).not.toHaveBeenCalledWith("id", "synthetic-user-b");
  });

  it("returns 429 with Retry-After without updating a profile when rate limited", async () => {
    const harness = await loadHarness({
      rateLimitRecord: {
        id: "synthetic-rate-limit",
        request_count: 5,
        window_start: new Date().toISOString(),
      },
    });
    const response = await harness.handler(request("valid-local-token"));
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(harness.profileUpdate).not.toHaveBeenCalled();
  });

  it("returns a sanitized 500 response for a profile update failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const harness = await loadHarness({
      profileUpdateResult: { error: { message: "postgres://user:password@host/db token=secret" } },
    });
    const response = await harness.handler(request("valid-local-token"));
    const raw = await response.text();
    expect(response.status).toBe(500);
    expect(JSON.parse(raw)).toEqual({ error: "Failed to process request" });
    expect(raw).not.toMatch(/postgres|password|token|secret/i);
  });

  it("does not expose sensitive details from unexpected failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const harness = await loadHarness({
      getUserThrows: new Error("SUPABASE_SERVICE_ROLE_KEY=secret postgres://host/database"),
    });
    const response = await harness.handler(request("valid-local-token"));
    const raw = await response.text();
    expect(response.status).toBe(500);
    expect(JSON.parse(raw)).toEqual({ error: "An unexpected error occurred" });
    expect(raw).not.toMatch(/supabase|service.role|secret|postgres|database/i);
  });

  it("handles OPTIONS without authentication, rate-limit or profile mutations", async () => {
    const harness = await loadHarness();
    const response = await harness.handler(new Request(
      "http://127.0.0.1:54321/functions/v1/recover-account",
      { method: "OPTIONS" },
    ));
    expect(response.status).toBe(200);
    expect(harness.createClient).not.toHaveBeenCalled();
    expect(harness.rateInsert).not.toHaveBeenCalled();
    expect(harness.profileUpdate).not.toHaveBeenCalled();
  });

  it("rejects an oversized request before authentication or mutation", async () => {
    const harness = await loadHarness();
    const response = await harness.handler(request("valid-local-token", {
      headers: { "content-length": "1025" },
    }));
    expect(response.status).toBe(413);
    expect(harness.createClient).not.toHaveBeenCalled();
    expect(harness.profileUpdate).not.toHaveBeenCalled();
  });
});
