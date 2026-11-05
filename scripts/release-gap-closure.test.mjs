import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const ts = require('typescript');
const yaml = require('js-yaml');
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

for (const name of ['auto-rsvp-push-cron', 'chat-photo-gallery-reminders']) {
  test(`${name} rejects an ordinary user before privileged work and permits preflight`, async () => {
    let handler, clients = 0;
    const source = read(`supabase/functions/${name}/index.ts`).replace(/^import .*;\s*$/gm, '');
    const guard = read('supabase/functions/_shared/reminder-auth.ts').replace('export function', 'function');
    const compiled = ts.transpile(`${guard}\n${source}`, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None });
    vm.runInNewContext(compiled, {
      Deno: { env: { get: key => key === 'SUPABASE_SERVICE_ROLE_KEY' ? 'synthetic-service' : undefined }, serve: fn => { handler = fn; } },
      createClient: () => { clients++; throw new Error('Unauthorized client creation'); },
      corsHeaders: { 'Access-Control-Allow-Origin': '*' }, outboundBlockedResponse: () => null,
      Response, Request, URL, console,
    });
    const response = await handler(new Request('https://example.invalid/job', { method: 'POST', headers: { Authorization: 'Bearer user-jwt' } }));
    assert.equal(response.status, 403);
    assert.equal(clients, 0);
    const options = await handler(new Request('https://example.invalid/job', { method: 'OPTIONS' }));
    assert.equal(options.status, 200);
    assert.equal(clients, 0);
  });
}
test('hosting permits only the required additional media and map origins', () => {
  const csp = read('netlify.toml').match(/Content-Security-Policy = "([^"]+)"/)[1];
  const directives = Object.fromEntries(csp.split(';').map(part => { const [name, ...values] = part.trim().split(/\s+/); return [name, values]; }));
  assert.ok(directives['connect-src'].includes('https://*.raw.icp0.io'));
  assert.ok(directives['frame-src'].includes('https://www.google.com'));
  assert.deepEqual(directives['script-src'], ["'self'"]);
  assert.deepEqual(directives['object-src'], ["'none'"]);
  assert.ok(!directives['connect-src'].includes('*'));
});
test('store publication and hosting call the exact-commit gate before building', () => {
  const config = yaml.load(read('codemagic.yaml'));
  for (const workflow of ['android-workflow', 'ios-workflow']) {
    assert.equal(config.workflows[workflow].scripts[0].script, 'node scripts/prod-publication-gate.mjs');
  }
  const host = read('scripts/host-build-env.mjs');
  assert.ok(host.indexOf('await verifyProdPublication(env)') < host.indexOf('spawnSync(command'));
  const promotion = yaml.load(read('.github/workflows/promote-icp-prod.yml'));
  const steps = promotion.jobs.frontend.steps;
  const guard = steps.findIndex(step => step.run?.includes('prod-publication-gate.mjs --database-only'));
  const publish = steps.findIndex(step => step.name === 'Publish to the PROD frontend canister');
  assert.ok(guard >= 0 && publish > guard);
});
test('scheduled worker stays disabled, checks out prod, and binds execution to its commit', () => {
  const config = yaml.load(read('.github/workflows/icp-push-deliver-prod.yml'));
  const job = config.jobs.deliver;
  assert.match(job.if, /PROD_ICP_PUSH_ENABLED == 'true'/);
  assert.match(job.if, /event_name == 'schedule'.*refs\/heads\/main/);
  assert.equal(job.environment, 'production');
  assert.equal(job.steps[0].with.ref, 'refs/heads/prod');
  assert.equal(job.steps[0].with['persist-credentials'], false);
  assert.match(job.steps[1].run, /git rev-parse refs\/remotes\/origin\/prod/);
  assert.match(job.steps.at(-1).run, /GITHUB_REF=refs\/heads\/prod.*GITHUB_SHA="\$\(git rev-parse HEAD\)"/);
});