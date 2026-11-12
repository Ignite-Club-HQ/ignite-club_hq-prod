// Ignite-owned customer-facing tool boundary. Does not import or forward the
// generic DFINITY ChatGPT plugin. The eventual OAuth/Internet Identity bridge
// must supply the verified session and the same caller-signed ICP actors used
// by the native application. Nothing in model-supplied args can select a user.
export const DEV_ORIGIN = "https://proe7-kqaaa-aaaas-qg6gq-cai.ic0.app";
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

export class PluginAccessError extends Error {
  constructor(code, message) { super(message); this.name = "PluginAccessError"; this.code = code; }
}
function error(code, text) { throw new PluginAccessError(code, text); }
function obj(x) { if (!x || typeof x !== "object" || Array.isArray(x)) error("INVALID_INPUT", "Expected an object"); return x; }
function keys(input, allowed) {
  const a = obj(input);
  if (Object.keys(a).some(k => !allowed.includes(k))) error("INVALID_INPUT", "Unsupported input field");
  return a;
}
function id(value, label) {
  if (typeof value !== "string" || !ID.test(value)) error("INVALID_INPUT", `Invalid ${label}`);
  return value;
}
function rows(list, label, max = 100) {
  if (!Array.isArray(list)) error("INVALID_BACKEND_RESULT", `Invalid ${label} response`);
  if (list.length > 1000) error("RESULT_TOO_LARGE", `Too many ${label}; narrow the request`);
  return list.slice(0, max);
}
function text(x, max = 180) { return typeof x === "string" ? x.slice(0, max) : ""; }
function secureSession(session) {
  // These properties MUST originate from an auth bridge that has checked
  // OAuth issuer/audience/scope and verified the Internet Identity delegation.
  // This structure is never accepted as a tool argument or from an HTTP body.
  if (!session || session.oauthVerified !== true ||
      session.internetIdentityDelegationVerified !== true ||
      session.environment !== "dev" ||
      session.derivationOrigin !== DEV_ORIGIN ||
      typeof session.principal !== "string" || !ID.test(session.principal) ||
      typeof session.actorFactory !== "function") {
    error("NOT_CONNECTED", "Connect an Ignite DEV Internet Identity account to use member tools");
  }
  return session;
}
export const TOOL_NAMES = Object.freeze([
  "get_ignite_profile", "list_my_clubs", "list_my_teams",
  "list_team_events", "list_conversations", "list_conversation_messages",
]);

