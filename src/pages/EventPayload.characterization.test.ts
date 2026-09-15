/**
 * Transitional characterization for the event form payload rules.
 *
 * These assertions deliberately pin business decisions at the page boundary
 * before payload construction is extracted during the Events refactor. They
 * should be replaced by direct tests of the extracted builder in phase E3.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");
const createSource = read("src/pages/CreateEventPage.tsx");
const editSource = read("src/pages/EditEventPage.tsx");

function between(source: string, start: string, end: string) {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt);
  expect(startAt, `missing start marker: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endAt, `missing end marker: ${end}`).toBeGreaterThan(startAt);
  return source.slice(startAt, endAt);
}

const createPayload = between(createSource, "const baseEventData = {", "const dutyPayload");
const editPayload = between(editSource, "const updateData = {", "// If converting single event");

describe("event create payload business rules", () => {
  it("normalizes mini-league events to a club game with no team and the selected league", () => {
    expect(createSource).toContain('type: type === "mini_league" ? "game" : type');
    expect(createSource).toContain('teamId: type === "mini_league" ? "" : teamId');
    expect(createPayload).toMatch(/mini_league_id:\s*type === "mini_league" \? miniLeagueId : null/);
  });

  it("delegates shared normalization through the directly tested payload policy", () => {
    expect(createSource).toContain("const sharedEventData = buildSharedEventPayload({");
    expect(createPayload).toContain("...sharedEventData");
  });

  it("writes duties only for games and delegates the complete atomic transaction", () => {
    expect(createSource).toMatch(/const dutyPayload =\s*type === "game"\s*\? duties\.map/);
    expect(createSource).toContain("createEventTransaction(supabase, {");
    expect(createSource).toContain("event: baseEventData");
    expect(createSource).toContain("eventDate: parsedDateTime.toISOString()");
    expect(createSource).toContain("childDates");
    expect(createSource).toContain("duties: dutyPayload");
  });
});

describe("event edit payload parity", () => {
  it("uses the same directly tested normalization policy as create", () => {
    expect(editPayload).toContain("...buildSharedEventPayload({");
    for (const input of [
      "title", "type", "address", "description", "price", "opponent", "isBye",
      "arrivalMinutesBefore", "allowGuests", "restrictedRoles", "rsvpGrouping", "targetTeamIds",
    ]) expect(editPayload).toContain(input);
  });

  it("resets a changed reminder so the new schedule can notify again", () => {
    expect(editPayload).toMatch(/reminder_sent:\s*reminderEnabled \? \(event\?\.reminder_hours_before === reminderHours \? event\?\.reminder_sent : false\) : false/);
  });

  it("keeps event date, start and end aligned for single and series updates", () => {
    expect(editSource).toContain("updateEventTransaction(supabase, {");
    expect(editSource).toContain("updates: updateData");
    expect(editSource).toContain("selectedEventDate: parsedDateTime.toISOString()");
    expect(editSource).toContain("selectedStartTime: newStartIso");
    expect(editSource).toContain("selectedEndTime: newEndIso");
    expect(editSource).toContain("updateSeries: true");
    expect(editSource).toContain("updateSeries: false");
  });
});

describe("training conflict characterization", () => {
  const conflictCheck = between(createSource, "const checkForConflicts", "const handleSubmit");

  it("queries same-club active events in the selected date window and delegates matching", () => {
    expect(conflictCheck).toContain('.eq("club_id", clubId)');
    expect(conflictCheck).toContain('.eq("is_cancelled", false)');
    expect(conflictCheck).toContain('.gte("event_date", `${eventDateStr}T00:00:00`)');
    expect(conflictCheck).toContain('.lte("event_date", `${eventDateStr}T23:59:59`)');
    expect(conflictCheck).toContain("evaluateTrainingConflicts({");
    expect(conflictCheck).toContain("parsedDateTime");
    expect(conflictCheck).toContain("address");
  });

  it("queries eligible recurring parents and delegates weekday matching", () => {
    expect(conflictCheck).toContain('.eq("is_recurring", true)');
    expect(conflictCheck).toContain("recurrence_end_date.gte.");
    expect(conflictCheck).toContain("recurringParentQuery");
  });

  it("runs conflict detection only for training unless the user explicitly confirms override", () => {
    expect(createSource).toMatch(/if \(!skipConflictCheck && type === "training"\) \{[\s\S]*?await checkForConflicts\(\)/);
  });
});
