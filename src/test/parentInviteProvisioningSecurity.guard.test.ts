import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

/**
 * Parent-invite child provisioning must stay:
 *  - authorization-safe: the public RPC derives the user from auth.uid() only;
 *  - private where it accepts an explicit user id (trigger-only helper);
 *  - version-controlled: the profile-claim function and its trigger live in a
 *    forward-only migration, not just in the hosted database.
 */

const migrationsDir = "supabase/migrations";
const migrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(`${migrationsDir}/${f}`, "utf8"));
const allSql = migrations.join("\n");

const clientApi = readFileSync("src/features/membership/acceptParentInvite.ts", "utf8");
const joinTeamPage = readFileSync("src/pages/JoinTeamPage.tsx", "utf8");

describe("parent invite provisioning security", () => {
  it("keeps the user-id-taking provisioning function private", () => {
    expect(allSql).toContain("public._provision_invite_children_internal(");
    expect(allSql).toMatch(
      /REVOKE ALL ON FUNCTION public\._provision_invite_children_internal\(uuid, uuid\) FROM authenticated/
    );
    expect(allSql).toMatch(
      /REVOKE ALL ON FUNCTION public\._provision_invite_children_internal\(uuid, uuid\) FROM anon/
    );
    expect(allSql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\._provision_invite_children_internal\([^)]*\) TO [^;]*authenticated/
    );
  });

  it("drops the legacy two-argument public RPC", () => {
    expect(allSql).toContain("DROP FUNCTION IF EXISTS public.provision_invite_children(uuid, uuid);");
  });

  it("authorises the public wrapper against auth.uid() and the invite recipient", () => {
    const start = allSql.lastIndexOf("CREATE OR REPLACE FUNCTION public.provision_invite_children(p_invite_id uuid)");
    expect(start).toBeGreaterThan(-1);
    const fn = allSql.slice(start, start + 3000);
    expect(fn).toContain("_uid uuid := auth.uid()");
    expect(fn).toContain("not_authenticated");
    expect(fn).toContain("invite_not_for_this_user");
    expect(fn).toContain("lower(btrim(_inv.invited_email)) = lower(btrim(_email))");
    expect(fn).toContain("_provision_invite_children_internal(p_invite_id, _uid)");
    // Never accepts a caller-supplied user id.
    expect(fn).not.toContain("p_user_id");
  });

  it("revokes the public wrapper from PUBLIC and anon", () => {
    expect(allSql).toContain("REVOKE ALL ON FUNCTION public.provision_invite_children(uuid) FROM PUBLIC;");
    expect(allSql).toContain("REVOKE ALL ON FUNCTION public.provision_invite_children(uuid) FROM anon;");
    expect(allSql).toContain(
      "GRANT EXECUTE ON FUNCTION public.provision_invite_children(uuid) TO authenticated, service_role;"
    );
  });

  it("version-controls the profile-claim function and recreates its trigger deterministically", () => {
    expect(allSql).toContain("CREATE OR REPLACE FUNCTION public.claim_pending_invites_on_profile_create()");
    expect(allSql).toContain(
      "DROP TRIGGER IF EXISTS claim_pending_invites_on_profile_create_trigger ON public.profiles;"
    );
    expect(allSql).toContain("AFTER INSERT ON public.profiles");
  });

  it("provisions children before the invite is marked accepted", () => {
    const start = allSql.lastIndexOf("CREATE OR REPLACE FUNCTION public.claim_pending_invites_on_profile_create()");
    const fn = allSql.slice(start, start + 6000);
    const provision = fn.indexOf("_provision_invite_children_internal(inv.id, NEW.id)");
    const accept = fn.indexOf("SET status = 'accepted'");
    expect(provision).toBeGreaterThan(-1);
    expect(accept).toBeGreaterThan(provision);

    const roleFnStart = allSql.lastIndexOf("CREATE OR REPLACE FUNCTION public.auto_accept_pending_invites_on_role()");
    const roleFn = allSql.slice(roleFnStart, roleFnStart + 8000);
    expect(roleFn.indexOf("_provision_invite_children_internal(a.id, NEW.user_id)")).toBeLessThan(
      roleFn.indexOf("SET status = 'accepted'")
    );
  });

  it("rejects invalid or out-of-scope existing child references atomically", () => {
    const start = allSql.lastIndexOf("CREATE OR REPLACE FUNCTION public._provision_invite_children_internal(");
    const fn = allSql.slice(start, start + 12000);
    expect(fn).toContain("referenced_child_not_found");
    expect(fn).toContain("referenced_child_out_of_scope");
    expect(fn).toContain("invalid_child_name");
    expect(fn).toContain("child_team_assignment_failed");
  });

  it("removes the user id from the public TypeScript API", () => {
    expect(clientApi).not.toContain("p_user_id");
    expect(clientApi).toContain("provisionInviteChildren(params: {\n  inviteId: string;\n})");
    expect(joinTeamPage).toContain("provisionInviteChildren({\n          inviteId: pendingInviteData.id,\n        })");
  });

  it("invalidates children, membership and RSVP caches after recovery", () => {
    const branch = joinTeamPage.slice(
      joinTeamPage.indexOf("const childIds = await provisionInviteChildren("),
      joinTeamPage.indexOf("Couldn't finish setting up")
    );
    expect(branch).toContain('queryKey: ["children"]');
    expect(branch).toContain('queryKey: ["user-roles"]');
    expect(branch).toContain('queryKey: ["rsvps"]');
  });
});
