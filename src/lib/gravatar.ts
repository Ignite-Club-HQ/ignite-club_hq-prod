/**
 * Generate a Gravatar URL from an email address
 * Uses SHA-256 hashing as per Gravatar's current API
 */

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Get Gravatar URL for an email address
 * @param email - User's email address
 * @param size - Avatar size in pixels (default: 80)
 * @param defaultType - Default avatar type if no Gravatar exists ('404', 'mp', 'identicon', 'monsterid', 'wavatar', 'retro', 'robohash', 'blank')
 */
export async function getGravatarUrl(
  email: string, 
  size: number = 80, 
  defaultType: string = '404'
): Promise<string> {
  const trimmedEmail = email.trim().toLowerCase();
  const hash = await sha256(trimmedEmail);
  return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=${defaultType}`;
}

/**
 * Synchronous version using pre-computed hash
 * For use when you already have the hash stored
 */
export function getGravatarUrlFromHash(
  hash: string, 
  size: number = 80, 
  defaultType: string = '404'
): string {
  return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=${defaultType}`;
}
