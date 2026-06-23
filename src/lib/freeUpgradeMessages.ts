/**
 * Benefit-led upgrade copy for Free-tier cap moments. Keep these positive
 * (what Pro adds), not punitive.
 */
export const FREE_UPGRADE_MESSAGES = {
  photoCount:
    "You've used your 20 free photo uploads this cycle. Upgrade to Pro for unlimited uploads and storage.",
  photoStorage:
    "Your club has used its 500 MB free photo storage. Upgrade to Pro for unlimited media storage.",
  fileCount:
    "Store up to 10 files on Free. Upgrade to Pro for unlimited club document storage.",
  fileStorage:
    "Your club has used its 100 MB free file storage. Upgrade to Pro for unlimited document storage.",
  pollCount:
    "You've used your 2 free polls this cycle. Upgrade to Pro for unlimited polls.",
} as const;

export type FreeUpgradeKey = keyof typeof FREE_UPGRADE_MESSAGES;
