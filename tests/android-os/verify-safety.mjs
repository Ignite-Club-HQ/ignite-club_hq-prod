#!/usr/bin/env node
/**
 * Safety guard for the Android OS resume regression test.
 *
 * This test runs a DISPOSABLE application in a throwaway emulator. It must
 * never touch development or production Supabase, never use signing
 * credentials, and never produce a publishable artifact.
 *
 * Usage:
 *   node tests/android-os/verify-safety.mjs           # pre-build checks
 *   node tests/android-os/verify-safety.mjs --post    # + built-output checks
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.join(HERE, "workspace");
const GENERATED = path.join(WORKSPACE, ".generated", "android");
const DIST = path.join(WORKSPACE, "dist");
const EXPECTED_APP_ID = "app.igniteclubhq.androidosresumetest";

const post = process.argv.includes("--post");
const failures = [];
const fail = (m) => failures.push(m);
const ok = (m) => console.log(`  ok  ${m}`);

// ---------------------------------------------------------------------------
// 1. Forbidden environment variables
//
// In CI this is a hard failure: the `android-os-resume-test` workflow declares
// no environment groups, so nothing Supabase-shaped may be present. Developer
// machines and the Lovable sandbox legitimately export these for the real app,
// so a local run may set AOS_ALLOW_LOCAL_ENV=1 to downgrade to a warning. CI
// never sets it, and the built-output scan below still runs either way.
// ---------------------------------------------------------------------------
const ALLOW_LOCAL_ENV = process.env.AOS_ALLOW_LOCAL_ENV === "1" && !process.env.CI;
const FORBIDDEN_PREFIXES = ["SUPABASE", "VITE_SUPABASE", "DATABASE_URL", "PGPASSWORD"];
const leaked = Object.keys(process.env).filter((k) =>
  FORBIDDEN_PREFIXES.some((p) => k === p || k.startsWith(p)),
);
if (leaked.length > 0 && !ALLOW_LOCAL_ENV) {
  fail(
    `forbidden environment variable(s) present: ${leaked.join(", ")}. ` +
      `This workflow must run with no Supabase/database environment group. ` +
      `(Local runs only: set AOS_ALLOW_LOCAL_ENV=1 to downgrade this to a warning.)`,
  );
} else if (leaked.length > 0) {
  console.log(`  WARN  local override: ignoring ${leaked.length} Supabase-shaped env var(s)`);
} else {
  ok("no SUPABASE / VITE_SUPABASE / DATABASE_URL / PGPASSWORD env vars present");
}


// Signing / store credentials must not be present either.
const FORBIDDEN_SIGNING = [
  "CM_KEYSTORE",
  "CM_KEYSTORE_PASSWORD",
  "CM_KEY_ALIAS",
  "CM_KEY_PASSWORD",
  "GCLOUD_SERVICE_ACCOUNT_CREDENTIALS",
  "GOOGLE_PLAY_SERVICE_ACCOUNT",
  "APP_STORE_CONNECT_PRIVATE_KEY",
];
const signing = FORBIDDEN_SIGNING.filter((k) => process.env[k]);
if (signing.length > 0) {
  fail(`signing/publishing credential(s) present: ${signing.join(", ")}`);
} else {
  ok("no signing or store-publishing credentials present");
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
    fail("capacitor.config.json must not define server.url (no live reload target)");
  } else {
    ok("no server.url in isolated capacitor config");
  }
}

// ---------------------------------------------------------------------------
// 3. Nothing from the real app leaks in
// ---------------------------------------------------------------------------
for (const stray of ["google-services.json", "GoogleService-Info.plist"]) {
  const p = path.join(WORKSPACE, stray);
  if (fs.existsSync(p)) fail(`${stray} must not exist in the isolated workspace`);
}
ok("no Firebase configuration in the isolated workspace");

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

function scanDir(dir, label) {
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
      if (!/\.(js|mjs|cjs|html|css|json|map|txt|xml|properties|gradle)$/i.test(entry.name)) continue;
      const text = fs.readFileSync(full, "utf8");
      scanned += 1;
      for (const bad of BAD_STRINGS) {
        if (text.includes(bad)) {
          fail(`${label}: "${bad}" found in ${path.relative(process.cwd(), full)}`);
        }
      }
    }
  }
  ok(`${label}: scanned ${scanned} file(s) for Supabase/database references`);
}

if (post) {
  if (!fs.existsSync(DIST)) fail(`expected built web assets at ${path.relative(process.cwd(), DIST)}`);
  scanDir(DIST, "web assets");

  if (!fs.existsSync(GENERATED)) {
    fail(`expected generated Android project at ${path.relative(process.cwd(), GENERATED)}`);
  } else {
    ok("generated Android project exists");

    const gradle = path.join(GENERATED, "app", "build.gradle");
    if (fs.existsSync(gradle)) {
      const text = fs.readFileSync(gradle, "utf8");
      if (!text.includes(EXPECTED_APP_ID)) {
        fail(`generated app/build.gradle applicationId is not ${EXPECTED_APP_ID}`);
      } else {
        ok(`generated applicationId is ${EXPECTED_APP_ID}`);
      }
      if (/signingConfigs\s*\{[\s\S]*?storeFile/.test(text)) {
        fail("generated app/build.gradle introduced a signing configuration");
      } else {
        ok("no signing configuration in the generated Gradle project");
      }
    } else {
      fail("generated app/build.gradle is missing");
    }

    if (fs.existsSync(path.join(GENERATED, "app", "google-services.json"))) {
      fail("google-services.json was copied into the generated Android project");
    } else {
      ok("no google-services.json in the generated Android project");
    }

    // Only the two allowed plugins may be linked into the disposable app.
    const pluginsGradle = path.join(GENERATED, "capacitor.settings.gradle");
    if (fs.existsSync(pluginsGradle)) {
      const text = fs.readFileSync(pluginsGradle, "utf8");
      const found = [...text.matchAll(/capacitor-([a-z0-9-]+)/g)].map((m) => m[1]);
      const allowed = new Set(["android", "app", "network"]);
      const extra = [...new Set(found)].filter((p) => !allowed.has(p));
      if (extra.length > 0) {
        fail(`unexpected Capacitor plugin(s) linked: ${extra.join(", ")}`);
      } else {
        ok("only @capacitor/app and @capacitor/network application plugins linked");
      }
    }

    scanDir(path.join(GENERATED, "app", "src"), "generated Android sources");
  }
}

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.error("\nANDROID OS TEST SAFETY CHECK FAILED:\n");
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error("");
  process.exit(1);
}
console.log(`\nAndroid OS test safety check passed${post ? " (post-build)" : ""}.\n`);
