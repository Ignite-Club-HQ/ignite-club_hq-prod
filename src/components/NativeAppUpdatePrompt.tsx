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
    let cancelled = false;

    async function check() {
      try {
        // Only run on native platforms
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform()) return;

        const platform = Capacitor.getPlatform(); // 'ios' | 'android'

        // Get current app version
        const { App } = await import('@capacitor/app');
        const info = await App.getInfo();
        const currentVersion = info.version; // e.g. "1.2.0"
        if (!currentVersion) return;

        // Fetch minimum version from app_settings
        const { data, error } = await supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'minimum_app_version')
          .maybeSingle();

        if (error || !data?.value) return;

        const minVersions = data.value as Record<string, string>;
        const requiredVersion = minVersions[platform];
        if (!requiredVersion) return;

        if (cancelled) return;

        if (compareSemver(currentVersion, requiredVersion) < 0) {
          console.log(`[UpdatePrompt] Current ${currentVersion} < required ${requiredVersion}, showing prompt`);
          setStoreUrl(platform === 'ios' ? APP_STORE_URL : PLAY_STORE_URL);
          setShowPrompt(true);
        }
      } catch (err) {
        console.warn('[UpdatePrompt] Check failed:', err);
      }
    }

    check();
    return () => { cancelled = true; };
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