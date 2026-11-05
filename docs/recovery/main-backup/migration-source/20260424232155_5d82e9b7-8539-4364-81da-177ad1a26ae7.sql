-- Track which user initiated a DM conversation so we can attribute stub
-- conversations (those with no messages exchanged) to the person who started them.
ALTER TABLE public.direct_conversations
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Update the get_or_create RPC to record the initiator on new rows.
CREATE OR REPLACE FUNCTION public.get_or_create_dm_conversation(other_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  conv_id UUID;
  p1 UUID;
  p2 UUID;
BEGIN
  IF auth.uid() < other_user_id THEN
    p1 := auth.uid();
    p2 := other_user_id;
  ELSE
    p1 := other_user_id;
    p2 := auth.uid();
  END IF;

  SELECT id INTO conv_id
  FROM direct_conversations
  WHERE participant_1 = p1 AND participant_2 = p2;

  IF conv_id IS NULL THEN
    INSERT INTO direct_conversations (participant_1, participant_2, created_by)
    VALUES (p1, p2, auth.uid())
    RETURNING id INTO conv_id;
  END IF;

  RETURN conv_id;
END;
$$;