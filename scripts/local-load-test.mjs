import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertLocalLoadEnvironment,
  failureReason,
  isExpectedLoadNetworkNoise,
  resolveLocalLoadProfile,
  summarizeRealtimeDelivery,
  thinkTimeMs,
  workerStartDelayMs,
  workerUserIndex,
} from "./local-load-safety.mjs";

let local;
try {
  local = assertLocalLoadEnvironment(process.env);
} catch (error) {
  throw new Error(`Refusing load test: ${error instanceof Error ? error.message : error}`);
}
const { name: profileName, profile } = resolveLocalLoadProfile(process.argv.slice(2));
const anonKey = local.anonKey;
const serviceKey = local.serviceKey;

const service = createClient(local.url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const samples = new Map();
const failuresByOperation = new Map();
const failureReasons = new Map();
let totalRequests = 0;
let failedRequests = 0;
let suppressedNetworkLogs = 0;
const createdUserIds = [];
const createdClubIds = [];
const realtimeChannels = [];
const realtimeDeliveryLatencies = [];
const realtimeWaves = [];
let realtimeSubscribed = 0;

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

async function measure(name, operation) {
  const started = performance.now();
  let failed = false;
  try {
    const result = await operation();
    failed = Boolean(result?.error);
    if (failed) throw result.error;
    return result;
  } catch (error) {
    failed = true;
    failuresByOperation.set(name, (failuresByOperation.get(name) ?? 0) + 1);
    const reason = failureReason(error);
    const key = `${name}:${reason}`;
    failureReasons.set(key, (failureReasons.get(key) ?? 0) + 1);
    throw error;
  } finally {
    const duration = performance.now() - started;
    const bucket = samples.get(name) ?? [];
    bucket.push(duration);
    samples.set(name, bucket);
    totalRequests += 1;
    if (failed) failedRequests += 1;
  }
}

async function inBatches(items, size, fn) {
  for (let index = 0; index < items.length; index += size) {
    await Promise.all(items.slice(index, index + size).map(fn));
  }
}

async function createUser(index) {
  const nonce = crypto.randomUUID();
  const email = `load-${index}-${nonce}@local.invalid`;
  const password = `Local-load-${nonce}!`;
  const result = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (result.error || !result.data.user) throw result.error ?? new Error("Local load user creation failed");
  createdUserIds.push(result.data.user.id);
  return { id: result.data.user.id, email, password };
}

async function seed() {
  const marker = await service.rpc("is_local_security_test_environment");
  if (marker.error || marker.data !== true) {
    throw new Error("Refusing load test: synthetic local database marker was not confirmed");
  }

  console.log(`Seeding ${profile.totalClubCardinality} synthetic clubs and ${profile.activeClubs * profile.usersPerClub} synthetic users…`);
  const userIndexes = Array.from(
    { length: profile.activeClubs * profile.usersPerClub },
    (_, index) => index,
  );
  const users = [];
  await inBatches(userIndexes, 10, async (index) => {
    users[index] = await createUser(index);
  });

  const profiles = await service.from("profiles").insert(users.map((user, index) => ({
    id: user.id,
    display_name: `Synthetic Load User ${index}`,
  })));
  if (profiles.error) throw profiles.error;

  const clubRows = Array.from({ length: profile.totalClubCardinality }, (_, index) => ({
    name: `Synthetic Load Club ${index} ${crypto.randomUUID()}`,
    created_by: index < profile.activeClubs
      ? users[index * profile.usersPerClub].id
      : null,
    is_pro: index % 2 === 0,
  }));
  for (let index = 0; index < clubRows.length; index += 250) {
    const inserted = await service.from("clubs")
      .insert(clubRows.slice(index, index + 250)).select("id");
    if (inserted.error) throw inserted.error;
    createdClubIds.push(...inserted.data.map((row) => row.id));
  }
  const activeClubIds = createdClubIds.slice(0, profile.activeClubs);

  const teams = await service.from("teams").insert(activeClubIds.map((clubId, index) => ({
    club_id: clubId,
    name: `Synthetic Load Team ${index}`,
    created_by: users[index * profile.usersPerClub].id,
  }))).select("id, club_id");
  if (teams.error) throw teams.error;

  const roles = [];
  for (let clubIndex = 0; clubIndex < profile.activeClubs; clubIndex += 1) {
    const teamId = teams.data.find((team) => team.club_id === activeClubIds[clubIndex]).id;
    for (let memberIndex = 0; memberIndex < profile.usersPerClub; memberIndex += 1) {
      const user = users[clubIndex * profile.usersPerClub + memberIndex];
      roles.push({
        user_id: user.id,
        role: memberIndex === 0 ? "club_admin" : "player",
        club_id: activeClubIds[clubIndex],
        team_id: memberIndex === 0 ? null : teamId,
      });
      Object.assign(user, { clubId: activeClubIds[clubIndex], teamId, isAdmin: memberIndex === 0 });
    }
  }
  const roleInsert = await service.from("user_roles").insert(roles);
  if (roleInsert.error) throw roleInsert.error;

  const subscriptions = await service.from("club_subscriptions").insert(activeClubIds.map((clubId, index) => ({
    club_id: clubId,
    plan: index % 2 === 0 ? "unlimited" : "starter",
    is_pro: index % 2 === 0,
  })));
  if (subscriptions.error) throw subscriptions.error;

  const events = await service.from("events").insert(activeClubIds.map((clubId, index) => ({
    club_id: clubId,
    created_by: users[index * profile.usersPerClub].id,
    title: `Synthetic Game ${index}`,
    type: "game",
    event_date: new Date(Date.now() + 86_400_000).toISOString(),
  }))).select("id, club_id");
  if (events.error) throw events.error;

  const rsvps = await service.from("rsvps").insert(users.map((user) => ({
    event_id: events.data.find((event) => event.club_id === user.clubId).id,
    user_id: user.id,
    status: "going",
  })));
  if (rsvps.error) throw rsvps.error;

  const notifications = await service.from("notifications").insert(users.map((user) => ({
    user_id: user.id,
    club_id: user.clubId,
    type: "event",
    message: "Synthetic local load notification",
    related_id: events.data.find((event) => event.club_id === user.clubId).id,
    skip_push: true,
  })));
  if (notifications.error) throw notifications.error;

  await inBatches(users, 20, async (user) => {
    const client = createClient(local.url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signedIn = await client.auth.signInWithPassword({
      email: user.email,
      password: user.password,
    });
    if (signedIn.error) throw signedIn.error;
    user.client = client;
    user.eventId = events.data.find((event) => event.club_id === user.clubId).id;
  });
  return users;
}

function chooseScenario() {
  const value = Math.random();
  const authShare = profile.authShare ?? 0.05;
  const businessShare = 1 - authShare;
  if (value < businessShare * (25 / 95)) return "membership";
  if (value < businessShare * (50 / 95)) return "events";
  if (value < businessShare * (65 / 95)) return "entitlement";
  if (value < businessShare * (80 / 95)) return "notifications";
  if (value < businessShare) return "rsvp";
  return "auth";
}

async function runScenario(user, scenario) {
  switch (scenario) {
    case "membership":
      return measure("membership_read", () => user.client.from("user_roles")
        .select("role, club_id, team_id").eq("user_id", user.id));
    case "events":
      return measure("events_read", () => user.client.from("events")
        .select("id, title, type, event_date, is_cancelled")
        .eq("club_id", user.clubId).order("event_date").limit(20));
    case "entitlement":
      return measure("entitlement_read", () =>
        user.client.rpc("has_active_pro_for_club", { _club_id: user.clubId }));
    case "notifications":
      return measure("notifications_read", () => user.client.from("notifications")
        .select("id, type, is_read, created_at")
        .eq("user_id", user.id).order("created_at", { ascending: false }).limit(20));
    case "rsvp":
      return measure("rsvp_write", () => user.client.from("rsvps")
        .update({ status: Math.random() > 0.5 ? "going" : "maybe" })
        .eq("event_id", user.eventId).eq("user_id", user.id));
    case "auth": {
      const client = createClient(local.url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      return measure("auth_sign_in", () => client.auth.signInWithPassword({
        email: user.email,
        password: user.password,
      }));
    }
  }
}

async function exercise(users) {
  const ramp = profile.rampSeconds ?? 0;
  console.log(
    `Running ${profile.virtualUsers} virtual users for ${profile.durationSeconds}s (${profileName}); `
    + `${ramp}s ramp and ${profile.durationSeconds - ramp}s full-load hold…`,
  );
  const deadline = performance.now() + profile.durationSeconds * 1_000;
  const workers = Array.from({ length: profile.virtualUsers }, (_, index) => (async () => {
    const delay = workerStartDelayMs(index, profile);
    if (delay) await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
    const user = users[workerUserIndex(index, profile.virtualUsers, users.length)];
    while (performance.now() < deadline) {
      try {
        await runScenario(user, chooseScenario());
      } catch {
        // Recorded by measure; continue so one failure does not hide the rate.
      }
      await new Promise((resolveDelay) => setTimeout(
        resolveDelay,
        thinkTimeMs(profile),
      ));
    }
  })());
  await Promise.all(workers);
}

async function subscribeRealtimeChannel(user, workerIndex) {
  const channel = user.client.channel(`load-realtime-${workerIndex}-${crypto.randomUUID()}`).on(
    "postgres_changes",
    {
      event: "UPDATE",
      schema: "public",
      table: "events",
      filter: `id=eq.${user.eventId}`,
    },
    (payload) => {
      const token = payload.new?.description;
      const wave = realtimeWaves.find((candidate) => candidate.token === token);
      if (!wave) return;
      wave.deliveries += 1;
      realtimeDeliveryLatencies.push(performance.now() - wave.startedAt);
    },
  );
  realtimeChannels.push({ client: user.client, channel });
  await measure("realtime_subscribe", () => new Promise((resolveSubscription, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Realtime subscription timed out"));
    }, 10_000);
    channel.subscribe((status, error) => {
      if (settled) return;
      if (status === "SUBSCRIBED") {
        settled = true;
        clearTimeout(timer);
        resolveSubscription();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        settled = true;
        clearTimeout(timer);
        reject(error ?? new Error(`Realtime subscription failed: ${status}`));
      }
    });
  }));
  realtimeSubscribed += 1;
}

async function exerciseRealtime(users) {
  console.log(
    `Opening ${profile.virtualUsers} authenticated Realtime connections over `
    + `${profile.rampSeconds}s (${profileName})…`,
  );
  const workers = Array.from({ length: profile.virtualUsers }, (_, index) => (async () => {
    const delay = workerStartDelayMs(index, profile);
    if (delay) await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
    const user = users[workerUserIndex(index, profile.virtualUsers, users.length)];
    try {
      await subscribeRealtimeChannel(user, index);
    } catch {
      // The measured subscription failure remains in the aggregate report.
    }
  })());
  await Promise.all(workers);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));

  const eventIds = [...new Set(
    users
      .filter((_, index) => index % Math.max(1, Math.floor(users.length / profile.virtualUsers)) === 0)
      .map((user) => user.eventId),
  )];
  console.log(
    `Subscribed ${realtimeSubscribed}/${profile.virtualUsers}; emitting `
    + `${profile.fanoutWaves} fan-out waves across ${eventIds.length} event rows…`,
  );

  for (let index = 0; index < profile.fanoutWaves; index += 1) {
    const wave = {
      token: `realtime-wave-${index}-${crypto.randomUUID()}`,
      startedAt: performance.now(),
      deliveries: 0,
      expected: realtimeSubscribed,
    };
    realtimeWaves.push(wave);
    try {
      await measure("realtime_fanout_write", () => service.from("events")
        .update({ description: wave.token }).in("id", eventIds));
    } catch {
      // The write failure remains measured; continue to preserve later waves.
    }
    const deliveryDeadline = performance.now() + 5_000;
    while (wave.deliveries < wave.expected && performance.now() < deliveryDeadline) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
    }
    if (index < profile.fanoutWaves - 1) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, profile.fanoutIntervalMs));
    }
  }
  samples.set("realtime_delivery", realtimeDeliveryLatencies);
}

