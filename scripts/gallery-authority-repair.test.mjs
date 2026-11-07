import test from 'node:test';
import assert from 'node:assert/strict';
import { galleryAuthorities } from './all-group-upgrade-policy.mjs';

test('gallery upgrade includes both the outbound pair and reverse club authority', () => {
  const inventory = { groups: [{ id: 'g1', services: [
    { name: 'club_domain', canisterId: 'club-cai' },
    { name: 'vault_domain', canisterId: 'vault-cai' },
    { name: 'media_metadata', canisterId: 'media-cai' },
  ] }] };
  const target = { groupId: 'g1', canisterId: 'media-cai' };
  const pair = galleryAuthorities(inventory, target, []);
  assert.deepEqual(pair.operations, [
    { canisterId: 'media-cai', method: 'set_gallery_authorities', principals: ['club-cai', 'vault-cai'] },
    { canisterId: 'club-cai', method: 'set_gallery_media_authority', principals: ['media-cai'] },
  ]);
});