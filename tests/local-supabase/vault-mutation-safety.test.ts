import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertSyntheticLocalMarker,
  createSecurityFixture,
  service,
  type SecurityFixture,
} from "./fixtures";

type VaultFile = {
  id: string;
  club_id?: string | null;
  team_id?: string | null;
  mini_league_id?: string | null;
  uploaded_by: string;
  file_url?: string;
  file_size?: number;
  storage_bucket?: string;
  storage_path?: string;
};

describe("local Vault: mutation authorization, lifecycle, and quota isolation", () => {
  let fixture: SecurityFixture;
  const fileIds: string[] = [];
  const leagueIds: string[] = [];

  const createFile = async (values: Omit<VaultFile, "id">) => {
    const result = await service.from("vault_files").insert({
      file_url: `synthetic://${crypto.randomUUID()}`,
      file_size: 1024,
      ...values,
    }).select("id").single();
    if (result.error) throw result.error;
    fileIds.push(result.data.id);
    return result.data.id as string;
  };

  const authorize = async (callerId: string, fileId: string) => {
    const result = await service.rpc("authorize_vault_deletion", {
      _caller_id: callerId,
      _kind: "file",
      _record_id: fileId,
    });
    if (result.error) throw result.error;
    return result.data[0] as { authorized: boolean; reason: string; effective_club_id: string | null };
  };

  beforeAll(async () => {
    await assertSyntheticLocalMarker();
    fixture = await createSecurityFixture();
  });

  afterAll(async () => {
    await service.from("vault_deletion_jobs").delete().in("record_id", fileIds);
    await service.from("vault_storage_reservations").delete().in("club_id", [fixture.clubA, fixture.clubB]);
    await service.from("file_deletion_logs").delete().in("file_id", fileIds);
    await service.from("vault_files").delete().in("id", fileIds);
    await service.from("mini_leagues").delete().in("id", leagueIds);
    await fixture?.cleanup();
  });

  it("allows a club administrator only within their exact club", async () => {
    const ownClubFile = await createFile({ club_id: fixture.clubA, uploaded_by: fixture.memberA.id });
    const otherClubFile = await createFile({ club_id: fixture.clubB, uploaded_by: fixture.outsiderB.id });

    expect(await authorize(fixture.adminA.id, ownClubFile)).toMatchObject({ authorized: true });
    expect(await authorize(fixture.adminA.id, otherClubFile)).toMatchObject({
      authorized: false,
      reason: "forbidden",
    });
  });

  it("rejects missing, unscoped, and conflicting record scopes", async () => {
    const unscoped = await createFile({ uploaded_by: fixture.memberA.id });
    const conflicting = await createFile({
      club_id: fixture.clubA,
      team_id: fixture.teamB,
      uploaded_by: fixture.memberA.id,
    });

    expect(await authorize(fixture.adminA.id, crypto.randomUUID())).toMatchObject({
      authorized: false,
      reason: "not_found",
    });
    expect(await authorize(fixture.adminA.id, unscoped)).toMatchObject({
      authorized: false,
      reason: "no_scope",
    });
    expect(await authorize(fixture.adminA.id, conflicting)).toMatchObject({
      authorized: false,
      reason: "scope_conflict",
    });
  });

  it("honours exact team-admin and mini-league-admin scopes", async () => {
    expect((await service.from("user_roles").insert({
      user_id: fixture.memberA.id,
      role: "team_admin",
      club_id: fixture.clubA,
      team_id: fixture.teamA,
    })).error).toBeNull();

    const ownTeamFile = await createFile({ team_id: fixture.teamA, uploaded_by: fixture.adminA.id });
    const otherTeamFile = await createFile({ team_id: fixture.teamB, uploaded_by: fixture.outsiderB.id });
    expect(await authorize(fixture.memberA.id, ownTeamFile)).toMatchObject({ authorized: true });
    expect(await authorize(fixture.memberA.id, otherTeamFile)).toMatchObject({ authorized: false });

    const league = await service.from("mini_leagues").insert({
      club_id: fixture.clubA,
      name: "Synthetic Local League",
    }).select("id").single();
    if (league.error) throw league.error;
    leagueIds.push(league.data.id);
    expect((await service.from("mini_league_admins").insert({
      mini_league_id: league.data.id,
      user_id: fixture.memberA.id,
    })).error).toBeNull();
    const leagueFile = await createFile({
      mini_league_id: league.data.id,
      uploaded_by: fixture.adminA.id,
    });
    expect(await authorize(fixture.memberA.id, leagueFile)).toMatchObject({ authorized: true });
  });

  it("allows the original uploader of an otherwise valid scoped record", async () => {
    const fileId = await createFile({ club_id: fixture.clubA, uploaded_by: fixture.memberA.id });
    expect(await authorize(fixture.memberA.id, fileId)).toMatchObject({ authorized: true });
  });

  it("denies authenticated clients direct access to privileged deletion RPCs and ledgers", async () => {
    const fileId = await createFile({ club_id: fixture.clubA, uploaded_by: fixture.memberA.id });
    const direct = await fixture.memberA.client.rpc("authorize_vault_deletion", {
      _caller_id: fixture.memberA.id,
      _kind: "file",
      _record_id: fileId,
    });
    expect(direct.error).not.toBeNull();

    const jobs = await fixture.memberA.client.from("vault_deletion_jobs").select("id");
    const reservations = await fixture.memberA.client.from("vault_storage_reservations").select("id");
    expect(jobs.error).toBeNull();
    expect(jobs.data).toEqual([]);
    expect(reservations.error).toBeNull();
    expect(reservations.data).toEqual([]);
  });

  it("creates one idempotent deletion job and one audit record across retries", async () => {
    const fileId = await createFile({
      club_id: fixture.clubA,
      uploaded_by: fixture.memberA.id,
      storage_bucket: "club-media-local",
      storage_path: `${fixture.clubA}/${fixture.memberA.id}/synthetic.pdf`,
    });
    const args = {
      _caller_id: fixture.memberA.id,
      _kind: "file",
      _record_id: fileId,
      _bucket: "club-media-local",
      _object_path: `${fixture.clubA}/${fixture.memberA.id}/synthetic.pdf`,
      _deletion_type: "permanent",
    };
    const first = await service.rpc("begin_vault_deletion", args);
    const retry = await service.rpc("begin_vault_deletion", args);
    expect(first.error).toBeNull();
    expect(retry.error).toBeNull();
    expect(retry.data[0].job_id).toBe(first.data[0].job_id);

    const jobs = await service.from("vault_deletion_jobs").select("id, attempts").eq("record_id", fileId);
    const audits = await service.from("file_deletion_logs").select("id").eq("file_id", fileId);
    expect(jobs.data).toHaveLength(1);
    expect(jobs.data?.[0].attempts).toBe(1);
    expect(audits.data).toHaveLength(1);
  });

  it("preserves metadata on retryable failure and deletes it only on finalization", async () => {
    const fileId = await createFile({ club_id: fixture.clubA, uploaded_by: fixture.memberA.id });
    const begun = await service.rpc("begin_vault_deletion", {
      _caller_id: fixture.memberA.id,
      _kind: "file",
      _record_id: fileId,
      _bucket: "club-media-local",
      _object_path: `${fixture.clubA}/${fixture.memberA.id}/retry.pdf`,
      _deletion_type: "permanent",
    });
    expect(begun.error).toBeNull();
    const jobId = begun.data[0].job_id as string;

    expect((await service.rpc("fail_vault_deletion", {
      _job_id: jobId,
      _error_code: "synthetic_storage_timeout",
    })).error).toBeNull();
    expect((await service.from("vault_files").select("id").eq("id", fileId).maybeSingle()).data?.id).toBe(fileId);

    expect((await service.rpc("finalize_vault_deletion", { _job_id: jobId })).data).toBe("completed");
    expect((await service.from("vault_files").select("id").eq("id", fileId).maybeSingle()).data).toBeNull();
    expect((await service.from("vault_deletion_jobs").select("status").eq("id", jobId).single()).data?.status)
      .toBe("completed");
  });

  it("enforces the free quota atomically across concurrent reservations", async () => {
    const twentyMb = 20 * 1024 * 1024;
    const [a, b] = await Promise.all([
      fixture.memberA.client.rpc("reserve_vault_storage", { _club_id: fixture.clubA, _bytes: twentyMb }),
      fixture.memberA.client.rpc("reserve_vault_storage", { _club_id: fixture.clubA, _bytes: twentyMb }),
    ]);
    const successes = [a, b].filter((result) => result.error === null);
    const failures = [a, b].filter((result) => result.error !== null);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0].error?.message).toContain("quota_exceeded");
  });

  it("denies cross-club quota reservation and prevents another user settling it", async () => {
    const forbidden = await fixture.outsiderB.client.rpc("reserve_vault_storage", {
      _club_id: fixture.clubA,
      _bytes: 1,
    });
    expect(forbidden.error).not.toBeNull();

    const reserved = await fixture.memberA.client.rpc("reserve_vault_storage", {
      _club_id: fixture.clubA,
      _bytes: 1024,
    });
    expect(reserved.error).toBeNull();
    const reservationId = reserved.data[0].reservation_id as string;
    expect((await fixture.outsiderB.client.rpc("settle_vault_storage", {
      _reservation_id: reservationId,
      _committed: true,
    })).error).toBeNull();
    expect((await service.from("vault_storage_reservations").select("status").eq("id", reservationId).single()).data?.status)
      .toBe("active");
    expect((await fixture.memberA.client.rpc("settle_vault_storage", {
      _reservation_id: reservationId,
      _committed: true,
    })).error).toBeNull();
    expect((await service.from("vault_storage_reservations").select("status").eq("id", reservationId).single()).data?.status)
      .toBe("committed");
  });
});
