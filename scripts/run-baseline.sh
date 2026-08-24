#!/usr/bin/env bash
# =====================================================================
# One-click baseline for the push-delivery work.
#
#   ./scripts/run-baseline.sh
#
# Runs, in order:
#   1. Frontend suite            (vitest run)
#   2. Edge-function suites      (deno test — fan-out, queue worker, auth)
#   3. Database integration      (psql against a FRESH LOCAL Supabase stack)
#
# Step 3 is SKIPPED (loudly, non-fatally) when no local stack is reachable.
# It NEVER runs against hosted dev or production: the target must be a
# localhost Postgres. Everything in the SQL suite is transaction-wrapped and
# rolled back, and only synthetic ids are used.
# =====================================================================
set -uo pipefail
cd "$(dirname "$0")/.."

FAILED=0
step() { printf '\n\033[1m=== %s ===\033[0m\n' "$1"; }
fail() { printf '\033[31mFAIL: %s\033[0m\n' "$1"; FAILED=1; }
skip() { printf '\033[33mSKIP: %s\033[0m\n' "$1"; }

step "1/3 Frontend suite (vitest)"
if CI=true TZ=UTC npx vitest run; then
  echo "frontend suite passed"
else
  fail "frontend suite"
fi

step "2/3 Edge-function suites (deno)"
if command -v deno >/dev/null 2>&1; then
  ( cd supabase/functions && deno test --allow-net --allow-env --no-check \
      process-event-notifications/event_notify_characterization_test.ts \
      process-event-notifications/push_delivery_queue_test.ts \
      process-push-delivery-queue/internal_auth_test.ts ) \
    || fail "edge-function suites"
else
  skip "deno not installed — edge-function suites not run"
fi

step "3/3 Database integration (fresh local Supabase stack)"
DB_URL="${BASELINE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
if [[ "$DB_URL" != *"127.0.0.1"* && "$DB_URL" != *"localhost"* ]]; then
  fail "refusing to run DB tests against a non-local target"
elif ! command -v psql >/dev/null 2>&1; then
  skip "psql not installed"
elif ! psql "$DB_URL" -c 'select 1' >/dev/null 2>&1; then
  skip "no local Supabase stack on 54322 — run 'supabase start' first (see docs/PUSH_DELIVERY_QUEUE.md)"
else
  for SQL_TEST in supabase/tests/push_delivery_queue_test.sql supabase/tests/enqueue_event_push_v2_ambiguity_test.sql; do
    OUT=$(psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_TEST" 2>&1)
    echo "$OUT" | grep -E '^(NOTICE|ERROR|psql:)' || true
    if echo "$OUT" | grep -q 'FAIL \|ERROR'; then
      fail "database integration suite ($SQL_TEST)"
    else
      printf 'database integration suite passed (%s, %s assertions)\n' "$(basename "$SQL_TEST")" "$(echo "$OUT" | grep -c 'ok   ')"
    fi
  done
fi

printf '\n'
if [[ "$FAILED" -eq 0 ]]; then
  printf '\033[32mBASELINE GREEN\033[0m\n'
else
  printf '\033[31mBASELINE RED\033[0m\n'
fi
exit "$FAILED"
