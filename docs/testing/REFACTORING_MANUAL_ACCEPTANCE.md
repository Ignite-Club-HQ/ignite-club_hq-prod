# Refactoring manual acceptance checklist

**Candidate branch:** `integrate/competition-current`

**Candidate commit:** `bca406b0c`

**Evidence:** [`../RELEASE_CANDIDATE_2026-08-17.md`](../RELEASE_CANDIDATE_2026-08-17.md)

**Expected duration:** 30–45 minutes

**Purpose:** Delegated smoke review before constructing a promotion branch

## Safety and evidence

- [ ] Confirm the deployed preview displays the exact candidate commit.
- [ ] Use synthetic or designated test accounts and clubs; do not alter real
  production club data.
- [ ] Record platform, browser/device, account role and timestamp.
- [ ] Capture a screenshot or short recording for every failure.
- [ ] Do not promote while any critical journey below is unexplained.

## Authentication and tenant context

- [ ] Sign in, sign out and sign in again without stale data from the previous
  session.
- [ ] Switch between two clubs and confirm theme, Home, Messages, Events, Media
  and Vault remain scoped to the selected club.
- [ ] Open a protected deep link while signed out and confirm authentication
  returns to the intended destination.

## Messaging and notifications

- [ ] Open team, club, operational/group, direct and club-admin conversations;
  each thread shows the same preview/message identity as the inbox.
- [ ] Send a text message, reply and reaction; each appears once and remains
  after reopening the thread.
- [ ] Open an in-app notification for an older message and confirm the exact
  message is visible and correctly positioned.
- [ ] Switch to another club, then open a notification belonging to the first
  club; the app switches context before revealing the correct thread.
- [ ] Background and resume the app from Inbox and an open chat; navigation and
  sending remain responsive and rows do not visibly jump.

## Events and Home

- [ ] Create, edit and delete a single event; Home/Next Up and Schedule reflect
  the committed state.
- [ ] Edit a recurring series end date and confirm the intended occurrences.
- [ ] RSVP as an adult and, where available, as a guardian for a child.
- [ ] Open a club-wide targeted game and verify grade/team attendance grouping.
- [ ] Cancel an event and confirm the UI does not claim success before the
  mutation completes.

## Membership and invitations

- [ ] Send or open a designated club-role and team-role invitation and confirm
  the intended account/signup destination and active club context.
- [ ] Add/update/remove a test membership and confirm unrelated roles remain.
- [ ] With two guardians assigned, remove one and confirm the remaining
  guardian retains the child assignment and RSVP ability.

## Vault and Media

- [ ] Navigate Vault folders; upload, rename, trash and restore/delete a test
  item with truthful success/failure feedback.
- [ ] Upload a test photo, change club/team filters and confirm it appears only
  in the intended scope.
- [ ] Add a Media reaction and confirm it appears without duplication.
- [ ] Verify “delete from Feed” and “delete from Feed and Vault” produce their
  distinct intended outcomes.
- [ ] Open Media after background/resume and confirm it remains responsive.

## Competition and PlayHQ

- [ ] Open fixtures, record/edit a result and inspect the ladder.
- [ ] Add or edit a manual match without changing unrelated fixtures.
- [ ] Open a team in a PlayHQ-configured club; the PlayHQ card appears without
  a React crash during loading.
- [ ] Open a team in an unconfigured club; the PlayHQ card remains absent.

## PitchBoard and AutoSub

- [ ] Enter PitchBoard from each routinely used entry point and start the timer.
- [ ] Perform one manual substitution and execute an AutoSub window.
- [ ] Background/lock and resume; the route, timer, lineup and plan remain
  intact and time never moves backwards.
- [ ] Change formation, add a fill-in if used, complete halftime and finish the
  game without duplicate substitutions or notifications.

## Native and external checks

- [ ] On at least one supported Android device, check keyboard/composer,
  background/resume and a notification tap.
- [ ] On at least one supported iOS device or simulator, check the same critical
  lifecycle paths.
- [ ] If the release changes payments, push delivery or a third-party
  integration, obtain separate provider-specific evidence. This checklist does
  not replace it.

## Acceptance record

```text
Candidate commit:
Preview URL/build:
Reviewer:
Date/time:
Platforms:
Accounts/roles used:
Passed sections:
Failures and evidence:
Deferred provider checks:
Decision: ACCEPT / REJECT / ACCEPT WITH RECORDED EXCEPTIONS
```
