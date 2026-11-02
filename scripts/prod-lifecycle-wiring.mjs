// PROD-only closed lifecycle wiring runner. Re-reads the exact routing gate,
// rebuilds the wiring plan, requires the reviewed hash and confirmation, then
// applies only allowlisted idempotent calls (media quota store, worker grants),
// re-reading the gate after each call. Never sets the removal switch, never
// changes identity links, never records approval and never opens a group.
import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readRoutingGate } from './prod-routing-gate.mjs';
import { planLifecycleWiring, assertWiringApproval, WIRING_METHODS } from './prod-lifecycle-wiring-policy.mjs';

let stage = 'startup';
const Unit = IDL => IDL.Variant({ Ok: IDL.Null, Err: IDL.Text });

async function main() {
  const env = process.env;
  mkdirSync(env.CHECK_REPORT_DIR, { recursive: true });
  const pushWorker = env.PROD_ICP_PUSH_WORKER_PRINCIPAL;
  const write = (name, value) => writeFileSync(path.join(env.CHECK_REPORT_DIR, name), JSON.stringify(value, null, 2));

  stage = 'read live gate and verify reviewed plan';
  let gate = await readRoutingGate(env);
  const plan = planLifecycleWiring(gate.review, { ids: gate.ids, pushWorker });
  assertWiringApproval(plan, { reviewedHash: env.WIRING_PLAN_HASH, confirmation: env.CONFIRMATION, groups: gate.page.groups });
  write('prod-lifecycle-wiring-before.json', plan);

  const { Actor, IDL, Principal, agent } = gate;
  const done = [];
  for (const op of plan.ready) {
    stage = `apply ${op.group}/${op.service}.${op.method}`;
    if (!WIRING_METHODS.includes(op.method)) throw new Error('Plan contains a call outside the closed wiring allowlist');
    const svc = Actor.createActor(() => IDL.Service({ [op.method]: IDL.Func([IDL.Principal], [Unit(IDL)], []) }),
      { agent, canisterId: op.canisterId });
    const reply = await svc[op.method](Principal.fromText(op.argument));
    if (!reply || 'Err' in reply) throw new Error(`${op.group}/${op.service} refused ${op.method}: ${String(reply?.Err ?? 'no reply').slice(0, 120)}`);

    stage = `read back ${op.group}/${op.service}.${op.setting}`;
    gate = await readRoutingGate(env, { log: false });
    const diag = gate.review.diagnostics.find(d => d.group === op.group && d.service === op.service);
    const binding = diag?.bindings.find(b => b.setting === op.setting);
    if (binding?.result !== 'matched') throw new Error(`${op.group}/${op.service} ${op.setting} did not read back; stop`);
    if (gate.page.groups.some(g => g.accepting !== false)) throw new Error('A group is no longer CLOSED; stop');
    done.push({ ...op, verified: true });
    write('prod-lifecycle-wiring-result.json', { planSha256: plan.planSha256, done });
  }

  const message = ['## PROD lifecycle wiring applied (closed)', '',
    `Plan \`${plan.planSha256}\`: ${done.length} call(s), each read back.`, '',
    ...done.map(o => `- ${o.group}/${o.service}: ${o.method}(${o.argument}) ✔`), '',
    'Groups stay CLOSED. No removal switch, identity link, routing approval, opening, funding, DEV or database change.'].join('\n');
  console.log(message);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, message + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  const reason = String(error?.message ?? 'unknown').slice(0, 240).replace(/[\r\n]+/g, ' ');
  const message = `### PROD lifecycle wiring stopped\n\nStage: ${stage}\n\nReason: ${reason}\n\nEvery call is idempotent; re-run the read-only gate and review before retrying.\n`;
  console.error(message);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, message);
  process.exitCode = 1;
});
