import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readerRouterAuthorityFingerprint } from './dev-generation2-reader-router-authority.mjs';
const fixture=()=>({
  revision:11n,configurationRevision:11n,
  groups:[{
    id:'g2',target_alias:'mainnet',
    cycles:50_000_000n,heap_bytes:512_000n,observed_at_ns:100n,
    assigned_clubs:5,
  }],
  placements:[{group_id:'g2'}],
});
const authority='{"group":"g2","domains":{"club_domain":"yfwyv-nyaaa-aaaal-qxpyq-cai"},"accepting":true}';

test('router health/telemetry changes do not invalidate a checked release plan',()=>{
  const original=fixture();
  const observed=fixture();
  observed.groups[0].cycles=49_000_000n;
  observed.groups[0].heap_bytes=645_000n;
  observed.groups[0].observed_at_ns=300n;
  observed.groups[0].assigned_clubs=9;
  assert.equal(readerRouterAuthorityFingerprint(original,authority),
    readerRouterAuthorityFingerprint(observed,authority));
});

test('changes to authority configuration or either revision are rejected',()=>{
  const baseline=readerRouterAuthorityFingerprint(fixture(),authority);
  for(const changed of [
    {...fixture(),revision:12n},
    {...fixture(),configurationRevision:12n},
  ])assert.notEqual(readerRouterAuthorityFingerprint(changed,authority),baseline);
  assert.notEqual(readerRouterAuthorityFingerprint(fixture(),authority.replace('yfwyv-','foreign-')),baseline);
  assert.notEqual(readerRouterAuthorityFingerprint(fixture(),authority.replace('"accepting":true','"accepting":false')),baseline);
});

test('missing or ambiguous authority evidence is refused, never normalised into approval',()=>{
  for(const bad of [
    {...fixture(),revision:10n},
    {...fixture(),configurationRevision:undefined},
    {...fixture(),configurationRevision:0n},
    {...fixture(),groups:[]},
    {...fixture(),placements:[]},
    {...fixture(),groups:[fixture().groups[0],fixture().groups[0]]},
  ])assert.throws(()=>readerRouterAuthorityFingerprint(bad,authority));
  assert.throws(()=>readerRouterAuthorityFingerprint(fixture(),''));
});

test('real release operator fingerprints canonical authority only and preserves live source checks',()=>{
  const source=readFileSync(new URL('../frontend/scripts/dev-generation2-directory-reader-release.ts',import.meta.url),'utf8');
  const helper=source.match(/readerRouterAuthorityFingerprint/g)??[];
  assert.ok(helper.length>=4,'readback and final release must both use stable authority');
  assert.doesNotMatch(source,/initialRouterFingerprint=fingerprint\(initialRouter\)/);
  assert.doesNotMatch(source,/fingerprint\(currentRouter\)!==initialRouterFingerprint/);
  assert.doesNotMatch(source,/fingerprint\(nowRouter\)!==initialRouterFingerprint/);
  assert.match(source,/groupApprovalConfiguration\(initialRouter\.groups,initialRouter\.placements\)/);
  assert.match(source,/groupApprovalConfiguration\(currentRouter\.groups,currentRouter\.placements\)/);
  assert.match(source,/groupApprovalConfiguration\(nowRouter\.groups,nowRouter\.placements\)/);
  assert.match(source,/sources:statuses,snapshotVerified:true,restorationGuardVerified:true/);
  assert.match(source,/fingerprint\(after\)!==fingerprint\(statuses\)/);
  assert.match(source,/identity\.check_membership_directory_acceptance\(\)/);
  assert.match(source,/checkedPlan!==planHash/);
  assert.match(source,/report\('mismatch\.json'/);
  assert.match(source,/noModifications:true/);
  assert.ok(source.indexOf('checkedPlan!==planHash')<source.indexOf('identity.enable_membership_directory(commit)'),
    'mismatch must refuse before the only activation');
});
