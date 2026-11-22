import { createElement, useEffect, useRef } from 'react';
import { ToastAction } from '@/components/ui/toast';
import { toast } from '@/hooks/use-toast';
import { fetchEventLineup, saveEventLineup, lineupSignature, type EventLineupSnapshot } from '../eventLineupRepository';

type Job = { eventId: string; teamId: string; userId?: string; snapshot: EventLineupSnapshot };

/** Debounce, serialize and acknowledge. Unknown outcomes require an explicit retry. */
export function useEventLineupSave(job: Job | null) {
  const pending = useRef<Job | null>(null);
  const busy = useRef(false);
  const acknowledged = useRef('');
  const mounted = useRef(true);
  const currentJob = useRef(job);
  currentJob.current = job;
  const flush = useRef<() => Promise<void>>(async () => {});
  flush.current = async () => {
    const next = pending.current;
    if (!next || busy.current) return;
    pending.current = null;
    busy.current = true;
    const signature = `${next.userId}|${next.teamId}|${next.eventId}|${lineupSignature(next.snapshot)}`;
    const key = `ignite_lineup_draft_${next.userId}_${next.teamId}_${next.eventId}`;
    const notify = () => {
      if (!mounted.current) return;
      toast({ title: 'Lineup not confirmed', variant: 'destructive',
        description: 'Your lineup is kept on this device. Check your connection before retrying.',
        action: createElement(ToastAction, { altText: 'Check saved lineup', onClick: async () => {
          const active = currentJob.current;
          if (!mounted.current || !active || active.userId !== next.userId || active.teamId !== next.teamId || active.eventId !== next.eventId) return;
          try {
            const remote = await fetchEventLineup(next.eventId, next.teamId);
            if (!mounted.current || currentJob.current?.userId !== next.userId) return;
            if (remote && lineupSignature(remote.snapshot) === lineupSignature(next.snapshot)) {
              acknowledged.current = signature;
              sessionStorage.removeItem(key);
            } else toast({ title: 'Lineup needs review', description: 'The saved lineup differs. Your edits remain on this device; reopen the match to review them.', variant: 'destructive' });
          } catch (error) { console.warn('[PitchBoard] Lineup reconciliation unavailable', error); }

        } }, 'Check save'),
      });
    };
    try {
      if (signature === acknowledged.current) return;
      // A previous interrupted write must never be replayed on remount.
      if (sessionStorage.getItem(key)) { notify(); return; }
      sessionStorage.setItem(key, JSON.stringify(next));
      if (!(await saveEventLineup(next))) throw new Error('Lineup save was not acknowledged');
      acknowledged.current = signature;
      sessionStorage.removeItem(key);
    } catch (error) {
      console.warn('[PitchBoard] Lineup save unconfirmed', error);
      notify();
    } finally {
      busy.current = false;
      if (pending.current) void flush.current();
    }
  };
  useEffect(() => {
    if (!job) { pending.current = null; return; }
    const signature = `${job.userId}|${job.teamId}|${job.eventId}|${lineupSignature(job.snapshot)}`;
    if (signature === acknowledged.current) return;
    pending.current = job;
    const timer = setTimeout(() => { void flush.current(); }, 1200);
    return () => clearTimeout(timer);
  }, [job?.eventId, job?.teamId, job?.userId, job ? lineupSignature(job.snapshot) : '']);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; void flush.current(); };
  }, []);
}