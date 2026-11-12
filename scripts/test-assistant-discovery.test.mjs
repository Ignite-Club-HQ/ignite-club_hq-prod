import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testAssistantDiscoveryFiles, writeTestAssistantDiscovery } from "./test-assistant-discovery.mjs";

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
  assert.deepEqual(g2.map(c => c.id), [g2Provision.canisters.club_domain], "declare only Group 2 club canister");
  assert.equal(new Set(manifest.canisters.map(c => c.id)).size, manifest.canisters.length);
  assert.equal(manifest.canisters.some(c => Object.values(g2Provision.canisters).includes(c.id) && c.id !== g2Provision.canisters.club_domain), false, "do not expose other g2 service canisters");
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