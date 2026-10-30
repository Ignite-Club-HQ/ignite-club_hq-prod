import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('disposable socket-only PostgreSQL verifies signup guards without touching DEV or PROD', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'ignite-signup-local-'));
  // Never inherit hosted PG settings, credentials or injected sessions.
  const env = { PATH: process.env.PATH, HOME: directory, LANG: 'C.UTF-8' };
  const asLocalUser = process.getuid?.() === 0;
  const command = (program, args) => {
    const result = spawnSync(program, args,
      { env, encoding: 'utf8', timeout: 60000, ...(asLocalUser ? { uid: 1000, gid: 1000 } : {}) });
    assert.equal(result.status, 0, `${program}: ${result.stderr}`);
    return result.stdout;
  };
  let started = false;
  try {
    const parts = ['signup-rehearsal-fixture.sql', '../docs/release-review/signup-helper-draft.sql',
      '../docs/release-review/signup-access-draft.sql', 'signup-rehearsal-assertions.sql'];
    writeFileSync(path.join(directory, 'rehearsal.sql'), parts.map(file => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n'));
    if (asLocalUser) {
      const owned = spawnSync('chown',['-R','lovable',directory],{ env,encoding:'utf8' });
      assert.equal(owned.status,0,owned.stderr);
    }
    command('initdb',['-D',path.join(directory,'data'),'-A','trust','-U','rehearsal','--no-locale']);
    // TCP disabled; only this newly initialized private socket is reachable.
    command('pg_ctl',['-D',path.join(directory,'data'),'-l',path.join(directory,'server.log'),'-o',`-c listen_addresses='' -k ${directory} -p 55439`,'-w','start']);
    started = true;
    const output = command('psql',['-X','-h',directory,'-p','55439','-U','rehearsal','-d','postgres','-v','ON_ERROR_STOP=1','-f',path.join(directory,'rehearsal.sql')]);
    assert.match(output,/PASS: synthetic signup, lifecycle, helper ACL and anonymous routing checks/);
  } finally {
    if (started) command('pg_ctl',['-D',path.join(directory,'data'),'-m','immediate','-w','stop']);
    rmSync(directory,{ recursive:true,force:true });
  }
});