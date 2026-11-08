import { galleryAuthorities } from './all-group-upgrade-policy.mjs';

/** Only exact owning-group reciprocal links; never queue, membership or data changes. */
export function galleryAuthorityOperations(inventory, target, provisions) {
  const { club, vault } = galleryAuthorities(inventory, target, provisions);
  return [
    { canisterId: target.canisterId, method: 'set_gallery_authorities', principals: [club, vault] },
    { canisterId: club, method: 'set_gallery_media_authority', principals: [target.canisterId] },
  ];
}

export async function applyGalleryAuthorities(operations, { gate, persist, call }) {
  for (const operation of operations) {
    await gate();
    await persist(operation, 'pending');
    const reply = await call(operation);
    if (!reply || !Object.hasOwn(reply, 'Ok')) throw Error('Gallery authority assignment refused; retained pending intent');
    await persist(operation, 'complete');
  }
}