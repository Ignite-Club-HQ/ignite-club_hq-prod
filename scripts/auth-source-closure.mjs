import { readFileSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import path from 'node:path';
import { sha256 } from './prod-release-review.mjs';

const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.css'];
const entries = ['components/AuthMethodChoice.tsx', 'components/ClubBackendEnforcement.tsx',
  'components/IcpSignInScreen.tsx', 'lib/emailSignupPolicy.ts', 'live/authBackendMode.ts',
  'live/backendRouting.ts', 'pages/AuthPage.tsx', 'pages/PlacementAdminSettingsPage.tsx',
  'hooks/useAuth.tsx', 'App.tsx'];

function resolveImport(root, from, specifier) {
  if (!specifier.startsWith('@/') && !specifier.startsWith('.')) return null;
  const base = specifier.startsWith('@/') ? path.join(root, specifier.slice(2)) : path.resolve(path.dirname(path.join(root, from)), specifier);
  if (!base.startsWith(`${root}${path.sep}`)) throw new Error('Import escapes source root');
  for (const p of [base, ...extensions.map(e => base + e), ...extensions.map(e => path.join(base, 'index' + e))]) {
    if (existsSync(p) && lstatSync(p).isFile() && !lstatSync(p).isSymbolicLink()) return path.relative(root, p);
  }
  return undefined;
}

/** Conservative import discovery is an audit, never acceptance or a copy plan. */
export function auditAuthSourceClosure({ currentRoot, productionRoot, productionCommit }) {
  if (productionCommit !== 'ea005b7178a6de9c207b744a2ea65cffde713b5f') throw new Error('Exact reviewed production anchor required');
  const root = path.resolve(currentRoot);
  const prod = path.resolve(productionRoot);
  const queue = [...entries];
  const seen = new Set();
  const files = [];
  const unresolved = [];
  const packages = new Set();
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(path.join(root, file), 'utf8');
    const baseline = path.join(prod, file);
    const before = existsSync(baseline) ? readFileSync(baseline, 'utf8') : null;
    const imports = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["']([^"']+)["']/g)].map(m => m[1]);
    for (const specifier of imports) {
      const dependency = resolveImport(root, file, specifier);
      if (dependency === null) packages.add(specifier);
      else if (dependency === undefined) unresolved.push({ file, specifier });
      else queue.push(dependency);
    }
    files.push({ file, sha256: sha256(source), productionSha256: before === null ? null : sha256(before),
      status: before === null ? 'absent-in-production' : before === source ? 'byte-identical' : 'requires-selective-adaptation' });
  }
  // Independent entire PROD source inventory allows later proof that unselected
  // score/push/data paths were preserved; no files are copied by this tool.
  const productionInventory = [];
  function walk(directory, prefix = '') {
    for (const name of readdirSync(directory).sort()) {
      if (['.git', '.env', 'node_modules'].includes(name)) continue;
      const full = path.join(directory, name);
      const file = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error('Symlinked production source denied');
      if (stat.isDirectory()) walk(full, file);
      else if (stat.isFile()) productionInventory.push({ file, sha256: sha256(readFileSync(full)) });
    }
  }
  walk(prod);
  files.sort((a, b) => a.file.localeCompare(b.file));
  return { schemaVersion: 1, reviewOnly: true, mergeAuthorized: false, deploymentAuthorized: false,
    sourceClosureAccepted: false, productionCommit, entryPoints: entries,
    limitations: ['Conservative import scan; excludes runtime-computed imports and requires manual semantic review',
      'App/provider graph is diagnostic only, not an instruction to copy all dependencies',
      'Backend routing may affect scores without changing score file bytes'],
    counts: { reachableFiles: files.length, missingInProduction: files.filter(f => f.status === 'absent-in-production').length,
      changed: files.filter(f => f.status === 'requires-selective-adaptation').length, unchanged: files.filter(f => f.status === 'byte-identical').length },
    files, unresolved, packages: [...packages].sort(), productionInventory,
    productionInventorySha256: sha256(JSON.stringify(productionInventory)) };
}