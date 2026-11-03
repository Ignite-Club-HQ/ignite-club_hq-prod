// The allowlist of files that may be promoted from the development repository
// into the live repository, plus the decision rules for a copy run.
//
// Why this exists: the live repository is a different, older layout (the web app
// still sits at its root), so a whole-tree copy would overwrite live code with a
// structure that does not belong there. Only the canister layer — sources, their
// build settings, the live environment definition and the release tooling that
// drives them — is promoted, and only where the live repository does not already
// have a file. Everything else in the live repository stays exactly as it is.
//
// Pure: no network, no CLI. The runner does the copying; the guards are testable.
export const PROD_REPO = 'Ignite-Club-HQ/ignite-club_hq-prod';
export const PROD_BRANCH = 'prod';
export const SOURCE_BRANCH = 'main';

/** Whole subtrees that belong to the canister layer. */
export const ICP_SOURCE_PREFIXES = ['backend/', 'deploy/prod/'];

/**
 * Exact files: release tooling and the card-funding path. Listed one by one so a
 * same-named file in the live repository's own `scripts/` folder can never be
 * silently replaced by a directory-wide rule.
 */
export const ICP_SOURCE_FILES = [
  'mops.toml',
  'mops.lock',
  'scripts/icp-environments.mjs',
  'scripts/icp-environments.test.mjs',
  'scripts/record-prod-release.mjs',
  'scripts/deploy-mainnet.sh',
  'scripts/push-worker-principal.mjs',
  'scripts/prod-push-key-policy.mjs',
  'scripts/prod-push-key.mjs',
  'scripts/prod-push-key.test.mjs',
  'scripts/prod-account-key-policy.mjs',
  'scripts/prod-account-key.mjs',
  'scripts/prod-account-key.test.mjs',
  'scripts/prod-safeguard-setup.mjs',
  'scripts/prod-safeguard-setup.test.mjs',
  'scripts/prod-protection-contract.mjs',
  'scripts/prod-protection-policy.mjs',
  'scripts/prod-protection-policy.test.mjs',
  'scripts/prod-protection-live.mjs',
  'scripts/resolve-prod-push-worker.mjs',
  'scripts/prod-publication-gate.mjs',
  'scripts/prod-card-funding.mjs',
  'scripts/prod-card-funding-policy.mjs',
  'scripts/prod-card-funding-policy.test.mjs',
  'scripts/prod-card-funding-workflow.test.mjs',
  'scripts/prod-connection-check-policy.mjs',
  'scripts/prod-connection-check.mjs',
  'scripts/prod-connection-check.test.mjs',
  'scripts/prod-group-readiness.mjs',
  'scripts/prod-group-readiness.test.mjs',
  'scripts/prod-group-contract.mjs',
  'scripts/prod-base-group-policy.mjs',
  'scripts/prod-base-group.mjs',
  'scripts/prod-base-group.test.mjs',
  'scripts/prod-g2-plan-policy.mjs',
  'scripts/prod-g2-plan.mjs',
  'scripts/prod-g2-plan.test.mjs',
  'scripts/prod-g2-create-policy.mjs',
  'scripts/prod-g2-create.mjs',
  'scripts/prod-g2-create.test.mjs',
  'scripts/prod-g2-idl.mjs',
  'scripts/prod-g2-register-policy.mjs',
  'scripts/prod-g2-register.mjs',
  'scripts/prod-g2-register.test.mjs',
  'scripts/prod-identity-link-policy.mjs',
  'scripts/prod-identity-link.mjs',
  'scripts/prod-identity-link.test.mjs',
  'scripts/prod-routing-gate-policy.mjs',
  'scripts/prod-routing-gate.mjs',
  'scripts/prod-routing-gate.test.mjs',
  'scripts/prod-lifecycle-wiring-policy.mjs',
  'scripts/prod-lifecycle-wiring-policy.test.mjs',
  'scripts/prod-lifecycle-wiring.mjs',
  'scripts/prod-cycles-topup-policy.mjs',
  'scripts/prod-cycles-topup.mjs',
  'scripts/prod-cycles-topup.test.mjs',
  'scripts/enlarge-photo-store-policy.mjs',
  'scripts/stage-group-wasm.mjs',
  'scripts/resolve-group-push-worker.sh',
  'scripts/media-card-funding-policy.mjs',
  'frontend/scripts/media-stage-two-github.mjs',
  // The live upgrade's photo-key safety check runs before and after every
  // upgrade; without these the live repository cannot upgrade at all.
  'frontend/scripts/media-key-deploy-preflight.mjs',
  'frontend/scripts/media-key-deploy-rules.mjs',
  'frontend/scripts/media-key-mainnet.mjs',

  '.github/workflows/promote-icp-prod.yml',
  '.github/workflows/apply-prod-lifecycle-wiring.yml',
  '.github/workflows/fund-prod-canisters-by-card.yml',
  '.github/workflows/check-prod-canister-connections.yml',
  '.github/workflows/setup-prod-base-group.yml',
  '.github/workflows/plan-prod-second-group.yml',
  '.github/workflows/create-prod-second-group.yml',
  '.github/workflows/register-prod-second-group.yml',
  '.github/workflows/link-prod-account-service.yml',
  '.github/workflows/check-prod-routing-gates.yml',
  '.github/workflows/plan-prod-cycles-topup.yml',
  '.github/workflows/execute-prod-cycles-topup.yml',
  '.github/workflows/prod-create-push-key.yml',
  '.github/workflows/prod-create-account-approval-key.yml',
  '.github/workflows/prod-activate-protections.yml',
];

