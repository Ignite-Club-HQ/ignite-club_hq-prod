SELECT set_config('ignite.suppress_event_notify','on', true);
UPDATE public.competition_matches
   SET round_number = (substring(notes from '(?i)\mround\s*(\d{1,3})'))::int
 WHERE competition_id = '89e25f56-9440-401e-bfeb-7c9b4d0294dd'
   AND round_number IS NULL
   AND notes ~* '\mround\s*\d';
SELECT set_config('ignite.suppress_event_notify','off', true);