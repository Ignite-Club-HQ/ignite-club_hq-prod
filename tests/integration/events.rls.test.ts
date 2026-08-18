import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";

const ALLOWED_DEV_PROJECT_REF = "ecsdwrarzfexssxtrymj";
const TEST_PREFIX = `e2e_stage2_${Date.now()}`;

type DemoUser = {
  email: string;
  password: string;
  roles?: string[];
  clubs?: string[];
};

function readEnvFile() {
  const values: Record<string, string> = {};
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    values[line.slice(0, separator)] = line
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
  }
  return values;
}

function projectRef(url: string) {
  return new URL(url).hostname.split(".")[0];
}

async function authenticatedClient(url: string, key: string, account: DemoUser) {
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email: account.email,
    password: account.password,
  });
  if (error) throw new Error(`Could not authenticate Stage 2 fixture: ${error.message}`);
  return client;
}

// SAFETY: This legacy suite targets a hosted development project and must not
// run. Retained temporarily as historical test design until it can be replaced
// by a synthetic, local-Docker-only integration suite.
describe.skip(
  "Stage 2: event and RSVP RLS on the dev database",
  () => {
    let admin: SupabaseClient;
    let member: SupabaseClient;
    let clubId: string;
    let adminId: string;
    let memberId: string;
    let eventId: string | null = null;

    beforeAll(async () => {
      const env = readEnvFile();
      const url = env.VITE_SUPABASE_URL;
      const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
      if (!url || !key) throw new Error("Stage 2 requires the configured Supabase URL and publishable key");
      if (projectRef(url) !== ALLOWED_DEV_PROJECT_REF) {
        throw new Error(`Refusing Stage 2 mutations: ${projectRef(url)} is not the allow-listed dev project`);
      }

      const response = await fetch(`${url}/functions/v1/generate-demo-data`, {
        method: "POST",
        headers: { "content-type": "application/json", apikey: key },
        body: JSON.stringify({ action: "list-public" }),
      });
      if (!response.ok) throw new Error(`Could not load demo fixtures (${response.status})`);
      const users = ((await response.json()) as { users?: DemoUser[] }).users ?? [];
      const riverside = users.filter((user) => user.clubs?.includes("Riverside FC"));
      const adminAccount = riverside.find((user) => user.roles?.includes("Club Admin"));
      const memberAccount = riverside.find(
        (user) => user.roles?.includes("Player") && !user.roles?.some((role) => ["Club Admin", "Team Admin", "Coach"].includes(role)),
      );
      if (!adminAccount || !memberAccount) throw new Error("Riverside FC lacks required admin/member demo fixtures");

      admin = await authenticatedClient(url, key, adminAccount);
      member = await authenticatedClient(url, key, memberAccount);
      adminId = (await admin.auth.getUser()).data.user!.id;
      memberId = (await member.auth.getUser()).data.user!.id;

      const { data: club, error } = await admin.from("clubs").select("id").eq("name", "Riverside FC").single();
      if (error || !club) throw new Error(`Could not resolve Riverside FC: ${error?.message}`);
      clubId = club.id;
    });

    afterAll(async () => {
      if (eventId && admin) await admin.from("events").delete().eq("id", eventId);
      await Promise.all([admin?.auth.signOut(), member?.auth.signOut()]);
    });

    it("denies event creation to an ordinary club member", async () => {
      const { error } = await member.from("events").insert({
        title: `${TEST_PREFIX}_unauthorised`,
        type: "social",
        club_id: clubId,
        created_by: memberId,
        event_date: "2099-07-19T12:00:00.000Z",
      });
      expect(error, "RLS must reject ordinary-member event creation").not.toBeNull();
    });

    it("allows a club admin to create, edit and cancel an event", async () => {
      const created = await admin
        .from("events")
        .insert({
          title: `${TEST_PREFIX}_admin_event`,
          type: "social",
          club_id: clubId,
          created_by: adminId,
          event_date: "2099-07-19T12:00:00.000Z",
          address: "Stage 2 Local Test Ground",
        })
        .select("id, title, is_cancelled")
        .single();
      expect(created.error).toBeNull();
      eventId = created.data!.id;

      const edited = await admin.from("events").update({ description: "Stage 2 edited" }).eq("id", eventId).select("description").single();
      expect(edited).toMatchObject({ error: null, data: { description: "Stage 2 edited" } });

      const cancelled = await admin.from("events").update({ is_cancelled: true }).eq("id", eventId).select("is_cancelled").single();
      expect(cancelled).toMatchObject({ error: null, data: { is_cancelled: true } });
    });

    it("allows a member to view the club event but not edit it", async () => {
      const visible = await member.from("events").select("id, title").eq("id", eventId!).single();
      expect(visible.error).toBeNull();
      expect(visible.data?.title).toBe(`${TEST_PREFIX}_admin_event`);

      const changed = await member.from("events").update({ title: `${TEST_PREFIX}_hijacked` }).eq("id", eventId!).select("id");
      expect(changed.error).toBeNull();
      expect(changed.data).toEqual([]);
    });

    it("allows a member to create, update and remove only their own RSVP", async () => {
      const inserted = await member.from("rsvps").insert({ event_id: eventId!, user_id: memberId, status: "going" }).select("id, status").single();
      expect(inserted.error).toBeNull();
      const rsvpId = inserted.data!.id;

      const updated = await member.from("rsvps").update({ status: "not_going" }).eq("id", rsvpId).select("status").single();
      expect(updated).toMatchObject({ error: null, data: { status: "not_going" } });

      const removed = await member.from("rsvps").delete().eq("id", rsvpId).select("id").single();
      expect(removed.error).toBeNull();
    });
  },
);
