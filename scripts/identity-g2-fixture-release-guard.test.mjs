import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { assertReleaseEnvironment, assertReleaseArtifact, wasmExports, FIXTURE_METHOD } from './identity-g2-fixture-release-guard.mjs';

const leb=n=>{const out=[];do{let b=n&127;n=Math.floor(n/128);if(n)b|=128;out.push(b)}while(n);return out};
const wasm=(names)=>{
  const out=[0,97,115,109,1,0,0,0];
  // Exported functions need a syntactically valid type/function/code section.
  const type=[1,0x60,0,0];
  const functionSection=[...leb(names.length),...names.map(()=>0)];
  const exports=[...leb(names.length)];
  names.forEach((name,index)=>{
    const bytes=Buffer.from(name,'utf8');
    exports.push(...leb(bytes.length),...bytes,0,...leb(index));
  });
  const codes=[...leb(names.length),...names.flatMap(()=>[2,0,0x0b])];
  for(const [kind,section] of [[1,type],[3,functionSection],[7,exports],[10,codes]]){
    out.push(kind,...leb(section.length),...section);
  }
  return Buffer.from(out);
};
test('ordinary wasm and compressed artifact pass',()=>{
  const b=wasm(['canister_update read_linked_account','canister_query whoami']);
  assert.deepEqual(wasmExports(b),['canister_update read_linked_account','canister_query whoami']);
  assert.doesNotThrow(()=>assertReleaseArtifact(b));
  assert.doesNotThrow(()=>assertReleaseArtifact(gzipSync(b)));
});
test('disposable fixture update export cannot be released raw or gzipped',()=>{
  const b=wasm(['canister_update '+FIXTURE_METHOD]);
  assert.throws(()=>assertReleaseArtifact(b),/PocketIC-only/);
  assert.throws(()=>assertReleaseArtifact(gzipSync(b)),/PocketIC-only/);
});
test('malformed and truncated wasm cannot pass',()=>{
  assert.throws(()=>assertReleaseArtifact(Buffer.from('NOTWASM')));
  assert.throws(()=>assertReleaseArtifact(Buffer.from([0,97,115,109,1,0,0,0,7,5,1])),/Truncated/);
});
test('exact fixture build marker or cargo feature environment always rejected',()=>{
  assert.doesNotThrow(()=>assertReleaseEnvironment({CARGO_BUILD_FEATURES:'safe'}));
  for(const key of ['IGNITE_ISOLATED_G2_FIXTURE_BUILD','CARGO_FEATURE_ISOLATED_G2_CHAIN_FIXTURE']){
    assert.throws(()=>assertReleaseEnvironment({[key]:'0'}),/fixture/i);
  }
  for(const key of ['CARGO_FEATURES','CARGO_BUILD_FEATURES','RUSTFLAGS','CARGO_ENCODED_RUSTFLAGS']){
    assert.throws(()=>assertReleaseEnvironment({[key]:'isolated-g2-chain-fixture'}),/fixture/i);
  }
});
