-- Add suburb column to events
ALTER TABLE public.events 
ADD COLUMN IF NOT EXISTS suburb TEXT;

-- Add team_size to pitch_formations
ALTER TABLE public.pitch_formations 
ADD COLUMN IF NOT EXISTS team_size INTEGER DEFAULT 11;

-- Add minutes_played to game_player_stats  
ALTER TABLE public.game_player_stats 
ADD COLUMN IF NOT EXISTS minutes_played INTEGER DEFAULT 0;

-- Add total_game_time, total_substitutions, formation_used to game_summaries
ALTER TABLE public.game_summaries 
ADD COLUMN IF NOT EXISTS total_game_time INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_substitutions INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS formation_used TEXT;

-- Add file_url column to photos (in addition to image_url)
ALTER TABLE public.photos 
ADD COLUMN IF NOT EXISTS file_url TEXT;