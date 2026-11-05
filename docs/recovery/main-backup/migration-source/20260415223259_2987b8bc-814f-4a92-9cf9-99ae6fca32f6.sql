-- Delete stale FCM tokens, keeping only the most recent per user per platform
DELETE FROM fcm_tokens
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY user_id, platform ORDER BY updated_at DESC) AS rn
    FROM fcm_tokens
  ) ranked
  WHERE rn > 1
);

-- Create a trigger function to auto-remove old tokens when a new one is upserted
CREATE OR REPLACE FUNCTION cleanup_old_fcm_tokens()
RETURNS TRIGGER AS $$
BEGIN
  -- Delete any older tokens for the same user+platform (excluding the new one)
  DELETE FROM fcm_tokens
  WHERE user_id = NEW.user_id
    AND platform = NEW.platform
    AND id != NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fire after insert or update so the new row is already saved
DROP TRIGGER IF EXISTS trg_cleanup_old_fcm_tokens ON fcm_tokens;
CREATE TRIGGER trg_cleanup_old_fcm_tokens
  AFTER INSERT OR UPDATE ON fcm_tokens
  FOR EACH ROW
  EXECUTE FUNCTION cleanup_old_fcm_tokens();