import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("deleted and recreated team chat identity", () => {
  it("keeps inbox discovery on active team IDs and fetches previews by those IDs", () => {
    const inbox = source("src/pages/MessagesPage.tsx");
    const repositories = source("src/features/messaging/inbox/inboxRepositories.ts");
    expect(inbox).toContain("fetchInboxMemberTeamsWithMessages(user!.id)");
    expect(repositories).toContain('.is("deleted_at", null)');
    expect(repositories).toContain("const activeTeamIds = teams.map((team) => team.id)");
    expect(repositories).toContain('{ _team_ids: activeTeamIds }');
    expect(repositories).toContain('.eq("team_id", team.id)');
  });

  it("posts a new event only to the event row's immutable team ID", () => {
    const autoPost = source("supabase/functions/auto-post-event-to-chat/index.ts");
    expect(autoPost).toContain('.eq("id", ev.team_id)');
    expect(autoPost).toContain("team_id: ev.team_id");
    expect(autoPost).not.toMatch(/team_id:\s*team\.name/);
  });

  it("routes message notifications through the stored message team ID, never a team name", () => {
    const routing = source("src/lib/notificationChatRouting.ts");
    expect(routing).toContain('from("team_messages").select("team_id").eq("id", messageId)');
    expect(routing).toContain('return found("team", tMsg.team_id)');
    expect(routing).not.toMatch(/team_name|teams\.name/);
  });

  it("scopes soft-delete side effects to the deleted team primary key", () => {
    const migration = source("supabase/migrations/20260726230702_4e682cdf-684f-44c9-b15d-7eac23dd4f37.sql");
    expect(migration).toContain("WHERE team_id = NEW.id");
    expect(migration).not.toMatch(/WHERE\s+(?:team_)?name\s*=/i);
  });
});
