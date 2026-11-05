# Live database release: classification of the 39 waiting changes (4 Nov 2026)

This is a read-only review. Nothing has been applied to the live database.
"Record only" means the live history gets an entry saying the change was handled, but the SQL is never run there. That needs a separate tool, which runs only with Paul's approval.

## A. Structure-only candidates (24): owner scope approved, execution not ready
20260928122526, 20261003053838, 20261004012137, 20261004045741, 20261007010000,
20261007020000, 20261009090000, 20261009100000, 20261010000000, 20261010010000,
20261011000000, 20261012020000, 20261013000000, 20261014000000, 20261014010000,
20261014014920, 20261014014957, 20261014015130, 20261014020000, 20261014030000,
20261014062816, 20261015185653, 20261015192331, 20261104031935 (separate email-invite check)

### 4 November follow-up: proceed with safe items

Paul approved proceeding with safe structural items, not score copying/clearing, country
backfills, reminder activation, AI activation or migration-history repairs. No live
deployment occurred in this follow-up.

The earlier “send live as-is” label was too strong. Running these 24 candidates through
the actual structural SQL checker produced **10 passes and 14 held candidates**.
Policy expressions and subqueries require review under the current checker; two files
also lack the required explicit service-role grant. Parser passes alone do not establish
target compatibility, dependency readiness or authorization to execute.

- Parser passes: 20260928122526, 20261003053838, 20261004045741,
  20261007010000, 20261007020000, 20261011000000, 20261014014957,
  20261014015130, 20261014062816, 20261104031935.
- Required grant findings: 20261009100000 (`competition_event_operations`) and
  20261013000000 (`icp_welcome_email_deliveries`). Preserve applied originals;
  any correction must use a separately reviewed release adaptation.
- Exact candidate hashes and checker findings are saved in
  `safe-items-check-2026-11-04.json`; this is diagnostic evidence, not an executable plan.
- Focused release/preflight tests: **26 passed, 0 failed**.

**Execution blocker:** the current runner deploys the complete pending tree and has
no selective-release or record-only mode. It cannot release these candidates while
leaving the unsafe originals pending. Do not relax fingerprints, mark unapplied SQL
as applied, or filter the tree to force deployment. The next required work is a reviewed
exact staging mechanism within the existing release process, followed by target
compatibility checks; any live migration-history modification needs separate approval.

## B. Test-site only: record only, never run live (6)
- 20261030013157: replaces live profile creation; superseded by 20261104031935
- 20261030013232: tightens permissions on the function above; superseded by 20261104031935
- 20261030013444: test script that writes test invites
- 20261030013735: email club list using test-site club IDs
- 20261030014542, 20261030014712: test-site permission repairs

## C. Wanted on live, but the original would fail there: record only, plus a live-safe replacement (3)
- 20261030030705 / 030741 / 031128: let people leave a competition role. Each file deliberately stops on any database other than the test site. The replacement creates the final function, delete/read rules and owner guard without that stop.

## D. Writes or clears live data: needs Paul's decision (6)
- 20261008014417: adds the club country and service columns (structure), but also sets every live club's country to AU (data).
- 20261012000000: competition document storage. It also creates a private storage area, which counts as a settings write.
- 20261012010000: scheduled event reminders. It turns on and schedules a recurring background job.
- 20261021003048: hidden scores and history. It copies scores into a new table, then **clears existing live scores**. This must never run as written (rule: keep current scores, hold back score and AI changes).
  - Verified 4 Nov: the change is **not a deletion of the numbers**. Every competition score is copied into `competition_match_results` first, and the app already reads scores from that table on fixtures, ladders, public competition pages and history (verified in `CompetitionFixturesPanel.tsx`, `PublicCompetitionPage.tsx`, `historyRepository.ts`). Only the duplicate copies in the old match/event columns are emptied, and only for competition-linked rows — ordinary club and mini-league games keep their own scores.
  - The emptying is what makes hiding real, not decoration: fixture rows are readable by anyone who can see the fixture, and public-competition fixtures are readable by anonymous visitors, so a filled old column leaks a hidden score regardless of what the screens show.
  - Either form is blocked from the merge path: the live-release structural checker rejects both files (57 findings on 20261021003048, 1 on 20261021003143) because the copy and the emptying are data writes, not structure. So this change cannot be promoted through a merge in any form; releasing it needs structure first, then a separately approved data run.
- 20261021003143: score permission follow-up; depends on the item above.
- 20261030052009: AI score-review status table (AI is held back).

## Why some changes need the record-only tool
The current live release applies the complete waiting inventory in date order. Editing
changes already applied on the test site breaks their saved fingerprints. There is no
implemented record-only tool, and invented applied-history entries are not a safe
workaround. Excluding unsafe originals requires a reviewed exact staging mechanism;
any proposed live history changes need a separate, specific approval.
