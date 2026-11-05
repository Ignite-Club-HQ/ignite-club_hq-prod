# Club plan approval — 5 November 2026

Paul Cranwell approved all currently identified new club plans missing from the
production database at 04:10 UTC: **small** and **growing**.

The complete application plan list is starter, standard, unlimited, small, growing.
Existing production plans are starter, standard and unlimited according to the
reviewed release evidence. This approval does not authorize unknown future plans,
price changes, subscription changes or writes to existing business rows.

## Exact approved structural SQL

```sql
ALTER TYPE public.club_subscription_plan ADD VALUE IF NOT EXISTS 'small';
ALTER TYPE public.club_subscription_plan ADD VALUE IF NOT EXISTS 'growing';
```

Existing DEV migration:
`20261105030600_011ccdbd-6203-4517-88c0-ee23c0bd84e0.sql`

SHA-256: `0f3bff05c7d5d0957cf362647a1b1d75c7f301b213491ae5f298845a83609c3a`

## Status

Owner approval recorded; no production SQL executed in this turn. The existing
six-migration executable release approval is unchanged. This seventh migration
must be integrated and checked through the existing release inventory before
automated promotion, or applied by Paul in the production SQL Editor with a
readback. Approval alone does not certify merge readiness.

Readback after applying:

```sql
SELECT enumlabel
FROM pg_enum
WHERE enumtypid = 'public.club_subscription_plan'::regtype
ORDER BY enumsortorder;
```