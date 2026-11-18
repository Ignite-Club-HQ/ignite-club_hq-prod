# DEV name, invitation and schedule improvements

## Implemented

- **Name unlocking:** independent original-PII route closing checks now run together. The pinned DEV resolver shares an overlapping full registry confirmation between original sources, then discards it; subsequent unlocks recheck. Names remain withheld until all required checks pass. Ciphertext authorization, club keys, identity/session fences and denied-access behavior are unchanged.
- **Invitation acceptance:** empty-child receipts skip child-access setup. For family invitations, guardian setup and the name grant remain awaited (existing eight-second cap); birth-year and jersey-number grants continue independently. Acceptance and exact committed-receipt reads are still required, with no write replay. The wait timer is cleared on fast completion.
- **Schedule deduplication:** overlapping event-list requests share their in-flight read beyond the same-tick batch window, isolated by identity object, caller, full target and club/team filters. Settled or failed promises are discarded so later visits reread the server. Duplicate exact club/event rows are removed; distinct IDs and clubs remain separate, even when titles/dates match. Consumers get independent result arrays.

## Verification

- 197 focused tests pass in each of email and Internet Identity configurations (16 files per configuration).
- Edited-file ESLint passes.
- Regressions cover parallel-but-required name closing, registry drift, later fresh confirmations, exact club-key reuse, optional slow invite fields, timer cleanup, uncertain acceptance refusal, overlapping event reads, destination/account/filter separation, exact-row deduplication and failure recovery.
- Existing mounted invitation, team roster and Schedule page tests pass. These use controlled service responses, not a delegated real Internet Identity session.

## Limits and acceptance still required

No deployed canisters, accounts, role grants, stored events, production settings or PROD releases were changed. No event deletion, historical reconciliation, scheduler activation or cryptographic format change is included.

The sandbox has no delegated Internet Identity user session; its email integration is external/unmanaged. Consequently real signed-in DEV end-to-end unlock/join/readback and installed-phone timing remain unverified. The results above establish code regressions, not measured real-network seconds saved. Before production promotion, exercise these on grouped DEV:

1. Open a populated club/team after fresh sign-in and on a repeat visit; confirm authorized names unlock and a denied member cannot read them.
2. Accept a real family invitation; confirm success, exact linked children and readable names, including when optional details are slow.
3. Open Schedule and Home with overlapping loads, refresh, and confirm one card per exact event while separate same-title events remain visible.

Root architecture notes were not expanded because the user-owned root AGENTS rules exhaust its size budget; scoped rules record the decisions.