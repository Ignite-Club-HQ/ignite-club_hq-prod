import { supabase } from '@/integrations/supabase/client';
import { withFeatureBackend } from '@/live/featureRouter';

export interface PitchFixture {
  id: string; title: string; event_date: string; type: string;
  address: string | null; suburb: string | null; opponent: string | null;
  description: string | null; team_id: string | null;
}

export async function readPitchFixtures(teamId?: string, eventId?: string, hoursBefore?: number): Promise<PitchFixture[]> {
  return withFeatureBackend('events', {
    supabase: async () => {
      let query = supabase.from('events').select('id,title,event_date,type,address,suburb,opponent,description,team_id');
      if (eventId) query = query.eq('id', eventId);
      else {
        query = query.eq('team_id', teamId ?? '').eq('type', 'game').eq('is_cancelled', false)
          .gte('event_date', new Date(Date.now() - 24 * 60 * 60_000).toISOString());
        if (hoursBefore !== undefined) query = query.lte('event_date', new Date(Date.now() + hoursBefore * 60 * 60_000).toISOString());
      }
      const { data, error } = await query.order('event_date', { ascending: true }).limit(eventId ? 1 : 20);
      if (error) throw error;
      return data ?? [];
    },
    icp: async ctx => {
      const { listLiveEvents } = await import('@/live/features/events');
      const events = await listLiveEvents(ctx, null, teamId ?? null);
      return events.filter(event => {
        if (eventId) return event.id === eventId;
        const start = Number(event.starts_at_ms);
        return event.event_type === 'game' && !event.cancelled && !event.deleted
          && start >= Date.now() - 24 * 60 * 60_000
          && (hoursBefore === undefined || start <= Date.now() + hoursBefore * 60 * 60_000);
      }).sort((a, b) => Number(a.starts_at_ms) - Number(b.starts_at_ms)).slice(0, eventId ? 1 : 20)
        .map(event => ({ id: event.id, title: event.title, event_date: new Date(Number(event.starts_at_ms)).toISOString(),
          type: event.event_type, address: event.address[0] ?? null, suburb: event.location[0] ?? null,
          opponent: event.opponent[0] ?? null, description: event.description, team_id: event.team_id[0] ?? null }));
    },
  }, eventId ? { eventId } : { teamId: teamId ?? '' });
}