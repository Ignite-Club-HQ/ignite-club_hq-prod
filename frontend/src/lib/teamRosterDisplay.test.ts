import { describe, it, expect } from 'vitest';
import { visibleTeamMemberName, visibleChildRosterName, needsChildNameRetry, needsAdultNameRetry, requestedTeamAdultNameIds, teamRosterHeaderStatus, scopedIcpTeamRosterKey } from './teamRosterDisplay';

describe('team-roster privacy and loading', () => {
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

describe('DEV-only self-name omission for encrypted team roster reads', () => {
  const ids = ['test3', 'test', 'test3'];
  const aliases = ['test', 'principal:test', 'own-account-id'];
  it('requests only other adults when the signed-in self already has a readable authorised profile name', () => {
    expect(requestedTeamAdultNameIds(ids, aliases, ' Test ', true)).toEqual(['test3']);
    expect(requestedTeamAdultNameIds(['principal:test','test3'], aliases, 'Test', true)).toEqual(['test3']);
    expect(requestedTeamAdultNameIds(['own-account-id','test3'], aliases, 'Test', true)).toEqual(['test3']);
  });
  it('keeps all adults if the own name is unavailable, encrypted or a placeholder', () => {
    for (const value of [null, '', ' ', 'pii-display-name:v1:source:self', 'Unknown User', 'Name unavailable']) {
      expect(requestedTeamAdultNameIds(ids, aliases, value, true)).toEqual(['test','test3']);
    }
  });
  it('keeps PROD, Supabase and other target queries unchanged', () => {
    expect(requestedTeamAdultNameIds(ids, aliases, 'Test', false)).toEqual(['test','test3']);
  });
  it('never treats another adult as signed-in self or invents a display name', () => {
    const subjects = requestedTeamAdultNameIds(['test','test3'], ['test'], 'Test', true);
    expect(subjects).toEqual(['test3']);
    expect(requestedTeamAdultNameIds(['test','test3'], [], 'Test', true)).toEqual(['test','test3']);
  });
});
