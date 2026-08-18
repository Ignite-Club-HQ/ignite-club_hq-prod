const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

export const LOCAL_LOAD_PROFILES = Object.freeze({
  smoke: {
    virtualUsers: 5, durationSeconds: 15, activeClubs: 2,
    usersPerClub: 5, totalClubCardinality: 25,
  },
  baseline: {
    virtualUsers: 50, durationSeconds: 60, activeClubs: 10,
    usersPerClub: 20, totalClubCardinality: 100,
  },
  gameday: {
    virtualUsers: 200, durationSeconds: 120, activeClubs: 25,
    usersPerClub: 20, totalClubCardinality: 500, authShare: 0.01,
  },
  authstorm: {
    virtualUsers: 200, durationSeconds: 120, activeClubs: 25,
    usersPerClub: 20, totalClubCardinality: 500, authShare: 0.05,
  },
  scale: {
    virtualUsers: 500, durationSeconds: 180, activeClubs: 50,
    usersPerClub: 20, totalClubCardinality: 1_000, authShare: 0.01,
    rampSeconds: 120,
  },
  realistic500: {
    virtualUsers: 500, durationSeconds: 300, activeClubs: 50,
    usersPerClub: 20, totalClubCardinality: 1_000, authShare: 0,
    rampSeconds: 180, thinkTimeMinMs: 3_000, thinkTimeMaxMs: 10_000,
  },
  realistic1000: {
    virtualUsers: 1_000, durationSeconds: 300, activeClubs: 50,
    usersPerClub: 20, totalClubCardinality: 1_000, authShare: 0,
    rampSeconds: 180, thinkTimeMinMs: 3_000, thinkTimeMaxMs: 10_000,
  },
  realtime500: {
    mode: "realtime",
    virtualUsers: 500, durationSeconds: 120, activeClubs: 50,
    usersPerClub: 20, totalClubCardinality: 1_000, authShare: 0,
    rampSeconds: 60, fanoutWaves: 10, fanoutIntervalMs: 3_000,
  },
});

export function workerStartDelayMs(workerIndex, profile) {
  if (!Number.isInteger(workerIndex) || workerIndex < 0 || workerIndex >= profile.virtualUsers) {
    throw new Error("worker index is outside the selected profile");
  }
  const rampSeconds = profile.rampSeconds ?? 0;
  if (rampSeconds <= 0 || profile.virtualUsers <= 1) return 0;
  return Math.round((workerIndex / (profile.virtualUsers - 1)) * rampSeconds * 1_000);
}

export function workerUserIndex(workerIndex, virtualUsers, availableUsers) {
  if (
    !Number.isInteger(workerIndex)
    || !Number.isInteger(virtualUsers)
    || !Number.isInteger(availableUsers)
    || workerIndex < 0
    || virtualUsers < 1
    || availableUsers < 1
    || workerIndex >= virtualUsers
  ) {
    throw new Error("invalid worker-to-user distribution");
  }
  return Math.floor((workerIndex * availableUsers) / virtualUsers) % availableUsers;
}

export function failureReason(error) {
  const values = [];
  let current = error;
  for (let depth = 0; current && depth < 4; depth += 1) {
    for (const value of [
      current.code,
      current.status,
      current.name,
      current.message,
      current.details,
      current.hint,
    ]) {
      if (value !== undefined && value !== null && String(value).trim()) values.push(String(value));
    }
    current = current.cause;
  }
  return [...new Set(values)].join(":").slice(0, 180) || "unknown";
}

export function thinkTimeMs(profile, randomValue = Math.random()) {
  const minimum = profile.thinkTimeMinMs ?? 100;
  const maximum = profile.thinkTimeMaxMs ?? 300;
  if (
    !Number.isFinite(minimum)
    || !Number.isFinite(maximum)
    || minimum < 0
    || maximum < minimum
    || randomValue < 0
    || randomValue > 1
  ) {
    throw new Error("invalid local load pacing configuration");
  }
  return minimum + randomValue * (maximum - minimum);
}

export function isExpectedLoadNetworkNoise(values) {
  const text = values.map((value) => {
    if (value instanceof Error) return failureReason(value);
    try { return typeof value === "string" ? value : JSON.stringify(value); } catch { return String(value); }
  }).join(" ");
  return /fetch failed|UND_ERR_SOCKET|ECONNRESET|other side closed/i.test(text);
}

export function summarizeRealtimeDelivery(waves) {
  const expectedDeliveries = waves.reduce((sum, wave) => sum + wave.expected, 0);
  const receivedDeliveries = waves.reduce(
    (sum, wave) => sum + Math.min(wave.deliveries, wave.expected),
    0,
  );
  const duplicateDeliveries = waves.reduce(
    (sum, wave) => sum + Math.max(0, wave.deliveries - wave.expected),
    0,
  );
  const missingDeliveries = Math.max(0, expectedDeliveries - receivedDeliveries);
  return {
    expectedDeliveries,
    receivedDeliveries,
    missingDeliveries,
    duplicateDeliveries,
    deliveryRate: expectedDeliveries ? receivedDeliveries / expectedDeliveries : 0,
  };
}

function requireKey(value, prefix) {
  const valid = typeof value === "string"
    && (value.split(".").length === 3
      || (value.startsWith(prefix) && value.length > prefix.length + 16));
  if (!valid) throw new Error("generated local API keys are required");
  return value;
}

export function assertLocalLoadEnvironment(source) {
  let url;
  try { url = new URL(source.LOCAL_SUPABASE_URL); } catch { url = null; }
  if (
    !url
    || url.protocol !== "http:"
    || !LOOPBACK.has(url.hostname)
    || url.port !== "54321"
    || url.pathname !== "/"
    || url.username
    || url.password
  ) {
    throw new Error("target must be local HTTP on port 54321");
  }
  return {
    url: url.origin,
    anonKey: requireKey(source.LOCAL_SUPABASE_ANON_KEY, "sb_publishable_"),
    serviceKey: requireKey(source.LOCAL_SUPABASE_SERVICE_ROLE_KEY, "sb_secret_"),
  };
}

export function resolveLocalLoadProfile(args) {
  const name = args.find((arg) => arg.startsWith("--profile="))?.split("=")[1] ?? "smoke";
  const profile = LOCAL_LOAD_PROFILES[name];
  if (!profile) {
    throw new Error(`Unknown load profile "${name}". Use ${Object.keys(LOCAL_LOAD_PROFILES).join(", ")}`);
  }
  return { name, profile };
}
