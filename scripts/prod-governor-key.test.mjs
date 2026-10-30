// The PROD signing key is minted inside CI so nobody needs a terminal, and it
// is handed over only as material encrypted with a passphrase the owner chose
// themselves. These tests hold that handoff to its shape, and prove the exact
// openssl flags the two workflows share really do round-trip a key file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, readFileSync as rd } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const MINT = read('.github/workflows/prod-create-governor.yml');
const PROMOTE = read('.github/workflows/promote-icp-prod.yml');

test('the minting workflow is PROD-tagged and gated on an explicit confirmation', () => {
  assert.match(MINT, /^name: "\[PROD\] /m);
  assert.match(MINT, /CREATE PROD KEY/);
  assert.match(MINT, /refs\/heads\/prod/);
});

test('the passphrase is a stored secret, never a form field the run page would expose', () => {
  assert.match(MINT, /PASSPHRASE: \$\{\{ secrets\.PROD_GOVERNOR_PASSPHRASE \}\}/);
  // A workflow_dispatch input is stored in plain text on the run page, so a
  // passphrase typed there would sit next to the ciphertext it protects.
  assert.doesNotMatch(MINT, /inputs\.(passphrase|password)/);
  assert.match(MINT, /No PROD_GOVERNOR_PASSPHRASE secret/);
});

test('minting refuses to orphan a key that is already stored', () => {
  assert.match(MINT, /EXISTING_PEM: \$\{\{ secrets\.PROD_GOVERNOR_PEM \}\}/);
  assert.match(MINT, /EXISTING_ENC: \$\{\{ secrets\.PROD_GOVERNOR_PEM_ENC \}\}/);
  assert.match(MINT, /\[ -n "\$\{EXISTING_PEM:-\}" \] \|\| \[ -n "\$\{EXISTING_ENC:-\}" \]/);
});

test('the plain key and the seed phrase never leave the runner', () => {
  assert.match(MINT, /--output-seed "\$ICP_HOME\/seed"/);
  assert.match(MINT, /umask 077/);
  assert.match(MINT, /trap 'rm -rf "\$ICP_HOME"' EXIT/);
  assert.match(MINT, /if: always\(\)\s*\n\s*run: rm -rf "\$ICP_HOME"/);
  // Only the ciphertext is handed over; the PEM and the seed are never echoed.
  assert.doesNotMatch(MINT, /echo "\$\{?(PEM|SEED)\}?"/);
  assert.doesNotMatch(MINT, /\bcat "\$ICP_HOME\/(gov\.pem|seed)"/);
  assert.match(MINT, /base64 -w0 "\$ICP_HOME\/gov\.enc"/);
});

test('promotion opens either handoff and still refuses a key that is not PROD', () => {
  assert.match(PROMOTE, /PROD_GOVERNOR_PEM_ENC: \$\{\{ secrets\.PROD_GOVERNOR_PEM_ENC \}\}/);
  assert.match(PROMOTE, /PROD_GOVERNOR_PASSPHRASE: \$\{\{ secrets\.PROD_GOVERNOR_PASSPHRASE \}\}/);
  assert.match(PROMOTE, /openssl enc -d -aes-256-cbc -pbkdf2/);
  assert.match(PROMOTE, /grep -q -- '-----BEGIN' "\$PEM"/);
  assert.equal((PROMOTE.match(/assertGovernor\('prod'/g) ?? []).length, 2);
  // Neither job may fall back to a DEV key.
  assert.doesNotMatch(PROMOTE, /secrets\.GOVERNOR_PEM\b|secrets\.DEPLOYER_PEM\b/);
});

test('the shared openssl flags round-trip a key file, and a wrong passphrase fails', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ignite-key-envelope-'));
  try {
    const key = path.join(dir, 'key.pem');
    const pass = path.join(dir, 'pass');
    const enc = path.join(dir, 'key.enc');
    const out = path.join(dir, 'out.pem');
    execFileSync('openssl', ['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', key]);
    writeFileSync(pass, 'correct horse battery staple');

    // Exactly what the minting workflow does.
    execFileSync('openssl', ['enc', '-aes-256-cbc', '-pbkdf2', '-salt', '-in', key, '-out', enc, '-pass', `file:${pass}`]);
    const blob = execFileSync('base64', ['-w0', enc], { encoding: 'utf8' }).trim();
    assert.ok(blob.length > 200 && !/\s/.test(blob), 'the handoff block must be one copyable line');

    // Exactly what promotion does with the stored secret.
    writeFileSync(enc, Buffer.from(blob, 'base64'));
    execFileSync('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-in', enc, '-out', out, '-pass', `file:${pass}`]);
    assert.deepEqual(rd(out), rd(key));

    // A wrong passphrase must fail closed rather than emit garbage.
    writeFileSync(pass, 'wrong passphrase');
    assert.throws(() =>
      execFileSync('openssl', ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-in', enc, '-out', out, '-pass', `file:${pass}`], { stdio: 'ignore' }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
