import type { InviteChildJournal } from "./createIcpInviteChild";

/** Device-local record of a partially completed invite child so a retry
 * resumes the exact record. `ignite_` prefix: swept on sign-out. */
const key = (principal: string) => `ignite_icp_invite_child_v1:${principal}`;

export function readInviteChildJournal(principal: string): InviteChildJournal | null {
  try {
    const raw = localStorage.getItem(key(principal));
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (typeof v?.childId !== "string" || typeof v?.teamId !== "string" || typeof v?.clubId !== "string" ||
        typeof v?.name !== "string" || typeof v?.nameSaved !== "boolean") return null;
    return v as InviteChildJournal;
  } catch { return null; }
}

export function writeInviteChildJournal(principal: string, journal: InviteChildJournal): void {
  try { localStorage.setItem(key(principal), JSON.stringify(journal)); } catch { /* storage unavailable */ }
}

export function clearInviteChildJournal(principal: string): void {
  try { localStorage.removeItem(key(principal)); } catch { /* storage unavailable */ }
}
