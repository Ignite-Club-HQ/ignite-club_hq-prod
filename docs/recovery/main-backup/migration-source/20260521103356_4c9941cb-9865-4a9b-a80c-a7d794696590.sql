UPDATE public.teams
SET default_rsvp_audience = 'players_only'
WHERE default_rsvp_audience = 'players_and_parents'
  AND (
    (COALESCE(name, '') || ' ' || COALESCE(level_age, '')) ~* '\m(senior|seniors|men|mens|women|womens|ladies|adult|adults|masters|reserve|reserves|first|firsts|second|seconds|premier|premiers|open|opens)\M'
    OR (
      (COALESCE(name, '') || ' ' || COALESCE(level_age, '')) ~* '\mU\s*-?\s*([0-9]{2,})\M'
      AND COALESCE(
        NULLIF(substring((COALESCE(name, '') || ' ' || COALESCE(level_age, '')) from '\mU\s*-?\s*([0-9]{2,})\M'), ''),
        '0'
      )::int >= 19
    )
  );