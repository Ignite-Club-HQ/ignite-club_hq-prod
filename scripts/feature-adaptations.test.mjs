import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { compileFeatureAdaptations,adaptVerifiedDefinition } from './feature-adaptation-review.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
test('nine drafts remain review-only and score transition is excluded from compiled rehearsal',()=>{
 const r=compileFeatureAdaptations(root);
 assert.equal(r.drafts.length,9);
 assert.equal(r.deploymentAuthorized,false);
 assert.equal(r.drafts[8].status,'held-data-transition-design');
 assert.doesNotMatch(r.sql,/UPDATE public\.competition_matches SET home_score|DROP TRIGGER|INSERT INTO storage\.buckets/);
});
test('legacy definition drift cannot be silently adapted',()=>{
 const r=JSON.parse(readFileSync(`${root}/docs/release-review/adaptation-definitions.json`,'utf8'));
 assert.throws(()=>adaptVerifiedDefinition(r.definitions.invitations.sql+'changed',r.definitions.invitations.sha256,'invitations'));
});
test('every adaptation is bound to unchanged original migration hashes',()=>{
 const manifest=JSON.parse(readFileSync(`${root}/docs/release-review/feature-adaptations-manifest.json`,'utf8'));
 const held=JSON.parse(readFileSync(`${root}/docs/release-review/transition-dispositions-2026-10-30.json`,'utf8'));
 assert.equal(manifest.adaptations.length,9);
 assert.equal(manifest.deploymentAuthorized,false);
 for(const draft of manifest.adaptations){
  for(const original of draft.originals){
   const expected=held.migrations.find(e=>e.file===original.file);
   assert.equal(original.sha256,expected?.sha256);
  }
 }
});
test('feature adapters run only on disposable local PostgreSQL with synthetic records',()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'ignite-features-local-'));
 const env={PATH:process.env.PATH,HOME:directory,LANG:'C.UTF-8'};
 const local=process.getuid?.()===0 ? {uid:1000,gid:1000}:{};
 const run=(cmd,args)=>{const r=spawnSync(cmd,args,{env,encoding:'utf8',timeout:60000,...local});assert.equal(r.status,0,`${cmd}: ${r.stderr}`);return r.stdout;};
 let started=false;
 try{
  const definitions=JSON.parse(readFileSync(`${root}/docs/release-review/adaptation-definitions.json`,'utf8')).definitions;
  const setup=readFileSync(`${root}/scripts/feature-adaptations-fixture.sql`,'utf8');
  const sql=setup+'\n'+definitions.events.sql+';\n'+definitions.duty.sql+';\nCREATE TRIGGER duty BEFORE INSERT OR UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.validate_event_duty_team();\n'+compileFeatureAdaptations(root).sql+'\n'+readFileSync(`${root}/scripts/feature-adaptations-assertions.sql`,'utf8');
  writeFileSync(path.join(directory,'rehearsal.sql'),sql);
  if(process.getuid?.()===0) assert.equal(spawnSync('chown',['-R','1000:1000',directory],{env}).status,0);
  run('initdb',['-D',`${directory}/data`,'-A','trust','-U','rehearsal','--no-locale']);
  run('pg_ctl',['-D',`${directory}/data`,'-l',`${directory}/server.log`,'-o',`-c listen_addresses='' -k ${directory} -p 55440`,'-w','start']);started=true;
  const output=run('psql',['-X','-h',directory,'-p','55440','-U','rehearsal','-d','postgres','-v','ON_ERROR_STOP=1','-f',`${directory}/rehearsal.sql`]);
  assert.match(output,/PASS: canonical event replay/);
 }finally{if(started)run('pg_ctl',['-D',`${directory}/data`,'-m','immediate','-w','stop']);rmSync(directory,{recursive:true,force:true});}
});