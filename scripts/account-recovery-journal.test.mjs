import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAccountRecoveryJournal } from './account-recovery-journal.mjs';
const binding='a'.repeat(64);
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'account-recovery-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
test('exclusive non-expiring journal blocks another coordinator and keeps pending work',async t=>{
 const dir=await fixture(t),j=await createAccountRecoveryJournal(dir,binding);
 await j.save({phase:'restore-intent',pending:{kind:'load',id:'base'},generation:3n});
 await assert.rejects(createAccountRecoveryJournal(dir,binding),{code:'EEXIST'});
 await assert.rejects(j.release(),/Unfinished/);
 assert.equal((await j.read()).generation,3n);assert.equal((await j.read()).pending.id,'base');
});
test('unknown process loss retains lock even when old',async t=>{
 const dir=await fixture(t);const j=await createAccountRecoveryJournal(dir,binding);
 await j.save({phase:'snapshot-intent',pending:{kind:'take',id:'identity'}});
 const lock=JSON.parse(await readFile(join(dir,'recovery.lock'),'utf8'));lock.createdAt='1900-01-01';await writeFile(join(dir,'recovery.lock'),JSON.stringify(lock));
 await assert.rejects(createAccountRecoveryJournal(dir,binding),{code:'EEXIST'});
 assert.equal((await j.read()).pending.kind,'take');
});
test('outside writer substitution refuses before another journal save',async t=>{
 const dir=await fixture(t),j=await createAccountRecoveryJournal(dir,binding);
 await j.save({phase:'checkpointed'});
 const row=JSON.parse(await readFile(join(dir,'recovery.json'),'utf8'));row.revision+=1;await writeFile(join(dir,'recovery.json'),JSON.stringify(row));
 await assert.rejects(j.save({phase:'restored'}),/outside exclusive writer/);
});
test('lock substitution fails closed and only finished no-pending recovery can release',async t=>{
 const dir=await fixture(t),j=await createAccountRecoveryJournal(dir,binding);
 await j.save({phase:'resumed'});await j.release();
 await assert.rejects(j.read(),{code:'ENOENT'});
});