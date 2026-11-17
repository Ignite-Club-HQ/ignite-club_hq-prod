import { describe, expect, it } from "vitest";
import { summarizeAdultNameIssues, teamRosterReadFailureCode } from "./teamRosterReads";

describe("parent-name diagnostics", () => {
  it("maps known name refusals to specific codes", () => {
    expect(teamRosterReadFailureCode(new Error("Configured private-name service required"))).toBe("SERVICE_NOT_ADMITTED");
    expect(teamRosterReadFailureCode(new Error("Read private display names: Original private-name binding changed"))).toBe("PROFILE_LINK_MISMATCH");
    expect(teamRosterReadFailureCode(new Error("Private-name release fenced or not configured"))).toBe("RELEASE_NOT_CONFIGURED");
    expect(teamRosterReadFailureCode("Club name copy not saved yet.")).toBe("NOT_SHARED_YET");
  });
  it("counts issues per reason", () => {
    expect(summarizeAdultNameIssues(["Club name copy not saved yet.", "Club name copy not saved yet.", "Configured private-name service required"]))
      .toEqual([{ code: "NOT_SHARED_YET", count: 2 }, { code: "SERVICE_NOT_ADMITTED", count: 1 }]);
  });
});
