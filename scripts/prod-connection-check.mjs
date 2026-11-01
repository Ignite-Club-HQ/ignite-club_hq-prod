import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { createPrivateKey } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { assertCheckContext, readerSpec, checkCalls, assessLinks, failureReason, internalReason, evidenceText } from './prod-connection-check-policy.mjs';
import { assessGroupReadiness, setupProposal } from './prod-group-readiness.mjs';
import { G2_REGISTRATION_RECEIPT_PATH, reviewedG2Inventory } from './prod-g2-register-policy.mjs';

// The reviewed inventory must come from our own acknowledged journal receipt,
// never from the router reply it is meant to check. Failures stay bounded and
// secret-free: an unavailable review keeps the group flagged, it never passes.
export function inventoryEvidenceFailureReason(error) {
  const message = error instanceof Error ? error.message : '';
  const known = [
    'Live repository journal authorization required',
    'Acknowledged closed g2 registration receipt required',
    'Reviewed g2 inventory is incomplete',
    'Reviewed g2 inventory must be independent of base',
    'Journal readback failed; stop without replay',
  ];
  if (known.includes(message)) return message;
  if (/^GitHub journal (GET|POST|PUT) failed \([0-9]{3}\); stop without replay$/.test(message)) return message;
  return 'Inventory evidence unavailable; independent review outstanding';
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// invoke(spec) returns the decoded reply. Configuration readers return the
// [key, value] pairs (variant readers already unwrapped); router readers
// return their raw variant for review.
export async function runCheck({ ids, env, principal, invoke, save }) {
  assertCheckContext(ids, env, principal);
  const report = { checkedAt: new Date().toISOString(), commit: env.GITHUB_SHA,
    scope: 'PROD infrastructure readback only; no activation or business records', rows: [], complete: false, connectionsComplete: true };
  for (const call of checkCalls(ids)) {
    const row = { name: call.name, id: call.id, method: call.method, query: call.query };
    try {
      const value = await invoke(readerSpec(call, ids));
      if (call.method === 'read_group_opening_configuration') {
        row.configuration = value;
        row.links = assessLinks(call.name, value, ids);
        const bad = row.links.filter(link => !link.matches);
        row.verdict = bad.length ? 'LINK_MISMATCH' : 'READBACK';
        row.reason = bad.length
          ? bad.map(l => `${l.key}: ${l.observed.length ? l.observed.join(',') : 'not set'}`).join('; ').slice(0, 300)
          : row.links.length ? `${row.links.length} link(s) confirmed` : 'Configuration read; no service-link comparisons defined (not a readiness pass)';
      } else {
        const text = evidenceText(value);
        if (text.length > 262144) throw new Error('Infrastructure reply exceeded evidence bound');
        row.evidence = text;
        // Keep typed infrastructure evidence for bounded readiness assessment.
        if (call.method === 'read_group_registry_page') row.registry = value;
        if (call.method === 'read_routing_approval') row.approval = value;
        if (value && typeof value === 'object' && 'Err' in value) {
          row.verdict = 'READER_DENIED';
          row.reason = `Canister refused: ${String(value.Err).slice(0, 160)}`;
        } else {
          row.verdict = 'REVIEW_ROUTING_EVIDENCE';
          const ok = value?.Ok;
          row.reason = call.method === 'read_routing_approval'
            ? (Array.isArray(ok) && ok.length ? 'approval recorded; revision/inventory must match' : 'no approval recorded — group setup incomplete')
            : call.method === 'read_group_registry_page' ? `${ok?.groups?.length ?? 0} group(s) in bounded registry page`
              : Array.isArray(ok) ? `${ok.length} group(s) registered` : 'reply received';
        }
      }
    } catch (error) {
      // Raw library output is never stored: only the bounded, redacted
      // canister reason from failureReason explains the failure.
      row.verdict = 'UNREADABLE';
      row.reason = error?.stderr ? failureReason(error.stderr) : (internalReason(error) || failureReason(''));
      // A fresh-install state is not readiness for independent PROD groups.
      if (call.name === 'identity_access' && call.method === 'read_group_opening_configuration' &&
          row.reason === 'Canister refused: Deletion registry not pinned') {
        row.verdict = 'NOT_PINNED_YET';
        row.reason = 'Trusted PROD registry not pinned — group setup incomplete';
      }
    }
    if (['UNREADABLE', 'READER_DENIED', 'LINK_MISMATCH'].includes(row.verdict)) report.connectionsComplete = false;
    report.rows.push(row);
    report.readiness = assessGroupReadiness(report);
    report.complete = report.readiness.infrastructureComplete;
    await save(report);
  }
  return report;
}

export function summaryLines(report) {
  return ['### PROD connection check', '', '| Service | Check | Result | Reason |', '|---|---|---|---|',
    ...report.rows.map(r => `| ${r.name} | ${r.method} | ${r.verdict} | ${String(r.reason ?? '').replace(/\|/g, '/')} |`), '',
    report.connectionsComplete ? 'Base connection reads passed; this alone does not complete group setup.' : 'Some base connections need attention.',
    '', '### PROD group readiness', '',
    ...(report.readiness?.gaps ?? []).map(g => `- ${g.code}: ${g.detail}`),
    report.complete ? 'Bounded infrastructure checks passed; full release/opening acceptance remains separate.' : 'PROD group setup is incomplete. Do not open groups or connect the live app yet.',
    'No routing, canister configuration, DEV connection or database changes were made.',
    'Routing replies are evidence for review, not permission to open a group.'];
}

// Loads the decrypted governor PEM (secp256k1 or Ed25519) as an agent identity.
export function identityFromPem(pem, lib) {
  const jwk = createPrivateKey(pem).export({ format: 'jwk' });
  const secret = Buffer.from(jwk.d, 'base64url');
  if (jwk.kty === 'OKP' && jwk.crv === 'Ed25519') return lib.Ed25519KeyIdentity.fromSecretKey(new Uint8Array(secret));
  if (jwk.kty === 'EC' && jwk.crv === 'secp256k1') return lib.Secp256k1KeyIdentity.fromSecretKey(new Uint8Array(secret));
  throw new Error('Unsupported governor key type');
}

async function main() {
  const env = process.env;
  const ids = JSON.parse(readFileSync(path.join(ROOT, 'deploy/prod/.icp/data/mappings/ic.ids.json'), 'utf8'));
  const require = createRequire(path.join(env.CHECK_DEPS_DIR, 'package.json'));
  const { HttpAgent, Actor } = require('@icp-sdk/core/agent');
  const { IDL } = require('@icp-sdk/core/candid');
  const { Ed25519KeyIdentity } = require('@icp-sdk/core/identity');
  const { Secp256k1KeyIdentity } = require('@icp-sdk/core/identity/secp256k1');
  const identity = identityFromPem(readFileSync(env.CHECK_KEY_PEM, 'utf8'), { Ed25519KeyIdentity, Secp256k1KeyIdentity });
  const principal = identity.getPrincipal().toText();
  console.log(`Signing as ${principal}`);

  const Pairs = IDL.Vec(IDL.Tuple(IDL.Text, IDL.Text));
  const Result = ok => IDL.Variant({ Ok: ok, Err: IDL.Text });
  const DomainCanister = IDL.Record({ domain: IDL.Text, canister: IDL.Principal });
  const ShardGroup = IDL.Record({ id: IDL.Text, max_clubs: IDL.Nat32, observed_at_ns: IDL.Nat64, accepting: IDL.Bool,
    photo_store: IDL.Opt(IDL.Principal), heap_budget_bytes: IDL.Nat64, cycles: IDL.Nat64, assigned_clubs: IDL.Nat32,
    domains: IDL.Vec(DomainCanister), target_alias: IDL.Text, min_cycles: IDL.Nat64, heap_bytes: IDL.Nat64 });
  const RoutingApproval = IDL.Record({ configuration_revision: IDL.Nat64, removal_checked_at_ms: IDL.Nat64,
    approved_configuration_sha256: IDL.Text, target_alias: IDL.Text, removal_wiring_group_ids: IDL.Vec(IDL.Text), evidence_sha256: IDL.Text });
  const Placement = IDL.Record({ group_id: IDL.Text, deployment_id: IDL.Text, deployment_revision: IDL.Nat64,
    host: IDL.Text, network_kind: IDL.Text, primary_subnet: IDL.Principal,
    approved_subnets: IDL.Vec(IDL.Principal), additional_subnets_enabled: IDL.Bool,
    domains: IDL.Vec(IDL.Record({ domain: IDL.Text, canister: IDL.Principal, subnet: IDL.Principal })) });
  const RegistryPage = IDL.Record({ groups: IDL.Vec(ShardGroup), placements: IDL.Vec(Placement),
    revision: IDL.Nat64, configuration_revision: IDL.Opt(IDL.Nat64), next_cursor: IDL.Opt(IDL.Text) });
  const signatures = {
    read_group_opening_configuration: variant => IDL.Func([], [variant ? Result(Pairs) : Pairs], []),
    list_groups: () => IDL.Func([], [Result(IDL.Vec(ShardGroup))], ['query']),
    read_group_registry_page: () => IDL.Func([IDL.Text, IDL.Opt(IDL.Nat64), IDL.Opt(IDL.Text), IDL.Nat32], [Result(RegistryPage)], []),
    read_routing_approval: () => IDL.Func([IDL.Text], [Result(IDL.Opt(RoutingApproval))], []),
  };

  const agent = await HttpAgent.create({ host: 'https://icp-api.io', identity });
  const output = path.join(env.CHECK_REPORT_DIR, 'prod-connections.json');
  mkdirSync(env.CHECK_REPORT_DIR, { recursive: true });
  const report = await runCheck({ ids, env, principal,
    invoke: async spec => {
      const func = signatures[spec.method](spec.variant);
      const actor = Actor.createActor(() => IDL.Service({ [spec.method]: func }), { agent, canisterId: spec.canisterId });
      let value;
      try {
        value = await actor[spec.method](...spec.args);
      } catch (error) {
        const wrapped = new Error('Reader call failed');
        wrapped.stderr = String(error?.message ?? error);
        throw wrapped;
      }
      if (spec.method !== 'read_group_opening_configuration') return value;
      if (!spec.variant) return value;
      if (value && 'Ok' in value) return value.Ok;
      const denied = new Error('Configuration reader denied');
      denied.stderr = `with message: '${String(value?.Err ?? 'denied').slice(0, 200)}'`;
      throw denied;
    },
    save: report => writeFileSync(output, evidenceText(report)),
  });
  writeFileSync(path.join(env.CHECK_REPORT_DIR, 'prod-group-setup-proposal.json'), evidenceText(setupProposal(report.readiness)));
  const lines = summaryLines(report);
  // Printed to the log too, so the result is visible from the job screen.
  console.log(lines.join('\n'));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  if (!report.complete) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    const reason = typeof error?.code === 'string' && error.path ? `${error.code} ${path.basename(error.path)}` : internalReason(error) || (/^(Connection check requires|Unsupported governor key type|PROD governor|PROD must not|Governor principal|Repository variable)/.test(String(error?.message)) ? String(error.message).slice(0, 200) : failureReason(error?.stderr ?? ''));
    console.error(`PROD connection check stopped before finishing: ${reason}. No configuration changes were attempted.`);
    process.exitCode = 1;
  });
}
