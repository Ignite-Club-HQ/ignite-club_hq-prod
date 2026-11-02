import test from 'node:test';
import assert from 'node:assert/strict';
import { allowLongUpdates } from './pocket-ic-long-updates.mjs';
const fake=(answerAfter,reject=false)=>{let ticks=0;return{ticks:()=>ticks,client:{tick:async()=>{ticks++;},ingressStatus:async()=>{if(ticks<answerAfter)return null;if(reject)throw new Error('Canister call failed: refused');return{body:new Uint8Array([7])};}}};};
test('waits beyond PocketIC 100-round cap and returns the same reply',async()=>{const f=fake(250);const pic=allowLongUpdates({client:f.client});assert.deepEqual(await pic.client.awaitCall({messageId:'m'}),{body:new Uint8Array([7])});assert.equal(f.ticks(),250);});
test('rejections still surface unchanged',async()=>{const f=fake(3,true);allowLongUpdates({client:f.client});await assert.rejects(f.client.awaitCall({messageId:'m'}),/refused/);});
test('stays bounded',async()=>{const f=fake(1e9);allowLongUpdates({client:f.client},{maxRounds:10});await assert.rejects(f.client.awaitCall({messageId:'m'}),/after 10 rounds/);assert.equal(f.ticks(),10);});
