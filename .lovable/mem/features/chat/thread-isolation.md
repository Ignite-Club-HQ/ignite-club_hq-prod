---
name: Chat thread isolation
description: Cross-group message bleed root cause — chat routes must remount on param change and GroupChatPage must scope every message list to the active group_id
type: constraint
---

Symptom (prod, 2026-08-04): a message posted in "Team admins & coaches" rendered inside the "Finance" group thread of the same club. The DB was clean — every `group_messages` insert stamps an explicit correct `group_id`. It was a client render/persist bleed.

Root causes, all in the "route param changed without a remount" family:

1. `<Route path="/groups/:groupId" element={<GroupChatPage />} />` — React Router reuses the element instance when only the param changes, so `localMessages`, refs and query-hook `prev` all survive chat A → chat B.
2. `placeholderData: (prev) => { if (prev) return prev; }` — `prev` is the PREVIOUS group's `{messages, reactions}`; returned verbatim as group B's data.
3. The fail-open `previousOnly` merge in the sync `useLayoutEffect` keeps prior rows absent from the incoming snapshot, with no `group_id` check — foreign rows latched in permanently and were re-persisted via `cacheMessages("group", groupId, ...)`.
4. The groupId-reset is a passive `useEffect`, which always runs AFTER the merging `useLayoutEffect` in the same commit — guaranteeing one merge pass sees the old group's state.

Rules:
- Every conversation route (`/groups/:groupId`, `/messages/:teamId`, `/messages/club/:clubId`, `/messages/dm/:conversationId`, `/messages/club-admin/:conversationId`) is wrapped in `RemountOnParamChange` in `src/App.tsx`, which keys a `Fragment` on the param. Never unwrap them.
- Never return React Query `placeholderData` `prev` for a chat thread without verifying the rows belong to the current thread id.
- Any fail-open message merge MUST drop rows whose thread foreign key differs from the active thread id.
- Guarded by `src/test/chatCrossThreadBleed.guard.test.ts`.
