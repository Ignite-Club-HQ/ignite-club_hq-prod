
-- Backfill missing points_history entries from points_cooldowns
-- where no matching points_history record exists for that user+action+date
INSERT INTO public.points_history (user_id, club_id, amount, balance_after, source_type, description, created_at)
SELECT 
  pc.user_id,
  pc.club_id,
  pc.points_awarded,
  0, -- balance_after unknown for historical records
  CASE pc.action_type
    WHEN 'chat_message' THEN 'chat_engagement'
    WHEN 'photo_upload' THEN 'photo_upload'
    WHEN 'photo_comment' THEN 'photo_comment'
    WHEN 'weekly_bonus' THEN 'weekly_chat_streak'
    ELSE 'chat_engagement'
  END::text,
  CASE pc.action_type
    WHEN 'chat_message' THEN 'Chat engagement bonus (backfilled)'
    WHEN 'photo_upload' THEN 'Photo upload bonus (backfilled)'
    WHEN 'photo_comment' THEN 'Photo comment bonus (backfilled)'
    WHEN 'weekly_bonus' THEN 'Weekly engagement bonus (backfilled)'
    ELSE 'Engagement bonus (backfilled)'
  END,
  pc.awarded_date::timestamp with time zone
FROM points_cooldowns pc
WHERE NOT EXISTS (
  SELECT 1 FROM points_history ph 
  WHERE ph.user_id = pc.user_id 
    AND ph.source_type IN ('chat_engagement', 'photo_upload', 'photo_comment', 'weekly_chat_streak', 'weekly_photo_streak')
    AND ph.created_at::date = pc.awarded_date
    AND ph.amount = pc.points_awarded
    AND ph.club_id = pc.club_id
);
