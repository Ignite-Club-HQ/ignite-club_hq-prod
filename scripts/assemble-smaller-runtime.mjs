import { readFileSync, writeFileSync, readdirSync, lstatSync, mkdirSync, mkdtempSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './prod-release-review.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const anchor = 'ea005b7178a6de9c207b744a2ea65cffde713b5f';
function patchOnce(text, before, after) {
  if (text.split(before).length !== 2) throw new Error('Selective source anchor changed');
  return text.replace(before, after);
}
function filesAt(directory, prefix = '') {
  const result = [];
  for (const name of readdirSync(directory).sort()) {
    if (name === '.git' || name === 'node_modules' || name === '.env' || name.startsWith('.env.')) continue;
    const full = path.join(directory, name), rel = prefix ? prefix + '/' + name : name;
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error('Source links forbidden');
    if (stat.isDirectory()) result.push(...filesAt(full, rel));
    else if (stat.isFile()) result.push({ file: rel, sha256: sha256(readFileSync(full)) });
  }
  return result;
}

/** Temporary DEV rehearsal only. No deployment or SQL execution interface. */
export function assembleSmallerRuntime({ productionSource, currentRoot = root }) {
  const review = JSON.parse(readFileSync(path.join(currentRoot, 'docs/release-review/auth-source-closure-2026-10-30.json')));
  const actual = filesAt(path.join(productionSource, 'src'));
  if (review.productionCommit !== anchor || JSON.stringify(actual) !== JSON.stringify(review.productionInventory)) {
    throw new Error('Exact independently inventoried production source required');
  }
  const destination = mkdtempSync(path.join(tmpdir(), 'ignite-smaller-runtime-'));
  const email = path.join(destination, 'email'), secure = path.join(destination, 'secure');
  mkdirSync(email); mkdirSync(secure);
  cpSync(path.join(productionSource, 'src'), path.join(email, 'src'), { recursive: true });
  // Secure input is the complete working ICP app, not eight cherry-picked files.
  // Inventory and copy only source; generated output/dependencies never enter it.
  cpSync(path.join(currentRoot, 'frontend/src'), path.join(secure, 'src'), { recursive: true,
    filter: p => !p.split(path.sep).some(n => ['node_modules','.git','.env'].includes(n)) });
  cpSync(path.join(currentRoot, 'frontend/public'), path.join(destination, 'public'), { recursive: true });
  const currentPackage = JSON.parse(readFileSync(path.join(currentRoot,'frontend/package.json')));
  const oldPackage = JSON.parse(readFileSync(path.join(productionSource,'package.json')));
  // Keep current paired ICP SDK versions, recover missing legacy native plugins.
  const candidatePackage = {...currentPackage, scripts:{}, dependencies:{...oldPackage.dependencies,...currentPackage.dependencies}};
  writeFileSync(path.join(destination,'package.json'),JSON.stringify(candidatePackage,null,2)+'\n');
  const put = (base, relative, text) => { const p = path.join(base, relative); mkdirSync(path.dirname(p), {recursive:true}); writeFileSync(p, text); };
  const template = name => readFileSync(path.join(currentRoot, 'scripts/release-templates', name), 'utf8');
  const runtime = readFileSync(path.join(currentRoot, 'scripts/smaller-release-runtime.mjs'), 'utf8');
  for (const base of [email, secure]) {
    put(base, 'src/lib/releaseRuntime.js', runtime);
    put(base, 'src/components/ReleaseAuthTabs.tsx', template('ReleaseAuthTabs.tsx'));
  }
  put(email, 'src/lib/releaseEmailSignup.ts', template('email-signup-policy.ts'));
  put(email, 'src/components/admin/RetainedEmailSettings.tsx', template('RetainedEmailSettings.tsx'));
  let auth = readFileSync(path.join(email, 'src/pages/AuthPage.tsx'), 'utf8');
  auth = "import { ReleaseAuthTabs } from '@/components/ReleaseAuthTabs';\n" + auth;
  auth = patchOnce(auth, '        <Card className={authCardClassName}>', '        {!isInInviteFlow && <ReleaseAuthTabs value="supabase" disabled={loading || googleLoading} />}\n        <Card className={authCardClassName}>');
  put(email, 'src/pages/AuthPage.tsx', auth);
  let provider = readFileSync(path.join(email, 'src/hooks/useAuth.tsx'), 'utf8');
  provider = "import { prepareEmailSignup } from '@/lib/releaseEmailSignup';\n" + provider;
  provider = patchOnce(provider, '      const { data, error } = await supabase.auth.signUp({', '      const inviteToken = await prepareEmailSignup(email);\n      const { data, error } = await supabase.auth.signUp({');
  provider = patchOnce(provider, '        options: { emailRedirectTo: redirectUrl },', '        options: { emailRedirectTo: redirectUrl, ...(inviteToken ? { data: { email_signup_invite_token: inviteToken } } : {}) },');
  put(email, 'src/hooks/useAuth.tsx', provider);
  let settings = readFileSync(path.join(email, 'src/pages/AppSettingsPage.tsx'), 'utf8');
  settings = "import { RetainedEmailSettings } from '@/components/admin/RetainedEmailSettings';\n" + settings;
  settings = patchOnce(settings, '        <LegalReacceptanceAdminCard />', '        <RetainedEmailSettings />\n        <LegalReacceptanceAdminCard />');
  put(email, 'src/pages/AppSettingsPage.tsx', settings);
  let app = readFileSync(path.join(secure, 'src/App.tsx'), 'utf8');
  app = patchOnce(app, '  const AuthBoundary = useIcpAuth ? IcpAuthProvider : AuthProvider;', '  const AuthBoundary = IcpAuthProvider;');
  app = patchOnce(app, '<BrowserRouter useTransitions={false}>', '<BrowserRouter basename="/secure" useTransitions={false}>');
  app = patchOnce(app, 'const ScoreHistoryReviewPage = lazyWithRetry(() => import("./pages/ScoreHistoryReviewPage"));\n', '');
  app = patchOnce(app, '                  <Route path="/clubs/:clubId/score-review" element={<ScoreHistoryReviewPage />} />\n', '');
  put(secure, 'src/App.tsx', app);
  let secureAuth = readFileSync(path.join(secure, 'src/pages/AuthPage.tsx'), 'utf8');
  secureAuth = "import { ReleaseAuthTabs } from '@/components/ReleaseAuthTabs';\n" + secureAuth;
  secureAuth = patchOnce(secureAuth, '  const useIcpLab = !forceEmailAuth && (forceIcpAuth || icpScreen);', '  const useIcpLab = true;');
  const start = secureAuth.indexOf('  const methodTabs = showMethodTabs ? <AuthMethodChoice');
  const end = secureAuth.indexOf('\n\n  if (useIcpLab)', start);
  if (start < 0 || end < start) throw new Error('Secure tab anchor missing');
  secureAuth = secureAuth.slice(0,start) + '  const methodTabs = !isInInviteFlow ? <ReleaseAuthTabs value="icp" disabled={loading || googleLoading || !!resumingSignIn} /> : undefined;' + secureAuth.slice(end);
  secureAuth = patchOnce(secureAuth, '          if (canSwitchMethod) { setAuthMethodChoice("supabase"); return; }', '          window.location.assign("/auth"); return;');
  put(secure, 'src/pages/AuthPage.tsx', secureAuth);
  let ii = readFileSync(path.join(secure, 'src/live/internetIdentityAuth.ts'), 'utf8');
  ii = patchOnce(ii, 'export const II_REDIRECT_CALLBACK_PATH = "/auth";', 'export const II_REDIRECT_CALLBACK_PATH = "/secure/auth";');
  put(secure, 'src/live/internetIdentityAuth.ts', ii);
  let mode = readFileSync(path.join(secure, 'src/live/authBackendMode.ts'), 'utf8');
  mode = patchOnce(mode, '  return mountedAuthProvider === "icp";', '  return true;');
  mode = patchOnce(mode, '  if (mountedAuthProvider === "icp") return false;', '  return false;');
  mode = patchOnce(mode, 'export function readAuthChoice(): BackendProvider | null {', 'export function readAuthChoice(): BackendProvider | null {\n  return "icp";');
  put(secure, 'src/live/authBackendMode.ts', mode);
  // Hard-reload recoveries belong to the secure document, never legacy home.
  for (const file of ['components/RouteErrorBoundary.tsx','components/ClubBackendEnforcement.tsx','lib/pushNotifications.ts']) {
    const source = readFileSync(path.join(secure,'src',file),'utf8');
    if (!source.includes('window.location.replace("/")')) throw new Error('Secure recovery anchor missing');
    put(secure,'src/'+file, source.replaceAll('window.location.replace("/")','window.location.replace("/secure/")'));
  }
  let lazy = readFileSync(path.join(secure,'src/lib/lazyWithRetry.ts'),'utf8');
  lazy = patchOnce(lazy, 'window.location.hash : "/",', 'window.location.hash : "/secure/",');
  put(secure,'src/lib/lazyWithRetry.ts',lazy);
  let notFound = readFileSync(path.join(secure,'src/pages/NotFound.tsx'),'utf8');
  notFound = patchOnce(notFound,'href="/"','href="/secure/"');
  put(secure,'src/pages/NotFound.tsx',notFound);
  let denial = readFileSync(path.join(secure,'src/lib/emailSignupPolicy.ts'),'utf8');
  denial = patchOnce(denial,'Email accounts are available by invitation for Bridgewater Soccer Club and Basket Range Cricket Club. For other clubs, continue with Internet Identity.',
    'Email accounts are available by invitation. Otherwise, continue with Internet Identity.');
  put(secure,'src/lib/emailSignupPolicy.ts',denial);
  // Never mutate shared legacy invite/draft storage when secure renders.
  // The retained email runtime keeps every original key and cleanup rule.
  const privateKeys = ['redirectAfterAuth','inviteAuthContext','inviteFlowContext'];
  for (const item of filesAt(path.join(secure,'src'))) {
    if (!/\.(?:tsx?|jsx?)$/.test(item.file)) continue;
    let text = readFileSync(path.join(secure,'src',item.file),'utf8');
    const old = text;
    for (const key of privateKeys) text = text.replaceAll('"'+key+'"','"ignite_secure_'+key+'"').replaceAll("'"+key+"'","'ignite_secure_"+key+"'");
    if (text !== old) put(secure,'src/'+item.file,text);
  }
  const html = entry => `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Ignite Club HQ</title><meta name="description" content="Your club, teams, events and conversations in Ignite Club HQ."></head><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>`;
  put(destination,'email-index.html',html('/email/src/main.tsx'));
  put(destination,'secure-index.html',html('/secure/src/product-main.tsx'));
  const tailwind = readFileSync(path.join(currentRoot,'frontend/tailwind.config.ts'),'utf8')
    .replace('"./src/**/*.{ts,tsx}"','"./email/src/**/*.{ts,tsx}", "./secure/src/**/*.{ts,tsx}"');
  put(destination,'tailwind.config.ts',tailwind);
  put(destination,'postcss.config.js',readFileSync(path.join(currentRoot,'frontend/postcss.config.js'),'utf8'));
  put(destination,'public/_redirects','/secure/* /secure-index.html 200\n/* /email-index.html 200\n');
  // Local DEV callbacks only; host-specific PROD allowlists require verified origin.
  put(destination,'public/.well-known/ii-auth-callbacks',JSON.stringify({callbacks:['http://localhost:8082/secure/auth']})+'\n');
  put(destination,'public/secure/native-sign-in.html',readFileSync(path.join(currentRoot,'frontend/public/native-sign-in.html'),'utf8'));
  // The exact legacy worker has no fetch handler or email-shell fallback.
  // Do not replace its push lifecycle with the newer preview worker.
  const sw = readFileSync(path.join(productionSource,'public/sw.js'),'utf8');
  if (sha256(sw) !== 'af2817ac3cd4d75517791830e3ff71d2125ed9d90c3dd0207e8817aae3df6fe5') throw new Error('Legacy service worker fingerprint changed');
  if (sw.includes("addEventListener('fetch'") || sw.includes('addEventListener("fetch"')) {
    throw new Error('Legacy service worker navigation boundary requires re-review');
  }
  put(destination,'public/sw.js',sw);
  put(destination,'vite.config.mjs',template('vite-runtime-config.mjs'));
  const emailAfter = filesAt(path.join(email, 'src'));
  const changed = actual.filter(e => emailAfter.find(f => f.file === e.file)?.sha256 !== e.sha256);
  if (changed.map(f => f.file).sort().join('|') !== ['hooks/useAuth.tsx','pages/AppSettingsPage.tsx','pages/AuthPage.tsx'].join('|')) {
    throw new Error('Unreviewed legacy email changes');
  }
  const manifest = { schemaVersion:1, productionCommit:anchor, rehearsalOnly:true, deploymentAuthorized:false,
    mergeAuthorized:false, databaseExecutionAuthorized:false, sourceClosureAccepted:false,
    secureProductionReady:false, nativeAcceptance:false,
    beforeImages: actual, changedEmailFiles:changed, email:emailAfter, secure:filesAt(path.join(secure,'src')),
    legacyWorkerSha256:sha256(sw), candidatePackageSha256:sha256(JSON.stringify(candidatePackage)),
    limitations:['Secure raw-link and native deep-link adaptation still requires acceptance',
      'Verified PROD canister inventory absent; hosted settings and authenticated acceptance unverified',
      'DEV rehearsal is not the approved production migration runner'] };
  writeFileSync(path.join(destination,'manifest.json'), JSON.stringify(manifest,null,2)+'\n');
  return { destination, manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Supply only the locally extracted production source directory');
    const result = assembleSmallerRuntime({productionSource:path.resolve(process.argv[2])});
    console.log(`Local candidate: ${result.destination}; ${result.manifest.changedEmailFiles.length} selective email edits; production unchanged.`);
  } catch (e) { console.error(e.message); process.exitCode=1; }
}