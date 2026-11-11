import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  PROD_MEMBER_II_ORIGIN, DEV_FRONTEND_II_CANISTER,
  PRODUCTION_WEBSITE_ORIGINS, DEV_APP_ORIGINS,
  alternativeOriginsForBuild, derivationOriginForBuild,
} from "./iiOriginPolicy.mjs";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const generator = fs.readFileSync(path.join(dirname, "prepare-canister-dist.mjs"), "utf8");
const prodCanister = "pjx2u-tiaaa-aaaac-qhj3a-cai"; // known PROD frontend alias is included in website origins

test("DEV allows DEV previews, not production marketing site or production app", () => {
  const origins = alternativeOriginsForBuild({ isProdBuild: false, frontendCanisterId: DEV_FRONTEND_II_CANISTER });
  assert.ok(DEV_APP_ORIGINS.every(origin => origins.includes(origin)));
  assert.ok(PRODUCTION_WEBSITE_ORIGINS.every(origin => !origins.includes(origin)));
  assert.ok(!origins.includes(PROD_MEMBER_II_ORIGIN));
  assert.equal(derivationOriginForBuild({ isProdBuild: false, frontendCanisterId: DEV_FRONTEND_II_CANISTER }),
    "https://proe7-kqaaa-aaaas-qg6gq-cai.icp0.io");
  assert.equal(new Set(origins).size, origins.length, "No duplicate origins");
});
test("PROD admits production marketing website and app, but not DEV previews", () => {
  const origins = alternativeOriginsForBuild({ isProdBuild: true, frontendCanisterId: prodCanister });
  assert.ok(PRODUCTION_WEBSITE_ORIGINS.every(origin => origins.includes(origin)));
  assert.ok(origins.includes(PROD_MEMBER_II_ORIGIN));
  assert.ok(DEV_APP_ORIGINS.every(origin => !origins.includes(origin)));
  assert.equal(derivationOriginForBuild({ isProdBuild: true, frontendCanisterId: prodCanister }), PROD_MEMBER_II_ORIGIN);
  assert.equal(new Set(origins).size, origins.length, "No duplicate origins");
});
test("unknown frontend ID never inherits DEV preview aliases", () => {
  const origins = alternativeOriginsForBuild({ isProdBuild: false, frontendCanisterId: "zzzzz-zzzzz-zzzzz-zzzzz-cai" });
  assert.ok(DEV_APP_ORIGINS.every(origin => !origins.includes(origin)));
  assert.ok(PRODUCTION_WEBSITE_ORIGINS.every(origin => !origins.includes(origin)));
});
test("generator uses explicit environment policy, not an always-on site whitelist", () => {
  assert.match(generator, /alternativeOriginsForBuild\(\{ isProdBuild, frontendCanisterId \}\)/);
  assert.match(generator, /derivationOriginForBuild\(\{ isProdBuild, frontendCanisterId \}\)/);
  assert.match(generator, /FRONTEND_CANISTER_ID is required for PROD frontend builds/);
  assert.doesNotMatch(generator, /alternativeOrigins:\s*\[\s*`https:/);
});
