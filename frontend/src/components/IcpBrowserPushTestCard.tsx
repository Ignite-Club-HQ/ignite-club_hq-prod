import { useEffect, useRef, useState } from 'react';
import { Bell, Loader2, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { usesDevIcpPush } from '@/live/icpPushMode';
import devBrowserConfig from '@/live/devBrowserPushPublicConfig.json';

const messages: Record<string, string> = {
  'not-configured': 'Browser notification settings are missing. Complete Include web push in the Firebase connection.',
  'unsupported': 'This browser cannot receive notifications. Try Chrome on Android; iPhone requires the installed home-screen app.',
  'open-in-new-tab': 'Open the TEST app in its own browser tab, not inside the Lovable preview.',
  'denied': 'Notifications are blocked. Allow them in this browser’s site settings.',
  'setup-pending': 'The TEST sending service is not ready yet. No notification was requested.',
  'account-changed': 'Your account changed. Sign in again before testing.',
};

export function IcpBrowserPushTestCard({ userId }: { userId: string }) {
  const address = useRef('');
  const generation = useRef(0);
  const [busy, setBusy] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    generation.current++;
    address.current = '';
    setRegistered(false); setBusy(false); setMessage('');
    return () => {
      generation.current++;
      address.current = '';
    };
  }, [userId]);
  async function enable() {
    const ticket = generation.current;
    setBusy(true);
    try {
      const [{ enableDevBrowserPushProbe }, { getCurrentInternetIdentity }] = await Promise.all([
        import('@/live/icpBrowserPush'), import('@/live/internetIdentityAuth'),
      ]);
      const identity = await getCurrentInternetIdentity();
      if (ticket !== generation.current) return;
      if (!identity || identity.getPrincipal().toText() !== userId.replace(/^principal:/, '')) {
        setMessage(messages['account-changed']); return;
      }
      const current = () => ticket === generation.current && usesDevIcpPush();
      const result = await enableDevBrowserPushProbe({
        apiKey: import.meta.env.IGNITE_LIVE_DEV_FIREBASE_WEB_API_KEY || devBrowserConfig.apiKey,
        appId: import.meta.env.IGNITE_LIVE_DEV_FIREBASE_APP_ID || devBrowserConfig.appId,
        projectId: import.meta.env.IGNITE_LIVE_DEV_FIREBASE_PROJECT_ID || devBrowserConfig.projectId,
        vapidKey: import.meta.env.IGNITE_LIVE_DEV_FIREBASE_VAPID_KEY || devBrowserConfig.vapidKey,
      }, current);
      if (ticket !== generation.current) return;
      const freshIdentity = await getCurrentInternetIdentity();
      if (!current() || freshIdentity?.getPrincipal().toText() !== identity.getPrincipal().toText()) {
        setMessage(messages['account-changed']); return;
      }
      address.current = result.status === 'registered' && 'token' in result ? result.token : '';
      setRegistered(result.status === 'registered');
      setMessage(result.status === 'registered' ? 'Browser ready. Copy the test address and send it here in chat so I can send one alert.' : messages[result.status]);
    } catch (error) {
      console.error('TEST browser alerts failed:', error);
      const detail = error instanceof Error && error.message ? ` (${error.message.slice(0, 160)})` : '';
      if (ticket === generation.current) setMessage(`This browser could not enable test alerts. Check notification permission and try again.${detail}`);
    } finally { if (ticket === generation.current) setBusy(false); }
  }
  async function copy() {
    if (!address.current || !usesDevIcpPush()) return;
    const ticket = generation.current;
    try {
      await navigator.clipboard.writeText(address.current);
      if (ticket === generation.current) setMessage('Test address copied. Paste it in this chat for one TEST alert.');
    } catch {
      if (ticket === generation.current) setMessage('Copy was blocked. Allow clipboard access and try again.');
    }
  }
  if (!usesDevIcpPush()) return null;
  return <Card>
    <CardHeader><CardTitle className="flex items-center gap-2"><Bell className="h-5 w-5" />TEST browser notifications</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button onClick={enable} disabled={busy || registered}>{busy && !registered ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bell className="mr-2 h-4 w-4" />}Enable test alerts</Button>
        {registered && <Button variant="outline" onClick={copy}><Copy className="mr-2 h-4 w-4" />Copy test address</Button>}
      </div>
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </CardContent>
  </Card>;
}