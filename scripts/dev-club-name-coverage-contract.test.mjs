import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const runner=read('frontend/scripts/audit-dev-club-name-coverage.ts');
const policy=read('scripts/dev-club-name-coverage-policy.mjs');
const backend=read('backend/pii_access_control/src/main.mo');
const did=read('backend/pii_access_control/pii_access_control.did');
const workflow=read('.github/workflows/dev-club-name-coverage-audit.yml');

test('protected workflow is manual-only for governor, PR jobs parse/test without secrets',()=>{
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/if: github.event_name == 'workflow_dispatch'/);
  assert.match(workflow,/environment: group-2-admin-controls/);
  assert.match(workflow,/permissions:\n  contents: read/);
  assert.match(workflow,/persist-credentials: false/);
  assert.match(workflow,/group: ignite-mainnet-governor-deployment/);
  assert.match(workflow,/AUDIT DEV CLUB NAME COPIES READ ONLY/);
  assert.match(workflow,/test "\$GITHUB_REF" = "refs\/heads\/main"/);
  assert.doesNotMatch(workflow,/\n  push:|\n  schedule:|permissions:\n  contents: write/);
  assert.doesNotMatch(workflow,/icp deploy|icp canister install|git push|update_settings/);
  assert.match(runner,/GROUP2_GOVERNOR/);
  assert.match(runner,/DEV_CLUB_NAME_COVERAGE_ACTION/);
  assert.match(runner,/DEV_CLUB_NAME_COVERAGE_CONFIRMATION/);
  assert.match(runner,/loadOperatorIdentity/);
});

test('DEV metadata-only reader cannot return original/copy ciphertext or derive any key',()=>{
  const start=backend.indexOf('func read_dev_private_club_name_replica_coverage(');
  const end=backend.indexOf('// Create-only refresh pins the ORIGINAL saved bytes',start);
  assert.ok(start>0&&end>start,'auditor method block required');
  const body=backend.slice(start,end);
  for(const id of ['iui5p-aaaaa-aaaal-qxllq-cai','zt5a6-yiaaa-aaaal-qxp5q-cai'])
    assert.ok(body.includes(id),'no foreign PII canister');
  assert.match(body,/if \(not isGovernor\(caller\)\)/);
  assert.match(body,/subjects\.size\(\) > 25/);
  assert.match(body,/validMediaClub\(club\)/);
  assert.match(body,/r\.pii_id == id and r\.field_id == clubNameField\(club\)/);
  assert.match(body,/copies\[0\]\.master_key_id != clubNameScheme\(club\)/);
  assert.match(body,/originals\[0\]\.master_key_id != vetkeySchemeId\(\)/);
  assert.match(did,/read_dev_private_club_name_replica_coverage: \(subjects: vec principal/);
  assert.doesNotMatch(body,/vetKdDeriveKey|pii_vetkey|set_|register_|grant_|authorizePrivateNames/);
  assert.doesNotMatch(body,/ciphertext =|originalBytes =|refresh_private_club_name|read_private_club_name_lifecycle/);
  assert.match(body,/state : Text/);
});

test('audit is source-bound and never uploads raw personal data',()=>{
  for(const id of ['mzzzv-taaaa-aaaal-qxlrq-cai','yfwyv-nyaaa-aaaal-qxpyq-cai',
    'iui5p-aaaaa-aaaal-qxllq-cai','zt5a6-yiaaa-aaaal-qxp5q-cai',
    'mq2sj-fiaaa-aaaal-qxlqa-cai'])assert.ok(runner.includes(id) || policy.includes(id),id);
  assert.match(runner,/read_membership_source_page/);
  assert.match(runner,/list_admin_accounts/);
  assert.match(runner,/const second=await getSnapshot\(\)/);
  assert.match(runner,/first\.fingerprint===second\.fingerprint/);
  assert.match(runner,/summarizeDevClubNameCoverage/);
  assert.match(runner,/reportDir,'check\.json'/);
  assert.doesNotMatch(runner,/get_private_profile_names_batch|get_private_profile_name_vetkeys_batch|decrypt\s*\(|encryptPiiText|read_private_club_name_lifecycle|register_pii\(/);
  assert.doesNotMatch(runner,/JSON\.stringify\((?:first|second|plan|observed)\)\s*[,;)]/);
  assert.match(policy,/readyToReleaseName:false,nameReadAuthorised:false/);
  assert.match(policy,/missingOwnerAuthorisedReadAndDenialAcceptance:true/);
});

test('a failed metadata read produces only a blocked, count-only report before failing',()=>{
  assert.match(runner,/if\('Err' in reply\)/);
  assert.match(runner,/classifyDevNameCoverageFailure\(reply.Err,\{backend:true\}\)/);
  assert.match(runner,/classifyDevNameCoverageFailure\(error\)/);
  assert.match(runner,/sourceGroup=group.source===PII.g1\?'g1':'g2'/);
  assert.match(runner,/writeFileSync\(resolve\(reportDir,'check.json'\)/);
  assert.match(runner,/if\(readFailure\)\{/);
  assert.match(runner,/readFailure===null/);
  assert.match(runner,/sourceReadbackFailed/);
  assert.doesNotMatch(runner,/console\.(?:warn|error|log)\([^\n]*\b(?:error|reply\.Err|group\.subjects|group\.club)\b/);
  assert.doesNotMatch(runner,/throw Error\(error\.message\)|throw error|error\?\.stack/);
  assert.match(policy,/backend_refused_other/);
  assert.match(policy,/transport_deadline/);
  assert.match(policy,/readyToReleaseName:false,nameReadAuthorised:false/);
});