async function cleanup() {
  await inBatches(realtimeChannels, 50, async ({ client, channel }) => {
    try { await client.removeChannel(channel); } catch {
      // The outer lifecycle still removes the isolated stack if a socket is gone.
    }
  });
  for (let index = 0; index < createdClubIds.length; index += 100) {
    await service.from("clubs").delete().in("id", createdClubIds.slice(index, index + 100));
  }
  await inBatches(createdUserIds, 20, async (id) => {
    await service.auth.admin.deleteUser(id);
  });
}

let exitCode = 0;
let report;
const originalConsoleError = console.error;
try {
  const users = await seed();
  console.error = (...values) => {
    if (isExpectedLoadNetworkNoise(values)) {
      suppressedNetworkLogs += 1;
      return;
    }
    originalConsoleError(...values);
  };
  if (profile.mode === "realtime") {
    await exerciseRealtime(users);
  } else {
    await exercise(users);
  }
  console.error = originalConsoleError;

  console.log("\n========== Local synthetic load summary ==========");
  const operationMetrics = {};
  for (const [name, values] of [...samples.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    operationMetrics[name] = {
      count: values.length,
      p50Ms: percentile(values, 0.5),
      p95Ms: percentile(values, 0.95),
      p99Ms: percentile(values, 0.99),
      failures: failuresByOperation.get(name) ?? 0,
    };
    console.log(
      `${name.padEnd(22)} count=${String(values.length).padStart(6)} `
      + `p50=${percentile(values, 0.5).toFixed(1)}ms `
      + `p95=${percentile(values, 0.95).toFixed(1)}ms `
      + `p99=${percentile(values, 0.99).toFixed(1)}ms`,
    );
  }
  const errorRate = totalRequests ? failedRequests / totalRequests : 1;
  const allReads = [...samples.entries()]
    .filter(([name]) => name.endsWith("_read"))
    .flatMap(([, values]) => values);
  const allWrites = samples.get("rsvp_write") ?? [];
  const auth = samples.get("auth_sign_in") ?? [];
  const {
    expectedDeliveries,
    receivedDeliveries,
    missingDeliveries,
    duplicateDeliveries,
    deliveryRate,
  } = summarizeRealtimeDelivery(realtimeWaves);
  const assertions = profile.mode === "realtime"
    ? [
        ["requests executed", totalRequests > 0],
        ["subscription success >= 99%", realtimeSubscribed / profile.virtualUsers >= 0.99],
        ["fan-out delivery >= 99%", deliveryRate >= 0.99],
        [
          "fan-out delivery p95 < 1000ms",
          realtimeDeliveryLatencies.length > 0
            && percentile(realtimeDeliveryLatencies, 0.95) < 1_000,
        ],
        ["no duplicate fan-out deliveries", duplicateDeliveries === 0],
      ]
    : [
        ["requests executed", totalRequests > 0],
        ["error rate < 1%", errorRate < 0.01],
        ["read p95 < 500ms", percentile(allReads, 0.95) < 500],
        ["write p95 < 750ms", percentile(allWrites, 0.95) < 750],
        ["auth p95 < 1000ms when exercised", auth.length === 0 || percentile(auth, 0.95) < 1_000],
      ];
  report = {
    generatedAt: new Date().toISOString(),
    profile: profileName,
    configuration: profile,
    totalRequests,
    failedRequests,
    errorRate,
    suppressedNetworkLogs,
    operationMetrics,
    failureReasons: Object.fromEntries(
      [...failureReasons.entries()].sort((a, b) => b[1] - a[1]),
    ),
    realtime: profile.mode === "realtime" ? {
      attemptedConnections: profile.virtualUsers,
      subscribedConnections: realtimeSubscribed,
      fanoutWaves: profile.fanoutWaves,
      expectedDeliveries,
      receivedDeliveries,
      missingDeliveries,
      duplicateDeliveries,
      deliveryRate,
      deliveryP50Ms: percentile(realtimeDeliveryLatencies, 0.5),
      deliveryP95Ms: percentile(realtimeDeliveryLatencies, 0.95),
      deliveryP99Ms: percentile(realtimeDeliveryLatencies, 0.99),
    } : undefined,
    assertions: Object.fromEntries(assertions),
  };
  console.log(`total=${totalRequests} failed=${failedRequests} error_rate=${(errorRate * 100).toFixed(2)}%`);
  console.log(`suppressed_known_network_logs=${suppressedNetworkLogs}`);
  if (profile.mode === "realtime") {
    console.log(
      `realtime_subscribed=${realtimeSubscribed}/${profile.virtualUsers} `
      + `delivery_rate=${(deliveryRate * 100).toFixed(2)}% `
      + `missing=${missingDeliveries} duplicates=${duplicateDeliveries}`,
    );
  }
  if (failedRequests) {
    console.log("Failures by operation:");
    for (const [name, count] of [...failuresByOperation.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`  ${name}: ${count}`);
    }
    console.log("Failure reasons:");
    for (const [reason, count] of [...failureReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      console.log(`  ${count} × ${reason}`);
    }
  }
  for (const [label, passed] of assertions) {
    console.log(`${passed ? "PASS" : "FAIL"}: ${label}`);
    if (!passed) exitCode = 1;
  }
} finally {
  console.error = originalConsoleError;
  if (report) {
    const reportDirectory = resolve("test-results", "local-load");
    await mkdir(reportDirectory, { recursive: true });
    const reportPath = resolve(reportDirectory, `${profileName}-latest.json`);
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`Report: ${reportPath}`);
  }
  await cleanup();
}
process.exit(exitCode);
