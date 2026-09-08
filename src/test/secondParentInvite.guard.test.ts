import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  isValidSecondParentEmail,
  secondParentValidationError,
  secondParentPartialFailureMessage,
  SECOND_PARENT_EMAIL_REQUIRED,
} from "@/features/membership/secondParentInvite";

const sheet = readFileSync("src/components/AddTeamMemberSheet.tsx", "utf8");
const bulkWorkflow = readFileSync("src/features/membership/bulkInvitationWorkflow.ts", "utf8");

/**
 * Production incident: a second parent (Zoe Schultz) was entered, no
 * pending_invites row or email was created, and the UI still said "success".
 * These guards keep every branch on the shared helper and keep the failure
 * visible.
 */
describe("second parent invite", () => {
  it("requires a valid email once a name is entered", () => {
    expect(secondParentValidationError({ role: "parent", name: "Zoe Schultz", email: "" })).toBe(
      SECOND_PARENT_EMAIL_REQUIRED,
    );
    expect(secondParentValidationError({ role: "parent", name: "Zoe", email: "not-an-email" })).toBe(
      SECOND_PARENT_EMAIL_REQUIRED,
    );
    expect(
      secondParentValidationError({ role: "parent", name: "Zoe", email: "zoe@example.com" }),
    ).toBeNull();
  });

  it("does not block when nothing is entered, or an existing profile is chosen", () => {
    expect(secondParentValidationError({ role: "parent", name: "", email: "" })).toBeNull();
    expect(
      secondParentValidationError({
        role: "parent",
        name: "Zoe",
        email: "",
        selectedProfile: { id: "u1", display_name: "Zoe" },
      }),
    ).toBeNull();
    expect(secondParentValidationError({ role: "coach", name: "Zoe", email: "" })).toBeNull();
  });

  it("validates emails strictly", () => {
    expect(isValidSecondParentEmail("a@b.co")).toBe(true);
    expect(isValidSecondParentEmail(" ")).toBe(false);
    expect(isValidSecondParentEmail("a@b")).toBe(false);
    expect(isValidSecondParentEmail(null)).toBe(false);
  });

  it("every branch of the sheet routes second parents through the shared helper", () => {
    const calls = `${sheet}\n${bulkWorkflow}`.match(/ensureSecondParent\(\{/g) ?? [];
    // Existing/new single-recipient paths plus existing/new bulk paths.
    expect(calls.length).toBeGreaterThanOrEqual(4);
  });

  it("no longer writes inert second_guardian_* metadata instead of an invite", () => {
    expect(sheet).not.toContain("second_guardian_name");
    expect(sheet).not.toContain("second_guardian_email");
    expect(sheet).not.toContain("second_guardian_user_id");
  });

  it("surfaces second-parent failures and blocks invalid submissions", () => {
    expect(sheet).toContain("secondParentValidationError({");
    expect(sheet).toContain("if (secondParentBlocked)");
    expect(bulkWorkflow).toContain("secondParentValidationError({");
    expect(sheet).toContain("secondParentPartialFailureMessage(");
    expect(sheet).toContain("SecondParentError");
  });

  it("reports partial success without technical detail", () => {
    const msg = secondParentPartialFailureMessage("Matt B and Tyler were added", "Zoe Schultz");
    expect(msg).toContain("Zoe Schultz");
    expect(msg).toContain("could not be created");
  });
});

const helper = readFileSync("src/features/membership/secondParentInvite.ts", "utf8");

describe("second parent invite rows", () => {
  it("creates a real pending invite for existing-account second parents", () => {
    expect(helper).toContain("second_parent_of_existing_user: true");
    // both branches route through the same upsert
    expect((helper.match(/upsertSecondParentInvite\(\{/g) ?? []).length).toBe(2);
  });

  it("never mints a link without reading the row back", () => {
    expect(helper).toContain('.select("id, invite_token")');
    expect(helper).toContain("invite_row_not_readable");
  });

  it("asserts children metadata when the form has children", () => {
    expect((helper.match(/missing_children_metadata/g) ?? []).length).toBe(2);
  });
});
