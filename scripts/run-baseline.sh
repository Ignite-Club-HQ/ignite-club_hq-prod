#!/usr/bin/env bash
# Compatibility entry point. The complete baseline has one lifecycle owner:
# run-complete-baseline starts the isolated stack, runs every frontend,
# Playwright and local-Supabase stage, and verifies cleanup in a finally block.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/run-complete-baseline.mjs --approved-local-session "$@"
