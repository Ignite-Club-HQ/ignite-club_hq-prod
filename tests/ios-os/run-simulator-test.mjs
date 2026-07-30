#!/usr/bin/env node
/**
 * iOS OS resume regression test — Simulator driver.
 *
 * Selects and boots a deterministic iOS Simulator, builds the disposable
 * fixture for the simulator SDK ONLY (no signing, no archive, no device
 * build), installs it, starts Appium, and runs `resume.e2e.mjs`.
 *
 * NETWORK LIMITATION: the Codemagic host network is never disabled, because
 * that would disrupt the build runner. A reliable simulator-only network
 * transition cannot be isolated from the host, so offline→online recovery is
 * covered by the unit/adapter guards (`resumeVsReconnectRecovery.guard.test.ts`,
 * `reactQueryNativeAdapter.resume.test.ts`) and is NOT faked here.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const GENERATED = path.join(HERE, "workspace", ".generated", "ios", "App");
const OUT = path.join(ROOT, "test-results", "ios-os");
const BUNDLE_ID = "app.igniteclubhq.iososresumetest";
const PREFERRED_DEVICE = "iPhone 15";

fs.mkdirSync(OUT, { recursive: true });

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });

const say = (m) => console.log(`\n=== ${m} ===`);

// ---------------------------------------------------------------------------
say("Selecting a simulator");
const devicesJson = JSON.parse(sh("xcrun", ["simctl", "list", "devices", "available", "--json"]));
fs.writeFileSync(path.join(OUT, "simctl-list.txt"), sh("xcrun", ["simctl", "list"]));

const candidates = [];
for (const [runtime, devices] of Object.entries(devicesJson.devices)) {
  if (!runtime.includes("iOS")) continue;
  const version = (runtime.split("iOS-")[1] ?? "").replace(/-/g, ".");
  for (const d of devices) {
    if (!d.isAvailable) continue;
    if (!/^iPhone/.test(d.name)) continue;
    candidates.push({ ...d, version });
  }
}
if (candidates.length === 0) {
  console.error("No available iPhone simulator runtimes found on this machine.");
  process.exit(1);
}
// Deterministic: preferred model first, then newest runtime, then name order.
candidates.sort((a, b) => {
  const pa = a.name === PREFERRED_DEVICE ? 0 : 1;
  const pb = b.name === PREFERRED_DEVICE ? 0 : 1;
  if (pa !== pb) return pa - pb;
  if (a.version !== b.version) return b.version.localeCompare(a.version, undefined, { numeric: true });
  return a.name.localeCompare(b.name);
});
const sim = candidates[0];
if (sim.name !== PREFERRED_DEVICE) {
  console.log(`NOTE: "${PREFERRED_DEVICE}" unavailable — deterministically selected fallback.`);
}
console.log(`Selected simulator: ${sim.name} (iOS ${sim.version}) udid=${sim.udid}`);

say("Booting simulator");
spawnSync("xcrun", ["simctl", "boot", sim.udid], { stdio: "inherit" });
spawnSync("xcrun", ["simctl", "bootstatus", sim.udid, "-b"], { stdio: "inherit" });

// ---------------------------------------------------------------------------
say("Building the isolated app (simulator SDK, Debug, unsigned)");
const derived = path.join(OUT, "DerivedData");
const buildLog = path.join(OUT, "xcodebuild.log");
const workspace = path.join(GENERATED, "App.xcworkspace");
const project = path.join(GENERATED, "App.xcodeproj");
const projectArgs = fs.existsSync(workspace)
  ? ["-workspace", workspace]
  : ["-project", project];

const build = spawnSync(
  "xcodebuild",
  [
    ...projectArgs,
    "-scheme", "App",
    "-configuration", "Debug",
    "-sdk", "iphonesimulator",
    "-destination", `id=${sim.udid}`,
    "-derivedDataPath", derived,
    "CODE_SIGNING_ALLOWED=NO",
    "CODE_SIGNING_REQUIRED=NO",
    "CODE_SIGN_IDENTITY=",
    "build",
  ],
  { encoding: "utf8", maxBuffer: 1024 * 1024 * 64 },
);
fs.writeFileSync(buildLog, `${build.stdout ?? ""}\n${build.stderr ?? ""}`);
if (build.status !== 0) {
  console.error(`xcodebuild failed — see ${path.relative(ROOT, buildLog)}`);
  console.error((build.stdout ?? "").split("\n").slice(-40).join("\n"));
  process.exit(1);
}

const appPath = path.join(derived, "Build", "Products", "Debug-iphonesimulator", "App.app");
if (!fs.existsSync(appPath)) {
  console.error(`built .app not found at ${appPath}`);
  process.exit(1);
}
console.log(`Built ${appPath}`);

say("Installing on the booted simulator");
spawnSync("xcrun", ["simctl", "uninstall", sim.udid, BUNDLE_ID], { stdio: "ignore" });
const install = spawnSync("xcrun", ["simctl", "install", sim.udid, appPath], { stdio: "inherit" });
if (install.status !== 0) process.exit(1);

// ---------------------------------------------------------------------------
say("Starting Appium");
const appiumLog = fs.openSync(path.join(OUT, "appium.log"), "w");
const appium = spawn("appium", ["--port", String(process.env.IOS_OS_APPIUM_PORT ?? 4723), "--relaxed-security"], {
  stdio: ["ignore", appiumLog, appiumLog],
});
const stopAppium = () => { try { appium.kill("SIGTERM"); } catch { /* ignore */ } };
process.on("exit", stopAppium);

