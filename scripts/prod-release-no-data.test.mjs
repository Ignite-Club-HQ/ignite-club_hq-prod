// Owner rule (30 Oct 2026, 11:02 UTC): the production release may change
// structures only — no production data is changed. This test reads the five
// run-list migrations and proves the only thing they write is the single
// `backend_routing_config` settings row, that no business row is ever
// inserted, updated or deleted, and that nothing destructive runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const MIGRATIONS_DIR = 'supabase/migrations';
const RUN_LIST = [
  '20261004045741',
  '20261030013157',
  '20261030013232',
  '20261030013735',
  '20261030052009',
];
const SETTINGS_FILE = '20261030013735';

const DOLLAR_BODY = /(?<q>\$\w*\$)[\s\S]*?\k<q>/g;
const WRITE = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE|MERGE\s+INTO)\s+([a-zA-Z0-9_."]+)/gi;
const SKIP_TARGETS = new Set(['SET', 'IF', 'WHERE', 'TABLE']);

function resolve(prefix) {
  const files = readdirSync(MIGRATIONS_DIR).filter((name) => name.startsWith(`${prefix}_`));
  assert.equal(files.length, 1, `run-list version ${prefix} must match exactly one migration file`);
  return { file: files[0], sql: readFileSync(`${MIGRATIONS_DIR}/${files[0]}`, 'utf8') };
}

function stripBodies(sql) {
  return sql.replace(DOLLAR_BODY, ' /* function body */ ');
}

function writesIn(sql) {
  const found = [];
  for (const match of sql.matchAll(WRITE)) {
    const statement = match[1].toUpperCase().replace(/\s+/g, ' ');
    const target = match[2].replace(/"/g, '');
    if (SKIP_TARGETS.has(target.toUpperCase())) continue;
    found.push({ statement, target });
  }
  return found;
}

const runList = RUN_LIST.map(resolve);

test('run list writes nothing but the routing settings row', () => {
  const outer = [];
  for (const { file, sql } of runList) {
    for (const write of writesIn(stripBodies(sql))) outer.push({ ...write, file });
  }
  assert.deepEqual(
    outer,
    [{ statement: 'INSERT INTO', target: 'public.app_settings', file: runList.find((entry) => entry.file.startsWith(SETTINGS_FILE)).file }],
    'only the backend_routing_config settings row may be written at release time',
  );
});

test('the settings write is a keyed upsert that only replaces the value', () => {
  const { sql } = runList.find((entry) => entry.file.startsWith(SETTINGS_FILE));
  assert.match(sql, /ON CONFLICT\s*\(\s*key\s*\)\s*DO UPDATE\s+SET\s+value\s*=/i);
  assert.match(sql, /updated_at\s*=\s*now\(\)/i);
  assert.doesNotMatch(sql, /DELETE|TRUNCATE/i);
});

test('the owner-approved exception is scoped to exactly the routing-settings key', () => {
  // Owner accepted this one row on 30 Oct 2026 11:04 UTC. The acceptance covers only
  // this key and only the two retained clubs; anything wider must fail here.
  const { sql } = runList.find((entry) => entry.file.startsWith(SETTINGS_FILE));
  assert.match(sql, /INSERT\s+INTO\s+public\.app_settings[\s\S]{0,120}?VALUES\s*\(\s*'backend_routing_config'/i);
  assert.match(sql, /"defaultBackend"\s*:\s*"supabase"/);
  assert.match(sql, /966bdaec-ebf1-46da-b2b3-cc53bf05c422/);
  assert.match(sql, /493ee2e3-c834-487d-93be-d1c8a0dbc4a8/);
  assert.equal((sql.match(/"id"\s*:\s*"/g) || []).length, 2);
});

test('function bodies keep only the signup profile insert production already does', () => {
  const bodyWrites = [];
  for (const { file, sql } of runList) {
    const bodies = [...sql.matchAll(DOLLAR_BODY)].map((match) => match[0]);
    for (const body of bodies) {
      for (const write of writesIn(body)) bodyWrites.push({ ...write, file });
    }
  }
  assert.deepEqual(
    bodyWrites,
    [{ statement: 'INSERT INTO', target: 'public.profiles', file: runList.find((entry) => entry.file.startsWith('20261030013157')).file }],
    'the only table write a function may perform is the profiles(id) insert on signup',
  );
});

test('no run-list migration can destroy rows, tables or other databases', () => {
  for (const { file, sql } of runList) {
    assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i, `${file} must not delete rows`);
    assert.doesNotMatch(sql, /\bTRUNCATE\b/i, `${file} must not truncate a table`);
    assert.doesNotMatch(sql, /\bDROP\s+(TABLE|SCHEMA|DATABASE|COLUMN|INDEX)\b/i, `${file} must not drop stored data`);
    assert.doesNotMatch(sql, /\bMERGE\s+INTO\b/i, `${file} must not merge rows`);
  }
});

test('run-list migrations stay portable and never target another database', () => {
  for (const { file, sql } of runList) {
    assert.doesNotMatch(sql, /current_database\s*\(/i, `${file} must not pin itself to one database`);
    assert.doesNotMatch(sql, /ecsdwrarzfexssxtrymj/i, `${file} must not name the development project`);
    assert.doesNotMatch(sql, /RAISE EXCEPTION\s+'DEV/i, `${file} must not be a development-only repair`);
  }
});

test('no run-list migration touches a business table', () => {
  // Body writes are runtime behaviour (the signup trigger) and are pinned
  // separately; here only statements that run at release time are inspected.
  const business = /(^|\.)(clubs|teams|profiles|events|rsvps|messages|chat_groups|competition_matches|competition_events|notifications)\b/i;
  for (const { file, sql } of runList) {
    for (const write of writesIn(stripBodies(sql))) {
      assert.ok(
        !business.test(write.target),
        `${file} must not write ${write.target}; production business rows stay untouched`,
      );
    }
  }
});
