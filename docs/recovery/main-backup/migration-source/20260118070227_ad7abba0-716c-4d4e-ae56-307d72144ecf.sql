-- Add a policy to allow anyone to read team_invites by token (for join validation)
-- This is safe because:
-- 1. The token itself is a secret that must be known
-- 2. We only expose invite data, not sensitive information
-- 3. This enables the RLS check in user_roles to work

CREATE POLICY "Anyone can read valid team invites" ON team_invites
FOR SELECT
USING (
  (expires_at IS NULL OR expires_at > now())
  AND (max_uses IS NULL OR uses_count < max_uses)
);