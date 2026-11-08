/** Keep the generated opaque secret server-only; derive an Ed25519 seed in memory. */
export async function browserTestSigningSeed(secret: string): Promise<Uint8Array> {
  if (!secret) throw new Error('TEST signing configuration unavailable');
  const material = new TextEncoder().encode(`ignite-dev-browser-self-test:v1:${secret}`);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', material));
}