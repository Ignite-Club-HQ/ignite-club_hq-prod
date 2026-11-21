import { describe, it, expect } from 'vitest';
import { hasPendingAdultNameDisplay, visibleTeamMemberName, visibleChildRosterName, needsChildNameRetry, needsAdultNameRetry, requestedClubAdultNameIds, teamRosterHeaderStatus, scopedIcpTeamRosterKey } from './teamRosterDisplay';

describe('team-roster privacy and loading', () => {
  it('does not treat background refresh as unlocking when all parent names are visible', () => {
    expect(hasPendingAdultNameDisplay(['Paul Cranwell', 'Test', 'Test2'], true)).toBe(false);
    expect(hasPendingAdultNameDisplay([], true)).toBe(false);
  });

  it('tracks an active unlock only while a rendered parent name is unresolved', () => {
    for (const missing of [null, undefined, '', ' ', 'pii-display-name:v1:authority:subject', 'Name unavailable', 'Unlocking name…']) {
      expect(hasPendingAdultNameDisplay(['Paul Cranwell', missing], true)).toBe(true);
      expect(hasPendingAdultNameDisplay(['Paul Cranwell', missing], false)).toBe(false);
    }
  });

  it('shows existing public/authorized display names without changing them', () => {
    expect(visibleTeamMemberName(' Test ')).toBe('Test');
    expect(visibleTeamMemberName('Coach Jane')).toBe('Coach Jane');
  });

  it('never exposes a protected private reference as a teammate name', () => {
    expect(visibleTeamMemberName('pii-display-name:v1:pii-canister:principal')).toBe('Name unavailable');
    expect(visibleTeamMemberName(null)).toBe('Name unavailable');
    expect(visibleTeamMemberName('  ')).toBe('Name unavailable');
  });

  it('reports the player-load state even when adults are already on screen', () => {
    expect(teamRosterHeaderStatus({
      members: 2, children: 0, loadingMembers: false, loadingChildren: true, memberError: false, childError: false,
    })).toBe('2 members · Loading players…');
    expect(teamRosterHeaderStatus({
      members: 2, children: 2, loadingMembers: false, loadingChildren: false, memberError: false, childError: false,
    })).toBe('4 members');
    expect(teamRosterHeaderStatus({
      members: 0, children: 0, loadingMembers: false, loadingChildren: false, memberError: false, childError: true,
    })).toBe('Members unavailable');
  });

  it('never reuses roster cache keys between Internet Identities or owning groups', () => {
    const base = ['team-children', 'U10'];
    const a = scopedIcpTeamRosterKey(base, 'principal-a', 'club-two');
    const b = scopedIcpTeamRosterKey(base, 'principal-b', 'club-two');
    const c = scopedIcpTeamRosterKey(base, 'principal-a', 'club-one');
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(c);
    expect(base).toEqual(['team-children', 'U10']);
  });
});

describe('authorized child-name read states', () => {
  it('displays only decrypted text while leaving the source record unchanged', () => {
    const id = { id: 'child-1', name: 'Player' };
    expect(visibleChildRosterName(' Ted ', false)).toBe('Ted');
    expect(visibleChildRosterName(undefined, true)).toBe('Unlocking name…');
    expect(visibleChildRosterName(undefined, false)).toBe('Name unavailable');
    expect(visibleChildRosterName('pii-display-name:unauthorized', false)).toBe('Name unavailable');
    expect(id.name).toBe('Player');
  });
  it('offers a read-only retry only for unresolved member names after the query finishes', () => {
    const ids = ['child-1','child-2'];
    expect(needsChildNameRetry(ids, undefined, true)).toBe(false);
    expect(needsChildNameRetry(ids, new Map(), false)).toBe(true);
    expect(needsChildNameRetry(ids, new Map([['child-1','Ted']]), false)).toBe(true);
    expect(needsChildNameRetry(ids, new Map([['child-1','Ted'], ['child-2','QA']]), false)).toBe(false);
    expect(needsChildNameRetry([], undefined, false)).toBe(false);
  });
});

describe('DEV ICP cross-account adult-name refresh', () => {
  const ids = ['test', 'test3'];
  it('reports unresolved profiles after a successful but incomplete read', () => {
    expect(needsAdultNameRetry(ids, [{account_id:'test',display_name:'Test'}], false)).toBe(true);
    expect(needsAdultNameRetry(ids, [
      {account_id:'test',display_name:'Test'},
      {account_id:'test3',display_name:'pii-display-name:v1:authority:subject'},
    ],false)).toBe(true);
    expect(needsAdultNameRetry(ids, [
      {account_id:'test',display_name:'Test'}, {account_id:'test3',display_name:null},
    ],false)).toBe(true);
  });
  it('does not propose a second read while loading or after both names resolve', () => {
    expect(needsAdultNameRetry(ids,[],true)).toBe(false);
    expect(needsAdultNameRetry(ids,[
      {account_id:'test',display_name:'Test'}, {account_id:'test3',display_name:'Test3'},
    ],false)).toBe(false);
    expect(needsAdultNameRetry([],[],false)).toBe(false);
  });
});

describe('fast pinned DEV club-key roster test', () => {
  const adults=['test3','test','test3'];
  const signedIn=['test','principal:test','account-test'];
  it('omits ONLY a verified signed-in self with existing unlocked profile name', () => {
    expect(requestedClubAdultNameIds(adults,signedIn,'Test',true)).toEqual(['test3']);
    expect(requestedClubAdultNameIds(['account-test','test3'],signedIn,'Test',true)).toEqual(['test3']);
    expect(requestedClubAdultNameIds(['test3','test'],['test3'],'Test3',true)).toEqual(['test']);
  });
  it('never removes a foreign adult, even when they have an identical displayed name',()=>{
    expect(requestedClubAdultNameIds(adults,['not-in-this-roster'],'Test',true)).toEqual(['test','test3']);
  });
  it('keeps the previous full request unless DEV pilot is explicitly on',()=>{
    expect(requestedClubAdultNameIds(adults,signedIn,'Test',false)).toEqual(['test','test3']);
    for(const name of [null,'',' ','Name unavailable','Unknown User','pii-display-name:v1:x:y']){
      expect(requestedClubAdultNameIds(adults,signedIn,name,true)).toEqual(['test','test3']);
    }
  });
});
