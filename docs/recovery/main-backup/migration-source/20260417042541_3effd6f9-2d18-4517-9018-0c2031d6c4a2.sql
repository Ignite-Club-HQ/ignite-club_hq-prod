-- Correct Heidi Crawford's role on U8 White from player to parent (matches the invite she accepted)
UPDATE public.user_roles
SET role = 'parent'
WHERE id = '3d136caf-21dc-4846-b6ae-b4bc8a0bb118'::uuid;

-- Reconcile both ghost pending invites for Heidi on U8 White
UPDATE public.pending_invites
SET status = 'accepted',
    accepted_at = now(),
    invited_user_id = 'ad03ef9b-eeb1-4861-a9a7-65897cc003d9'::uuid
WHERE id IN (
  '26a580a7-f1e6-4c39-8fc2-0836b71b7b4b'::uuid,
  '72ebcb0b-a022-4621-b56c-7ef59973d36f'::uuid
);

-- Audit trail
INSERT INTO public.audit_logs (action_type, actor_id, target_user_id, target_user_name, details)
VALUES (
  'role_corrected',
  NULL,
  'ad03ef9b-eeb1-4861-a9a7-65897cc003d9'::uuid,
  'Heidi Crawford',
  jsonb_build_object(
    'team_id', '487cc28c-8213-485b-b0c4-fe4ba53dcd2d',
    'team_name', 'U8 White',
    'previous_role', 'player',
    'new_role', 'parent',
    'reason', 'Aligning role with original parent invite; reconciled 2 pending invites'
  )
);