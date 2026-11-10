/** Saved displays are placeholders, never authority for opening a team. */
export function carouselReady(hasSavedCards: boolean, inventoryReady: boolean, detailsReady: boolean[]): boolean {
  return hasSavedCards || (inventoryReady && detailsReady.every(Boolean));
}