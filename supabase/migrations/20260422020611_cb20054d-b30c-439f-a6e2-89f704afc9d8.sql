-- Rename existing vault files whose display name was incorrectly captured as a
-- generic Google URL action segment ("edit", "view", "preview", etc.) when the
-- link was synced from a chat. Replace with a friendly label derived from the URL.
UPDATE public.vault_files
SET name = CASE
    WHEN file_url ILIKE '%/spreadsheets/%' THEN 'Google Sheet'
    WHEN file_url ILIKE '%/document/%'    THEN 'Google Doc'
    WHEN file_url ILIKE '%/presentation/%' THEN 'Google Slides'
    WHEN file_url ILIKE '%/forms/%'       THEN 'Google Form'
    WHEN file_url ILIKE '%drive.google.com%' THEN 'Google Drive file'
    WHEN file_url ILIKE '%docs.google.com%'  THEN 'Google Doc'
    ELSE name
  END
  || COALESCE(
    ' (' || substring(file_url FROM '/d/([a-zA-Z0-9_-]{1,6})') || ')',
    ''
  )
WHERE name IN ('edit', 'view', 'preview', 'comment', 'copy', 'template')
  AND (file_url ILIKE '%google.com%');