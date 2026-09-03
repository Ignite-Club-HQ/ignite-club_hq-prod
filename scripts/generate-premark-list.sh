#!/usr/bin/env bash
# One-time backlog scanner: for every local migration NOT yet applied in prod,
# check whether every object it creates (tables, functions, policies) already
# exists in prod. If yes -> emit as safe-to-pre-mark. Prints a YAML block you
# can paste into .github/workflows/promote-to-prod.yml.
#
# Usage:
#   export PROD_DB_URL='postgresql://postgres.<ref>:<pw>@<pooler-host>:6543/postgres?sslmode=require'  # transaction pooler
#   bash scripts/generate-premark-list.sh
#
# Requires: psql, awk, grep. Read-only: only runs SELECTs against prod.

set -euo pipefail

: "${PROD_DB_URL:?Set PROD_DB_URL to the prod Postgres connection string}"

MIG_DIR="supabase/migrations"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "==> Fetching prod state..." >&2

# 1. Already-applied migrations in prod
psql "$PROD_DB_URL" -Atc \
  "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version" \
  > "$TMP/applied.txt"

# 2. All tables that exist in public
psql "$PROD_DB_URL" -Atc \
  "SELECT tablename FROM pg_tables WHERE schemaname='public'" \
  | sort -u > "$TMP/tables.txt"

# 3. All functions that exist in public
psql "$PROD_DB_URL" -Atc \
  "SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'" \
  | sort -u > "$TMP/functions.txt"

# 4. All policies that exist
psql "$PROD_DB_URL" -Atc \
  "SELECT schemaname||'.'||tablename||'::'||policyname FROM pg_policies" \
  | sort -u > "$TMP/policies.txt"

echo "==> Prod has $(wc -l < "$TMP/applied.txt") applied migrations, $(wc -l < "$TMP/tables.txt") tables, $(wc -l < "$TMP/functions.txt") functions" >&2

SAFE_LIST="$TMP/safe.txt"
UNSAFE_LIST="$TMP/unsafe.txt"
: > "$SAFE_LIST"
: > "$UNSAFE_LIST"

for f in "$MIG_DIR"/*.sql; do
  base=$(basename "$f")
  version="${base%%_*}"

  # Skip if already applied
  if grep -qx "$version" "$TMP/applied.txt"; then continue; fi

  # Extract created object names (best-effort regex)
  tables=$(grep -oiE 'create[[:space:]]+table[[:space:]]+(if[[:space:]]+not[[:space:]]+exists[[:space:]]+)?(public\.)?[a-z_][a-z0-9_]*' "$f" \
    | awk '{print tolower($NF)}' | sed 's/^public\.//' | sort -u)
  functions=$(grep -oiE 'create[[:space:]]+(or[[:space:]]+replace[[:space:]]+)?function[[:space:]]+(public\.)?[a-z_][a-z0-9_]*' "$f" \
    | awk '{print tolower($NF)}' | sed 's/^public\.//;s/(.*//' | sort -u)

  # Extract destructive/side-effect statements
  has_side_effects=$(grep -icE '^[[:space:]]*(insert|update|delete|alter[[:space:]]+table|drop[[:space:]]+)' "$f" || true)

  # No created objects AND no side effects => nothing to check, skip
  if [ -z "$tables" ] && [ -z "$functions" ] && [ "$has_side_effects" = "0" ]; then
    continue
  fi

  all_exist=1
  reasons=""

  if [ -n "$tables" ]; then
    while IFS= read -r t; do
      [ -z "$t" ] && continue
      if ! grep -qx "$t" "$TMP/tables.txt"; then
        all_exist=0
        reasons="$reasons missing_table:$t"
      fi
    done <<< "$tables"
  fi

  if [ -n "$functions" ]; then
    while IFS= read -r fn; do
      [ -z "$fn" ] && continue
      if ! grep -qx "$fn" "$TMP/functions.txt"; then
        all_exist=0
        reasons="$reasons missing_fn:$fn"
      fi
    done <<< "$functions"
  fi

  if [ "$all_exist" = "1" ]; then
    # Pick the most distinctive signature for the workflow check
    sig_table=$(echo "$tables" | head -n1)
    sig_fn=$(echo "$functions" | head -n1)
    echo "$version|$sig_table|$sig_fn|$base" >> "$SAFE_LIST"
  else
    echo "$version|$base|$reasons" >> "$UNSAFE_LIST"
  fi
done

echo "" >&2
echo "==> SAFE to pre-mark: $(wc -l < "$SAFE_LIST")" >&2
echo "==> Needs manual review: $(wc -l < "$UNSAFE_LIST")" >&2
echo "" >&2

echo "# ===== SAFE PRE-MARK LIST (paste into promote-to-prod.yml) ====="
while IFS='|' read -r version sig_table sig_fn base; do
  if [ -n "$sig_table" ]; then
    check="SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='$sig_table'"
  else
    check="SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='$sig_fn'"
  fi
  echo "  - version: \"$version\""
  echo "    check_sql: \"$check\""
  echo "    # file: $base"
done < "$SAFE_LIST"

echo ""
echo "# ===== UNSAFE / NEEDS REVIEW ====="
cat "$UNSAFE_LIST" >&2
