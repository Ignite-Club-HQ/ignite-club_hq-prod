import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Capacitor } from '@capacitor/core';
import { createCarouselResumeRecovery } from '@/lib/carouselResumeRecovery';

export function useCarouselResumeRecovery(userId: string | undefined, _clubId: string | null) {
  const client = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    let disposed = false;
    let backgroundedAt: number | undefined;
    let removeNative: (() => void) | undefined;
    const recover = createCarouselResumeRecovery(client, ['my-teams-premium-v2', userId]);
    const onReturn = () => {
      if (disposed) return;
      if (document.visibilityState === 'hidden') {
        backgroundedAt ??= Date.now();
        return;
      }
      if (navigator.onLine === false) return;
      const restartSuspended = backgroundedAt !== undefined && Date.now() - backgroundedAt >= 20_000;
      backgroundedAt = undefined;
      void recover({ restartSuspended }).catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('pageshow', onReturn);
    window.addEventListener('online', onReturn);
    if (Capacitor.isNativePlatform()) void import('@capacitor/app').then(async ({ App }) => {
      if (disposed) return;
      const listener = await App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) onReturn();
        else backgroundedAt ??= Date.now();
      });
      if (disposed) await listener.remove();
      else removeNative = () => { void listener.remove(); };
    }).catch(() => undefined);
    return () => {
      disposed = true;
      removeNative?.();
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('pageshow', onReturn);
      window.removeEventListener('online', onReturn);
    };
  }, [client, userId]);
}