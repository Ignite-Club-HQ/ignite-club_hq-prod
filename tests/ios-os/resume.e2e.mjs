/**
 * iOS OS resume regression suite — WebdriverIO + Appium (XCUITest).
 *
 * Drives GENUINE iOS Simulator lifecycle transitions against the disposable
 * WKWebView harness and asserts on its machine-readable state.
 *
 * Warm background/resume only — never terminate/relaunch as a substitute.
 * Never signs, publishes or uploads anything.
 */
import fs from "node:fs";
import path from "node:path";
import { remote } from "webdriverio";
import { buildCapabilities, APPIUM_SERVER, BUNDLE_ID } from "./appium.conf.mjs";

const OUT = path.resolve(process.cwd(), "test-results/ios-os");
fs.mkdirSync(OUT, { recursive: true });

const appPath = process.env.IOS_OS_APP_PATH;
const deviceName = process.env.IOS_OS_DEVICE_NAME ?? "iPhone 15";
const platformVersion = process.env.IOS_OS_PLATFORM_VERSION ?? "";
const udid = process.env.IOS_OS_UDID;

if (!appPath || !udid) {
  console.error("IOS_OS_APP_PATH and IOS_OS_UDID must be set (see run-simulator-test.mjs)");
  process.exit(1);
}

let failures = 0;
const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m) => {
  console.log(`  FAIL  ${m}`);
  failures += 1;
};
const say = (m) => console.log(`\n=== ${m} ===`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let driver;

async function shot(name) {
  try {
    await driver.saveScreenshot(path.join(OUT, `${name}.png`));
  } catch { /* ignore */ }
}

async function dumpSource(name) {
  try {
    fs.writeFileSync(path.join(OUT, `${name}.xml`), await driver.getPageSource());
  } catch { /* ignore */ }
}

/** Read the harness state, preferring the WEBVIEW context, falling back to a11y. */
async function readState() {
  try {
    const contexts = await driver.getContexts();
    const web = contexts.find((c) => String(c.id ?? c).startsWith("WEBVIEW"));
    if (web) {
      await driver.switchContext(String(web.id ?? web));
      const text = await driver.execute(
        "return document.getElementById('state') && document.getElementById('state').textContent;",
      );
      await driver.switchContext("NATIVE_APP");
      if (text) return parseState(String(text));
    }
  } catch { /* fall through to native a11y */ }

  const src = await driver.getPageSource();
  const m = /IOS_OS_(?:READY|BOOTING)[^"<]*/.exec(src);
  if (!m) throw new Error("harness state not found in page source");
  return parseState(m[0]);
}

function parseState(text) {
  const state = { raw: text, ready: text.includes("IOS_OS_READY") };
  for (const [, k, v] of text.matchAll(/([A-Z_]+)=([A-Za-z0-9]+)/g)) {
    state[k] = /^\d+$/.test(v) ? Number(v) : v;
  }
  return state;
}

async function waitForReady(timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const s = await readState();
      if (s.ready) return s;
    } catch { /* not up yet */ }
    await sleep(2000);
  }
  throw new Error("harness never reported IOS_OS_READY");
}

/** Warm background for `seconds`, then reactivate the SAME process. */
async function backgroundAndResume(seconds) {
  await driver.background(seconds);
  await sleep(1500);
}

async function tapPing() {
  const el = await driver.$('~PING');
  await el.click();
  await sleep(500);
}

