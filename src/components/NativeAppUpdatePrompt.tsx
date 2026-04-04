import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

const APP_STORE_URL = 'https://apps.apple.com/au/app/ignite-club-hq/id6758928691';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=app.lovable.igniteteamhub';

/**
 * Compare two semver strings. Returns:
 *  -1 if a < b, 0 if a == b, 1 if a > b
 */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

/**
 * Shows a non-dismissible update prompt on native apps when the installed
 * version is below the minimum required version stored in app_settings.
 *
 * This acts as a fallback for users who haven't updated — even if the
 * push notification tap couldn't open the store, this prompt will appear
 * every time they open the app.
 */
export function NativeAppUpdatePrompt() {
  const [showPrompt, setShowPrompt] = useState(false);
  const [storeUrl, setStoreUrl] = useState(PLAY_STORE_URL);

  useEffect(() => {
    // Listen for force-update-prompt event (from test push notifications)
    const handleForcePrompt = () => {
      console.log('[UpdatePrompt] Force update prompt triggered via event');
      setShowPrompt(true);
    };
    window.addEventListener('force-update-prompt', handleForcePrompt);
    return () => window.removeEventListener('force-update-prompt', handleForcePrompt);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let removeAppStateListener: (() => void) | undefined;

    async function check() {
      try {
        console.log('[UpdatePrompt] Starting version check...');
        
        // Only run on native platforms
        const { Capacitor } = await import('@capacitor/core');
        const isNative = Capacitor.isNativePlatform();
        console.log('[UpdatePrompt] isNativePlatform:', isNative);
        if (!isNative) return;

        const platform = Capacitor.getPlatform(); // 'ios' | 'android'
        console.log('[UpdatePrompt] Platform:', platform);

        // Get current app version
        const { App } = await import('@capacitor/app');
        const info = await App.getInfo();
        const currentVersion = info.version; // e.g. "1.2.0"
        console.log('[UpdatePrompt] App info:', JSON.stringify({ version: info.version, build: info.build }));
        if (!currentVersion) {
          console.log('[UpdatePrompt] No currentVersion, skipping');
          return;
        }

        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          console.log('[UpdatePrompt] No auth session yet, waiting for auth restore');
          return;
        }

        // Fetch minimum version from app_settings
        const { data, error } = await supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'minimum_app_version')
          .maybeSingle();

        if (error) {
          console.log('[UpdatePrompt] Failed to fetch minimum_app_version:', error);
          return;
        }
        if (!data?.value) {
          console.log('[UpdatePrompt] No minimum_app_version data found');
          return;
        }

        const minVersions = data.value as Record<string, string>;
        const requiredVersion = minVersions[platform];
        console.log('[UpdatePrompt] Required version for', platform, ':', requiredVersion, 'minVersions:', JSON.stringify(minVersions));
        if (!requiredVersion) {
          console.log('[UpdatePrompt] No required version for platform', platform);
          return;
        }

        if (cancelled) return;

        // Android uses numeric build numbers, iOS uses semver
        const isOutdated = platform === 'android'
          ? Number(info.build || '0') < Number(requiredVersion)
          : compareSemver(currentVersion, requiredVersion) < 0;

        console.log('[UpdatePrompt] Outdated check:', {
          platform,
          currentBuild: info.build,
          currentVersion,
          requiredVersion,
          isOutdated,
        });

        if (isOutdated) {
          console.log(`[UpdatePrompt] ${platform} current ${platform === 'android' ? info.build : currentVersion} < required ${requiredVersion}, showing prompt`);
          setStoreUrl(platform === 'ios' ? APP_STORE_URL : PLAY_STORE_URL);
          setShowPrompt(true);
        } else {
          console.log('[UpdatePrompt] App is up to date');
        }
      } catch (err) {
        console.warn('[UpdatePrompt] Check failed:', err);
      }
    }

    check();

    const {
      data: { subscription: authSubscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) return;
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') {
        console.log('[UpdatePrompt] Auth restored, re-checking version gate:', event);
        void check();
      }
    });

    void (async () => {
      try {
        const { App } = await import('@capacitor/app');
        const listener = await App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) {
            void check();
          }
        });
        removeAppStateListener = () => {
          void listener.remove();
        };
      } catch (err) {
        console.warn('[UpdatePrompt] App state listener unavailable:', err);
      }
    })();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void check();
      }
    };

    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      authSubscription.unsubscribe();
      removeAppStateListener?.();
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const handleUpdate = async () => {
    try {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url: storeUrl });
    } catch {
      window.open(storeUrl, '_system');
    }
  };

  if (!showPrompt) return null;

  return (
    <AlertDialog open>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            📲 Update Required
          </AlertDialogTitle>
          <AlertDialogDescription>
            A new version of Ignite Club HQ is available with important improvements. Please update to continue using the app.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button onClick={handleUpdate} className="w-full">
            Update Now
          </Button>
          <Button
            variant="ghost"
            className="w-full text-xs text-muted-foreground"
            onClick={() => setShowPrompt(false)}
          >
            Remind me later
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}