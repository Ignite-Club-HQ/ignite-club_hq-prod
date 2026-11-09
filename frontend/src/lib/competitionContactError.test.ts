import { describe, expect, it } from "vitest";
import { competitionContactError } from "./competitionContactError";

/**
 * The "message the competition organisers" action is refused server-side with
 * terse technical sentences. None of them may reach a person's phone as-is.
 */
describe("competitionContactError", () => {
  it("explains the organiser's own refusal without echoing the raw sentence", () => {
    const result = competitionContactError(new Error("You are an admin of this competition"));

    expect(result.title).toBe("You run this competition");
    expect(result.description).toContain("you can manage teams, fixtures and settings");
    expect(result.description).not.toContain("admin of this competition");
    expect(result.technicalMessage).toBe("You are an admin of this competition");
  });

  it("tells an outsider how to get access when membership is refused", () => {
    for (const raw of ["You are not part of this competition", "Competition membership required"]) {
      const result = competitionContactError(new Error(raw));

      expect(result.title).toBe("Messaging organisers isn't available to you here");
      expect(result.description).toContain("ask your club to add you to a team");
    }
  });

  it("asks for a sign-in when the session is missing", () => {
    const result = competitionContactError(new Error("Authentication required"));

    expect(result.title).toBe("Please sign in first");
    expect(result.description).toContain("Sign in, then tap the button again");
  });

  it("points back to the competitions list when the competition is gone", () => {
    const result = competitionContactError(new Error("Competition not found"));

    expect(result.title).toBe("We couldn't find this competition");
    expect(result.description).toContain("competitions list");
  });

  it("says no organiser exists yet when nobody is configured", () => {
    const result = competitionContactError(new Error("Competition admins are not configured"));

    expect(result.title).toBe("This competition has no organiser yet");
    expect(result.description).toContain("Nobody is listed as an organiser");
  });

  it("blames the connection on a network failure", () => {
    const result = competitionContactError(new TypeError("Failed to fetch"));

    expect(result.title).toBe("You appear to be offline");
    expect(result.description).toContain("Check your connection");
  });

  it("never shows an unrecognised backend sentence to the user", () => {
    const result = competitionContactError(new Error("column chat_groups.competition_scope does not exist"));

    expect(result.title).toBe("We couldn't open this inbox");
    expect(result.description).not.toContain("chat_groups");
    expect(result.technicalMessage).toContain("competition_scope");
  });

  it("reads the raw text out of details/hint shapes too", () => {
    const result = competitionContactError({ details: "You are an admin of this competition" });

    expect(result.title).toBe("You run this competition");
  });

  it("shows the organiser's note as a plain note, not a red error", () => {
    expect(competitionContactError(new Error("You are an admin of this competition")).variant).toBe("default");
  });

  it("keeps real failures styled as errors", () => {
    for (const raw of ["Failed to fetch", "Competition not found", "column chat_groups.competition_scope does not exist"]) {
      expect(competitionContactError(new Error(raw)).variant).toBe("destructive");
    }
  });
});