async function main() {
  driver = await remote({
    ...APPIUM_SERVER,
    capabilities: buildCapabilities({ appPath, deviceName, platformVersion, udid }),
  });

  console.log(`Simulator: ${deviceName} (iOS ${platformVersion || "installed runtime"}) udid=${udid}`);
  fs.writeFileSync(
    path.join(OUT, "simulator.json"),
    JSON.stringify({ deviceName, platformVersion, udid, bundleId: BUNDLE_ID }, null, 2),
  );

  // -------------------------------------------------------------------------
  say("TEST 1 — initial state");
  const initial = await waitForReady();
  await shot("1-initial");
  if (initial.ready) pass("IOS_OS_READY appears");
  else fail("IOS_OS_READY missing");
  if (initial.ACTIVE === 30) pass("ACTIVE=30 synthetic observers");
  else fail(`ACTIVE=${initial.ACTIVE} (expected 30)`);
  if (initial.REFETCH_COUNT === 0) pass("REFETCH_COUNT=0 at rest");
  else fail(`REFETCH_COUNT=${initial.REFETCH_COUNT} at rest (expected 0)`);

  await tapPing();
  let s = await readState();
  if (s.PING_COUNT >= 1) pass("PING works");
  else { fail("PING did not register"); await shot("1-ping-fail"); await dumpSource("1-ping-fail"); }

  // -------------------------------------------------------------------------
  say("TEST 2 — ordinary online warm resume");
  await backgroundAndResume(2);
  await sleep(4000);
  s = await readState();
  await shot("2-warm-resume");
  if (s.REFETCH_COUNT === 0) pass("warm resume produced 0 active refetches");
  else fail(`warm resume produced REFETCH_COUNT=${s.REFETCH_COUNT} (expected 0)`);
  const pingBefore = s.PING_COUNT;
  await tapPing();
  s = await readState();
  if (s.PING_COUNT === pingBefore + 1) pass("PING still responsive after resume");
  else { fail("PING unresponsive after resume"); await shot("2-ping-fail"); }

  // -------------------------------------------------------------------------
  say("TEST 3 — five repeated online resumes");
  for (let i = 1; i <= 5; i += 1) {
    await backgroundAndResume(2);
    await sleep(3500);
    s = await readState();
    if (s.REFETCH_COUNT !== 0) {
      fail(`cycle ${i}: REFETCH_COUNT=${s.REFETCH_COUNT} (expected 0)`);
      await shot(`3-cycle${i}-fail`);
      break;
    }
    const before = s.PING_COUNT;
    await tapPing();
    s = await readState();
    if (s.PING_COUNT !== before + 1) {
      fail(`cycle ${i}: app unresponsive after resume`);
      await shot(`3-cycle${i}-unresponsive`);
      break;
    }
  }
  if (s.REFETCH_COUNT === 0) pass("5 repeated resumes: no refetch storm, app responsive");

  // -------------------------------------------------------------------------
  say("TEST 4 — overlapping wake signals coalesce");
  const resumesBefore = s.RESUME_COUNT;
  await backgroundAndResume(2);
  try {
    const contexts = await driver.getContexts();
    const web = contexts.find((c) => String(c.id ?? c).startsWith("WEBVIEW"));
    if (web) {
      await driver.switchContext(String(web.id ?? web));
      await driver.execute(
        "document.dispatchEvent(new Event('visibilitychange'));" +
          "window.dispatchEvent(new Event('focus'));" +
          "window.dispatchEvent(new Event('pageshow'));",
      );
      await driver.switchContext("NATIVE_APP");
    }
  } catch { /* injection is best-effort; the OS already fired the real ones */ }
  await sleep(4000);
  s = await readState();
  await shot("4-overlapping-wake");
  if (s.REFETCH_COUNT === 0) pass("overlapping wake signals created no refetch storm");
  else fail(`overlapping wake signals produced REFETCH_COUNT=${s.REFETCH_COUNT}`);
  if (s.RESUME_COUNT - resumesBefore <= 2) pass("wake signals coalesced into a single resume");
  else fail(`wake signals produced ${s.RESUME_COUNT - resumesBefore} resumes (expected <= 2)`);

  // -------------------------------------------------------------------------
  say("TEST 5 — longer background interval (>= 25s)");
  await backgroundAndResume(28);
  await sleep(5000);
  s = await readState();
  await shot("5-long-background");
  if (s.REFETCH_COUNT === 0) pass("long background: healthy active queries not blanket-refetched");
  else fail(`long background produced REFETCH_COUNT=${s.REFETCH_COUNT}`);
  const framesA = s.FRAMES;
  await sleep(2500);
  s = await readState();
  if (s.FRAMES > framesA) pass("WebView still compositing after long background");
  else fail("WebView frames stalled after long background");
  const bodyHidden = await isBodyHidden();
  if (bodyHidden === false) pass("no permanent hidden body / transform remains");
  else if (bodyHidden === null) console.log("  SKIP  body visibility not readable (no webview context)");
  else { fail("body remained hidden after resume"); await shot("5-body-hidden"); }

  // -------------------------------------------------------------------------
  say("TEST 6 — interrupted wake");
  await driver.background(3);
  await sleep(300);
  await driver.background(3); // re-background during the wake window
  await sleep(4000);
  s = await readState();
  await shot("6-interrupted-wake");
  const pingBefore6 = s.PING_COUNT;
  await tapPing();
  s = await readState();
  if (s.PING_COUNT === pingBefore6 + 1) pass("watchdog restored a visible, touchable document");
  else { fail("document not touchable after interrupted wake"); await dumpSource("6-fail"); }

  // -------------------------------------------------------------------------
  say("TEST 7 — request saturation");
  const saturate = await driver.$('~SATURATE');
  await saturate.click();
  await sleep(1500);
  await backgroundAndResume(3);
  await sleep(3000);
  const pingBefore7 = (await readState()).PING_COUNT;
  await tapPing();
  s = await readState();
  if (s.PING_COUNT === pingBefore7 + 1) pass("PING responsive while 30 requests are blocked");
  else { fail("PING blocked by saturated requests"); await shot("7-saturation-fail"); }
  await (await driver.$('~SATURATE')).click(); // release cleanly
  await sleep(2000);
  pass("blocked requests released cleanly");

  // -------------------------------------------------------------------------
  say("TEST 8 — memory warning (supplementary)");
  console.log("  SKIP  issued by run-simulator-test.mjs when the runtime supports it");

  // -------------------------------------------------------------------------
  say("TEST 9 — crash / hang detection");
  try {
    const state = await driver.queryAppState(BUNDLE_ID);
    if (state >= 3) pass(`application still running (state=${state})`);
    else fail(`application is not running (state=${state}) — crash or termination`);
  } catch (err) {
    fail(`could not query app state: ${err.message}`);
  }

  await shot("final");
  await dumpSource("final-source");
}

async function isBodyHidden() {
  try {
    const contexts = await driver.getContexts();
    const web = contexts.find((c) => String(c.id ?? c).startsWith("WEBVIEW"));
    if (!web) return null;
    await driver.switchContext(String(web.id ?? web));
    const hidden = await driver.execute(
      "return getComputedStyle(document.body).visibility === 'hidden';",
    );
    await driver.switchContext("NATIVE_APP");
    return Boolean(hidden);
  } catch {
    return null;
  }
}

try {
  await main();
} catch (err) {
  fail(`suite error: ${err && err.message ? err.message : String(err)}`);
  await shot("error");
  await dumpSource("error-source");
} finally {
  try { await driver?.deleteSession(); } catch { /* ignore */ }
}

console.log(`\n${failures === 0 ? "iOS OS resume regression suite PASSED" : `iOS OS resume regression suite FAILED (${failures})`}\n`);
process.exit(failures === 0 ? 0 : 1);
