import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertSyntheticLocalMarker,
  createSecurityFixture,
  createSyntheticUser,
  service,
  type SecurityFixture,
  type SyntheticUser,
} from "./fixtures";

describe("local messaging security across all chat surfaces", () => {
  let f: SecurityFixture;
  let secondClubAdmin: SyntheticUser;
  let groupA: string, dmA: string, adminThreadA: string;
  const created: Record<string, string> = {};

  beforeAll(async () => {
    await assertSyntheticLocalMarker();
    f = await createSecurityFixture();
    secondClubAdmin = await createSyntheticUser("second-club-admin-message-reader");
    const secondAdminRole = await service.from("user_roles").insert({
      user_id: secondClubAdmin.id,
      role: "club_admin",
      club_id: f.clubA,
    });
    if (secondAdminRole.error) throw secondAdminRole.error;
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
    if (secondClubAdmin?.id) await service.auth.admin.deleteUser(secondClubAdmin.id);
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

  it("shows one member's all-club-admin conversation and exact message to every admin of that club", async () => {
    const sent = await f.memberA.client.from("club_admin_messages").insert({
      conversation_id: adminThreadA,
      author_id: f.memberA.id,
      text: "Synthetic message for every club admin",
    }).select("id, conversation_id, text").single();
    expect(sent.error).toBeNull();

    const [primaryConversation, secondConversation, primaryThread, secondThread, foreignConversation, foreignThread] =
      await Promise.all([
        f.adminA.client.from("club_admin_conversations").select("id").eq("id", adminThreadA),
        secondClubAdmin.client.from("club_admin_conversations").select("id").eq("id", adminThreadA),
        f.adminA.client.from("club_admin_messages").select("id, conversation_id, text")
          .eq("conversation_id", adminThreadA).eq("id", sent.data!.id),
        secondClubAdmin.client.from("club_admin_messages").select("id, conversation_id, text")
          .eq("conversation_id", adminThreadA).eq("id", sent.data!.id),
        f.outsiderB.client.from("club_admin_conversations").select("id").eq("id", adminThreadA),
        f.outsiderB.client.from("club_admin_messages").select("id").eq("id", sent.data!.id),
      ]);

    expect(primaryConversation.data).toEqual([{ id: adminThreadA }]);
    expect(secondConversation.data).toEqual([{ id: adminThreadA }]);
    expect(primaryThread.data).toEqual([sent.data]);
    expect(secondThread.data).toEqual([sent.data]);
    expect(foreignConversation.data).toEqual([]);
    expect(foreignThread.data).toEqual([]);
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

  it.each([
    ["club_messages", "club"],
    ["group_messages", "group"],
    ["direct_messages", "direct"],
    ["club_admin_messages", "club-admin"],
  ] as const)("allows only the author to edit %s", async (table, label) => {
    const id = created[table];
    const author = await f.memberA.client.from(table).update({ text: `Author edited ${label}` }).eq("id", id).select("id,text");
    expect(author.error).toBeNull();
    expect(author.data).toEqual([{ id, text: `Author edited ${label}` }]);

    const foreignAdmin = await f.outsiderB.client.from(table).update({ text: "Cross-club edit" }).eq("id", id).select("id");
    expect(foreignAdmin.data).toEqual([]);
  });

  it("allows a club administrator to moderate-delete only their own club message", async () => {
    const ownClubMessage = await f.memberA.client.from("club_messages").insert({ club_id: f.clubA, author_id: f.memberA.id, text: "Moderate locally" }).select("id").single();
    expect(ownClubMessage.error).toBeNull();
    const deleted = await f.adminA.client.from("club_messages").delete().eq("id", ownClubMessage.data!.id).select("id");
    expect(deleted.data).toEqual([{ id: ownClubMessage.data!.id }]);

    const foreign = await f.outsiderB.client.from("club_messages").delete().eq("id", created.club_messages).select("id");
    expect(foreign.data).toEqual([]);
  });

  it.each([
    ["group_messages"],
    ["direct_messages"],
    ["club_admin_messages"],
  ] as const)("prevents a non-author, including a scoped administrator, from deleting %s", async (table) => {
    const adminAttempt = await f.adminA.client.from(table).delete().eq("id", created[table]).select("id");
    expect(adminAttempt.data).toEqual([]);
    const outsiderAttempt = await f.outsiderB.client.from(table).delete().eq("id", created[table]).select("id");
    expect(outsiderAttempt.data).toEqual([]);
  });

  it("lets a club administrator read and send to a team in the exact administered club only", async () => {
    const ownClub = await f.adminA.client.from("team_messages").insert({ team_id: f.teamA, author_id: f.adminA.id, text: "Scoped club announcement" }).select("id").single();
    expect(ownClub.error).toBeNull();
    const foreignClub = await f.outsiderB.client.from("team_messages").insert({ team_id: f.teamA, author_id: f.outsiderB.id, text: "Cross-club announcement" });
    expect(foreignClub.error).not.toBeNull();
    const readable = await f.adminA.client.from("team_messages").select("id").eq("id", ownClub.data!.id);
    expect(readable.data).toEqual([{ id: ownClub.data!.id }]);
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

  it("keeps Broadcast update and deletion restricted to an app administrator", async () => {
    const id = created.broadcast_messages;
    const ordinaryUpdate = await f.memberA.client.from("broadcast_messages").update({ text: "Ordinary edit" }).eq("id", id).select("id");
    expect(ordinaryUpdate.data).toEqual([]);
    const appUpdate = await f.adminA.client.from("broadcast_messages").update({ text: "App-admin edit" }).eq("id", id).select("id,text");
    expect(appUpdate.data).toEqual([{ id, text: "App-admin edit" }]);
    const ordinaryDelete = await f.memberA.client.from("broadcast_messages").delete().eq("id", id).select("id");
    expect(ordinaryDelete.data).toEqual([]);
    const appDelete = await f.adminA.client.from("broadcast_messages").delete().eq("id", id).select("id");
    expect(appDelete.data).toEqual([{ id }]);
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

  it.each([
    ["team_messages", "team", () => ({ team_id: f.teamA })],
    ["club_messages", "club", () => ({ club_id: f.clubA })],
    ["group_messages", "group", () => ({ group_id: groupA })],
    ["direct_messages", "direct", () => ({ conversation_id: dmA })],
    ["club_admin_messages", "club-admin", () => ({ conversation_id: adminThreadA })],
  ] as const)("rolls back denied moderation without deleting the %s row", async (table, label, scope) => {
    const inserted = await f.memberA.client.from(table).insert({
      ...scope(), author_id: f.memberA.id, text: `Preserve denied ${label}`,
    }).select("id").single();
    expect(inserted.error).toBeNull();

    const denied = await f.outsiderB.client.from(table).delete().eq("id", inserted.data!.id).select("id");
    expect(denied.data).toEqual([]);
    const preserved = await f.memberA.client.from(table).select("id,text").eq("id", inserted.data!.id).single();
    expect(preserved.error).toBeNull();
    expect(preserved.data).toEqual({ id: inserted.data!.id, text: `Preserve denied ${label}` });
  });

  it.each([
    ["team", "team_messages", () => ({ team_id: f.teamA })],
    ["club", "club_messages", () => ({ club_id: f.clubA })],
    ["group", "group_messages", () => ({ group_id: groupA })],
    ["dm", "direct_messages", () => ({ conversation_id: dmA })],
    ["club_admin", "club_admin_messages", () => ({ conversation_id: adminThreadA })],
  ] as const)("enforces exact ownership and scope for %s read markers", async (kind, table, scope) => {
    const inserted = await f.adminA.client.from(table).insert({
      ...scope(), author_id: f.adminA.id, text: `Read marker ${kind}`,
    }).select("id").single();
    expect(inserted.error).toBeNull();

    const ownRead = await f.memberA.client.from("message_reads").insert({
      user_id: f.memberA.id,
      message_kind: kind,
      message_id: inserted.data!.id,
    }).select("id").single();
    expect(ownRead.error).toBeNull();

    const forgedIdentity = await f.memberA.client.from("message_reads").insert({
      user_id: f.adminA.id,
      message_kind: kind,
      message_id: inserted.data!.id,
    });
    expect(forgedIdentity.error).not.toBeNull();

    const hidden = await f.outsiderB.client.from("message_reads").select("id").eq("id", ownRead.data!.id);
    expect(hidden.data).toEqual([]);
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

  it("revokes Team and Club reads and sends after the exact membership role is removed", async () => {
    await service.from("user_roles").delete().eq("user_id", f.memberA.id).eq("club_id", f.clubA).eq("team_id", f.teamA);
    expect((await f.memberA.client.from("team_messages").select("id")).data).toEqual([]);
    expect((await f.memberA.client.from("club_messages").select("id")).data).toEqual([]);
    expect((await f.memberA.client.from("team_messages").insert({ team_id: f.teamA, author_id: f.memberA.id, text: "After team removal" })).error).not.toBeNull();
    expect((await f.memberA.client.from("club_messages").insert({ club_id: f.clubA, author_id: f.memberA.id, text: "After club removal" })).error).not.toBeNull();
  });
});
