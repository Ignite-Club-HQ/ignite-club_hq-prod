import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { connectionCalls, inventory } from './deployment.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const require = createRequire(path.join(ROOT, 'frontend/package.json'));
const YAML = require('yaml');
const prod = JSON.parse(readFileSync(path.join(ROOT, 'deploy/opencloud/prod.json'), 'utf8'));
const dev = JSON.parse(readFileSync(path.join(ROOT, 'deploy/opencloud/dev.json'), 'utf8'));
const calls = connectionCalls(prod);
const prodIds = new Set(inventory(prod).filter(row => row.service !== 'frontend').map(row => row.id));
const devIds = new Set(inventory(dev).map(row => row.id));

function runWiring(mode, { failTimerReadback = false } = {}) {
  const temp = mkdtempSync(path.join(tmpdir(), 'prod-wire-services-'));
  const bin = path.join(temp, 'bin');
  const log = path.join(temp, 'calls.jsonl');
  try {
    mkdirSync(bin);
    const mock = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.MOCK_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'identity' && args[1] === 'principal') {
  console.log(process.env.EXPECTED_GOVERNOR);
  process.exit(0);
}
if (args[0] !== 'canister' || args[1] !== 'call') process.exit(2);
const target = args[2], method = args[3];
const stateFile = process.env.MOCK_STATE;
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
if (method === 'read_group_opening_configuration') {
  if ((target === process.env.G1_TIMER || target === process.env.G2_TIMER) &&
      (!state[target] || process.env.FAIL_TIMER_READBACK === '1')) {
    console.log('(variant { Err = "' + (state[target] ? 'Governor required' : 'Timer queue is not initialized') + '" })');
  } else console.log('(variant { Ok = vec {} })');
  process.exit(0);
}
if (method === 'initialize') {
  state[target] = true;
  fs.writeFileSync(stateFile, JSON.stringify(state));
}
console.log('(variant { Ok })');
`;
    writeFileSync(path.join(bin, 'icp'), mock);
    chmodSync(path.join(bin, 'icp'), 0o700);
    const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/opencloud/prod-wire-services.mjs'), mode], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GITHUB_REF_NAME: 'main',
        RUNNER_TEMP: temp,
        MOCK_LOG: log,
        MOCK_STATE: path.join(temp, 'state.json'),
        EXPECTED_GOVERNOR: prod.controllers.governor,
        G1_TIMER: prod.groups[0].canisterIds.timer_jobs,
        G2_TIMER: prod.groups[1].canisterIds.timer_jobs,
        FAIL_TIMER_READBACK: failTimerReadback ? '1' : '0',
      },
    });
    const records = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    return { result, records };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

test('PROD wiring plan contains 78 calls to allocated backends only', () => {
  assert.equal(prod.applicationKey, 'ignite_prod_v2');
  assert.equal(inventory(prod).length, 32);
  assert.equal(calls.length, 78);
  assert.deepEqual(calls.filter(call => call.method === 'initialize').map(call => call.service), ['g1_timer_jobs', 'g2_timer_jobs']);
  for (const call of calls) {
    assert.ok(prodIds.has(call.target));
    assert.ok(!devIds.has(call.target));
    for (const match of call.candidArgs.matchAll(/principal "([^"]+)"/g)) {
      assert.ok(prodIds.has(match[1]));
      assert.ok(!devIds.has(match[1]));
    }
    assert.doesNotMatch(call.method, /register_group|accepting|opening/i);
  }
});

test('check mode is read-only and permits only pristine timer readback refusals', () => {
  const { result, records } = runWiring('check');
  assert.equal(result.status, 0, result.stderr);
  const canisterCalls = records.filter(args => args[0] === 'canister');
  assert.equal(canisterCalls.length, 24);
  assert.ok(canisterCalls.every(args => args[3] === 'read_group_opening_configuration'));
  assert.match(result.stdout, /Validated 78 wiring calls/);
});

test('wire mode initializes both timers first, uses positional Candid, and verifies every write', () => {
  const { result, records } = runWiring('wire');
  assert.equal(result.status, 0, result.stderr);
  const canisterCalls = records.filter(args => args[0] === 'canister');
  const mutations = canisterCalls.filter(args => args[3] !== 'read_group_opening_configuration');
  const expected = [...calls.filter(call => call.method === 'initialize'), ...calls.filter(call => call.method !== 'initialize')];
  assert.equal(mutations.length, 78);
  assert.deepEqual(mutations.slice(0, 2).map(args => args[3]), ['initialize', 'initialize']);
  mutations.forEach((args, index) => {
    const call = expected[index];
    assert.equal(args[2], call.target);
    assert.equal(args[3], call.method);
    assert.equal(args[4], call.candidArgs, `${call.service}.${call.method} must be the positional Candid argument`);
    assert.ok(!args.includes('--args'));
    assert.ok(args.includes('--candid'));
    assert.ok(args.includes('--identity'));
    assert.ok(args.includes('opencloud-governor'));
  });
  const readbacks = canisterCalls.filter(args => args[3] === 'read_group_opening_configuration');
  assert.equal(readbacks.length, 24 + 78);
  assert.match(result.stdout, /Wiring calls completed/);
});

test('failed timer lifecycle readback stops before any other service is wired', () => {
  const { result, records } = runWiring('wire', { failTimerReadback: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Readback refused g1_timer_jobs/);
  const mutations = records.filter(args => args[0] === 'canister' && args[3] !== 'read_group_opening_configuration');
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0][3], 'initialize');
});

test('workflow is manual, reuses PROD governor secrets, and adds no environment or deployment trigger', () => {
  const file = path.join(ROOT, '.github/workflows/opencloud-prod-wire-services.yml');
  const text = readFileSync(file, 'utf8');
  const workflow = YAML.parse(text);
  assert.equal(workflow.name, '[PROD] OpenCloud PROD service wiring');
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.mode.options, ['check', 'wire']);
  assert.equal(workflow.on.workflow_dispatch.inputs.mode.default, 'check');
  assert.equal(workflow.jobs.wiring.if, "github.ref == 'refs/heads/main'");
  assert.equal(workflow.jobs.wiring.environment, undefined);
  assert.equal(workflow.concurrency.group, 'opencloud-prod-deployment');
  assert.match(text, /@icp-sdk\/icp-cli@1\.7\.0/);
  assert.match(text, /secrets\.PROD_GOVERNOR_PEM_ENC/);
  assert.match(text, /secrets\.PROD_GOVERNOR_PASSPHRASE/);
  assert.doesNotMatch(text, /secrets\.GOVERNOR_PEM\b|opencloud-dev|ignite_dev_v2/);
  assert.doesNotMatch(text, /icp canister (create|install)|register_group|open-prod-group/);
});
