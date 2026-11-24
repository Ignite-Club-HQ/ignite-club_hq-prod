import { createElement, useEffect, useRef } from 'react';
import { readSharedPitchBoard, writeSharedPitchBoard, sharedPitchSignature, type SharedBoardSnapshot } from '@/lib/sharedPitchBoard';

import { toast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';

/** Last revision/state this device saw per board, so reopening keeps unsent local edits. */
const lastSynced = new Map<string, { revision: string; signature: string }>();

/** One writer per open board; serial read/CAS loop, no blind retry after failure. */
export function useIcpSharedPitchBoard({ teamId, userId, enabled, readOnly, apply }: {
  teamId: string; userId?: string; enabled: boolean; readOnly: boolean;
  apply: (pitch: Record<string, unknown>) => void;
}) {
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    if (!enabled || !teamId.startsWith('event-group-')) return;
    function remote(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (detail?.source === 'icp-remote' && detail.teamId === teamId && detail.pitch) applyRef.current(detail.pitch);
    }
    window.addEventListener('game-state-changed', remote);
    return () => window.removeEventListener('game-state-changed', remote);
  }, [enabled, teamId]);
  useEffect(() => {
    if (!enabled || !userId || teamId.startsWith('event-group-')) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let revision: bigint | null = null;
    let hydrated = false;
    let signature = '';
    let uncertain = false;
    const session = crypto.randomUUID();
    const key = `ignite-pitch-board-state-team-${teamId}`;
    function local(): Record<string, unknown> | null {
      try { return JSON.parse(localStorage.getItem(key) ?? 'null'); } catch { return null; }
    }
    const draftKey = `ignite_pitch_draft_${userId}_${teamId}`;
    function offerDraft(pitch: Record<string, unknown>) {
      if (readOnly) return;
      const retained = sessionStorage.getItem(draftKey);
      if (retained) pitch = JSON.parse(retained);
      else sessionStorage.setItem(draftKey, JSON.stringify(pitch));
      toast({ title: 'Unsaved board kept', description: 'The shared board has been reloaded. Your edits are kept on this device.',
        action: createElement(ToastAction, { altText: 'Restore unsaved board edits', onClick: () => {
          if (disposed || readOnly) return;
          localStorage.setItem(key, JSON.stringify(pitch));
          applyRef.current(pitch);
          sessionStorage.removeItem(draftKey);
        } }, 'Restore edits') });
    }
    function adopt(snapshot: SharedBoardSnapshot | null) {
      if (disposed) return;
      revision = snapshot?.revision ?? null;
      if (snapshot) {
        const pitch = { ...snapshot.pitch, teamId };
        const displaced = local();
        if (!readOnly && displaced && sharedPitchSignature(displaced) !== sharedPitchSignature(pitch)) offerDraft(displaced);
        else if (!hydrated && !readOnly) {
          const retained = sessionStorage.getItem(draftKey);
          if (retained) offerDraft(JSON.parse(retained));
        }
        signature = sharedPitchSignature(pitch);
        lastSynced.set(teamId, { revision: String(revision), signature });
        localStorage.setItem(key, JSON.stringify(pitch));
        localStorage.setItem('ignite-pitch-board-state', JSON.stringify(pitch));
        applyRef.current(pitch);
      } else signature = sharedPitchSignature(local() ?? {});
      hydrated = true;
    }
    async function tick() {
      if (disposed) return;
      try {
        if (document.visibilityState === 'hidden' || !navigator.onLine) return;
        const remote = await readSharedPitchBoard(teamId);
        if (disposed) return;
        const seen = lastSynced.get(teamId);
        const pending = local();
        if (!hydrated && !uncertain && remote && pending && !readOnly && seen
          && seen.revision === String(remote.revision) && sharedPitchSignature(pending) !== seen.signature) {
          // Board unchanged remotely since this device last synced, but local
          // edits (e.g. auto-subs set up just before closing) were never sent.
          revision = remote.revision;
          signature = seen.signature;
          hydrated = true;
        } else if (!hydrated || uncertain || (remote?.revision ?? null) !== revision) {
          adopt(remote);
          uncertain = false;
          return;
        }
        const pitch = local();
        if (readOnly || !pitch) return;
        const next = sharedPitchSignature(pitch);
        if (next === signature && remote) return;
        // Preserve the loaded CAS token even if another client commits while
        // preparing PII: the canister refuses that stale write atomically.
        const ack = await writeSharedPitchBoard(teamId, revision, pitch, session);
        if (disposed) return;
        revision = ack.revision;
        signature = next;
        lastSynced.set(teamId, { revision: String(revision), signature });
      } catch (error) {
        // Conflict/unknown write: reload instead of replaying the payload.
        const draft = local();
        if (draft && !readOnly && sharedPitchSignature(draft) !== signature) offerDraft(draft);
        uncertain = true;
        console.warn('[PitchBoard] Shared state refresh failed', error);
      } finally {
        if (!disposed) timer = setTimeout(tick, 5000);
      }
    }
    void tick();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      // Flush edits made since the last poll so closing the board keeps them.
      const pitch = local();
      if (!hydrated || uncertain || readOnly || !pitch || sharedPitchSignature(pitch) === signature) return;
      const next = sharedPitchSignature(pitch);
      void writeSharedPitchBoard(teamId, revision, pitch, session)
        .then(ack => lastSynced.set(teamId, { revision: String(ack.revision), signature: next }))
        .catch(error => console.warn('[PitchBoard] Final shared board save failed', error));
    };
  }, [enabled, userId, teamId, readOnly]);
}