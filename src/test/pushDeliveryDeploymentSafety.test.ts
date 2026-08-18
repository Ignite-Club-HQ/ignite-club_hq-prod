import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const queueMigration = readFileSync(
  "supabase/migrations/20260726104123_ac48de2e-512a-4178-b50f-cf07472be669.sql",
  "utf8",
);
const helperMigration = readFileSync(
  "supabase/migrations/20260726093234_bbfefd61-9362-4cc2-82d5-ccd335bc7a46.sql",
  "utf8",
);

describe("push-delivery deployment safety contract", () => {
  it("fails before schema mutation when required extensions or Vault values are absent", () => {
    const preflightEnd = queueMigration.indexOf("$preflight$;");
    const firstMutation = queueMigration.indexOf("ALTER TABLE public.notifications");

    expect(preflightEnd).toBeGreaterThan(0);
    expect(firstMutation).toBeGreaterThan(preflightEnd);
    for (const extension of ["pg_cron", "pg_net", "supabase_vault"]) {
      expect(queueMigration).toContain(`extname = '${extension}'`);
    }
    for (const secret of ["functions_base_url", "service_role_key"]) {
      expect(queueMigration).toContain(`name = '${secret}'`);
      expect(queueMigration).toMatch(
        new RegExp(`Vault secret ${secret} (?:is missing|rejected)`),
      );
    }
  });

  it("requires an HTTPS Supabase origin with no path and appends the function route once", () => {
    expect(queueMigration).toContain(
      String.raw`v_base !~ '^https://[a-z0-9.-]+\.supabase\.(co|in)$'`,
    );
    expect(queueMigration).toContain(
      "public.internal_functions_base_url() || '/functions/v1/process-push-delivery-queue'",
    );
    expect(queueMigration).not.toContain(
      "public.internal_functions_base_url() || '/functions/v1/functions/v1/",
    );
  });

  it("installs exactly one named minute cron contract using secure helpers", () => {
    expect(queueMigration.match(/cron\.schedule\s*\(/g)).toHaveLength(1);
    expect(queueMigration).toMatch(
      /cron\.schedule\s*\(\s*'ignite-push-delivery-queue-worker'\s*,\s*'\* \* \* \* \*'/,
    );
    expect(queueMigration).toContain("public.internal_functions_base_url()");
    expect(queueMigration).toContain("public.internal_service_role_key()");
    expect(queueMigration).not.toMatch(/Authorization',\s*'Bearer eyJ/);
  });

  it("keeps Vault helper functions inaccessible to application roles", () => {
    for (const helper of ["internal_functions_base_url", "internal_service_role_key"]) {
      expect(helperMigration).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${helper}\\(\\) FROM PUBLIC`, "i"),
      );
      expect(helperMigration).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${helper}\\(\\) FROM anon, authenticated`, "i"),
      );
    }
  });

  it("exposes only non-sensitive preflight results to service-role operators", () => {
    expect(queueMigration).toMatch(
      /REVOKE ALL ON FUNCTION public\.push_delivery_preflight\(\) FROM PUBLIC/i,
    );
    expect(queueMigration).toMatch(
      /REVOKE ALL ON FUNCTION public\.push_delivery_preflight\(\) FROM anon, authenticated/i,
    );
    expect(queueMigration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.push_delivery_preflight\(\) TO service_role/i,
    );

    const reportingFunction = queueMigration.slice(
      queueMigration.indexOf("CREATE OR REPLACE FUNCTION public.push_delivery_preflight"),
      queueMigration.indexOf("REVOKE ALL ON FUNCTION public.push_delivery_preflight"),
    );
    expect(reportingFunction).not.toContain("RETURN QUERY SELECT v_base");
    expect(reportingFunction).not.toContain("RETURN QUERY SELECT v_key");
  });
});
