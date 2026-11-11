import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('failed initial read identifies authentication without exposing database diagnostics or retrying', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'release-diagnostics-'));
  try {
    writeFileSync(path.join(directory, 'psql'), '#!/bin/sh\nprintf \'FATAL: password authentication failed for user "private-user"; password=private-value\\n\' >&2\nexit 2\n', { mode: 0o700 });
    const result = spawnSync(process.execPath, ['scripts/supabase-structural-release.mjs'], {
      encoding: 'utf8', env: { ...process.env, PATH: `${directory}:${process.env.PATH}`,
        GITHUB_REF: 'refs/heads/prod', PROJECT_REF: 'yabcfiuntwqjwvschnji',
        SUPABASE_ACCESS_TOKEN: 'fixture', SUPABASE_DB_PASSWORD: 'fixture', GITHUB_SHA: 'a'.repeat(40),
        RELEASE_REPORT_DIR: directory, RELEASE_MODE: 'safe-apply' },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /migration ledger read.*database authentication refused/i);
    assert.doesNotMatch(result.stderr + result.stdout, /private-user|private-value/);
    assert.match(result.stderr, /no retry or repair/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});