export function createIgniteHandlers({resolveVerifiedSession, backend}) {
  if (typeof resolveVerifiedSession !== "function" || !backend) throw new Error("Trusted OAuth/II bridge and caller-scoped backend required");
  async function sessionFor(extra) { return secureSession(await resolveVerifiedSession(extra)); }
  async function clubAccess(session, club) {
    if ((await backend.hasClubAccess(session, club)) !== true)
      error("ACCESS_DENIED", "Club is not accessible to this connected account");
  }
  async function teamAccess(session, club, team) {
    if ((await backend.hasTeamAccess(session, club, team)) !== true)
      error("ACCESS_DENIED", "Team is not accessible to this connected account");
  }
  return Object.freeze({
    async get_ignite_profile(args, extra) {
      keys(args, []);
      const session = await sessionFor(extra);
      const own = obj(await backend.getProfile(session));
      if (own.id !== session.principal) error("IDENTITY_MISMATCH", "Connected identity does not match the current account");
      return {id: session.principal, ...(own.nickname ? {nickname: text(own.nickname, 120)} : {})};
    },
    async list_my_clubs(args, extra) {
      keys(args, []);
      const session = await sessionFor(extra);
      const clubs = rows(await backend.listMyClubs(session), "clubs", 50)
        .map(row => ({id: id(row.id, "club ID"), name: text(row.name, 160)}));
      return {clubs};
    },
    async list_my_teams(args, extra) {
      const {club_id} = keys(args, ["club_id"]);
      const club = id(club_id, "club ID"), session = await sessionFor(extra);
      await clubAccess(session, club);
      const teams = rows(await backend.listMyTeams(session, club), "teams", 50)
        .filter(row => row.club_id === club)
        .map(row => ({id: id(row.id, "team ID"), club_id: club, name: text(row.name, 160)}));
      return {club_id: club, teams};
    },
    async list_team_events(args, extra) {
      const {club_id, team_id} = keys(args, ["club_id", "team_id"]);
      const club = id(club_id, "club ID"), team = team_id == null ? null : id(team_id, "team ID");
      const session = await sessionFor(extra);
      await clubAccess(session, club);
      if (team) await teamAccess(session, club, team);
      const events = rows(await backend.listEvents(session, club, team), "events", 100)
        .filter(row => !row.deleted && row.club_id === club && (team === null || row.team_id === team))
        .map(row => ({id: id(row.id, "event ID"), title: text(row.title, 160), club_id: club,
          team_id: row.team_id ?? null, starts_at_ms: String(row.starts_at_ms),
          ends_at_ms: String(row.ends_at_ms), event_type: text(row.event_type, 48)}));
      return {club_id: club, team_id: team, events};
    },
    // Caller-scoped, backwards-paged chat history. The account/principal is
    // always taken from the trusted OAuth/Internet Identity session, never args.
    async list_conversation_messages(args, extra) {
      const {club_id, team_id, conversation_id, before_sequence, limit} =
        keys(args, ["club_id", "team_id", "conversation_id", "before_sequence", "limit"]);
      const club = id(club_id, "club ID"), team = id(team_id, "team ID");
      const conversation = id(conversation_id, "conversation ID");
      if (before_sequence != null &&
          (typeof before_sequence !== "string" || !/^\d{1,20}$/.test(before_sequence) ||
           BigInt(before_sequence) > 18446744073709551615n || BigInt(before_sequence) === 0n)) {
        error("INVALID_INPUT", "Invalid message history cursor");
      }
      if (limit != null && (!Number.isInteger(limit) || limit < 1 || limit > 50)) {
        error("INVALID_INPUT", "History page size must be 1-50");
      }
      const pageSize = limit ?? 25;
      const session = await sessionFor(extra);
      await clubAccess(session, club);
      await teamAccess(session, club, team);
      if (typeof backend.hasConversationAccess !== "function" ||
          typeof backend.listConversationMessages !== "function") {
        error("NOT_AVAILABLE", "Authenticated chat history is not configured");
      }
      if ((await backend.hasConversationAccess(session, club, team, conversation)) !== true) {
        error("ACCESS_DENIED", "Conversation is not accessible to this account");
      }
      const page = obj(await backend.listConversationMessages(session, club, team, conversation,
        before_sequence ?? null, pageSize));
      if (!Array.isArray(page.messages) || page.messages.length > pageSize) {
        error("INVALID_BACKEND_RESULT", "Invalid conversation page");
      }
      const cursor = (value, label) => {
        if (value == null) return null;
        const val = String(value);
        if (!/^\d{1,20}$/.test(val) || BigInt(val) > 18446744073709551615n) {
          error("INVALID_BACKEND_RESULT", `Invalid ${label}`);
        }
        return val;
      };
      const seen = new Set();
      const messages = page.messages.map(row => {
        const item = obj(row);
        const messageId = id(item.id, "message ID");
        const scopeId = id(item.conversation_id, "message conversation");
        if (scopeId !== conversation || seen.has(messageId)) {
          error("ACCESS_DENIED", "Conversation message scope mismatch");
        }
        seen.add(messageId);
        if (typeof item.body !== "string" || item.body.length > 12000) {
          error("INVALID_BACKEND_RESULT", "Invalid message body");
        }
        const author = id(item.sender, "message sender");
        return {
          id: messageId, body: item.body, conversation_id: conversation,
          created_at_ms: cursor(item.created_at_ms, "message time"),
          edited_at_ms: cursor(item.edited_at_ms, "edit time"),
          sequence: cursor(item.sequence, "sequence"),
          reply_to_id: item.reply_to_id == null ? null : id(item.reply_to_id, "reply ID"),
          is_mine: author === session.principal,
          sender_name: typeof item.sender_name === "string"
            ? text(item.sender_name, 100) : author === session.principal ? "You" : "Team member",
          attachment: item.attachment == null ? null :
            {kind: text(obj(item.attachment).kind, 40)},
        };
      }).sort((a,b) => BigInt(a.sequence) < BigInt(b.sequence) ? -1 :
                        BigInt(a.sequence) > BigInt(b.sequence) ? 1 : 0);
      return {club_id:club, team_id:team, conversation_id:conversation,
        messages, latest_sequence:cursor(page.latest_sequence, "latest sequence"),
        next_sequence:cursor(page.next_sequence, "next sequence")};
    },
    async list_conversations(args, extra) {
      const {club_id, team_id} = keys(args, ["club_id", "team_id"]);
      const club = id(club_id, "club ID"), team = team_id == null ? null : id(team_id, "team ID");
      const session = await sessionFor(extra);
      await clubAccess(session, club);
      if (team) await teamAccess(session, club, team);
      const conversations = rows(await backend.listConversations(session, club, team), "conversations", 50)
        .filter(row => row.club_id === club && (team === null ? row.team_id == null : row.team_id === team))
        .map(row => ({id: id(row.conversation_id, "conversation ID"), name: text(row.name, 160),
          club_id: club, team_id: row.team_id ?? null, kind: text(row.kind, 32)}));
      return {club_id: club, team_id: team, conversations};
    },
  });
}

export async function invokeIgniteTool(handlers, name, args, extra) {
  if (!TOOL_NAMES.includes(name) || typeof handlers?.[name] !== "function") error("UNKNOWN_TOOL", "Unsupported Ignite action");
  return handlers[name](args, extra);
}
