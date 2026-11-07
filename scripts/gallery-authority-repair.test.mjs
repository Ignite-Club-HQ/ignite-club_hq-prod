import test from 'node:test';
import assert from 'node:assert/strict';
import { galleryAuthorityOperations, applyGalleryAuthorities } from './gallery-authority-repair-policy.mjs';

test('gallery upgrade includes both the outbound pair and reverse club authority', () => {
  const inventory = { groups: [{ id: 'g1', services: [
    { name: 'club_domain', canisterId: 'club-cai' },
    { name: 'vault_domain', canisterId: 'vault-cai' },
    { name: 'media_metadata', canisterId: 'media-cai' },
  ] }] };
  const target = { groupId: 'g1', canisterId: 'media-cai' };
  assert.deepEqual(galleryAuthorityOperations(inventory, target, []), [
    { canisterId: 'media-cai', method: 'set_gallery_authorities', principals: ['club-cai', 'vault-cai'] },
    { canisterId: 'club-cai', method: 'set_gallery_media_authority', principals: ['media-cai'] },
  ]);
});

test('refusal or lost assignment reply never continues to another authority', async () => {
  for (const mode of ['refused', 'lost']) {
    const calls = [], receipts = [];
    await assert.rejects(applyGalleryAuthorities([{ canisterId: 'media-cai' }, { canisterId: 'club-cai' }], {
      gate: async () => {}, persist: async (op, phase) => receipts.push(phase),
      call: async op => { calls.push(op); if (mode === 'lost') throw Error('Unknown reply'); return { Err: 'Governor required' }; },
    }));
    assert.equal(calls.length, 1);
    assert.deepEqual(receipts, ['pending']);
  }
});

test('successful assignments are both journaled before continuing', async () => {
  const events = [];
  await applyGalleryAuthorities([{ canisterId: 'media-cai' }, { canisterId: 'club-cai' }], {
    gate: async () => events.push('gate'), persist: async (op, phase) => events.push(phase),
    call: async () => { events.push('call'); return { Ok: null }; },
  });
  assert.deepEqual(events, ['gate', 'pending', 'call', 'complete', 'gate', 'pending', 'call', 'complete']);
});