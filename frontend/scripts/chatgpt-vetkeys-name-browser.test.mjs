import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium, expect } from '@playwright/test';

const port = 44767;
const root = new URL('..', import.meta.url);
const url = 'http://127.0.0.1:' + port + '/';

async function waitForLocalPreview(server) {
  for (let i = 0; i < 120; i++) {
    if (server.exitCode != null) throw Error('Vite preview terminated');
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return;
    } catch { /* preview not ready */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw Error('Vite preview did not start');
}

test('real Chromium encrypts a synthetic name locally with no off-origin requests or chat bridge', { timeout: 90000 }, async t => {
  const server = spawn(process.execPath, [
    'node_modules/vite/bin/vite.js', 'preview', '--config',
    'prototypes/chatgpt-vetkeys-name-poc/vite.config.mjs',
    '--host', '127.0.0.1', '--port', String(port), '--strictPort'
  ], { cwd: new URL('..', import.meta.url).pathname, stdio: 'ignore' });
  t.after(() => { if (server.exitCode == null) server.kill('SIGTERM'); });

  await waitForLocalPreview(server);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  t.after(async () => { await browser.close(); });
  const page = await browser.newPage();
  const offOriginRequests = [];
  const pageErrors = [];
  page.on('request', request => {
    if (!request.url().startsWith(url)) offOriginRequests.push(request.url().split('?')[0]);
  });
  page.on('pageerror', error => pageErrors.push(error.name));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.getByLabel('Invented display name').fill('Example Coach');
  await page.getByRole('button', { name: 'Test local encryption' }).click();
  await expect(page.getByRole('status')).toContainText('Local VetKeys encryption completed');
  await expect(page.getByLabel('Invented display name')).toHaveValue('');
  assert.deepEqual(pageErrors, [], 'Browser script failed at runtime');
  assert.deepEqual(offOriginRequests, [], 'Browser attempted off-origin request');
  const displayed = await page.locator('body').innerText();
  assert.equal(displayed.includes('Example Coach'), false, 'Plaintext was displayed');
  assert.equal(displayed.includes('blob "'), false, 'Ciphertext was exposed to the page');
});
