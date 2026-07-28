import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSyntheticLocalMarker, createSecurityFixture, service, type SecurityFixture } from "./fixtures";

describe("local messaging security across all chat surfaces", () => {
  let f: SecurityFixture;
  let groupA: string, dmA: string, adminThreadA: string;
  const created: Record<string, string> = {};

  beforeAll(async () => {
    await assertSyntheticLocalMarker();
    f = await createSecurityFixture();
    const group = await service.from("chat_groups").insert({ club_id: f.clubA, name: "Synthetic Group" }).select("id").single();
    if (group.error) throw group.error; groupA = group.data.id;
    const gm = await service.from("chat_group_members").insert([{ group_id: groupA, user_id: f.adminA.id }, { group_id: groupA, user_id: f.memberA.id }]);
    if (gm.error) throw gm.error;
    const dm = await service.from("direct_conversations").insert({ user_a: f.adminA.id, user_b: f.memberA.id }).select("id").single();
    if (dm.error) throw dm.error; dmA = dm.data.id;
    const thread = await service.from("club_admin_conversations").insert({ club_id: f.clubA, member_id: f.memberA.id }).select("id").single();
    if (thread.error) throw thread.error; adminThreadA = thread.data.id;
  });

  afterAll(async () => {
    if (dmA) await service.from("direct_conversations").delete().eq("id", dmA);
    await f?.cleanup();
  });

  it.each([
    ["team_messages", () => ({ team_id: f.teamA })],
    ["club_messages", () => ({ club_id: f.clubA })],
    ["group_messages", () => ({ group_id: groupA })],
    ["direct_messages", () => ({ conversation_id: dmA })],
    ["club_admin_messages", () => ({ conversation_id: adminThreadA })],
  ] as const)("allows an authorised member to send and read %s", async (table, scope) => {
    const result = await f.memberA.client.from(table).insert({ ...scope(), author_id: f.memberA.id, text: `Synthetic ${table}` }).select("id,text").single();
    expect(result.error).toBeNull();
    created[table] = result.data!.id;
  });

  it.each([
    ["team_messages", () => ({ team_id: f.teamA })], ["club_messages", () => ({ club_id: f.clubA })],
    ["group_messages", () => ({ group_id: groupA })], ["direct_messages", () => ({ conversation_id: dmA })],
    ["club_admin_messages", () => ({ conversation_id: adminThreadA })],
  ] as const)("denies a foreign-club user from inserting or reading %s", async (table, scope) => {
    const insert = await f.outsiderB.client.from(table).insert({ ...scope(), author_id: f.outsiderB.id, text: "Forbidden" });
    expect(insert.error).not.toBeNull();
    const rows = await f.outsiderB.client.from(table).select("id");
    expect(rows.data).toEqual([]);
  });

  it("restricts edits to the author while retaining administrator deletion", async () => {
    const id = created.team_messages;
    const foreignEdit = await f.adminA.client.from("team_messages").update({ text: "Admin moderation" }).eq("id", id).select("id");
    expect(foreignEdit.error).toBeNull();
    expect(foreignEdit.data).toEqual([]);
    const outsider = await f.outsiderB.client.from("team_messages").update({ text: "Hijack" }).eq("id", id).select("id");
    expect(outsider.data).toEqual([]);
    const authorEdit = await f.memberA.client.from("team_messages").update({ text: "Author correction" }).eq("id", id).select("id");
    expect(authorEdit.data).toEqual([{ id }]);
    const removed = await f.adminA.client.from("team_messages").delete().eq("id", id).select("id");
    expect(removed.data).toEqual([{ id }]);
  });

  it("restricts Broadcast writes to app administrators while keeping reads available", async () => {
    const denied = await f.memberA.client.from("broadcast_messages").insert({ author_id: f.memberA.id, text: "Forbidden broadcast" });
    expect(denied.error).not.toBeNull();
    await service.from("user_roles").insert({ user_id: f.adminA.id, role: "app_admin" });
    const sent = await f.adminA.client.from("broadcast_messages").insert({ author_id: f.adminA.id, text: "Authorised broadcast" }).select("id").single();
    expect(sent.error).toBeNull(); created.broadcast_messages = sent.data!.id;
    const visible = await f.memberA.client.from("broadcast_messages").select("id").eq("id", sent.data!.id);
    expect(visible.data).toEqual([{ id: sent.data!.id }]);
  });

  it("scopes reactions to accessible messages and to the reacting user", async () => {
    const message = await f.memberA.client.from("club_messages").insert({ club_id: f.clubA, author_id: f.memberA.id, text: "React here" }).select("id").single();
    const reaction = await f.adminA.client.from("message_reactions").insert({ user_id: f.adminA.id, club_message_id: message.data!.id, reaction_type: "heart" }).select("id").single();
    expect(reaction.error).toBeNull();
    const hidden = await f.outsiderB.client.from("message_reactions").select("id").eq("id", reaction.data!.id);
    expect(hidden.data).toEqual([]);
    const cannotDeleteAnother = await f.memberA.client.from("message_reactions").delete().eq("id", reaction.data!.id).select("id");
    expect(cannotDeleteAnother.data).toEqual([]);
  });

  it("keeps pins and read markers private and rejects inaccessible targets", async () => {
    const messageId = created.club_messages;
    const pin = await f.memberA.client.from("message_pins").insert({ user_id: f.memberA.id, message_kind: "club", message_id: messageId, scope_id: f.clubA }).select("id").single();
    expect(pin.error).toBeNull();
    const read = await f.memberA.client.from("message_reads").insert({ user_id: f.memberA.id, message_kind: "club", message_id: messageId }).select("id").single();
    expect(read.error).toBeNull();
    expect((await f.outsiderB.client.from("message_pins").select("id")).data).toEqual([]);
    const forged = await f.outsiderB.client.from("message_reads").insert({ user_id: f.outsiderB.id, message_kind: "club", message_id: messageId });
    expect(forged.error).not.toBeNull();
  });

  it("revokes future reads immediately when group membership is removed", async () => {
    const id = created.group_messages;
    await service.from("chat_group_members").delete().eq("group_id", groupA).eq("user_id", f.memberA.id);
    const rows = await f.memberA.client.from("group_messages").select("id").eq("id", id);
    expect(rows.data).toEqual([]);
    const send = await f.memberA.client.from("group_messages").insert({ group_id: groupA, author_id: f.memberA.id, text: "After removal" });
    expect(send.error).not.toBeNull();
  });
});