/**
 * Generated or machine-local files that must never travel: compiled wasm is
 * rebuilt by the deploy, and `.icp/` / `release.json` hold the *live* canister
 * IDs and release progress — copying those into the live repository would hand
 * the live release tools the development canister set.
 */
const NEVER_COPY = [
  /\.wasm$/,
  /(^|\/)\.mops\//,
  /(^|\/)\.dfx\//,
  /(^|\/)\.icp\//,
  /(^|\/)release\.json$/,
  /(^|\/)target\//,

  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)\.git\//,
];

const neverCopy = (file) => NEVER_COPY.some((pattern) => pattern.test(file));

/** Where a promotion may land: the live repository's release branch, never anything else. */
export function assertPromotionTarget({ dest = PROD_REPO, branch = PROD_BRANCH } = {}) {
  if (dest !== PROD_REPO) throw new Error(`Only the live repository ${PROD_REPO} may receive this layer; asked for ${dest}.`);
  if (branch !== PROD_BRANCH) throw new Error(`Only the ${PROD_BRANCH} branch may receive this layer; asked for ${branch}.`);
}


/** Every path the manifest allows, from a list of repository files. */
export function promotionFiles(files) {
  const allowed = new Set(files);
  const found = ICP_SOURCE_FILES.filter((file) => allowed.has(file));
  for (const prefix of ICP_SOURCE_PREFIXES) {
    for (const file of files) if (file.startsWith(prefix)) found.push(file);
  }
  return [...new Set(found)].filter((file) => !neverCopy(file)).sort();
}

/**
 * Manifest entries the source checkout is missing. A promotion with holes would
 * hand the live repository a canister layer it cannot build, so the runner stops
 * here and names them instead.
 */
export function missingSourceEntries(files) {
  const allowed = new Set(files);
  const missing = ICP_SOURCE_FILES.filter((file) => !allowed.has(file));
  for (const prefix of ICP_SOURCE_PREFIXES) {
    if (!files.some((file) => file.startsWith(prefix) && !neverCopy(file))) missing.push(prefix);
  }
  return missing;
}

/**
 * What a copy run would do, given what the live repository already holds.
 * Only absent files are added; a file that exists with different content is a
 * conflict that stops the run, because overwriting live code is not promotion.
 */
/**
 * The files a copy run writes. Absent files are always added; files the live
 * repository holds with different bytes are written only when the operator
 * explicitly chose to overwrite them. Overwrite must never be a silent no-op:
 * a run that reports success while skipping the files it was asked to replace
 * leaves the live branch on the old bytes.
 */
export function filesToWrite({ add, differ, allowDrift }) {
  if (differ.length && !allowDrift) return null; // the caller must stop
  return [...new Set([...add, ...(allowDrift ? differ : [])])].sort();
}

export function planPromotion({ files, existing }) {
  const wanted = promotionFiles(files);
  const have = new Set(existing);
  const copy = wanted.filter((file) => !have.has(file));
  const unchanged = wanted.filter((file) => have.has(file));
  return {
    copy,
    alreadyPresent: unchanged,
    conflicts: [],
    refused: files.filter((file) => !wanted.includes(file) && ICP_SOURCE_PREFIXES.some((p) => file.startsWith(p))),
  };
}
