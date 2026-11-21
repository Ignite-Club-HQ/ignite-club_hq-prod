#!/usr/bin/env bash
# Grants the Ignite DEV update keys controller access on all 32 OpenCloud engine
# canisters: the 19 parts in app "ignite_dev" plus the 13 Group 2 parts.
#
# Run this on a machine where the ICP CLI is signed in as the OpenCloud OWNER
# account (the same account you sign in to the console with):
#   4sf7q-x5j7l-a3cwp-dt7rd-evzpu-gextt-cmqum-fmzsg-avqpp-wk7ga-sae
#
# To get that identity onto the command line (browser and CLI must be on the
# same machine, because the sign-in redirects to that machine's own address):
#   icp identity link web opencloud-owner --app opencloud.org
#   icp identity default opencloud-owner
#
# Usage:
#   bash scripts/engine-browser/add_engine_controller.sh
#
# The script refuses to continue if the CLI is signed in as any other account,
# and stops on the first failed canister. It only ever ADDS controllers; it never
# removes or replaces the owner.

set -euo pipefail

EXPECTED_OWNER="4sf7q-x5j7l-a3cwp-dt7rd-evzpu-gextt-cmqum-fmzsg-avqpp-wk7ga-sae"
DEV_GOVERNOR="vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae"
WEB_APP_KEY="jfagr-a4uwo-nlikz-ysri5-ipbrt-k4qa2-vkofo-it7lz-eha3w-4wix6-oqe"
FRONTEND="7pfcq-raaaa-aaac5-aabia-cai"

# id|label   (the frontend is handled separately for the publishing key)
CANISTERS=(
  "7pfcq-raaaa-aaac5-aabia-cai|website (frontend)"
  "4krz3-miaaa-aaac5-aabdq-cai|club_domain"
  "72ct5-qiaaa-aaac5-aablq-cai|club_points_domain"
  "5symy-ciaaa-aaac5-aabhq-cai|competition_domain"
  "533he-uaaaa-aaac5-aabga-cai|events_domain"
  "5j5q5-yqaaa-aaac5-aabfa-cai|identity_access"
  "7bhpy-kqaaa-aaac5-aabja-cai|insights_domain"
  "5h75v-daaaa-aaac5-aabea-cai|media_blob_store"
  "5o4wj-viaaa-aaac5-aabfq-cai|media_metadata"
  "7ua6v-lyaaa-aaac5-aabkq-cai|messaging_domain"
  "7ieee-4yaaa-aaac5-aabiq-cai|migration_coordinator"
  "7ggjm-hiaaa-aaac5-aabjq-cai|mini_league_domain"
  "6xmxt-7aaaa-aaac5-aabma-cai|notification_queue"
  "5a63b-oyaaa-aaac5-aabeq-cai|pii_access_control"
  "5vzkm-pqaaa-aaac5-aabha-cai|placement_registry"
  "6qnrh-syaaa-aaac5-aabmq-cai|secret_workload_identity"
  "75dvj-5qaaa-aaac5-aabla-cai|shard_router"
  "542bq-zyaaa-aaac5-aabgq-cai|timer_jobs"
  "7tbyb-gaaaa-aaac5-aabka-cai|vault_domain"
  "dc4y3-hiaaa-aaac5-aadjq-cai|g2_messaging_domain"
  "dx3jw-gaaaa-aaac5-aadka-cai|g2_vault_domain"
  "dq2pc-lyaaa-aaac5-aadkq-cai|g2_events_domain"
  "dzze6-5qaaa-aaac5-aadla-cai|g2_club_domain"
  "d6yck-qiaaa-aaac5-aadlq-cai|g2_notification_queue"
  "ctwge-7aaaa-aaac5-aadma-cai|g2_mini_league_domain"
  "cuxaq-syaaa-aaac5-aadmq-cai|g2_media_metadata"
  "c5ulm-eqaaa-aaac5-aadna-cai|g2_insights_domain"
  "c2vny-jiaaa-aaac5-aadnq-cai|g2_timer_jobs"
  "cps4v-iaaaa-aaac5-aadoa-cai|g2_club_points_domain"
  "cit2b-fyaaa-aaac5-aadoq-cai|g2_media_blob_store"
  "cbqr5-tqaaa-aaac5-aadpa-cai|g2_pii_access_control"
  "cgrxj-6iaaa-aaac5-aadpq-cai|g2_competition_domain"
)

echo "Checking which account the ICP CLI is signed in as..."
ACTUAL="$(icp identity principal)"
echo "Signed in as: ${ACTUAL}"

if [ "${ACTUAL}" != "${EXPECTED_OWNER}" ]; then
  echo ""
  echo "STOP: this is not the OpenCloud owner account."
  echo "Expected: ${EXPECTED_OWNER}"
  echo "Run: icp identity link web opencloud-owner --app opencloud.org"
  echo "       icp identity default opencloud-owner"
  echo "then re-run this script."
  exit 1
fi

echo ""
echo "Adding the DEV governor ${DEV_GOVERNOR} as controller on ${#CANISTERS[@]} canisters..."
for entry in "${CANISTERS[@]}"; do
  id="${entry%%|*}"
  label="${entry##*|}"
  echo "-> ${label} (${id})"
  icp canister settings update "${id}" \
    --add-controller "${DEV_GOVERNOR}" \
    --network ic --force
done

echo ""
echo "Adding the web-app publishing key ${WEB_APP_KEY} to the website part only..."
icp canister settings update "${FRONTEND}" \
  --add-controller "${WEB_APP_KEY}" \
  --network ic --force

echo ""
echo "Granting the website part's upload permissions to both update keys..."
for key in "${DEV_GOVERNOR}" "${WEB_APP_KEY}"; do
  for permission in Prepare Commit; do
    echo "-> ${permission} for ${key}"
    icp canister call "${FRONTEND}" grant_permission \
      "(record { to_principal = principal \"${key}\"; permission = variant { ${permission} } })" \
      --network ic
  done
done

echo ""
echo "Done. Verifying controllers on each canister..."
FAILED=0
for entry in "${CANISTERS[@]}"; do
  id="${entry%%|*}"
  label="${entry##*|}"
  if icp canister status "${id}" --network ic 2>/dev/null | grep -q "${DEV_GOVERNOR}"; then
    echo "OK   ${label} (${id})"
  else
    echo "MISS ${label} (${id})  (DEV governor not listed - check this one)"
    FAILED=1
  fi
done

if icp canister status "${FRONTEND}" --network ic 2>/dev/null | grep -q "${WEB_APP_KEY}"; then
  echo "OK   website (frontend) publishing key"
else
  echo "MISS website (frontend) publishing key"
  FAILED=1
fi

if [ "${FAILED}" -ne 0 ]; then
  echo ""
  echo "Some canisters did not confirm. Re-run this script; it is safe to repeat."
  exit 1
fi

echo ""
echo "All 32 canisters confirmed. The DEV governor can now update every part."
