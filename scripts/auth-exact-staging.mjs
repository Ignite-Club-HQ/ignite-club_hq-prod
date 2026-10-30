import { lstatSync, readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { sha256 } from './prod-release-review.mjs';
import { buildSmallerReleaseReview, readSmallerReleaseInputs } from './smaller-release-review.mjs';

const bindings = Object.freeze({
  'docs/release-review/smaller-release-review.json': 'd9fa7c15282fd5bfab776b51629c19f90fff9f3740322d900ab865cc6224a89e',
  'docs/release-review/smaller-release-owner-approval.json': '6687c98a37651b5ed895698e368d86a287b0686d668191ef66601da6118ffdbd',
  'docs/release-review/prod-evidence-2026-10-30.json': 'f08c4ee89cff2f465d70470c7569c07e22813e4b615ac1a02da6cd3db99b81a6',
  'docs/release-review/prod-object-evidence-2026-10-30.json': '0a223f839ef5ea42dbdfe051c94163d69f3781cb781e8051713e18c3397e4927',
  'docs/release-review/prod-transition-evidence-2026-10-30.json': '1132f34f53de139fdf1e626daefd0b53ff5e7a9833bd87f76c74282e822ec3c3',
  'docs/release-review/signup-helper-draft.sql': 'fdbd6ff183360fed4427ff090be2e3c601252a4abdb181469d2d0f89172da9cd',
  'docs/release-review/signup-access-draft.sql': '12399ab2360a613eb3045ef661ce4c898ff78f63ffa93d5ee77a108ce18e2fac',
});
const candidatePaths = ['docs/release-review/signup-helper-draft.sql', 'docs/release-review/signup-access-draft.sql'];
const root = fileURLToPath(new URL('../', import.meta.url));

// Validate each ancestor, not just the final file: no symlinked source directories.
function regularFile(base, relative) {
  const parts = relative.split('/');
  if (path.isAbsolute(relative) || parts.some(p => !p || p === '.' || p === '..')) throw new Error('Unsafe source path');
  let current = base;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || (i === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) {
      throw new Error('Only regular source files and directories allowed');
    }
  }
  return readFileSync(current, 'utf8');
}

export function readAuthExactInputs(base = root) {
  const texts = Object.fromEntries(Object.keys(bindings).map(p => [p, regularFile(base, p)]));
  // Check migration and entrypoint ancestors before the broad inventory reader runs.
  const review = JSON.parse(texts['docs/release-review/smaller-release-review.json']);
  for (const entry of [...review.migrationInventory.map(e => ({ file: `supabase/migrations/${e.file}` })), ...review.sourceScope]) {
    regularFile(base, entry.file);
  }
  return { texts, smallerInputs: readSmallerReleaseInputs(base) };
}

/** Exact held package only; no connection, activation or runner inputs exist. */
export function buildAuthExactStagingManifest({ texts, smallerInputs }) {
  if (Object.keys(texts).sort().join('|') !== Object.keys(bindings).sort().join('|')) throw new Error('Exact bound input set required');
  for (const [p, hash] of Object.entries(bindings)) {
    if (typeof texts[p] !== 'string' || sha256(texts[p]) !== hash) throw new Error(`Reviewed bytes changed: ${p}`);
  }
  const savedReview = JSON.parse(texts['docs/release-review/smaller-release-review.json']);
  const generatedReview = buildSmallerReleaseReview(smallerInputs);
  if (JSON.stringify(savedReview) !== JSON.stringify(generatedReview)) throw new Error('Complete reviewed source inventory changed');
  for (const p of candidatePaths) {
    if (smallerInputs.drafts[path.basename(p)] !== texts[p]) throw new Error('Candidate substitution denied');
  }
  const approval = JSON.parse(texts['docs/release-review/smaller-release-owner-approval.json']);
  if (approval.scopeApprovalRecorded !== true || approval.readinessApproved !== false
      || approval.deploymentAuthorized !== false || approval.mergeAuthorized !== false
      || approval.runnerConsumable !== false || approval.reviewSha256 !== bindings[approval.reviewFile]) {
    throw new Error('Scope intent cannot become execution approval');
  }
  const evidence = JSON.parse(texts['docs/release-review/prod-evidence-2026-10-30.json']);
  if (evidence.projectRef !== 'yabcfiuntwqjwvschnji' || evidence.connectionIdentityIndependentlyVerified !== false) {
    throw new Error('Owner-supplied target provenance must remain explicit');
  }
  return {
    schemaVersion: 1, reviewOnly: true, rehearsalOnly: true, executionAuthorized: false,
    deploymentAuthorized: false, mergeAuthorized: false, runnerConsumable: false,
    dataClearingAuthorized: false, activationIncluded: false, independentlyVerifiedConnection: false,
    projectRef: evidence.projectRef,
    productionSourceAnchor: 'ea005b7178a6de9c207b744a2ea65cffde713b5f',
    sourceClosureAccepted: false,
    inputBindings: Object.entries(bindings).map(([file, hash]) => ({ file, sha256: hash })),
    originals: savedReview.migrationInventory,
    sourceEntryPoints: savedReview.sourceScope,
    candidates: candidatePaths.map((p, i) => ({ file: `candidates/0${i + 1}_signup-${i === 0 ? 'helper' : 'access'}.sql`,
      source: p, sha256: bindings[p], execute: false })),
    accountBeforeImages: {
      functions: evidence.signupFunctions?.map(e => ({ identity: e.function_signature ?? e.name, sha256: sha256(JSON.stringify(e)) })) ?? [],
      triggers: evidence.accountTriggers.map(e => ({ sha256: sha256(JSON.stringify(e)) })),
    },
    remainingGates: ['Auth-only frontend dependency closure against production',
      'Fresh independently authorized target reconciliation and object collision checks',
      'Existing invitation claim/use lifecycle and hosted signup confirmation acceptance',
      'Routing activation before-image, retained membership verification and separate approval',
      'Authenticated secure/email/admin acceptance and hosted publication configuration'],
  };
}

export function stageAuthExactWorkspace(inputs) {
  const manifest = buildAuthExactStagingManifest(inputs); // No output until all validation passes.
  const directory = mkdtempSync(path.join(tmpdir(), 'ignite-auth-exact-'));
  mkdirSync(path.join(directory, 'candidates'));
  for (const c of manifest.candidates) writeFileSync(path.join(directory, c.file), inputs.texts[c.source], { flag: 'wx', mode: 0o600 });
  writeFileSync(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return { directory, manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error('No target, connection or execution arguments accepted');
    const result = stageAuthExactWorkspace(readAuthExactInputs());
    console.log(`Held offline workspace: ${result.directory}; ${result.manifest.originals.length} originals excluded; no execution authorized.`);
    console.log(readdirSync(result.directory).join(', '));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}