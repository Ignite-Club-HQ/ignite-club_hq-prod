import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const source = readFileSync(resolve(__dirname, "CreateEventPage.tsx"), "utf8");

describe("Next Up freshness contract", () => {
  it("invalidates the exact user-scoped Next Up query key", () => {
    expect(source).toContain('queryKey: ["user-memberships-and-events", user!.id]');
    expect(source).toContain("await queryClient.invalidateQueries(");
  });

  it("invalidates after creation validation and before navigation", () => {
    const validateIdx = source.indexOf('throw new Error("Event could not be created.")');
    const invalidateIdx = source.indexOf('"user-memberships-and-events", user!.id');
    const navigateIdx = source.indexOf("navigate(`/events/${newEventId}`)");

    expect(validateIdx).toBeGreaterThan(-1);
    expect(invalidateIdx).toBeGreaterThan(validateIdx);
    expect(navigateIdx).toBeGreaterThan(invalidateIdx);
  });

  it("does not invalidate all queries globally", () => {
    expect(source).not.toContain("invalidateQueries()");
  });
});
