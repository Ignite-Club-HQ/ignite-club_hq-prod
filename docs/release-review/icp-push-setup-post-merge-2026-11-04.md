# ICP push notifications — setup after main → prod merge (2026-11-04)

Goal: push on for both systems at once. Email-sign-in clubs keep Supabase push
(already configured); secure-sign-in (ICP) clubs get push via the ICP outbox.
Each message lives in one system only, so no duplicate notifications.

## Current state (verified 2026-11-04, read-only)

- App: native token registration works in both modes (`nativePush.ts`, `useNativePush.ts`).
  Web/PWA push is disabled in all modes by design.
- Supabase push: FCM secrets present (`FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`,
  `FCM_PRIVATE_KEY`, `FCM_SERVICE_ACCOUNT`). Live test send not yet observed.
- ICP push DEV (`ignite-club-hybrid`): has `ICP_PUSH_WORKER_SEED`; missing
  `FCM_SERVICE_ACCOUNT_JSON` → scheduled worker no-ops ("not configured").
- ICP push PROD (`ignite-club_hq-prod`): variables `PROD_GOVERNOR_PRINCIPAL`,
  `PROD_ICP_PUSH_WORKER_PRINCIPAL`, `PUSH_WORKER_PRINCIPAL` only. Missing
  `PROD_ICP_PUSH_ENABLED`, `PROD_ICP_PUSH_QUEUE_IDS_JSON`, `PROD_FIREBASE_PROJECT_ID`,
  runtime `PROD_ICP_PUSH_WORKER_SEED`, `PROD_FCM_SERVICE_ACCOUNT_JSON`.
- Queues: DEV `jfcdq-yiaaa-aaaal-qxloa-cai`; PROD `w263o-3aaaa-aaaai-ayesq-cai`
  (plus PROD group-2 queue, ID to be read from prod branch mappings).

## Order (after Phase 4 live acceptance in the master plan)

### Step 1 — DEV first (prove it works)
1. Add `FCM_SERVICE_ACCOUNT_JSON` (Firebase service-account file) to DEV repo secrets.
2. For instant delivery, add to DEV edge-function secrets: `ICP_PUSH_WORKER_SEED`,
   `FCM_SERVICE_ACCOUNT_JSON` (queue defaults to DEV).
3. Paul signs in with secure sign-in on a phone (DEV build), sends a chat message from another account.
4. Confirm: push arrives once, tap opens the chat, worker run shows sent > 0.
Stop if any check fails; fix on DEV.

### Step 2 — PROD (separate approval from Paul)
1. PROD repo secrets: `PROD_ICP_PUSH_WORKER_SEED`, `PROD_FCM_SERVICE_ACCOUNT_JSON`.
2. PROD repo variables: `PROD_FIREBASE_PROJECT_ID`, `PROD_ICP_PUSH_QUEUE_IDS_JSON`
   (exact list of all PROD notification_queue IDs, both groups — never DEV).
3. Confirm worker principal is authorised on each PROD queue (read-only check).
4. PROD edge-function secrets for instant kick: worker seed, FCM file and
   explicit `NOTIFICATION_QUEUE_CANISTER_ID` (default is DEV — must be overridden).
5. Run `[PROD] ICP push deliver` once manually; it must validate inventory and exit cleanly.
6. Only then set `PROD_ICP_PUSH_ENABLED=true` to switch on the 5-minute schedule.

### Step 3 — Live check (one iPhone, one Android)
- Email-sign-in club member: push arrives (Supabase path).
- Secure-sign-in club member: push arrives (ICP path).
- One notification per message; no DEV queue in PROD logs.

## Rules
- No data changes; credentials only. Scheduler activation is its own approval.
- A missing PROD queue or setting must fail closed, never fall back to DEV.
- Turning off: unset `PROD_ICP_PUSH_ENABLED`.
