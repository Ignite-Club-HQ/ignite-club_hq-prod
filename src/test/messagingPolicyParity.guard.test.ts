import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = (name: string) => readFileSync(resolve(process.cwd(), "supabase/migrations", name), "utf8");
const local = () => readFileSync(resolve(process.cwd(), "local-supabase-workspace/supabase/migrations/20260727120000_local_messaging_security.sql"), "utf8");

describe("local messaging policy parity guard", () => {
  it("keeps team and club edits author-only like the production migration history", () => {
    const team = migration("20260330082633_0e5985eb-91a2-40ab-9c0c-f2883f480fb2.sql");
    const club = migration("20260331090548_35bb6cef-ab3d-4ad8-9411-813d5d24dc99.sql");
    expect(team).toContain("USING (author_id = auth.uid())");
    expect(team).toContain("WITH CHECK (author_id = auth.uid())");
    expect(club.match(/USING \(author_id = auth\.uid\(\)\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(local()).toContain("create policy team_change on public.team_messages for update to authenticated using (author_id=auth.uid()) with check (author_id=auth.uid())");
    expect(local()).toContain("create policy club_change on public.club_messages for update to authenticated using (author_id=auth.uid()) with check (author_id=auth.uid())");
  });

  it("retains author plus scoped-admin deletion for team messages", () => {
    const production = migration("20260330082633_0e5985eb-91a2-40ab-9c0c-f2883f480fb2.sql");
    for (const role of ["team_admin", "coach", "club_admin", "app_admin"]) expect(production).toContain(`'${role}'`);
    for (const role of ["team_admin", "coach", "club_admin", "app_admin"]) expect(local()).toContain(`'${role}'`);
    expect(local()).not.toContain("has_role(auth.uid(),'club_admin',(select");
    expect(local().match(/exists\(select 1 from teams t where t\.id=team_messages\.team_id and has_role\(auth\.uid\(\),'club_admin',t\.club_id,null\)\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("retains participant-only DM read/send and author-only mutation", () => {
    const production = migration("20260118094002_b8971fcd-4411-4cd4-8bc2-4947a54fd5a7.sql");
    expect(production).toContain("Users can view messages in their conversations");
    expect(production).toContain("Users can send messages in their conversations");
    expect(production).toContain("Users can update their own messages");
    expect(production).toContain("Users can delete their own messages");
  });
});
