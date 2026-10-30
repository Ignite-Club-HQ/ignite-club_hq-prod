
DO $do$
DECLARE
  removed integer;
  iteration integer;
BEGIN
  -- Each pass repeats until 0 duplicates remain in its scope. This handles
  -- the cascade where collapsing a parent folder creates new sibling
  -- duplicates among the re-parented children.
  -- Order: chat_group → auto_name → generic → drive (twice). Then loop drive+generic
  -- pair until both report 0 to absorb any newly-created collisions.

  iteration := 0;
  LOOP
    iteration := iteration + 1;
    EXIT WHEN iteration > 20;
    removed := 0;

    -- A. chat_group scope
    WITH live AS (
      SELECT vf.id, vf.club_id, vf.chat_group_id, vf.created_at,
             (SELECT count(*) FROM public.vault_files f
                WHERE f.folder_id = vf.id AND f.deleted_at IS NULL) AS fc
      FROM public.vault_folders vf
      WHERE deleted_at IS NULL AND chat_group_id IS NOT NULL
    ),
    ranked AS (
      SELECT id,
        FIRST_VALUE(id) OVER w AS keeper_id,
        ROW_NUMBER() OVER w AS rn
      FROM live
      WINDOW w AS (PARTITION BY club_id, chat_group_id
                   ORDER BY fc DESC, created_at ASC, id ASC)
    ),
    dups AS (SELECT id, keeper_id FROM ranked WHERE rn > 1),
    mvf AS (UPDATE public.vault_files vf SET folder_id = d.keeper_id
            FROM dups d WHERE vf.folder_id = d.id RETURNING 1),
    mvc AS (UPDATE public.vault_folders vf SET parent_id = d.keeper_id
            FROM dups d WHERE vf.parent_id = d.id AND vf.id <> d.keeper_id RETURNING 1),
    sd AS (UPDATE public.vault_folders vf SET deleted_at = now()
           FROM dups d WHERE vf.id = d.id RETURNING 1)
    SELECT (SELECT count(*) FROM mvf) + (SELECT count(*) FROM mvc) + (SELECT count(*) FROM sd) INTO removed;

    -- B. auto-named
    WITH live AS (
      SELECT vf.id, vf.club_id, vf.team_id, vf.name, vf.created_at,
             (SELECT count(*) FROM public.vault_files f
                WHERE f.folder_id = vf.id AND f.deleted_at IS NULL) AS fc
      FROM public.vault_folders vf
      WHERE deleted_at IS NULL
        AND chat_group_id IS NULL AND drive_folder_id IS NULL
        AND parent_id IS NULL AND restricted_roles IS NULL
        AND name IN ('Chat Images','Chat Links','Gallery Uploads')
    ),
    ranked AS (
      SELECT id,
        FIRST_VALUE(id) OVER w AS keeper_id,
        ROW_NUMBER() OVER w AS rn
      FROM live
      WINDOW w AS (PARTITION BY club_id, COALESCE(team_id::text,'-'), name
                   ORDER BY fc DESC, created_at ASC, id ASC)
    ),
    dups AS (SELECT id, keeper_id FROM ranked WHERE rn > 1),
    mvf AS (UPDATE public.vault_files vf SET folder_id = d.keeper_id
            FROM dups d WHERE vf.folder_id = d.id RETURNING 1),
    mvc AS (UPDATE public.vault_folders vf SET parent_id = d.keeper_id
            FROM dups d WHERE vf.parent_id = d.id AND vf.id <> d.keeper_id RETURNING 1),
    sd AS (UPDATE public.vault_folders vf SET deleted_at = now()
           FROM dups d WHERE vf.id = d.id RETURNING 1)
    SELECT removed + (SELECT count(*) FROM mvf) + (SELECT count(*) FROM mvc) + (SELECT count(*) FROM sd) INTO removed;

    -- C. generic (chat_group IS NULL, drive_folder_id IS NULL)
    WITH live AS (
      SELECT vf.id, vf.club_id, vf.team_id, vf.parent_id, lower(vf.name) AS lname,
             vf.created_at,
             (SELECT count(*) FROM public.vault_files f
                WHERE f.folder_id = vf.id AND f.deleted_at IS NULL) AS fc
      FROM public.vault_folders vf
      WHERE deleted_at IS NULL
        AND chat_group_id IS NULL AND drive_folder_id IS NULL
    ),
    ranked AS (
      SELECT id,
        FIRST_VALUE(id) OVER w AS keeper_id,
        ROW_NUMBER() OVER w AS rn
      FROM live
      WINDOW w AS (PARTITION BY club_id, COALESCE(team_id::text,'-'),
                                COALESCE(parent_id::text,'-'), lname
                   ORDER BY fc DESC, created_at ASC, id ASC)
    ),
    dups AS (SELECT id, keeper_id FROM ranked WHERE rn > 1),
    mvf AS (UPDATE public.vault_files vf SET folder_id = d.keeper_id
            FROM dups d WHERE vf.folder_id = d.id RETURNING 1),
    mvc AS (UPDATE public.vault_folders vf SET parent_id = d.keeper_id
            FROM dups d WHERE vf.parent_id = d.id AND vf.id <> d.keeper_id RETURNING 1),
    sd AS (UPDATE public.vault_folders vf SET deleted_at = now()
           FROM dups d WHERE vf.id = d.id RETURNING 1)
    SELECT removed + (SELECT count(*) FROM mvf) + (SELECT count(*) FROM mvc) + (SELECT count(*) FROM sd) INTO removed;

    -- D. drive-linked
    WITH live AS (
      SELECT vf.id, vf.club_id, vf.parent_id, vf.drive_folder_id, vf.created_at,
             (SELECT count(*) FROM public.vault_files f
                WHERE f.folder_id = vf.id AND f.deleted_at IS NULL) AS fc
      FROM public.vault_folders vf
      WHERE deleted_at IS NULL AND drive_folder_id IS NOT NULL
    ),
    ranked AS (
      SELECT id,
        FIRST_VALUE(id) OVER w AS keeper_id,
        ROW_NUMBER() OVER w AS rn
      FROM live
      WINDOW w AS (PARTITION BY club_id, COALESCE(parent_id::text,'-'), drive_folder_id
                   ORDER BY fc DESC, created_at ASC, id ASC)
    ),
    dups AS (SELECT id, keeper_id FROM ranked WHERE rn > 1),
    mvf AS (UPDATE public.vault_files vf SET folder_id = d.keeper_id
            FROM dups d WHERE vf.folder_id = d.id RETURNING 1),
    mvc AS (UPDATE public.vault_folders vf SET parent_id = d.keeper_id
            FROM dups d WHERE vf.parent_id = d.id AND vf.id <> d.keeper_id RETURNING 1),
    sd AS (UPDATE public.vault_folders vf SET deleted_at = now()
           FROM dups d WHERE vf.id = d.id RETURNING 1)
    SELECT removed + (SELECT count(*) FROM mvf) + (SELECT count(*) FROM mvc) + (SELECT count(*) FROM sd) INTO removed;

    RAISE NOTICE 'Dedupe iteration %: removed=%', iteration, removed;
    EXIT WHEN removed = 0;
  END LOOP;
END
$do$;

-- Final partial unique indexes.
CREATE UNIQUE INDEX IF NOT EXISTS vault_folders_one_live_per_drive_id
  ON public.vault_folders (club_id, parent_id, drive_folder_id)
  WHERE deleted_at IS NULL AND drive_folder_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS vault_folders_one_live_per_chat_group
  ON public.vault_folders (club_id, chat_group_id)
  WHERE deleted_at IS NULL AND chat_group_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS vault_folders_one_live_per_auto_name
  ON public.vault_folders (club_id, COALESCE(team_id::text,'-'), name)
  WHERE deleted_at IS NULL
    AND chat_group_id IS NULL
    AND drive_folder_id IS NULL
    AND parent_id IS NULL
    AND restricted_roles IS NULL
    AND name IN ('Chat Images', 'Chat Links', 'Gallery Uploads');
