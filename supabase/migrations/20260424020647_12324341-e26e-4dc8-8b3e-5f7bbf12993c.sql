
-- Shorten verbose drill step notes on all official drills so the floating
-- step overlay reads at a glance. We do this in three passes:
--   1) strip the leading category prefix ("Frame 2 — ", "Setup — ", etc.)
--   2) keep only the first sentence/clause (cut at ". ", " — ", or "; ")
--   3) hard-cap at 80 chars and capitalise the first letter
-- Only touches official drills so user-created drills stay untouched.

DO $$
DECLARE
  v_row record;
  v_new text;
BEGIN
  FOR v_row IN
    SELECT df.id, df.notes
    FROM public.drill_frames df
    JOIN public.drills d ON d.id = df.drill_id
    WHERE d.is_official = true
      AND df.notes IS NOT NULL
      AND length(trim(df.notes)) > 0
  LOOP
    v_new := v_row.notes;

    -- 1) strip leading "Setup — ", "Frame N — ", "Rotation — ",
    --    "Rotation cont. — ", "Next rep — ", "Set-up: ", "GO! "
    v_new := regexp_replace(
      v_new,
      '^(Setup|Set-up|Frame\s+\d+|Rotation(\s+cont\.?)?|Next\s+rep)\s*[—:\-]\s*',
      '',
      'i'
    );

    -- 2) cut at the first hard break: ". ", " — ", or "; "
    --    (keeps the first crisp clause, drops follow-on coaching detail)
    v_new := split_part(v_new, '. ',  1);
    v_new := split_part(v_new, ' — ', 1);
    v_new := split_part(v_new, '; ',  1);

    -- 3) trim, drop trailing punctuation, hard-cap to 80 chars
    v_new := trim(v_new);
    v_new := regexp_replace(v_new, '[\.;:,\s]+$', '');
    IF length(v_new) > 80 THEN
      v_new := rtrim(substring(v_new from 1 for 77)) || '…';
    END IF;

    -- capitalise first letter so the overlay reads as a clean instruction
    IF length(v_new) > 0 THEN
      v_new := upper(substring(v_new from 1 for 1)) || substring(v_new from 2);
    END IF;

    IF v_new <> v_row.notes THEN
      UPDATE public.drill_frames
      SET notes = v_new, updated_at = now()
      WHERE id = v_row.id;
    END IF;
  END LOOP;
END $$;
