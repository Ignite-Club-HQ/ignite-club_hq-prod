// DEV-only source contract for the protected, read-only legal-release OQL row.
// Not a substitute for Motoko compilation, owner-approved legal publication
// or a live two-identity ChatGPT acceptance test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const club = readFileSync(new URL('../backend/club_domain/src/main.mo', import.meta.url), 'utf8');
const oql = readFileSync(new URL('../backend/club_domain/src/oqlClubs.mo', import.meta.url), 'utf8');

test('only approved legal-release version is projected, never arbitrary app config', () => {
  assert.match(oql, /name = "legal_release"; fields = \[/);
  assert.match(oql, /Oql\.text\("version", version\)/);
  assert.match(oql, /Oql\.text\("terms_url", "https:\/\/igniteclubhq\.com\/terms"\)/);
  assert.match(oql, /Oql\.text\("privacy_url", "https:\/\/igniteclubhq\.com\/privacy"\)/);
  assert.doesNotMatch(oql, /Oql\.text\("(?:config|app_config|legal_reacceptance|terms_acceptance)"/);
});

test('missing legal release is an empty row set, no arbitrary default', () => {
  assert.match(club, /appConfig\.find\(func\(\(key, _\)\) = key == "legal_document_release"\)/);
  assert.match(club, /if \(version == ""\) \[\] else \[version\]/);
  assert.match(club, /case null \[\]/);
  assert.doesNotMatch(club, /publishedLegalReleaseRows\(\)[\s\S]{0,180}2026[0-9]{4}/);
});

test('both query and protected consensus update paths expose legal release', () => {
  assert.equal((club.match(/request\.entity == "legal_release"/g) ?? []).length, 2);
  assert.equal((club.match(/Oql\.run<Text>\(request, publishedLegalReleaseRows\(\)/g) ?? []).length, 2);
  assert.match(club, /public shared \(\{ caller \}\) func read_account_execute\(input : Text\)/);
});
