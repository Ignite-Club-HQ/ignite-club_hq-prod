-- Add team colors to event_groups (each group is now a "match" with 2 teams)
ALTER TABLE public.event_groups
ADD COLUMN team_a_color text DEFAULT 'red',
ADD COLUMN team_b_color text DEFAULT 'blue';

-- Add team assignment to event_group_players
ALTER TABLE public.event_group_players
ADD COLUMN team text CHECK (team IN ('a', 'b'));