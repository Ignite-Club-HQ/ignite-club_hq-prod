import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOptionalAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

/** Mounted only for TEST Internet Identity. Does not start email push hooks. */
export function IcpDevPushManager() {
  const userId = useOptionalAuth()?.user?.id;
  const navigate = useNavigate();
  useEffect(() => {
    if (!userId) return;
    let disposed = false;
    let disposeTaps: (() => void) | undefined;
    let removeResume: (() => Promise<void>) | undefined;
    void Promise.all([import('@/live/icpNativePush'), import('@/live/icpPushTap')]).then(async ([native, taps]) => {
      if (disposed) return;
      await taps.installDevIcpPushTaps();
      if (disposed) return;
      disposeTaps = taps.subscribeDevIcpPushTaps(userId.replace(/^principal:/, ''), navigate);
      // Never prompt or delay login/Home. Permission requests remain explicit user taps.
      void native.initializeDevIcpNativePush(userId, false);
      const { App } = await import('@capacitor/app');
      if (disposed) return;
      const handle = await App.addListener('resume', () => {
        if (!disposed) void native.initializeDevIcpNativePush(userId, false);
      });
      if (disposed) await handle.remove();
      else removeResume = () => handle.remove();
    }).catch(() => undefined);
    const receive = () => { toast('New Ignite notification'); };
    window.addEventListener('ignite:icp-push-received', receive);
    return () => {
      disposed = true;
      disposeTaps?.();
      void removeResume?.();
      window.removeEventListener('ignite:icp-push-received', receive);
    };
  }, [userId, navigate]);
  return null;
}