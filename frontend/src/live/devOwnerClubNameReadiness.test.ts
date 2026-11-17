import { beforeEach, describe, expect, it, vi } from 'vitest';

const flags=vi.hoisted(()=>({dev:true,released:false,retire:undefined as undefined | (()=>void)}));
vi.mock('./devCrossGroupTeamNameRoute',()=>({
  isExactDevG2NameTarget:()=>flags.dev,
  sharedClubNameEnforcementEnabled:()=>flags.released,
}));
vi.mock('./privateProfileSession',()=>({
  capturePrivateProfileSession:()=>()=>{},
  onPrivateProfileSessionRetired:(cb:()=>void)=>{flags.retire=cb;},
}));

import {
  reconcileConfirmedDevOwnerClubName, afterConfirmedDevMembershipNameReadiness,
  lastConfirmedDevOwnerNameReadiness, parseExactOwnDevNameReference,
} from './devOwnerClubNameReadiness';

const original='iui5p-aaaaa-aaaal-qxllq-cai';
const caller='edt5h-vbtif-a523i-cfe6i-ieemk-2ljzi-frngv-3vjyy-mxf3o-safv3-fae';
const ref=`pii-display-name:v1:${original}:${caller}`;
const club='177f8c01-3617-402a-aedd-5c5c17ccfde1';
let n=0;
const ctx=()=>({
  identity:{getPrincipal:()=>({toText:()=>caller,isAnonymous:()=>false})},
  target:{host:'https://icp-api.io',provider:'icp',canisterIds:{
    identity_access:'mq2sj-fiaaa-aaaal-qxlqa-cai',pii_access_control:'zt5a6-yiaaa-aaaal-qxp5q-cai',
  }},
}) as any;
const io=()=>({
  readMember:vi.fn(async()=>true),
  readSavedReference:vi.fn(async()=>ref),
  unlockOriginal:vi.fn(async()=>({name:'Dev parent',source:ctx(),confirm:vi.fn(async()=>{})})),
  prepareClubCopy:vi.fn(async()=>{}),
});

beforeEach(()=>{n++;flags.dev=true;flags.released=true;flags.retire?.();});

describe('DEV owner club-name lifecycle after acknowledged membership',()=>{
  it('does not run any canister reads or writes while the release is disabled',async()=>{
    flags.released=false;
    const f=io();
    expect(await reconcileConfirmedDevOwnerClubName(ctx(),club+String(n),{io:f})).toBe('pending-release');
    expect(f.readMember).not.toHaveBeenCalled();
    expect(f.prepareClubCopy).not.toHaveBeenCalled();
  });

  it('never touches PROD, unrelated group, or email/Supabase targets',async()=>{
    flags.dev=false;
    const f=io();
    expect(await reconcileConfirmedDevOwnerClubName(ctx(),club+String(n),{io:f})).toBe('not-applicable');
    expect(f.readMember).not.toHaveBeenCalled();
  });

  it('requires current signed club membership and an exact owner name reference',async()=>{
    const f=io();f.readMember.mockResolvedValue(false);
    expect(await reconcileConfirmedDevOwnerClubName(ctx(),club+String(n),{io:f})).toBe('pending-membership');
    expect(f.readSavedReference).not.toHaveBeenCalled();
    expect(f.prepareClubCopy).not.toHaveBeenCalled();
    f.readMember.mockResolvedValue(true);f.readSavedReference.mockResolvedValue('Unconverted user');
    expect(await reconcileConfirmedDevOwnerClubName(ctx(),club+String(n+1),{io:f})).toBe('pending-original-name');
    expect(f.unlockOriginal).not.toHaveBeenCalled();
  });

  it('rejects a foreign owner, invented name key, and plaintext profile',()=>{
    expect(parseExactOwnDevNameReference(ref,caller)).toBe(original);
    expect(parseExactOwnDevNameReference('Joe',caller)).toBeNull();
    expect(parseExactOwnDevNameReference(`pii-display-name:v1:${original}:somebody-else`,caller)).toBeNull();
    expect(parseExactOwnDevNameReference(`pii-display-name:v1:aaaaa-aa:${caller}`,caller)).toBeNull();
  });

  it('fails closed if signed original authority cannot be verified',async()=>{
    const f=io();f.unlockOriginal.mockRejectedValue(Error('Foreign source'));
    expect(await reconcileConfirmedDevOwnerClubName(ctx(),club+String(n),{io:f})).toBe('pending-source-verification');
    expect(f.prepareClubCopy).not.toHaveBeenCalled();
  });

  it('verifies current club membership before and after a create-only, owner-signed copy',async()=>{
    const f=io();
    const status=await reconcileConfirmedDevOwnerClubName(ctx(),club+String(n),{io:f});
    expect(status).toBe('ready');
    expect(f.readMember).toHaveBeenCalledTimes(2);
    expect(f.unlockOriginal).toHaveBeenCalledWith(ref,original,expect.any(Function));
    expect(f.prepareClubCopy).toHaveBeenCalledTimes(1);
    expect(f.prepareClubCopy.mock.calls[0][2]).toBe(club+String(n));
    const confirmation=f.unlockOriginal.mock.results[0].value as Promise<{confirm:()=>Promise<void>}>;
    expect((await confirmation).confirm).toHaveBeenCalledTimes(2);
  });

  it('does not replay an ambiguous write without an explicit owner action',async()=>{
    const f=io();f.prepareClubCopy.mockRejectedValueOnce(Error('Call deadline expired'));
    const key=club+String(n);
    expect(await reconcileConfirmedDevOwnerClubName(ctx(),key,{io:f})).toBe('pending-owner-check');
    expect(await reconcileConfirmedDevOwnerClubName(ctx(),key,{io:f})).toBe('pending-owner-check');
    expect(f.prepareClubCopy).toHaveBeenCalledTimes(1);
    // Explicit recheck re-reads membership and the saved original before any
    // new attempt. The underlying owner copy writer checks existing ciphertext.
    expect(await reconcileConfirmedDevOwnerClubName(ctx(),key,{io:f,explicitOwnerRetry:true})).toBe('ready');
    expect(f.prepareClubCopy).toHaveBeenCalledTimes(2);
  });

  it('preserves an acknowledged join and records a status without throwing',async()=>{
    const f=io();f.prepareClubCopy.mockRejectedValue(Error('Unknown'));
    const c=ctx(),key=club+String(n);
    expect(await reconcileConfirmedDevOwnerClubName(c,key,{io:f})).toBe('pending-owner-check');
    const s=await afterConfirmedDevMembershipNameReadiness(c,key);
    expect(s).toBe('pending-owner-check');
    expect(lastConfirmedDevOwnerNameReadiness(c,key)).toBe('pending-owner-check');
    expect(f.prepareClubCopy).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent owner preparations for a single club',async()=>{
    const f=io(),key=club+String(n);
    let finish:()=>void=()=>{};
    f.prepareClubCopy.mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;}));
    const a=reconcileConfirmedDevOwnerClubName(ctx(),key,{io:f});
    const b=reconcileConfirmedDevOwnerClubName(ctx(),key,{io:f});
    await vi.waitFor(()=>expect(f.prepareClubCopy).toHaveBeenCalledTimes(1));
    finish();
    expect(await Promise.all([a,b])).toEqual(['ready','ready']);
  });
});
