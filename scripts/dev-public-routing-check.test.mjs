import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/check-dev-public-routing.yml", import.meta.url), "utf8");
const reviewer = readFileSync(new URL("../frontend/scripts/produce-routing-gates.ts", import.meta.url), "utf8");

test("DEV routing verification runs manually, with no PR access to governor credentials", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /if: github.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /environment: group-2-admin-controls/);
  assert.match(workflow, /test "\$GITHUB_REF" = 'refs\/heads\/main'/);
  assert.match(workflow, /test "\$GITHUB_REPOSITORY" = 'Ignite-Club-HQ\/ignite-club_hq-prod'/);
  assert.match(workflow, /persist-credentials: false/);
});

test("DEV signed routing evidence cannot approve, deploy or target PROD", () => {
  assert.match(workflow, /permissions:\s+contents: read/);
  assert.match(workflow, /IGNITE_ICP_ENV: dev/);
  assert.match(workflow, /SNAPSHOT_CHECK_ONLY: "1"/);
  assert.match(workflow, /RECORD_ROUTING_APPROVAL: "0"/);
  assert.match(workflow, /jcdfe-vqaaa-aaaal-qxloq-cai/);
  assert.doesNotMatch(workflow, /IGNITE_ICP_ENV: prod|refs\/heads\/prod|deploy\/prod|git push|git commit|gh workflow run|icp deploy|icp canister install|set_app_config|record_routing_approval/);
});

test("snapshot preflight exits before generated source or live approval writes", () => {
  const check = reviewer.indexOf("if (process.env.SNAPSHOT_CHECK_ONLY === '1')");
  const sourceWrite = reviewer.indexOf("saveFile(new URL('../src/live/generated/routingGates.ts'");
  const approvalCall = reviewer.indexOf("recordLiveApproval(evidence.approvedConfiguration, evidenceSha256)");
  assert(check > 0 && sourceWrite > check && approvalCall > sourceWrite);
  assert.match(reviewer.slice(check, sourceWrite), /process\.exit\(0\)/);
});

test("preflight's signed report is inspected before reporting pass", () => {
  assert.match(workflow, /dev-public-routing-report\.json/);
  assert.match(workflow, /result\.routerCanisterId!=='jcdfe-vqaaa-aaaal-qxloq-cai'/);
  assert.match(workflow, /result\.targetAlias!=='mainnet'/);
  assert.match(workflow, /dev-public-routing-evidence/);
});
