import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertLocalSupabaseEnvironment } from "./safetyGuard";

const local = assertLocalSupabaseEnvironment(process.env);
export const service = createClient(local.url, local.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export type SyntheticUser = {
  id: string;
  email: string;
  password: string;
  client: SupabaseClient;
};

export type SecurityFixture = {
  adminA: SyntheticUser;
  memberA: SyntheticUser;
  outsiderB: SyntheticUser;
  clubA: string;
  clubB: string;
  teamA: string;
  teamB: string;
  childA: string;
  cleanup: () => Promise<void>;
};

export async function createSyntheticUser(label: string): Promise<SyntheticUser> {
  const nonce = crypto.randomUUID();
  const email = `${label}.${nonce}@local.invalid`;
  const password = `Local-only-${nonce}!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error("Local user creation failed");
  const id = created.data.user.id;
  const profile = await service.from("profiles").insert({ id, display_name: `Synthetic ${label}` });
  if (profile.error) throw profile.error;
  const client = createClient(local.url, local.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session?.access_token) {
    throw signedIn.error ?? new Error("Local user sign-in returned no access token");
  }
  // Keep the synthetic Realtime socket on the same confirmed user token as
  // PostgREST. Explicit propagation avoids SDK/image-version races where a
  // channel briefly opens with the bootstrap anon token after password login.
  client.realtime.setAuth(signedIn.data.session.access_token);
  return { id, email, password, client };
}

export async function createSecurityFixture(): Promise<SecurityFixture> {
  const users: SyntheticUser[] = [];
  const clubIds: string[] = [];
  try {
    const adminA = await createSyntheticUser("admin-a"); users.push(adminA);
    const memberA = await createSyntheticUser("member-a"); users.push(memberA);
    const outsiderB = await createSyntheticUser("outsider-b"); users.push(outsiderB);

    const clubs = await service.from("clubs").insert([
      { name: `Synthetic Club Alpha ${crypto.randomUUID()}`, created_by: adminA.id },
      { name: `Synthetic Club Beta ${crypto.randomUUID()}`, created_by: outsiderB.id },
    ]).select("id");
    if (clubs.error || clubs.data.length !== 2) throw clubs.error ?? new Error("Local club fixture failed");
    const [clubA, clubB] = clubs.data.map((row) => row.id); clubIds.push(clubA, clubB);

    const teams = await service.from("teams").insert([
      { name: "Synthetic Alpha Team", club_id: clubA, created_by: adminA.id },
      { name: "Synthetic Beta Team", club_id: clubB, created_by: outsiderB.id },
    ]).select("id, club_id");
    if (teams.error) throw teams.error;
    const teamA = teams.data.find((row) => row.club_id === clubA)!.id;
    const teamB = teams.data.find((row) => row.club_id === clubB)!.id;

    const roles = await service.from("user_roles").insert([
      { user_id: adminA.id, role: "club_admin", club_id: clubA },
      { user_id: memberA.id, role: "player", club_id: clubA, team_id: teamA },
      { user_id: outsiderB.id, role: "club_admin", club_id: clubB },
    ]);
    if (roles.error) throw roles.error;

    const child = await service.from("children").insert({
      parent_id: adminA.id, name: "Synthetic Child", year_of_birth: 2015,
    }).select("id").single();
    if (child.error) throw child.error;
    const assignment = await service.from("child_team_assignments").insert({ child_id: child.data.id, team_id: teamA });
    if (assignment.error) throw assignment.error;

    return {
      adminA, memberA, outsiderB, clubA, clubB, teamA, teamB, childA: child.data.id,
      cleanup: async () => {
        await service.from("clubs").delete().in("id", clubIds);
        await Promise.all(users.map((user) => service.auth.admin.deleteUser(user.id)));
      },
    };
  } catch (error) {
    await service.from("clubs").delete().in("id", clubIds);
    await Promise.all(users.map((user) => service.auth.admin.deleteUser(user.id)));
    throw error;
  }
}

export async function assertSyntheticLocalMarker() {
  const marker = await service.rpc("is_local_security_test_environment");
  if (marker.error) {
    throw new Error(
      `Refusing to run: local database marker check failed (${marker.error.message})`,
    );
  }
  if (marker.data !== true) {
    throw new Error("Refusing to run: synthetic local database marker returned false");
  }
}