const port = Number(process.env.IOS_OS_APPIUM_PORT ?? 4723);
const deadline = Date.now() + 90000;
let up = false;
while (Date.now() < deadline) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/status`);
    if (res.ok) { up = true; break; }
  } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 1500));
}
if (!up) {
  console.error("Appium server did not start — see test-results/ios-os/appium.log");
  stopAppium();
  process.exit(1);
}

// Simulator system log capture for diagnostics.
const sysLog = fs.openSync(path.join(OUT, "simulator-system.log"), "w");
const logProc = spawn(
  "xcrun",
  ["simctl", "spawn", sim.udid, "log", "stream", "--style", "compact", "--predicate",
   `processImagePath CONTAINS "App" OR subsystem CONTAINS "${BUNDLE_ID}"`],
  { stdio: ["ignore", sysLog, sysLog] },
);
process.on("exit", () => { try { logProc.kill("SIGTERM"); } catch { /* ignore */ } });

// ---------------------------------------------------------------------------
say("Running the iOS OS resume regression suite");
const suite = spawnSync(process.execPath, [path.join(HERE, "resume.e2e.mjs")], {
  stdio: "inherit",
  cwd: ROOT,
  env: {
    ...process.env,
    IOS_OS_APP_PATH: appPath,
    IOS_OS_UDID: sim.udid,
    IOS_OS_DEVICE_NAME: sim.name,
    IOS_OS_PLATFORM_VERSION: sim.version,
  },
});

// Supplementary: memory warning, never fatal.
say("Memory warning (supplementary)");
const mem = spawnSync("xcrun", ["simctl", "spawn", sim.udid, "notifyutil", "-p", "com.apple.system.lowmemory"], {
  stdio: "inherit",
});
console.log(mem.status === 0 ? "  memory warning issued" : "  SKIP  runtime does not support notifyutil");

// ---------------------------------------------------------------------------
say("Collecting diagnostics");
try {
  const crashDir = path.join(process.env.HOME ?? "", "Library/Logs/DiagnosticReports");
  if (fs.existsSync(crashDir)) {
    const dest = path.join(OUT, "crash-reports");
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(crashDir)) {
      if (!f.includes("App")) continue;
      const text = fs.readFileSync(path.join(crashDir, f), "utf8");
      if (text.includes(BUNDLE_ID)) fs.copyFileSync(path.join(crashDir, f), path.join(dest, f));
    }
  }
} catch { /* ignore */ }

stopAppium();
try { logProc.kill("SIGTERM"); } catch { /* ignore */ }

process.exit(suite.status === 0 ? 0 : 1);
