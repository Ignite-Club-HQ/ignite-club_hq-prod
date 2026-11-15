import { describe, it, expect } from 'vitest';
import { visibleTeamMemberName, visibleChildRosterName, needsChildNameRetry, teamRosterHeaderStatus, scopedIcpTeamRosterKey } from './teamRosterDisplay';

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
