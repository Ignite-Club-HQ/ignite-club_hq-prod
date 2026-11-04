# Live database release: classification of the 39 waiting changes (4 Nov 2026)

This is a read-only review. Nothing has been applied to the live database.
"Record only" means the live history gets an entry saying the change was handled, but the SQL is never run there. That needs a separate tool, which runs only with Paul's approval.

## A. Send live as-is: structure only (24)
20260928122526, 20261003053838, 20261004012137, 20261004045741, 20261007010000,
20261007020000, 20261009090000, 20261009100000, 20261010000000, 20261010010000,
20261011000000, 20261012020000, 20261013000000, 20261014000000, 20261014010000,
20261014014920, 20261014014957, 20261014015130, 20261014020000, 20261014030000,
20261014062816, 20261015185653, 20261015192331, 20261104031935 (separate email-invite check)

## B. Test-site only: record only, never run live (6)
- 20261030013157: replaces live profile creation; superseded by 20261104031935
- 20261030013232: tightens permissions on the function above; superseded by 20261104031935
- 20261030013444: test script that writes test invites
- 20261030013735: email club list using test-site club IDs
- 20261030014542, 20261030014712: test-site permission repairs

## C. Wanted on live, but the original would fail there: record only, plus a live-safe replacement (3)
- 20261030030705 / 030741 / 031128: let people leave a competition role. Each file deliberately stops on any database other than the test site. The replacement creates the final function, delete/read rules and owner guard without that stop.

## D. Writes or clears live data: needs Paul's decision (5)
- 20261008014417: adds the club country and service columns (structure), but also sets every live club's country to AU (data).
- 20261012000000: competition document storage. It also creates a private storage area, which counts as a settings write.
- 20261012010000: scheduled event reminders. It turns on and schedules a recurring background job.
- 20261021003048: hidden scores and history. It copies scores into a new table, then **clears existing live scores**. This must never run as written (rule: keep current scores, hold back score and AI changes).
- 20261021003143: score permission follow-up; depends on the item above.
- 20261030052009: AI score-review status table (AI is held back).

## Why some changes need the record-only tool
The live release applies every waiting change in date order and can't skip one. Editing changes that already ran on the test site breaks their saved fingerprints. So any change that must not run live has to be recorded as handled on the live database, which the current rules forbid without Paul's approval.
