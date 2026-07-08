#!/usr/bin/env bash
# Restore a Supabase PROD backup created by .github/workflows/promote-to-prod.yml
#
# WHEN TO USE THIS
# ----------------
# A promotion applied a bad migration to prod. You want the schema/data as it
# existed *immediately before* that promotion started. This DESTROYS anything
# written to prod since the backup ran — treat it as a nuclear option.
#
# Prefer, in order:
#   1. Write a forward reverse-migration (safe, no data loss).
#   2. Restore from Supabase's own PITR backup via the dashboard.
#   3. This script (last resort — data loss between backup and now).
#
# USAGE
# -----
#   1. Download the artifact from the failed GitHub Actions run:
#      Actions → Promote to Prod → <run> → Artifacts → prod-backup-*.tar.gz
#   2. export SUPABASE_DB_URL='postgresql://postgres:<PWD>@db.<REF>.supabase.co:5432/postgres'
#   3. ./scripts/restore-prod-backup.sh path/to/prod-backup-*.sql.gz
#
# Requires: psql, tar (both standard).

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <prod-backup-*.tar.gz>" >&2
  exit 1
fi
: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL to the prod connection string}"

ARCHIVE="$1"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "Extracting $ARCHIVE → $WORK"
tar xzf "$ARCHIVE" -C "$WORK"

cat <<EOF

⚠️  About to restore prod from backup.
    Target: $(echo "$SUPABASE_DB_URL" | sed 's|://[^@]*@|://***@|')
    Files : $(ls "$WORK")

This will OVERWRITE current prod schema + data.
Type 'RESTORE' to continue:
EOF
read -r confirm
[ "$confirm" = "RESTORE" ] || { echo "Aborted."; exit 1; }

echo "→ Restoring roles"
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$WORK/prod-roles.sql"
echo "→ Restoring schema"
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$WORK/prod-schema.sql"
echo "→ Restoring data"
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$WORK/prod-data.sql"

echo "✅ Restore complete. Verify the app, then decide whether to also revert the frontend commit."
