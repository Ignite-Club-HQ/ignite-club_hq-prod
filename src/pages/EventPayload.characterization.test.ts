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
    expect(createPayload).toMatch(/type:\s*type === "mini_league" \? "game" : type/);
    expect(createPayload).toMatch(/team_id:\s*type === "mini_league" \? null : \(teamId \|\| null\)/);
    expect(createPayload).toMatch(/mini_league_id:\s*type === "mini_league" \? miniLeagueId : null/);
  });

  it("keeps opponent and arrival details only for a non-bye game", () => {
    expect(createPayload).toMatch(/opponent:\s*type === "game" && !isBye \? opponent\.trim\(\) \|\| null : null/);
    expect(createPayload).toMatch(/arrival_minutes_before:\s*type === "game" && !isBye[^?]+\? parseInt\(arrivalMinutesBefore, 10\) : null/);
    expect(createPayload).toMatch(/is_bye:\s*type === "game" \? isBye : false/);
  });

  it("keeps price and guest limits only for social events", () => {
    expect(createPayload).toMatch(/amount:\s*type === "social" \? parsedPrice : null/);
    expect(createPayload).toMatch(/allow_guests:\s*type === "social" && allowGuests \? true : null/);
    expect(createPayload).toMatch(/max_guests_per_member:\s*type === "social" && allowGuests \? maxGuestsPerMember : null/);
  });

  it("persists grouping only for club-wide games/socials and targets at least two teams", () => {
    expect(createPayload).toMatch(/rsvp_grouping:[\s\S]*?!teamId && \(type === "game" \|\| type === "social"\)[\s\S]*?\? rsvpGrouping : null/);
    expect(createPayload).toMatch(/target_team_ids:[\s\S]*?!teamId && \(type === "game" \|\| type === "social"\)[\s\S]*?targetTeamIds\.length >= 2[\s\S]*?\? targetTeamIds[\s\S]*?: null/);
  });

  it("writes duties only for games and sends event, recurrence and duties through one RPC", () => {
    expect(createSource).toMatch(/const dutyPayload =\s*type === "game"\s*\? duties\.map/);
    expect(createSource).toContain('supabase.rpc("create_event_with_duties"');
    expect(createSource).toMatch(/p_event:\s*\{[\s\S]*?\.\.\.baseEventData,[\s\S]*?event_date:/);
    expect(createSource).toContain("p_child_dates: childDates");
    expect(createSource).toContain("p_duties: dutyPayload");
  });
});

describe("event edit payload parity", () => {
  it("preserves the create rules for bye, arrival, social payment and guests", () => {
    expect(editPayload).toMatch(/opponent:\s*type === "game" && !isBye \? opponent\.trim\(\) \|\| null : null/);
    expect(editPayload).toMatch(/arrival_minutes_before:\s*type === "game" && !isBye[^?]+\? parseInt\(arrivalMinutesBefore, 10\) : null/);
    expect(editPayload).toMatch(/amount:\s*type === "social" \? parsedPrice : null/);
    expect(editPayload).toMatch(/allow_guests:\s*type === "social" && allowGuests \? true : null/);
  });

  it("clears stale grouping and targets when an event becomes team-specific or changes type", () => {
    expect(editPayload).toMatch(/rsvp_grouping:[\s\S]*?!selectedTeamId && \(type === "game" \|\| type === "social"\)[\s\S]*?: null/);
    expect(editPayload).toMatch(/target_team_ids:[\s\S]*?!selectedTeamId && \(type === "game" \|\| type === "social"\)[\s\S]*?targetTeamIds\.length >= 2[\s\S]*?: null/);
  });

  it("resets a changed reminder so the new schedule can notify again", () => {
    expect(editPayload).toMatch(/reminder_sent:\s*reminderEnabled \? \(event\?\.reminder_hours_before === reminderHours \? event\?\.reminder_sent : false\) : false/);
  });

  it("keeps event date, start and end aligned for single and series updates", () => {
    expect(editSource).toContain("p_selected_event_date: parsedDateTime.toISOString()");
    expect(editSource).toContain("p_selected_start_time: newStartIso");
    expect(editSource).toContain("p_selected_end_time: newEndIso");
    expect(editSource).toMatch(/\.update\(\{[\s\S]*?\.\.\.updateData,[\s\S]*?event_date: parsedDateTime\.toISOString\(\),[\s\S]*?start_time: newStartIso,[\s\S]*?end_time: newEndIso/);
  });
});

describe("training conflict characterization", () => {
  const conflictCheck = between(createSource, "const checkForConflicts", "const handleSubmit");

  it("checks only same-club, active events at the normalized venue and time window", () => {
    expect(conflictCheck).toContain('.eq("club_id", clubId)');
    expect(conflictCheck).toContain('.eq("is_cancelled", false)');
    expect(conflictCheck).toContain('.gte("event_date", `${eventDateStr}T00:00:00`)');
    expect(conflictCheck).toContain('.lte("event_date", `${eventDateStr}T23:59:59`)');
    expect(conflictCheck).toMatch(/trim\(\)\.toLowerCase\(\)/);
  });

  it("also evaluates recurring parents by venue, time and weekday", () => {
    expect(conflictCheck).toContain('.eq("is_recurring", true)');
    expect(conflictCheck).toContain("recurrence_end_date.gte.");
    expect(conflictCheck).toContain("evtDate.getDay() === parsedDateTime.getDay()");
  });

  it("runs conflict detection only for training unless the user explicitly confirms override", () => {
    expect(createSource).toMatch(/if \(!skipConflictCheck && type === "training"\) \{[\s\S]*?await checkForConflicts\(\)/);
  });
});
