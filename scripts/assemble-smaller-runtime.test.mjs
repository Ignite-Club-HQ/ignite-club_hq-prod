import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {assembleSmallerRuntime} from './assemble-smaller-runtime.mjs';
import {sha256} from './prod-release-review.mjs';
import {ensureRehearsalDeps} from './ensure-frontend-deps.mjs';

test('installer refuses project directories before installing anything',()=>{
  assert.throws(()=>ensureRehearsalDeps('/dev-server/frontend'),/temporary/);
});
test('candidate preserves every original email score, push and startup byte outside exact three patches',()=>{
  const productionSource='/tmp/ignite-smaller-release/production-source';
  if(!existsSync(productionSource)) throw new Error('Extract exact production source before running candidate test');
  const {manifest,destination}=assembleSmallerRuntime({productionSource});
  assert.deepEqual(manifest.changedEmailFiles.map(f=>f.file),['hooks/useAuth.tsx','pages/AppSettingsPage.tsx','pages/AuthPage.tsx']);
  for(const file of ['App.tsx','main.tsx','components/PushNotificationManager.tsx','lib/notificationLaunchHandler.ts']){
    assert.equal(sha256(readFileSync(destination+'/email/src/'+file)),sha256(readFileSync(productionSource+'/src/'+file)));
  }
  assert.equal(manifest.legacyWorkerSha256,'af2817ac3cd4d75517791830e3ff71d2125ed9d90c3dd0207e8817aae3df6fe5');
  assert.equal(manifest.databaseExecutionAuthorized,false);
  assert.equal(manifest.deploymentAuthorized,false);
  assert.equal(manifest.secureProductionReady,false);
});