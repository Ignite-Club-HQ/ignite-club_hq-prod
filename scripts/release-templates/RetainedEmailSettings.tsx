import { useEffect, useState } from 'react';
import { Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { emailClubsFromSetting, updateEmailClubsBeforeImage } from '@/lib/releaseEmailSignup';

/** Existing settings RLS is authoritative; parent renders only for app admins. */
export function RetainedEmailSettings() {
  const { user } = useAuth();
  const [before, setBefore] = useState<unknown>();
  const [clubs, setClubs] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const role = await supabase.from('user_roles').select('id').eq('user_id', user.id).eq('role', 'app_admin').maybeSingle();
        if (role.error || !role.data) throw new Error('App administrator access required.');
        const [setting, roster] = await Promise.all([
          supabase.from('app_settings').select('value').eq('key', 'backend_routing_config').single(),
          supabase.from('clubs').select('id,name').order('name').limit(1000),
        ]);
        if (setting.error || roster.error) throw new Error('Unable to load email sign-in settings.');
        if ((roster.data ?? []).length === 1000) throw new Error('Club list requires a bounded search before editing.');
        const eligible = emailClubsFromSetting(setting.data.value);
        if (!cancelled) { setBefore(setting.data.value); setSelected(eligible.map(c => c.id)); setClubs(roster.data ?? []); }
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load settings.'); }
      finally { if (!cancelled) setBusy(false); }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);
  async function save() {
    if (before === undefined || busy || !user) return;
    setBusy(true); setError('');
    try {
      const picked = selected.map(id => clubs.find(c => c.id === id));
      if (picked.some(c => !c)) throw new Error('An existing selected club is unavailable. Reload before changing settings.');
      const value = updateEmailClubsBeforeImage(before, picked.filter((c): c is {id:string;name:string} => !!c));
      // Compare the exact observed JSON; no stale form may overwrite unrelated settings.
      const result = await supabase.from('app_settings').update({ value: value as never }).eq('key', 'backend_routing_config')
        .eq('value', JSON.stringify(before)).select('value');
      if (result.error) throw result.error;
      if (result.data?.length !== 1) throw new Error('Settings changed elsewhere. Reload before saving.');
      setBefore(result.data[0].value);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save settings.'); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 border-t border-border pt-4">
    <h2 className="text-lg font-semibold">Email sign-in is kept for</h2>
    {clubs.map(club => <label key={club.id} className="flex items-center gap-3 text-sm">
      <Checkbox disabled={busy || before === undefined} checked={selected.includes(club.id)} onCheckedChange={checked =>
        setSelected(prev => checked ? [...prev, club.id] : prev.filter(id => id !== club.id))} />{club.name}
    </label>)}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button onClick={save} disabled={busy || before === undefined}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save</Button>
  </section>;
}