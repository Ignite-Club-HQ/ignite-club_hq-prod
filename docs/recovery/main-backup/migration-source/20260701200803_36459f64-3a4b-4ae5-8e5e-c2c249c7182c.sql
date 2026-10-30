CREATE INDEX IF NOT EXISTS idx_user_roles_role_partial
ON public.user_roles (role)
WHERE role IN ('app_admin', 'club_admin', 'committee_member');