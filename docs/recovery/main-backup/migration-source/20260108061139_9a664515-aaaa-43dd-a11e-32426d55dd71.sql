-- Add missing columns that code expects

-- profiles: has_sausage_reward
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS has_sausage_reward BOOLEAN DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS photo_consent_given_at TIMESTAMPTZ;

-- clubs: logo_only_mode and dark theme colors
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS logo_only_mode BOOLEAN DEFAULT false;
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS theme_dark_primary_h INTEGER;
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS theme_dark_primary_s INTEGER;
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS theme_dark_primary_l INTEGER;
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS theme_dark_secondary_h INTEGER;
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS theme_dark_secondary_s INTEGER;
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS theme_dark_secondary_l INTEGER;
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS theme_dark_accent_h INTEGER;
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS theme_dark_accent_s INTEGER;
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS theme_dark_accent_l INTEGER;

-- game_player_stats: additional tracking columns
ALTER TABLE public.game_player_stats ADD COLUMN IF NOT EXISTS positions_played TEXT[] DEFAULT '{}';
ALTER TABLE public.game_player_stats ADD COLUMN IF NOT EXISTS position_minutes JSONB DEFAULT '{}';
ALTER TABLE public.game_player_stats ADD COLUMN IF NOT EXISTS substitutions_count INTEGER DEFAULT 0;
ALTER TABLE public.game_player_stats ADD COLUMN IF NOT EXISTS started_on_pitch BOOLEAN DEFAULT false;
ALTER TABLE public.game_player_stats ADD COLUMN IF NOT EXISTS goals_scored INTEGER DEFAULT 0;
ALTER TABLE public.game_player_stats ADD COLUMN IF NOT EXISTS assists INTEGER DEFAULT 0;
ALTER TABLE public.game_player_stats ADD COLUMN IF NOT EXISTS fill_in_player_name TEXT;
ALTER TABLE public.game_player_stats ADD COLUMN IF NOT EXISTS jersey_number INTEGER;
ALTER TABLE public.game_player_stats ADD COLUMN IF NOT EXISTS minutes_played INTEGER DEFAULT 0;

-- game_summaries: additional summary columns
ALTER TABLE public.game_summaries ADD COLUMN IF NOT EXISTS total_game_time INTEGER DEFAULT 0;
ALTER TABLE public.game_summaries ADD COLUMN IF NOT EXISTS total_substitutions INTEGER DEFAULT 0;
ALTER TABLE public.game_summaries ADD COLUMN IF NOT EXISTS formation_used TEXT;

-- team_player_positions: preferred positions and jersey number
ALTER TABLE public.team_player_positions ADD COLUMN IF NOT EXISTS preferred_positions TEXT[] DEFAULT '{}';
ALTER TABLE public.team_player_positions ADD COLUMN IF NOT EXISTS jersey_number INTEGER;

-- Add unique constraint for team_player_positions if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'team_player_positions_team_user_unique'
  ) THEN
    ALTER TABLE public.team_player_positions ADD CONSTRAINT team_player_positions_team_user_unique UNIQUE (team_id, user_id);
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- pending_invites: invited_label column
ALTER TABLE public.pending_invites ADD COLUMN IF NOT EXISTS invited_label TEXT;

-- photos: title, folder_id, deleted_at, show_in_feed
ALTER TABLE public.photos ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE public.photos ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES public.vault_folders(id) ON DELETE SET NULL;
ALTER TABLE public.photos ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.photos ADD COLUMN IF NOT EXISTS show_in_feed BOOLEAN DEFAULT true;

-- feedback: title and description columns
ALTER TABLE public.feedback ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE public.feedback ADD COLUMN IF NOT EXISTS description TEXT;

-- promo_codes: scope_type, storage_gb, uses_count
ALTER TABLE public.promo_codes ADD COLUMN IF NOT EXISTS scope_type TEXT;
ALTER TABLE public.promo_codes ADD COLUMN IF NOT EXISTS storage_gb INTEGER;
ALTER TABLE public.promo_codes ADD COLUMN IF NOT EXISTS uses_count INTEGER DEFAULT 0;

-- events: state, postcode, suburb, address, is_recurring
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS postcode TEXT;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS suburb TEXT;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT false;

-- favorite_event_titles: event_type column
ALTER TABLE public.favorite_event_titles ADD COLUMN IF NOT EXISTS event_type TEXT;

-- member_subscription_payments: notes column
ALTER TABLE public.member_subscription_payments ADD COLUMN IF NOT EXISTS notes TEXT;

-- Create team_folders table if not exists
CREATE TABLE IF NOT EXISTS public.team_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT 'default',
  sort_order INTEGER DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Enable RLS on team_folders
ALTER TABLE public.team_folders ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for team_folders
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'team_folders' AND policyname = 'Club members can view team folders'
  ) THEN
    CREATE POLICY "Club members can view team folders" ON public.team_folders
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = auth.uid() AND ur.club_id = team_folders.club_id
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'team_folders' AND policyname = 'Club admins can manage team folders'
  ) THEN
    CREATE POLICY "Club admins can manage team folders" ON public.team_folders
      FOR ALL USING (
        EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = auth.uid() 
          AND ur.club_id = team_folders.club_id
          AND ur.role IN ('club_admin', 'app_admin')
        )
      );
  END IF;
END $$;

-- Create player_of_match table if not exists
CREATE TABLE IF NOT EXISTS public.player_of_match (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL UNIQUE REFERENCES public.events(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  child_id UUID REFERENCES public.children(id) ON DELETE SET NULL,
  awarded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  points_awarded INTEGER DEFAULT 0,
  points BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Enable RLS on player_of_match
ALTER TABLE public.player_of_match ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for player_of_match
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'player_of_match' AND policyname = 'Anyone can view player of match'
  ) THEN
    CREATE POLICY "Anyone can view player of match" ON public.player_of_match
      FOR SELECT USING (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'player_of_match' AND policyname = 'Team admins can manage player of match'
  ) THEN
    CREATE POLICY "Team admins can manage player of match" ON public.player_of_match
      FOR ALL USING (
        EXISTS (
          SELECT 1 FROM public.events e
          JOIN public.user_roles ur ON (
            (ur.team_id = e.team_id AND ur.team_id IS NOT NULL) OR 
            ur.club_id = e.club_id
          )
          WHERE e.id = player_of_match.event_id
          AND ur.user_id = auth.uid()
          AND ur.role IN ('team_admin', 'coach', 'club_admin', 'app_admin')
        )
      );
  END IF;
END $$;