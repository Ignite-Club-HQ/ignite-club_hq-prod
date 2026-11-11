import test from "node:test";
import assert from "node:assert/strict";
import { evaluateIcpMcpOnboarding } from "../frontend/src/live/icpMcpOnboardingReadiness.mjs";

const complete = {
  accountActive:true, profileComplete:true, currentTermsAccepted:true,
  clubVerified:true, clubAdminVerified:true, sportVerified:true,
  countryVerified:true, clubSettingsVerified:true, teamVerified:true,
  defaultChatsVerified:true, groupLocalLinkVerified:true,
};

test("empty or partially checked onboarding never counts as complete", () => {
  assert.equal(evaluateIcpMcpOnboarding().complete, false);
  for (const key of Object.keys(complete)) {
    const state = { ...complete, [key]: false };
    assert.equal(evaluateIcpMcpOnboarding(state).complete, false, key);
  }
  assert.equal(evaluateIcpMcpOnboarding(complete).complete, true);
});

test("club and team creation alone do not imply terms, profile or country", () => {
  const outcome = evaluateIcpMcpOnboarding({
    accountActive:true, clubVerified:true, clubAdminVerified:true, teamVerified:true,
  });
  assert.equal(outcome.complete, false);
  assert.deepEqual(outcome.missing.map(v => v.id).filter(v => ["profile","terms","sport","country"].includes(v)),
    ["profile","terms","sport","country"]);
});

test("Group 2 service admission block never gets silently overridden", () => {
  const outcome = evaluateIcpMcpOnboarding({ ...complete, groupLocalLinkVerified:false, groupLinkBlockedByAdmission:true });
  assert.equal(outcome.complete, false);
  assert.equal(outcome.groupLink, "admission_blocked");
  assert.match(outcome.next, /Never override the guard/);
});

test("a verified role grant is distinct from independently linked group account", () => {
  const outcome = evaluateIcpMcpOnboarding({ ...complete, groupLocalLinkVerified:undefined, clubAdminVerified:true });
  assert.equal(outcome.complete, false);
  assert.equal(outcome.groupLink, "unverified");
});

test("all values must be literal verified booleans, not truthy strings", () => {
  const outcome = evaluateIcpMcpOnboarding({ ...complete, currentTermsAccepted:"yes" });
  assert.equal(outcome.complete, false);
  assert.equal(outcome.missing.find(v=>v.id==="terms")?.id, "terms");
});
