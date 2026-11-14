# Ted to U10 (DEV) — staged copy release gate

**Source-only safety foundation. No live write, executable UI, automatic migration, or canister upgrade is included.**

The user's read-only DEV screenshot passed the exact pinned preflight for Ted:
- G1 canister `mzzzv-taaaa-aaaal-qxlrq-cai`, child `child-own-3-12562284057`, decrypted name **Ted**; one parent/guardian, no source team
- Test full access principal `edt5h-vbtif-a523i-cfe6i-ieemk-2ljzi-frngv-3vjyy-mxf3o-safv3-fae`
- G2 canister `yfwyv-nyaaa-aaaal-qxpyq-cai`, U10 team `a3e9341e-bc61-4e4d-9ebf-2f2c9f347128`, club `177f8c01-3617-402a-aedd-5c5c17ccfde1`; no child on that Parent's destination at preflight
- The other child in G1 is out of scope and must remain untouched.

## Important: this is a staged new child, not the same child ID transferred

The existing `create_own_child()` necessarily generates a new G2 ID, and there is no per-child import or cross-group atomic transaction. The original G1 record is preserved; any later cleanup is a **distinct action requiring explicit approval**.

The code in `frontend/src/features/membership/devTedU10CopyCoordinator.ts` models an approved operator-driven sequence but is **NOT hooked to the application**. It is inert until an approved executor, durable journal adapter and separate authorisation exist. The companion strict PII helper **propagates errors** instead of swallowing them, but has no new UI call sites.

## Requirements BEFORE wiring or executing any step

1. An independently reviewed private, **globally atomic compare-and-set journal** must support `claimCreateOnce`, `readReceipt`, `advanceReceipt` for this exact source ID + destination club + Parent. Browser `localStorage` or session memory are NOT a safe shared journal across devices. Restrict journal readers and writers to authorised operator identities, scrub secrets and plaintext names, and preserve audit history.
2. Explicit owner approval to create **exactly one new G2 DEV child for Ted** by the linked Test full access Parent. Approval must name G1 source child and G2 U10 target, declare G1 preservation, and be **separate from simply viewing the read-only preflight or merging a PR**.
3. Verify the live Parent session, current source name, original child+sole guardian and no source team, destination empty, exact group routing, and Group 2 club membership **immediately before** creation. Abort on any mismatch, warning or partially unreadable result.
4. Atomically reserve a unique copy receipt with `phase=create-pending` **before** one `create_own_child()`. Never auto-retry on an error, timeout, lost response, duplicated click, another device, crash, or unknown outcome. An existing journal refuses creation.
5. Record the unique new G2 child ID and confirm Parent ownership and sole guardian. If the create returned but the receipt cannot be conditionally saved, **stop**. This is an uncertain outcome that needs a manual readback; do not create again.
6. Move `phase=name-pending`, then register **new** G2 encrypted name using a strict caller-verified writer, and **independently decrypt/read back 'Ted' in G2**. A success toast or best-effort `registerLiveChildNamePii` result is NOT evidence. Do not add to U10 if name verification is missing.
7. Move `phase=team-pending`, then issue **one** G2 `set_own_child_team` assignment. Independently read back the new G2 child with exactly U10, same Parent and sole guardian. Unknown reply remains pending, not retried.
8. Verify with a separately authenticated **Paul** staff account that the new G2 child appears on U10 roster and name has the intended club read grant; verify original G1 Ted and the other G1 child are unchanged.
9. Mark `phase=staff-verified` only after complete checks; never delete or detach Ted from G1 during this workflow. Notifications and PROD must not change.

## What remains before any live transfer

The code intentionally leaves `TedCopyActions` adapter **unimplemented**. Separate PR/review must provide:
- Privately authenticated atomic receipt implementation or operator-backed GitHub receipt with compare-and-set and no duplicate race
- Executor that binds to *only* pinned G2 canisters and the current Test full access principal and calls the strict PII helper. It must implement fresh readback and expose **one separately approved, deliberate write action**, not an automatic effect.
- Mock and disposable PocketIC failure/unknown-result rehearsals for write paths, including loss of response *after* canister commit and independent staff readback.
- Production and independent account boundary tests to prove no writes outside the exact DEV Group 2 child record.

**This PR never writes to children, guardians, teams, email, notifications, or any backend.**
