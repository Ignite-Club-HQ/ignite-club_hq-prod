/** Distinct app-owned TEST sender identity; no Google secrets enter ICP.
 * The derived principal must be commissioned on ICP before any delivery.
 */
export async function nativeSenderSigningSeed(secret: string): Promise<Uint8Array> {
  if (secret.length < 64) throw new Error('TEST native sender identity is unavailable');
  return new Uint8Array(await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(`ignite-dev-native-sender:v1:${secret}`),
  ));
}