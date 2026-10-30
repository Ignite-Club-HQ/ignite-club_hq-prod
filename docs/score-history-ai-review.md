# In-app score and History review

Access: club page → Club settings → Score & History review. Available to email-auth club administrators, verified again on the server against the exact club role. Team administrators, administrators of other clubs and standalone app-admin roles are not granted access. Internet Identity has no verified AI endpoint authorization bridge and is explicitly unavailable, never routed through a guessed Supabase identity.

Administrators manually enter competition, match and team identifiers plus 2–20 source copies. Each has an explicit score order and two nullable whole-number scores. Blank means missing; zero stays zero. Unknown order, incomplete values or divergent normalized copies produce a deterministic human-review hold. All copies remain in the downloadable advisory report. The tool never reads, changes, clears or reconciles live scores/History.

After explicit consent, only numbered score copies and deterministic comparison flags go to `openai/gpt-6-astra` through AI SDK Responses on Lovable AI Gateway. Club and match/team identifiers remain out of the model prompt. No names, prose attachments, tools or database-write capability are provided to the model. The output streams as plain text. Stop cancels the browser request and passes its signal upstream. There are no automatic retries or timeouts. Model agreement is not verified evidence.

The DEV-only `score_review_ai_access` service-private table persists gateway 402/403 blocks. Recovery requires an operator to confirm restored access before clearing this private block; there is no automatic probe, alternate model or credential rotation. All role/access lookup failures deny the request. No user records are stored by this feature.

## Validation and remaining blockers
- 5 Deno policy tests and 3 frontend input tests passed.
- Deno server checks passed; preview build reports OK.
- Real Gateway sample: Score 0–2 versus History 1–2 → discrepancy explained, hold recommended, no source winner chosen. Run correlation header captured.
- Signed-out browser redirects to `/auth` with no page errors. This does not verify a real administrator session.
- DEV endpoint deployment failed twice with tool-level internal errors; the in-app operation is not yet activated/verified.
- External unmanaged Supabase session prevents authenticated browser acceptance here. Internet Identity support requires a separate verified authorization bridge.
- New access-state migration changes the pending release inventory and must be reconciled under existing release safeguards before any production promotion. Existing production release holds remain intact.
- Existing database linter findings predate this addition; the migration introduced none. They were not modified by this task.