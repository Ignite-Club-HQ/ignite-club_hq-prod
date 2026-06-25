## Goal

Cut AI Catch Up cost and latency by classifying each message **once** and reusing it across every user in the thread. The current design re-runs the full LLM on the entire history for every user, every time.

Target: **~300ms hot-path** (no LLM call) when digests are warm. **70–90% fewer LLM tokens** when cold. Same UX, same output shape.

## Architecture

```text
   New message arrives
          │
          ▼
   ┌──────────────────┐        ┌───────────────────────┐
   │ message_digests  │◄───────│ digest-messages       │
   │ (per message_id) │        │  (background worker)  │
   │ classification,  │        │  batches 10 msgs,     │
   │ summary, topic,  │        │  cheap LLM call       │
   │ is_action,       │        │  (flash-lite / llama) │
   │ is_question      │        └───────────────────────┘
   └────────┬─────────┘
            │
   User taps "Catch me up"
            │
            ▼
   ┌──────────────────────────────────┐
   │ assemble-catchup (no LLM)        │
   │ - read digests since last_opened │
   │ - bucket by today/yesterday/...  │
   │ - extract actions & questions    │
   │ - return in <300ms               │
   └──────────────────────────────────┘
            │
            ▼ (only if digests missing)
   fallback to summarize-chat / -icp
```

## What changes

### 1. New table: `message_digests`
One row per chat message. Immutable once written. Stores:
- `message_id`, `message_type` ('club'|'team'|'group'), `chat_scope_id`, `created_at`
- `classification` enum: `action` | `question` | `decision` | `social` | `info`
- `summary` (short single-line, PII-scrubbed)
- `topic` (short tag)
- `mentions_user_ids` (uuid[])
- `provider` ('gemini-flash-lite' | 'icp-llama' | 'icp-qwen')
- `digested_at`

RLS: read via same `can_access_chat_*` helpers as the source message.

### 2. New edge function: `digest-messages`
- Runs every 2 minutes via `pg_cron`.
- Picks last 200 undigested messages across all Pro clubs with `ai_catch_up_enabled`.
- Reuses existing PII scrubber.
- Calls **Gemini Flash-Lite** (cheap) **or** ICP Llama based on `app_settings.ai_summary_provider`.
- Single prompt classifies a **batch of 10** messages → JSON array. Cuts per-message overhead ~10x.
- Inserts into `message_digests` (idempotent on `message_id`).

### 3. New edge function: `assemble-catchup`
- No LLM call. Pure SQL + bucketing.
- Input: `chat_scope`, `last_opened_at`.
- Reads `message_digests` joined to source messages since `last_opened_at`.
- Buckets: Today / Yesterday / Earlier.
- Returns existing `CatchUpResponse` shape (compatible with `CatchMeUpSheet.tsx`).
- Falls back to `summarize-chat` / `summarize-chat-icp` only if >20% of recent messages have no digest yet.

### 4. Hook update: `useChatCatchUp.ts`
- Calls `assemble-catchup` first.
- Only falls back to full-LLM functions on `digests_missing` response code.
- No UI changes.

### 5. Backfill
- One-off invocation of `digest-messages` over last 7 days of Pro-club messages on rollout.

## Performance and cost projection

| Scenario | Today | After |
|---|---|---|
| Hot thread, 5 users hit "Catch me up" | 5 × 10s LLM calls | 5 × 300ms SQL, 0 LLM |
| New message, 1 user opens | 1 × 10s | ~300ms (digest already warm) |
| Cold thread | 1 × 10s | 1 × 10s (same — fallback) |
| Gemini tokens/day (est.) | 100% baseline | ~10–25% baseline |
| ICP calls/day | 100% baseline | ~10–25% baseline |

## Safety preserved
- Same PII scrubber runs in `digest-messages` before LLM call.
- Sensitive-topic blocklist runs in `assemble-catchup` over digest topics → returns `sensitive_content` as before.
- 48h cache TTL no longer needed (digests are immutable; cheap to re-assemble).
- Admin bypass / club toggle / junior club restrictions enforced in `assemble-catchup` (same code as today).

## Out of scope
- No UI changes.
- No change to disclosure dialog.
- No change to provider selector in `/admin/settings`.
- Existing `summarize-chat` / `summarize-chat-icp` stay as fallback — not deleted.

## Rollout
1. Migration: create `message_digests` + RLS + GRANTs + index on `(chat_scope_id, created_at)`.
2. Ship `digest-messages` function + cron schedule (disabled by default via `app_settings.digest_worker_enabled`).
3. Ship `assemble-catchup` function.
4. Update `useChatCatchUp.ts` to try assemble first.
5. Enable worker for one pilot club (Bridgewater SC) → observe for 24h.
6. Enable globally.

Approve to proceed with step 1.