#!/usr/bin/env bash
# Adds the Ignite update account as a controller on all 19 OpenCloud engine
# canisters (DEV engine app "Ignite Club HQ").
#
# Run this in a GitHub Codespace (or any machine) where the ICP CLI is
# signed in as the OpenCloud OWNER account:
#   4sf7q-x5j7l-a3cwp-dt7rd-evzpu-gextt-cmqum-fmzsg-avqpp-wk7ga-sae
#
# Usage:
#   bash scripts/engine-browser/add_engine_controller.sh
#
# The script refuses to continue if the CLI is signed in as any other
# account, and stops on the first failed canister.

set -euo pipefail

EXPECTED_OWNER="4sf7q-x5j7l-a3cwp-dt7rd-evzpu-gextt-cmqum-fmzsg-avqpp-wk7ga-sae"
UPDATE_ACCOUNT="jfagr-a4uwo-nlikz-ysri5-ipbrt-k4qa2-vkofo-it7lz-eha3w-4wix6-oqe"

CANISTERS=(
  "7pfcq-raaaa-aaac5-aabia-cai"  # website (frontend)
  "4krz3-miaaa-aaac5-aabdq-cai"  # club_domain
  "72ct5-qiaaa-aaac5-aablq-cai"  # club_points_domain
  "5symy-ciaaa-aaac5-aabhq-cai"  # competition_domain
  "533he-uaaaa-aaac5-aabga-cai"  # events_domain
  "5j5q5-yqaaa-aaac5-aabfa-cai"  # identity_access
  "7bhpy-kqaaa-aaac5-aabja-cai"  # insights_domain
  "5h75v-daaaa-aaac5-aabea-cai"  # media_blob_store
  "5o4wj-viaaa-aaac5-aabfq-cai"  # media_metadata
  "7ua6v-lyaaa-aaac5-aabkq-cai"  # messaging_domain
  "7ieee-4yaaa-aaac5-aabiq-cai"  # migration_coordinator
  "7ggjm-hiaaa-aaac5-aabjq-cai"  # mini_league_domain
  "6xmxt-7aaaa-aaac5-aabma-cai"  # notification_queue
  "5a63b-oyaaa-aaac5-aabeq-cai"  # pii_access_control
  "5vzkm-pqaaa-aaac5-aabha-cai"  # placement_registry
  "6qnrh-syaaa-aaac5-aabmq-cai"  # secret_workload_identity
  "75dvj-5qaaa-aaac5-aabla-cai"  # shard_router
  "542bq-zyaaa-aaac5-aabgq-cai"  # timer_jobs
  "7tbyb-gaaaa-aaac5-aabka-cai"  # vault_domain
)

echo "Checking which account the ICP CLI is signed in as..."
ACTUAL="$(icp identity principal)"
echo "Signed in as: ${ACTUAL}"

if [ "${ACTUAL}" != "${EXPECTED_OWNER}" ]; then
  echo ""
  echo "STOP: this is not the OpenCloud owner account."
  echo "Expected: ${EXPECTED_OWNER}"
  echo "Sign in with OpenCloud's CLI steps first, then re-run this script."
  exit 1
fi

echo ""
echo "Adding update account ${UPDATE_ACCOUNT} as controller on ${#CANISTERS[@]} canisters..."
for id in "${CANISTERS[@]}"; do
  echo "-> ${id}"
  icp canister settings update "${id}" \
    --add-controller "${UPDATE_ACCOUNT}" \
    --network ic --force
done

echo ""
echo "Done. Verifying controllers on each canister..."
for id in "${CANISTERS[@]}"; do
  if icp canister status "${id}" --network ic 2>/dev/null | grep -q "${UPDATE_ACCOUNT}"; then
    echo "OK   ${id}"
  else
    echo "MISS ${id}  (update account not listed — check this one)"
  fi
done
