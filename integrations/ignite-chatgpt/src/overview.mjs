import {PluginAccessError} from "./core.mjs";

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const MAX_ITEMS = 3;
function fail(code, message) { throw new PluginAccessError(code, message); }
function inputObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(key => !["club_id", "team_id"].includes(key))) {
    fail("INVALID_INPUT", "Expected club_id or team_id only");
  }
  for (const [key, id] of Object.entries(value)) {
    if (id !== undefined && id !== null && (typeof id !== "string" || !ID.test(id))) {
      fail("INVALID_INPUT", `Invalid ${key}`);
    }
  }
  if (value.team_id && !value.club_id) fail("INVALID_INPUT", "Choose a club before a team");
  return value;
}
function unique(records, label) {
  if (!Array.isArray(records)) fail("INVALID_BACKEND_RESULT", `Invalid ${label} result`);
  const seen = new Set();
  return records.filter(row => {
    if (!row || typeof row.id !== "string" || !ID.test(row.id)) {
      fail("INVALID_BACKEND_RESULT", `Invalid ${label} identifier`);
    }
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}
function upcoming(events, nowMs) {
  if (!Array.isArray(events)) fail("INVALID_BACKEND_RESULT", "Invalid events result");
  const now = BigInt(Math.trunc(nowMs));
  const normalized = events.filter(row => !row.deleted && !row.cancelled).map(row => {
    const time = String(row.starts_at_ms);
    if (!/^\d+$/.test(time)) fail("INVALID_BACKEND_RESULT", "Invalid event time");
    return {row, start: BigInt(time)};
  });
  return normalized.filter(x => x.start >= now).sort((a,b) =>
    a.start < b.start ? -1 : a.start > b.start ? 1 : 0)
    .slice(0, MAX_ITEMS).map(x => x.row);
}

/**
 * Source-only customer overview composition. It reuses the five audited,
 * caller-scoped Ignite handlers; it does not accept an arbitrary principal,
 * make network requests, persist preferences or mint an Internet Identity grant.
 * Not yet published as an MCP tool.
 */
export async function getMyIgniteOverview(handlers, args = {}, extra, {nowMs = Date.now()} = {}) {
  const {club_id, team_id} = inputObject(args);
  if (!handlers || typeof handlers.list_my_clubs !== "function") {
    fail("INVALID_BACKEND_RESULT", "My Ignite handlers unavailable");
  }
  const clubs = unique((await handlers.list_my_clubs({}, extra)).clubs, "clubs");
  if (!clubs.length) return {view:"no_clubs", clubs:[]};
  if (club_id && !clubs.some(club => club.id === club_id)) {
    fail("ACCESS_DENIED", "Club is not accessible to this account");
  }
  const club = club_id ? clubs.find(c => c.id === club_id) : clubs.length === 1 ? clubs[0] : null;
  if (!club) return {view:"choose_club",clubs};

  const teams = unique((await handlers.list_my_teams({club_id:club.id}, extra)).teams, "teams");
  if (teams.some(t => t.club_id !== club.id)) fail("INVALID_BACKEND_RESULT", "Team belongs to a different club");
  if (team_id && !teams.some(team => team.id === team_id)) {
    fail("ACCESS_DENIED", "Team is not accessible to this account");
  }
  if (!teams.length) return {view:"no_teams",club,teams:[]};
  const team = team_id ? teams.find(t => t.id === team_id) : teams.length === 1 ? teams[0] : null;
  if (!team) return {view:"choose_team",club,teams};

  const [eventResult, chatResult] = await Promise.allSettled([
    handlers.list_team_events({club_id:club.id,team_id:team.id}, extra),
    handlers.list_conversations({club_id:club.id,team_id:team.id}, extra),
  ]);
  let events = null, chats = null;
  let events_status = eventResult.status === "fulfilled" ? "ok" : "unavailable";
  let chats_status = chatResult.status === "fulfilled" ? "ok" : "unavailable";
  if (events_status === "ok") {
    try {
      events = upcoming(eventResult.value.events, nowMs);
      if (events.some(e => e.club_id !== club.id || e.team_id !== team.id)) {
        fail("ACCESS_DENIED", "Event scope mismatch");
      }
    } catch (_) { events_status = "unavailable"; events = null; }
  }
  if (chats_status === "ok") {
    try {
      if (!Array.isArray(chatResult.value.conversations)) throw Error("Invalid chat result");
      const own = chatResult.value.conversations;
      if (own.some(c => c.club_id !== club.id || c.team_id !== team.id)) {
        fail("ACCESS_DENIED", "Conversation scope mismatch");
      }
      chats = own.slice(0, MAX_ITEMS);
    } catch (_) { chats_status = "unavailable"; chats = null; }
  }
  return {view:"team_home", club,team, events_status, events, chats_status, chats};
}
