import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testAssistantDiscoveryFiles, writeTestAssistantDiscovery } from "./test-assistant-discovery.mjs";
import { GROUP2_CUSTOMER_SERVICES, validateGroup2CustomerCanisters } from "./group2-mcp-discovery.mjs";

test("alternative TEST address declares the existing TEST identity, not the website or PROD identity", () => {
  const files = testAssistantDiscoveryFiles();
  assert.equal(files["/.well-known/ii-derivation-origin"].body, "https://proe7-kqaaa-aaaas-qg6gq-cai.icp0.io\n");
});

test("TEST discovery declares the exact DEV services and no PROD frontend", () => {
  const table = JSON.parse(readFileSync(new URL("../deploy/mainnet/.icp/data/mappings/ic.ids.json", import.meta.url), "utf8"));
  const manifest = JSON.parse(testAssistantDiscoveryFiles()["/.well-known/ic-architecture"].body);
  assert.equal(manifest.canisters[0].id, "proe7-kqaaa-aaaas-qg6gq-cai");
  assert.deepEqual(Object.fromEntries(manifest.canisters.filter(({ name }) => name !== "frontend" && name !== "Ignite TEST frontend" && !name.startsWith("g2/")).map(({ name, id }) => [name, id])), table);
  const g2Provision = JSON.parse(readFileSync(new URL("../deploy/groups/g2/provision.json", import.meta.url), "utf8"));
  const g2 = manifest.canisters.filter(c => c.name.startsWith("g2/"));
  const approval = JSON.parse(readFileSync(new URL("../deploy/groups/g2/general-opening.json", import.meta.url), "utf8"));
  const includedNames = GROUP2_CUSTOMER_SERVICES.map(([name]) => name);
  const includedIds = includedNames.map(name => name === "media_blob_store" ? g2Provision.dedicatedBlobStore.canisterId : g2Provision.canisters[name]);
  assert.deepEqual(g2.map(c => c.name), includedNames.map(name => `g2/${name}`));
  assert.deepEqual(g2.map(c => c.id), includedIds, "only approved customer-facing G2 canisters");
  assert.ok(g2.every(c => c.role === "backend"));
  assert.equal(new Set(manifest.canisters.map(c => c.id)).size, manifest.canisters.length);
  for (const name of ["pii_access_control", "notification_queue", "timer_jobs"]) {
    assert.ok(!g2.some(c => c.id === g2Provision.canisters[name]), `exclude sensitive service ${name}`);
  }
  for (const name of ["secret_workload_identity", "migration_coordinator", "shard_router"]) {
    assert.ok(!g2.some(c => c.name === `g2/${name}`), `exclude G2 infrastructure ${name}`);
  }
  const params = { provision: g2Provision, approval, sharedIds: table, frontendId: "proe7-kqaaa-aaaas-qg6gq-cai" };
  assert.deepEqual(validateGroup2CustomerCanisters(params), g2);
  const badProvision = structuredClone(g2Provision);
  badProvision.canisters.messaging_domain = g2Provision.canisters.events_domain;
  assert.throws(() => validateGroup2CustomerCanisters({ ...params, provision: badProvision }), /unapproved|duplicate/i);
  const missingInstalled = structuredClone(g2Provision);
  missingInstalled.installedDomains = missingInstalled.installedDomains.filter(n => n !== "events_domain");
  assert.throws(() => validateGroup2CustomerCanisters({ ...params, provision: missingInstalled }), /unapproved/i);
  assert.equal(manifest.canisters.some(({ id }) => id === "u3mrq-uiaaa-aaaac-bgioq-cai"), false);
});

test("writes discovery only to the supplied DEV output and never rewrites sign-in allowlists", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ignite-test-discovery-"));
  try {
    writeTestAssistantDiscovery(dir);
    assert.equal(readFileSync(path.join(dir, ".well-known/ii-derivation-origin"), "utf8"), "https://proe7-kqaaa-aaaas-qg6gq-cai.icp0.io\n");
    assert.throws(() => readFileSync(path.join(dir, ".well-known/ii-alternative-origins")), { code: "ENOENT" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});