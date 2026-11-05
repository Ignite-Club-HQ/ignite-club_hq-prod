# Phone-app compatibility audit — planned PROD database changes vs current iOS/Android apps

Date: 2026-11-05. Requested by Paul. Analysis-only: no PROD changes made.

## Question

Will the eight planned PROD database changes break the currently released iOS and
Android apps, which run code from before the hybrid repo was brought into this
repository?

## Method

Code-based review of the eight planned changes against the older phone-app code
paths. Not tested on a physical phone.

## Result: 7 of 8 changes are safe for the current phone apps

| Change | Effect on current phone apps |
|---|---|
| Fixture visibility functions | Additive only; old apps don't call them — unchanged |
| Competition Vault access functions | Additive only; old apps don't call them — unchanged |
| Official email invitation RPCs | Additive only; old apps don't call them — unchanged |
| Invitation message defaults | Additive only; old apps don't call them — unchanged |
| Welcome message (one-time DM) | Additive only; old apps don't call them — unchanged |
| Profile `country` column | Optional column, no backfill; old apps never send it — unchanged |
| `backend_routing_config` row + anon read policy | Sign-in settings row; old apps ignore it — unchanged |

## The one change with an effect: the email-signup invitation check

The signup check blocks new email account creation without a valid club/team
invitation token. On the **old phone apps**, a brand-new email signup without an
invitation would fail with an "you need an invitation" message.

### Risk assessment: LOW (Paul's reasoning confirmed 5 Nov 2026)

- New invited members receive an invitation **link**, which opens the **website**.
  They create their account there — the new website has the invitation check built
  in and handles it correctly.
- Only after they have an account do they download the phone app and **log in**.
  Login is completely unaffected by the signup check.
- The only affected path is someone who downloads the app first and tries to
  create a new email account without an invitation. That attempt failing is the
  intended behaviour — it is the whole point of the check.
- Existing members are completely unaffected: they already have accounts and only
  log in.

### Caveat

Not verified on a physical phone; conclusion is from code review of the old app's
signup flow and the invitation flow. The check only touches account **creation**,
and invited members create accounts on the website.

## Decision (Paul, 5 Nov 2026)

Proceed with **all eight** changes, including the email-signup invitation check,
in the merge. No need to hold the signup check back and no need to rush new phone
app versions; phone apps update at the normal pace afterwards.
