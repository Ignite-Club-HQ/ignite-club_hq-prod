# Ignite Club HQ Documentation Index

**Last reviewed:** 2026-08-18

The categories below distinguish current operating guidance from point-in-time
analysis. If a dated report conflicts with an authoritative document or the
repository, use the repository and authoritative document, then update the
documentation.

## Authoritative operating documents

- [Repository entry point](../README.md)
- [Architecture and invariants](ARCHITECTURE.md)
- [Promotion and rollback runbook](PROMOTION.md)
- [Dev to Prod environment checklist](PROMOTION_CHECKLIST.md)
- [Local Supabase test safety](testing/local-supabase.md)
- [Edge Function authentication](EDGE_FUNCTION_AUTH.md)
- [Edge Function and scheduled-work ownership](EDGE_FUNCTION_OWNERSHIP.md)
- [Push delivery queue](PUSH_DELIVERY_QUEUE.md)
- [Native IAP verification](NATIVE_IAP_VERIFICATION.md)

## Vendor onboarding and support

- [Detailed vendor technical handover](VENDOR_HANDOVER.md)
- [Vendor access and support pack](VENDOR_HANDOVER_PACK.md)
- [Current cumulative release-candidate evidence](RELEASE_CANDIDATE_2026-08-17.md)
- [Current promotion tranche and rollback plan](PROMOTION_TRANCHES_2026-08-17.md)
- [Current promotion construction preflight](PROMOTION_PREFLIGHT_2026-08-18.md)
- [Current code-quality ratchet](CODE_QUALITY_RATCHET_2026-08-18.md)
- [Refactoring automated closeout](REFACTORING_AUTOMATED_CLOSEOUT_2026-08-15.md)
- [Delegated refactoring acceptance checklist](testing/REFACTORING_MANUAL_ACCEPTANCE.md)
- [External and physical-device acceptance record](testing/EXTERNAL_ACCEPTANCE_2026-08-18.md)
- [Recent work state](RECENT_WORK_STATE.md) — a checkpoint; verify branch and
  commit before relying on it
- [Android keyboard QA](qa/android-keyboard-checklist.md)
- [iOS image gesture QA](qa/ios-pinch-zoom-checklist.md)

The two handover documents are broad supporting references. Counts, dependency
versions, dashboard settings, and service inventories can age; verify them
against the lockfile, current source, workflows, and external consoles.

## Security and reliability references

- [Security remediation risk review](SECURITY_REMEDIATION_RISK_REVIEW_2026-07-22.md)
- [Realtime membership audit](REALTIME_MEMBERSHIP_AUDIT.md)
- [Messaging scoped-revocation finding](MESSAGING_SCOPED_REVOCATION_FINDING_2026-07-26.md)
- [Edge secret operations](edge-secrets.md)
- [Brace expansion advisory](security/brace-expansion-advisory.md)

## Capacity and test operations

- [Capacity assessment](CAPACITY_ASSESSMENT_2026-07-24.md)
- [Scaling observability](SCALING_PHASE_1_OBSERVABILITY.md)
- [Local load testing](testing/local-load-testing.md)

Capacity numbers are measurements and forecasts from their stated dates, not a
service-level guarantee. Re-measure against current workload and Supabase plan.

## Historical audits and refactoring plans

These documents explain decisions and supply acceptance criteria. They are not
deployment instructions and may describe work already completed on a tranche or
integration branch.

The 17 August release-candidate record and promotion-tranche plan are the
current cumulative status; the dated closeout and tranche plans remain the
detailed decision history.

- [Codebase vendor-readiness audit](CODEBASE_VENDOR_READINESS_AUDIT_2026-07-26.md)
- [Code health check](CODE_HEALTH_CHECK_2026-07-22.md)
- [Frontend data and query coupling audit](FRONTEND_DATA_COUPLING_AUDIT_2026-08-13.md)
- [Expanded refactoring readiness](REFACTORING_READINESS_EXPANDED_2026-07-26.md)
- [Remaining refactoring test plan](REFACTORING_READINESS_REMAINING_TEST_PLAN.md)
- [Stage 1 refactoring readiness](REFACTORING_READINESS_STAGE_1_2026-07-26.md)
- [Phase 0 checkpoint](REFACTORING_PHASE_0_CHECKPOINT_2026-08-02.md)
- [Competition and fixtures refactor](REFACTORING_PHASE_1_COMPETITION_FIXTURES_PLAN_2026-08-03.md)
- [Messaging refactor](REFACTORING_MESSAGING_PLAN_2026-08-04.md)
- [Vault refactor](REFACTORING_VAULT_PLAN_2026-08-07.md)
- [Membership and invitations refactor](REFACTORING_MEMBERSHIP_INVITATIONS_PLAN_2026-08-09.md)
- [Autosub and pitch-board refactor](REFACTORING_AUTOSUB_PITCHBOARD_PLAN_2026-08-10.md)
- [Events refactor](REFACTORING_EVENTS_PLAN_2026-08-11.md)
- [Autosub fairness rewrite](autosub-fairness-rewrite.md)

## Documentation maintenance

- Architecture/security boundary changes update `ARCHITECTURE.md` in the same
  pull request.
- Branch, CI, deployment, or rollback changes update `PROMOTION.md` and the
  promotion checklist in the same pull request.
- Add a date and explicit status to new audits/plans.
- Move superseded guidance into a clearly marked historical section; do not
  leave two documents claiming to be authoritative.
- Never record secrets, hosted credentials, real user data, or recovery tokens.

## Repository review controls

- `.github/CODEOWNERS` identifies the current reviewer for sensitive areas. It
  is advisory unless a GitHub branch ruleset requires Code Owner approval.
- `.github/pull_request_template.md` captures behavioural scope, security and
  backend impact, test evidence, manual verification, promotion, and rollback.
- When a vendor team is granted repository access, replace individual ownership
  with the appropriate organisation team and review the branch rulesets before
  enabling mandatory approval.
