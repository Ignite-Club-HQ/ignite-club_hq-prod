import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encryptInventedNameLocally } from '../prototypes/chatgpt-vetkeys-name-poc/local-encryption.mjs';

const source = name => readFileSync(new URL('../prototypes/chatgpt-vetkeys-name-poc/' + name, import.meta.url), 'utf8');

test('synthetic browser name encrypts with existing VetKeys helper but only returns metadata', () => {
  const result = encryptInventedNameLocally('Example Coach');
  assert.deepEqual(Object.keys(result).sort(), ['ciphertextBytes', 'encryptedLocally']);
  assert.equal(result.encryptedLocally, true);
  assert.ok(result.ciphertextBytes > 40);
  assert.equal(JSON.stringify(result).includes('Example Coach'), false);
  assert.equal(JSON.stringify(result).includes('blob'), false);
});

test('user input is validated by the original Ignite encryption helper', () => {
  for (const bad of ['', '   ', 'X'.repeat(81), 'bad' + String.fromCharCode(10) + 'name', 'bad' + String.fromCharCode(0) + 'name', '😀'.repeat(81)]) {
    assert.throws(() => encryptInventedNameLocally(bad));
  }
});

test('synthetic Unicode names encrypt safely without exposing inputs', () => {
  for (const name of ['Coach 😀', '  Example Coach  ', 'Åsa Østberg']) {
    const receipt = encryptInventedNameLocally(name);
    assert.equal(receipt.encryptedLocally, true);
    assert.equal(JSON.stringify(receipt).includes(name.trim()), false);
  }
});

test('POC has no network, ChatGPT bridge, local persistence or visible user-name echo', () => {
  const js = source('local-encryption.mjs') + '\n' + source('main.mjs');
  // Exclude explanatory comments so the rules evaluate executable source.
  const executable = js.replace(/\/\/[^\n]*/g, '');
  const denied = [
    /\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\s*\(/,
    /\bsendBeacon\s*\(/, /\bpostMessage\s*\(/,
    /\bcallTool\s*\(/, /\bsendFollowUpMessage\s*\(/,
    /\b(localStorage|sessionStorage|indexedDB)\b/,
    /\b(navigator\.clipboard|document\.cookie)\b/,
    /\bconsole\.\w+\s*\(/, /\bwindow\.openai\b/,
    /\bform\.submit\s*\(/, /\blocation\.assign\s*\(/,
  ];
  for (const pattern of denied) assert.doesNotMatch(executable, pattern);
  assert.match(source('main.mjs'), /input\.value\s*=\s*''/);
  assert.match(source('local-encryption.mjs'), /prepareEncryptedChatgptProfileName\(/);
  assert.match(source('local-encryption.mjs'), /prepared\.ciphertext\.fill\(0\)/);
});

test('strict standalone CSP prohibits network and form submission', () => {
  const html = source('index.html');
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  for (const directive of [
    "default-src 'none'", "connect-src 'none'", "form-action 'none'",
    "img-src 'none'", "object-src 'none'", "base-uri 'none'"
  ]) assert.ok(html.includes(directive), 'Missing ' + directive);
  assert.match(html, /Use invented names only/);
  assert.match(html, /not an approved secure registration form/);
  assert.match(html, /type="module" src="\.\/main\.mjs"/);
  assert.doesNotMatch(html, /<iframe\b/i);
  assert.doesNotMatch(html, /<script[^>]+src="https?:/i);
});
