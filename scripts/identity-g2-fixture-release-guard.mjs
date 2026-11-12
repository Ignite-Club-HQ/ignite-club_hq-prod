// Refuse an isolated G2 fixture on any deployment path. No network or secrets.
// Run before builds AND against the exact WASM staged for installation.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const FIXTURE_METHOD = 'fixture_g2_authorize_reader';
export const FIXTURE_FEATURE = 'isolated-g2-chain-fixture';
export const FIXTURE_MARKER = 'IGNITE_ISOLATED_G2_FIXTURE_BUILD';

export function assertReleaseEnvironment(env = process.env) {
  for (const name of [FIXTURE_MARKER, 'CARGO_FEATURE_ISOLATED_G2_CHAIN_FIXTURE']) {
    if (Object.hasOwn(env, name)) throw new Error('Isolated G2 test fixture environment must not reach release: '+name);
  }
  for (const name of ['CARGO_FEATURES','CARGO_BUILD_FEATURES','RUSTFLAGS','CARGO_ENCODED_RUSTFLAGS','CARGO_PROFILE_RELEASE_RUSTFLAGS']) {
    const value = String(env[name] ?? '');
    if (/isolated[-_]g2[-_]chain[-_]fixture|POCKETIC_ONLY_NOT_DEPLOYABLE/i.test(value)) {
      throw new Error('Isolated G2 fixture in release build flags: '+name);
    }
  }
}

function readUleb(b, offset) {
  let result=0, shift=0, i=offset;
  for(let j=0;j<5;j++){
    if(i>=b.length)throw new Error('Truncated WASM LEB128');
    const v=b[i++];
    result+=(v&127)*2**shift;
    if((v&128)===0)return [result,i];
    shift+=7;
  }
  throw new Error('Oversized WASM LEB128');
}
export function wasmExports(raw) {
  const bytes=Buffer.from(raw);
  const b=bytes[0]===0x1f&&bytes[1]===0x8b?gunzipSync(bytes):bytes;
  if(b.length<8 || !b.subarray(0,8).equals(Buffer.from([0,97,115,109,1,0,0,0])))throw new Error('Invalid WASM artifact');
  let cursor=8;
  const exports=[];
  while(cursor<b.length){
    const kind=b[cursor++];
    const [size,next]=readUleb(b,cursor); cursor=next;
    if(size>b.length-cursor)throw new Error('Truncated WASM section');
    const end=cursor+size;
    if(kind===7){
      let [count,pos]=readUleb(b,cursor);
      if(count>100000)throw new Error('Oversized WASM export table');
      for(let k=0;k<count;k++){
        let [length,nextPos]=readUleb(b,pos);pos=nextPos;
        if(length>end-pos)throw new Error('Truncated WASM export name');
        const name=b.subarray(pos,pos+length).toString('utf8');pos+=length;
        if(pos>=end)throw new Error('Truncated WASM export kind');
        pos++; // external kind
        const [,afterIndex]=readUleb(b,pos);pos=afterIndex;
        exports.push(name);
      }
      if(pos!==end)throw new Error('Invalid WASM export section');
    }
    cursor=end;
  }
  return exports;
}
export function assertReleaseArtifact(raw) {
  const names=wasmExports(raw);
  if(names.some(name=>name.includes(FIXTURE_METHOD))) {
    throw new Error('REFUSED: PocketIC-only identity fixture endpoint exported from release WASM');
  }
  return {checked:true,exports:names.length};
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    assertReleaseEnvironment();
    const paths=process.argv.slice(2);
    for(const p of paths)assertReleaseArtifact(readFileSync(p));
    console.log('Identity release fixture safety: no fixture environment or exported endpoint'+(paths.length?' in '+paths.length+' WASM artifact(s)':' (environment only)'));
  }catch(e){console.error('::error::'+e.message);process.exitCode=1;}
}
