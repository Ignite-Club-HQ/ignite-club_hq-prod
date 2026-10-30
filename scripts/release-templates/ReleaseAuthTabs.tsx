import { Fingerprint, Mail } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { authMethodDestination } from '@/lib/releaseRuntime';

export function ReleaseAuthTabs({ value, disabled = false }: { value: 'supabase' | 'icp'; disabled?: boolean }) {
  return <Tabs value={value} onValueChange={next => {
    if (next === value || (next !== 'supabase' && next !== 'icp')) return;
    window.location.assign(authMethodDestination(next, window.location.search));
  }}>
    <TabsList className="grid h-12 w-full grid-cols-2" aria-label="Sign-in method">
      <TabsTrigger value="supabase" disabled={disabled} className="h-full min-w-0 gap-2 px-2 whitespace-normal">
        <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />Sign in with email
      </TabsTrigger>
      <TabsTrigger value="icp" disabled={disabled} className="h-full min-w-0 gap-2 px-2 whitespace-normal">
        <Fingerprint className="h-4 w-4 shrink-0" aria-hidden="true" />Sign in securely
      </TabsTrigger>
    </TabsList>
  </Tabs>;
}