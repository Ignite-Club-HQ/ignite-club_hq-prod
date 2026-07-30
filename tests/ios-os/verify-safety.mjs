#!/usr/bin/env node
/**
 * Safety guard for the iOS OS resume regression test.
 *
 * This test runs a DISPOSABLE application in a throwaway iOS Simulator. It
 * must never touch development or production Supabase, never use Apple
 * signing or App Store Connect credentials, and never produce a publishable
 * artifact.
 *
 * Usage:
 *   node tests/ios-os/verify-safety.mjs           # pre-build checks
 *   node tests/ios-os/verify-safety.mjs --post    # + built-output checks
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const WORKSPACE = path.join(HERE, "workspace");
const GENERATED = path.join(WORKSPACE, ".generated", "ios");
const WWW = path.join(WORKSPACE, "www");
const EXPECTED_APP_ID = "app.igniteclubhq.iososresumetest";

const post = process.argv.includes("--post");
const failures = [];
const fail = (m) => failures.push(m);
const ok = (m) => console.log(`  ok  ${m}`);

// ---------------------------------------------------------------------------
// 1. Forbidden environment variables
//
// In CI this is a hard failure: the `ios-os-resume-test` workflow declares no
// environment groups, so nothing Supabase-shaped may be present. Developer
// machines legitimately export these for the real app, so a local run may set
// IOS_ALLOW_LOCAL_ENV=1 to downgrade to a warning. CI never sets it, and the
// built-output scan below still runs either way.
// ---------------------------------------------------------------------------
const ALLOW_LOCAL_ENV = process.env.IOS_ALLOW_LOCAL_ENV === "1" && !process.env.CI;
const FORBIDDEN_PREFIXES = ["SUPABASE", "VITE_SUPABASE", "DATABASE_URL", "PGPASSWORD"];
const leaked = Object.keys(process.env).filter((k) =>
  FORBIDDEN_PREFIXES.some((p) => k === p || k.startsWith(p)),
);
if (leaked.length > 0 && !ALLOW_LOCAL_ENV) {
  fail(
    `forbidden environment variable(s) present: ${leaked.join(", ")}. ` +
      `This workflow must run with no Supabase/database environment group. ` +
      `(Local runs only: set IOS_ALLOW_LOCAL_ENV=1 to downgrade this to a warning.)`,
  );
} else if (leaked.length > 0) {
  console.log(`  WARN  local override: ignoring ${leaked.length} Supabase-shaped env var(s)`);
} else {
  ok("no SUPABASE / VITE_SUPABASE / DATABASE_URL / PGPASSWORD env vars present");
}

// Apple signing / store credentials must not be present either.
const FORBIDDEN_SIGNING = [
  "APP_STORE_CONNECT_PRIVATE_KEY",
  "APP_STORE_CONNECT_KEY_IDENTIFIER",
  "APP_STORE_CONNECT_ISSUER_ID",
  "CERTIFICATE_PRIVATE_KEY",
  "CM_CERTIFICATE",
  "CM_CERTIFICATE_PASSWORD",
  "CM_PROVISIONING_PROFILE",
  "APPLE_ID_PASSWORD",
];
const signing = FORBIDDEN_SIGNING.filter((k) => process.env[k]);
if (signing.length > 0) {
  fail(`Apple signing/publishing credential(s) present: ${signing.join(", ")}`);
} else {
  ok("no Apple signing or App Store Connect credentials present");
}

// ---------------------------------------------------------------------------
// 2. Isolated Capacitor config
// ---------------------------------------------------------------------------
const cfgPath = path.join(WORKSPACE, "capacitor.config.json");
if (!fs.existsSync(cfgPath)) {
  fail(`missing ${path.relative(process.cwd(), cfgPath)}`);
} else {
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  if (cfg.appId !== EXPECTED_APP_ID) {
    fail(`capacitor.config.json appId is "${cfg.appId}", expected "${EXPECTED_APP_ID}"`);
  } else {
    ok(`isolated appId ${EXPECTED_APP_ID}`);
  }
  if (cfg.server && cfg.server.url) {
    fail("capacitor.config.json must not define server.url (no hosted content)");
  } else {
    ok("no server.url in isolated capacitor config");
  }
  if (cfg.webDir !== "www") fail(`capacitor.config.json webDir must be "www"`);
}

// The real app's bundle identifiers must never appear in the fixture.
const realIds = new Set();
const prodCap = path.join(ROOT, "capacitor.config.ts");
if (fs.existsSync(prodCap)) {
  const text = fs.readFileSync(prodCap, "utf8");
  for (const m of text.matchAll(/['"]((?:app|com)\.[A-Za-z0-9._-]+)['"]/g)) {
    if (m[1] !== EXPECTED_APP_ID) realIds.add(m[1]);
  }
}
ok(`tracking ${realIds.size} real bundle identifier(s) as forbidden`);

// ---------------------------------------------------------------------------
// 3. Nothing from the real app leaks in
// ---------------------------------------------------------------------------
for (const stray of ["google-services.json", "GoogleService-Info.plist"]) {
  if (fs.existsSync(path.join(WORKSPACE, stray))) {
    fail(`${stray} must not exist in the isolated workspace`);
  }
}
ok("no Firebase configuration in the isolated workspace");

const wsPkgPath = path.join(WORKSPACE, "package.json");
if (fs.existsSync(wsPkgPath)) {
  const deps = Object.keys(JSON.parse(fs.readFileSync(wsPkgPath, "utf8")).dependencies ?? {});
  const allowed = new Set(["@capacitor/app", "@capacitor/network"]);
  const extra = deps.filter((d) => !allowed.has(d));
  if (extra.length > 0) fail(`unexpected fixture dependencies: ${extra.join(", ")}`);
  else ok("fixture declares only @capacitor/app and @capacitor/network");
}

// ---------------------------------------------------------------------------
// 4. Post-build: scan generated assets for secrets/endpoints
// ---------------------------------------------------------------------------
const BAD_STRINGS = [
  "supabase.co",
  "supabase.in",
  "postgres://",
  "postgresql://",
  "service_role",
  "VITE_SUPABASE_URL=",
];

function scanDir(dir, label, exts) {
  if (!fs.existsSync(dir)) return;
  const stack = [dir];
  let scanned = 0;
  while (stack.length) {
    const cur = stack.pop();
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "build") continue;
        stack.push(full);
        continue;
      }
      if (!exts.test(entry.name)) continue;
      const text = fs.readFileSync(full, "utf8");
      scanned += 1;
      for (const bad of BAD_STRINGS) {
        if (text.includes(bad)) {
          fail(`${label}: "${bad}" found in ${path.relative(process.cwd(), full)}`);
        }
      }
      for (const id of realIds) {
        if (text.includes(id)) {
          fail(`${label}: real bundle identifier "${id}" found in ${path.relative(process.cwd(), full)}`);
        }
      }
    }
  }
  ok(`${label}: scanned ${scanned} file(s) for Supabase/database/bundle-id references`);
}

if (post) {
  if (!fs.existsSync(WWW)) {
    fail(`expected built web assets at ${path.relative(process.cwd(), WWW)}`);
  }
  scanDir(WWW, "web assets", /\.(js|mjs|cjs|html|css|json|map|txt)$/i);

  if (!fs.existsSync(GENERATED)) {
    fail(`expected generated iOS project at ${path.relative(process.cwd(), GENERATED)}`);
  } else {
    ok("generated iOS project exists");

    // Bundle identifier
    const pbx = path.join(GENERATED, "App", "App.xcodeproj", "project.pbxproj");
    if (!fs.existsSync(pbx)) {
      fail("generated App.xcodeproj/project.pbxproj is missing");
    } else {
      const text = fs.readFileSync(pbx, "utf8");
      if (!text.includes(EXPECTED_APP_ID)) {
        fail(`generated project bundle identifier is not ${EXPECTED_APP_ID}`);
      } else {
        ok(`generated PRODUCT_BUNDLE_IDENTIFIER is ${EXPECTED_APP_ID}`);
      }
      for (const id of realIds) {
        if (text.includes(id)) fail(`generated project references real bundle id ${id}`);
      }
      if (/DEVELOPMENT_TEAM = [A-Z0-9]{6,}/.test(text)) {
        fail("generated project has a DEVELOPMENT_TEAM (signing identity) configured");
      } else {
        ok("no DEVELOPMENT_TEAM configured in the generated project");
      }
      if (/PROVISIONING_PROFILE_SPECIFIER = [^;\s"]/.test(text)) {
        fail("generated project has a provisioning profile specifier configured");
      } else {
        ok("no provisioning profile configured in the generated project");
      }
      if (/CODE_SIGN_IDENTITY = "?(iPhone|Apple) (Developer|Distribution)/.test(text)) {
        fail("generated project has a code signing identity configured");
      } else {
        ok("no code signing identity configured in the generated project");
      }
    }

    if (fs.existsSync(path.join(GENERATED, "App", "App", "GoogleService-Info.plist"))) {
      fail("GoogleService-Info.plist was copied into the generated iOS project");
    } else {
      ok("no GoogleService-Info.plist in the generated iOS project");
    }

    // Only the two allowed application plugins may be linked.
    const podfile = path.join(GENERATED, "App", "Podfile");
    const spmPkg = path.join(GENERATED, "App", "CapApp-SPM", "Package.swift");
    const linkText = [podfile, spmPkg]
      .filter((p) => fs.existsSync(p))
      .map((p) => fs.readFileSync(p, "utf8"))
      .join("\n");
    if (linkText) {
      const found = [...linkText.matchAll(/capacitor-([a-z0-9-]+)/gi)].map((m) =>
        m[1].toLowerCase(),
      );
      const allowed = new Set(["ios", "app", "network", "swift-plugin", "cordova"]);
      const extra = [...new Set(found)].filter((p) => !allowed.has(p));
      if (extra.length > 0) fail(`unexpected Capacitor plugin(s) linked: ${extra.join(", ")}`);
      else ok("only @capacitor/app and @capacitor/network application plugins linked");
    }

    scanDir(path.join(GENERATED, "App"), "generated iOS sources", /\.(swift|plist|json|js|html|pbxproj|xcconfig)$/i);
  }
}

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.error("\niOS OS TEST SAFETY CHECK FAILED:\n");
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error("");
  process.exit(1);
}
console.log(`\niOS OS test safety check passed${post ? " (post-build)" : ""}.\n`);
