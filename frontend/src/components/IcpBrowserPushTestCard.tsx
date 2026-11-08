import { useEffect, useRef, useState } from 'react';
import { Bell, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { createBrowserSelfTest } from '@/live/icpBrowserPushSelfTest';

type Session = Awaited<ReturnType<typeof createBrowserSelfTest>>;
const messages: Record<string, string> = {
  'not-configured': 'Browser notification settings are missing. Complete Include web push in the Firebase connection.',
  'unsupported': 'This browser cannot receive notifications. Try Chrome on Android; iPhone requires the installed home-screen app.',
  'open-in-new-tab': 'Open the TEST app in its own browser tab, not inside the Lovable preview.',
  'denied': 'Notifications are blocked. Allow them in this browser’s site settings.',
  'setup-pending': 'The TEST sending service is not ready yet. No notification was requested.',
  'account-changed': 'Your account changed. Sign in again before testing.',
};

export function IcpBrowserPushTestCard({ userId }: { userId: string }) {
  const session = useRef<Session>();
  const generation = useRef(0);
  const [busy, setBusy] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    generation.current++;
    setRegistered(false); setAttempted(false); setBusy(false); setMessage('');
    return () => {
      generation.current++;
      const old = session.current; session.current = undefined;
      void old?.dispose().catch(() => undefined);
    };
  }, [userId]);
  async function enable() {
    const ticket = generation.current;
    setBusy(true);
    try {
      const [{ enableDevIcpBrowserPush }, { createBrowserSelfTest }] = await Promise.all([
        import('@/live/icpBrowserPush'), import('@/live/icpBrowserPushSelfTest'),
      ]);
      const owner = await createBrowserSelfTest(userId);
      if (ticket !== generation.current) { await owner.dispose(); return; }
      session.current = owner;
      const result = await enableDevIcpBrowserPush({
        apiKey: import.meta.env.IGNITE_LIVE_DEV_FIREBASE_WEB_API_KEY ?? '',
        appId: import.meta.env.IGNITE_LIVE_DEV_FIREBASE_APP_ID ?? '',
        projectId: import.meta.env.IGNITE_LIVE_DEV_FIREBASE_PROJECT_ID ?? '',
        vapidKey: import.meta.env.IGNITE_LIVE_DEV_FIREBASE_VAPID_KEY ?? '',
      }, owner.authority);
      if (ticket !== generation.current) return;
      setRegistered(result.status === 'registered');
      setMessage(result.status === 'registered' ? 'This browser is registered for one TEST alert.' : messages[result.status]);
    } catch {
      if (ticket === generation.current) setMessage('TEST registration could not be confirmed. The sending service may still need its update.');
    } finally { if (ticket === generation.current) setBusy(false); }
  }
  async function send() {
    const owner = session.current;
    if (!owner || attempted) return;
    const ticket = generation.current;
    setBusy(true); setAttempted(true);
    try {
      const outcome = await owner.send();
      if (ticket !== generation.current) return;
      setMessage(outcome === 'accepted' ? 'Firebase accepted your TEST alert. Check this phone’s notifications.' :
        outcome === 'failed' ? 'Firebase declined this TEST alert. The sending settings need checking.' :
        'The TEST alert could not be confirmed. It will not be sent again automatically.');
    } catch {
      if (ticket === generation.current) setMessage('The TEST alert could not be confirmed. It will not be sent again automatically.');
    } finally { if (ticket === generation.current) setBusy(false); }
  }
  return <Card>
    <CardHeader><CardTitle className="flex items-center gap-2"><Bell className="h-5 w-5" />TEST browser notifications</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button onClick={enable} disabled={busy || registered}>{busy && !registered ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bell className="mr-2 h-4 w-4" />}Enable on this browser</Button>
        <Button variant="outline" onClick={send} disabled={!registered || busy || attempted}><Send className="mr-2 h-4 w-4" />Send TEST alert</Button>
      </div>
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
    </CardContent>
  </Card>;
}