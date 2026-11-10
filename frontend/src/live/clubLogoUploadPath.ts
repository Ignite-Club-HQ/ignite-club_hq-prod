/** New uploads only: preserve existing URLs and encryption identities. */
export function clubLogoUploadPath(path: string): string {
  const request = /^club-logos\/team-requests\/([^/]+)\/(.+)$/.exec(path);
  if (request) return `clubs/${request[1]}/logos/team-requests/${request[2]}`;
  const logo = /^club-logos\/([^/]+)\/(.+)$/.exec(path);
  return logo ? `clubs/${logo[1]}/logos/${logo[2]}` : path;
}

export function isClubLogoUploadPath(path: string): boolean {
  return /^clubs\/[^/]+\/logos\/.test(path);
}