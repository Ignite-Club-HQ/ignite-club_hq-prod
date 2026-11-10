import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const club = fs.readFileSync(path.join(root, "backend/club_domain/src/main.mo"), "utf8");
const identity = fs.readFileSync(path.join(root, "backend/identity_access/src/lib.rs"), "utf8");
const guide = fs.readFileSync(path.join(root, "docs/integrations/icp-mcp-ignite-onboarding.md"), "utf8");
const apiDoc = club.match(/public query func getApiDoc\(\) : async Text \{([\s\S]*?)\n  \};/)?.[1];
assert.ok(apiDoc, "club_domain must expose getApiDoc() to the ICP plugin");

test("guide refers to existing Candid operations", () => {
  for (const method of ["register_account", "whoami", "get_profile", "my_terms_acceptance"]) {
    assert.match(identity, new RegExp("\\bfn " + method + "\\s*\\("));
    assert.ok(guide.includes(method), "guide omits " + method);
  }
  for (const method of ["create_club", "save_team", "create_team_invite_link", "list_my_personal_teams"]) {
    assert.match(club, new RegExp("\\bfunc " + method + "\\s*\\("));
    assert.ok(guide.includes(method), "guide omits " + method);
  }
});

test("discovery doc covers account and legal consent setup", () => {
  for (const method of ["identity_access.whoami", "register_account", "get_profile", "my_terms_acceptance"]) {
    assert.ok(apiDoc.includes(method), "getApiDoc omits " + method);
  }
  assert.match(apiDoc, /Do not claim consent for the user/);
});

test("discovery doc does not treat raw club creation as provisioned", () => {
  assert.match(apiDoc, /group placement is active/);
  assert.match(apiDoc, /Never fall back to an unverified shared canister/);
  assert.match(apiDoc, /call does not finish these/);
  assert.match(club, /creatorPlacementAllowed\(caller, id\)/);
});

test("personal team invitation limitation is explicit", () => {
  assert.match(club, /team\.club_id == ""/);
  assert.match(apiDoc, /Personal\/clubless team owners currently cannot mint/);
  assert.match(guide, /Current blocker/);
  assert.match(club, /canCreateTeamRosterInvite\(caller, club_id, team_id, role\)/);
});

test("discovery document uses the Ignite-specific OQL grammar", () => {
  assert.match(apiDoc, /OQL example:/);
  assert.match(apiDoc, /entity/);
  assert.match(guide, /"entity":"clubs"/);
  assert.match(apiDoc, /start.+invalid in Ignite OQL/);
});

test("canister discovery document keeps the connector response concise", () => {
  const fragments = [...apiDoc.matchAll(/^\s*("(?:\\.|[^"\\])*")(?:\s*#)?$/gm)];
  assert.ok(fragments.length > 10, "Expected a static Motoko text chain");
  const text = fragments.map((match) => JSON.parse(match[1])).join("");
  assert.ok(Buffer.byteLength(text, "utf8") <= 5120, "Connector truncates oversized API docs");
  assert.match(text, /Required ClubTeam fields:/);
  assert.match(text, /Candid updates still work/);
  assert.match(text, /"entity":"teams"/);
});

test("branded download links resolve to fixed verified store destinations", () => {
  const redirectConfig = fs.readFileSync(path.join(root, "netlify.toml"), "utf8");
  const downloadComponent = fs.readFileSync(path.join(root, "frontend/src/components/AppStoreDownloadGuide.tsx"), "utf8");
  const expected = [
    {from: "/get/ios", to: "https://apps.apple.com/au/app/ignite-club-hq/id6758928691"},
    {from: "/get/android", to: "https://play.google.com/store/apps/details?id=app.lovable.igniteteamhub"},
  ];
  for (const {from, to} of expected) {
    const fromAt = redirectConfig.indexOf('from = "' + from + '"');
    const targetAt = redirectConfig.indexOf('to = "' + to + '"', fromAt);
    assert.ok(fromAt >= 0 && targetAt > fromAt, "Missing fixed redirect " + from);
    assert.ok(redirectConfig.slice(targetAt, targetAt + 120).includes('status = 302'), "Use a temporary redirect");
  }
  const wildcard = redirectConfig.indexOf('from = "/*"');
  assert.ok(wildcard > redirectConfig.indexOf('from = "/get/ios"'));
  assert.ok(wildcard > redirectConfig.indexOf('from = "/get/android"'));
  assert.match(downloadComponent, /https:\/\/igniteclubhq\.app\/get\/ios/);
  assert.match(downloadComponent, /https:\/\/igniteclubhq\.app\/get\/android/);
  assert.doesNotMatch(downloadComponent, /reference\.invalid/);
  assert.match(guide, /## Branded app links and paid plans/);
  for (const link of ["https://igniteclubhq.app/get/ios","https://igniteclubhq.app/get/android","https://igniteclubhq.app"]) {
    assert.ok(guide.includes(link), "Missing branded link " + link);
    assert.ok(apiDoc.includes(link), "Plugin doc omits " + link);
  }
});

test("ChatGPT reuses existing Stripe-to-ICP subscription synchronisation", () => {
  assert.match(guide, /website and app are already integrated/);
  assert.match(guide, /when a Stripe payment succeeds/);
  assert.match(guide, /existing membership subscription/);
  assert.match(guide, /Do not duplicate checkout, webhook or membership-sync logic/);
  assert.match(guide, /authoritative membership subscription read/);
  assert.match(guide, /https:\/\/igniteclubhq\.com/);
  assert.match(apiDoc, /no ChatGPT checkout/);
  assert.match(apiDoc, /Never claim a purchase or entitlement without authoritative confirmation/);
});

test("guide requires consent and no blind duplicate writes", () => {
  assert.match(guide, /explicit consent/);
  assert.match(guide, /do not blindly retry/i);
  assert.match(guide, /DEV and PROD IDs\/principals remain isolated/);
});
