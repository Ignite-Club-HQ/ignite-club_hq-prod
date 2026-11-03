# Retained PROD identity with historical domains: compatibility hold

Paul approved keeping the existing pinned PROD account service at 11:07 UTC, checking compatibility before installing the other services. No account upgrade, protection bypass, key change, data copy, opening or publication is authorized by this check.

## Verified
- Historical copy plan run 41623915897 succeeded at 11:02:27 UTC. Apply step was skipped; no production code was copied.
- Read actual `prod` identity source through GitHub, rather than assuming local main is the installed version. Source was saved for inspection by the connector on this turn.
- `read_service_account` invokes `production_service_account` outside rehearsal. That calls `verify_production_account_reader`, which requires signed production-reader approval, collects live receiver evidence and verifies subject evidence with the witness.
- The evidence collector calls `read_account_protection_configuration` on receiver targets. Historical Oct30 `club_domain.did` does not expose this method; other historical receiver interfaces also predate the protection endpoints. This is a real call-contract mismatch, not merely a missing deployment-script flag.
- Historical AccountAdmission ordinary eligibility is disabled without rehearsal, but its alias-account reader still calls `read_service_account` when requested. An inactive receiver path does not prove that mixed-release protected account access works.

## Implemented without live changes
- A release-plan selector retains the observed current identity fingerprint, excludes identity from all install targets, and leaves 30 other targets across both groups.
- Added a receiver-interface compatibility refusal so missing protection readers cannot be treated as a passing mixed release.
- Tests cover concrete target counts, retained identity hash, refusal of missing hash and the actual Oct30 club interface mismatch.

## Result and next decision
The proposed mixed release is not cleared for installation. Keeping the installed identity alone does not preserve its end-to-end protected read contract when receiver programs are rolled back. Do not suppress that check or set rehearsal flags to get around it.

The smaller safe direction is to keep the current PROD service set together and verify its ordinary access setup, rather than selectively downgrade receiver contracts. That is a changed release direction requiring Paul’s decision; no such deployment was performed.