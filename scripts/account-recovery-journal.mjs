// Local exclusive journal, not an authenticated mainnet controller fence.
// Lock survives process loss and has no age/PID/timeout-based takeover.
import { mkdir,open,readFile,rename,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const encode=value=>JSON.stringify(value,(_k,v)=>typeof v==='bigint'?{$recoveryBigint:v.toString()}:v);
const decode=text=>JSON.parse(text,(_k,v)=>v&&typeof v==='object'&&Object.keys(v).length===1&&typeof v.$recoveryBigint==='string'?BigInt(v.$recoveryBigint):v);
export async function createAccountRecoveryJournal(directory,binding) {
  if(typeof binding!=='string'||!/^[a-f0-9]{64}$/.test(binding))throw Error('Exact recovery binding required');
  await mkdir(directory,{recursive:true});
  const token=randomUUID(),lock=join(directory,'recovery.lock'),receipt=join(directory,'recovery.json');
  const handle=await open(lock,'wx',0o600);
  try {await handle.writeFile(encode({binding,token}));await handle.sync();}finally{await handle.close();}
  let revision=0,busy=false;
  const assertExclusiveWriter=async()=>{
    const owner=decode(await readFile(lock,'utf8'));
    if(owner.binding!==binding||owner.token!==token)throw Error('Exclusive recovery journal ownership lost');
  };
  const read=async()=>{
    await assertExclusiveWriter();
    try {const row=decode(await readFile(receipt,'utf8'));if(row.binding!==binding||row.revision!==revision)throw Error('Recovery journal changed outside exclusive writer');return row.state;}
    catch(error){if(error.code==='ENOENT'&&revision===0)return undefined;throw error;}
  };
  const save=async state=>{
    if(busy)throw Error('Concurrent recovery journal write refused');busy=true;
    let file;
    try {
      await assertExclusiveWriter();await read();
      const temporary=join(directory,`recovery-${token}.tmp`);
      file=await open(temporary,'wx',0o600);await file.writeFile(encode({binding,revision:revision+1,state}));await file.sync();await file.close();file=undefined;
      await assertExclusiveWriter();await rename(temporary,receipt);
      const dir=await open(directory,'r');try{await dir.sync();}finally{await dir.close();}
      revision+=1;await read();
    }finally {if(file)await file.close();busy=false;}
  };
  const release=async()=>{
    if(busy)throw Error('Concurrent recovery journal operation refused');busy=true;
    try {
      const state=await read();if(state?.pending||state?.phase!=='resumed')throw Error('Unfinished recovery retains exclusive lock');
      await assertExclusiveWriter();await rm(lock);
      const dir=await open(directory,'r');try{await dir.sync();}finally{await dir.close();}
    }finally{busy=false;}
  };
  return {read,save,assertExclusiveWriter,release};
}