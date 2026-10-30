import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { auditAuthSourceClosure } from './auth-source-closure.mjs';
test('source audit marks changed/missing dependencies without granting bulk copy or release', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'ignite-auth-closure-test-'));
  const currentRoot = path.join(directory, 'current');
  const productionRoot = path.join(directory, 'prod');
  const entries = ['components/AuthMethodChoice.tsx', 'components/ClubBackendEnforcement.tsx', 'components/IcpSignInScreen.tsx',
    'lib/emailSignupPolicy.ts', 'live/authBackendMode.ts', 'live/backendRouting.ts', 'pages/AuthPage.tsx',
    'pages/PlacementAdminSettingsPage.tsx', 'hooks/useAuth.tsx', 'App.tsx'];
  try {
    for (const root of [currentRoot, productionRoot]) for (const file of entries) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), file === 'App.tsx' && root === currentRoot ? 'import "./lib/extra";' : 'export {};');
    }
    writeFileSync(path.join(currentRoot, 'lib/extra.ts'), 'import "react";');
    const report = auditAuthSourceClosure({ currentRoot, productionRoot, productionCommit: 'ea005b7178a6de9c207b744a2ea65cffde713b5f' });
    assert.deepEqual(report.counts, { reachableFiles: 11, missingInProduction: 1, changed: 1, unchanged: 9 });
    assert.deepEqual(report.packages, ['react']);
    assert.equal(report.mergeAuthorized, false);
    assert.equal(report.sourceClosureAccepted, false);
    assert.throws(() => auditAuthSourceClosure({ currentRoot, productionRoot, productionCommit: 'main' }));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});