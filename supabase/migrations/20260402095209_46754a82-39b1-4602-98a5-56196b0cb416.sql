-- Delete duplicate user_roles, keeping the earliest one per (user_id, role, team_id, club_id)
DELETE FROM public.user_roles
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      row_number() OVER (
        PARTITION BY user_id, role,
          COALESCE(team_id, '00000000-0000-0000-0000-000000000000'::uuid),
          COALESCE(club_id, '00000000-0000-0000-0000-000000000000'::uuid)
        ORDER BY created_at ASC, id ASC
      ) AS rn
    FROM public.user_roles
  ) sub
  WHERE sub.rn > 1
);

-- Prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_unique_assignment_idx
ON public.user_roles (
  user_id,
  role,
  COALESCE(team_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(club_id, '00000000-0000-0000-0000-000000000000'::uuid)
);