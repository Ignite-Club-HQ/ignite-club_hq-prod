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
  assert.match(apiDoc, /OQL requests use/);
  assert.match(apiDoc, /entity/);
  assert.match(guide, /"entity":"clubs"/);
  assert.match(apiDoc, /not an Ignite OQL request property/);
});

test("guide requires consent and no blind duplicate writes", () => {
  assert.match(guide, /explicit consent/);
  assert.match(guide, /do not blindly retry/i);
  assert.match(guide, /DEV and PROD IDs\/principals remain isolated/);
});
