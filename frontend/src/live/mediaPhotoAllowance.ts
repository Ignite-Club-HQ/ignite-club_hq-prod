import type { FeatureBackendContext } from './featureRouter';
import type { ClubMediaUsage } from './blobStoreUpload';

export const MEDIA_PHOTO_CYCLE_LIMIT = 10;
type PhotoCategory = 'gallery_photo' | 'chat_photo';
const UNAVAILABLE = "We couldn't check your club's photo allowance. Please try again shortly.";

/** Match the store's category and team entitlement, never a viewer's personal Pro. */
export function photoScopeForPath(path: string): { clubId: string; teamId?: string; category: PhotoCategory } | null {
  const segments = path.split('/');
  if (segments[0] !== 'clubs' || !segments[1] || segments.length < 3) return null;
  if (segments.some(segment => ['logos', 'sponsors', 'rewards', 'qr-codes', 'points-icon'].includes(segment))) return null;
  if (segments[2] === 'vault' || segments.some((segment, i) => segment === 'files' && segments[i - 1] === 'chat')) return null;
  return { clubId: segments[1], teamId: segments[2] === 'teams' ? segments[3] : undefined,
    category: segments.some(segment => segment === 'chat' || segment === 'scheduled') ? 'chat_photo' : 'gallery_photo' };
}

export async function readLivePhotoAllowance(ctx: FeatureBackendContext, clubId: string, teamId?: string) {
  try {
    const [{ connectLiveClubDomain }, { getLiveClubMediaUsage }] = await Promise.all([import('./domains'), import('./blobStoreUpload')]);
    const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
    const [result, media] = await Promise.all([
      actor.get_media_allowance(clubId, teamId ? [teamId] : []),
      getLiveClubMediaUsage(ctx.target, ctx.identity, clubId),
    ]);
    if (!('Ok' in result)) throw new Error(UNAVAILABLE);
    return { isPro: result.Ok.premium, media };
  } catch (error) {
    console.warn('[media] photo allowance unavailable', error);
    throw new Error(UNAVAILABLE);
  }
}

export function assertPhotoAllowance(isPro: boolean, media: Record<string, ClubMediaUsage>, category: PhotoCategory, count = 1) {
  const row = media[category];
  if (!row || !Number.isSafeInteger(row.count) || row.count < 0 || !Number.isSafeInteger(count) || count < 1) throw new Error(UNAVAILABLE);
  if (!isPro && row.count + count > MEDIA_PHOTO_CYCLE_LIMIT) {
    throw new Error(category === 'gallery_photo'
      ? "You've used your 10 free photo uploads this cycle. Upgrade to Pro for unlimited uploads."
      : "You've used your 10 free chat photos this cycle. Upgrade to Pro for unlimited chat photos.");
  }
}

/** Fresh preflight only; the store still atomically enforces pending reservations. */
export async function checkLivePhotoUpload(ctx: FeatureBackendContext, path: string, count = 1) {
  const scope = photoScopeForPath(path);
  if (!scope) return;
  const { isPro, media } = await readLivePhotoAllowance(ctx, scope.clubId, scope.teamId);
  assertPhotoAllowance(isPro, media, scope.category, count);
}