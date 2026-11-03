# DEV vs PROD code fingerprints (read-only, 3 Nov 2026 ~08:55 UTC)

Matched to DEV release record at source f86b6f98 (29 Oct): 13 services.
Updated on DEV after that record, commit not yet identified: identity_access, club_domain, events_domain, messaging_domain, pii_access_control.

| group | service | DEV hash | matches 29 Oct record | PROD hash |
|---|---|---|---|---|
| shared | identity_access | 4fe59c88838d696d | no | 95621e15bf660ea4 |
| shared | placement_registry | 5ec2beb83285fc86 | yes | 5777dfd00e123e5c |
| shared | migration_coordinator | 74e6510ef0f27587 | yes | 74e6510ef0f27587 |
| shared | secret_workload_identity | 4a16ba01d5a17969 | yes | f77edeb5d24dfdd1 |
| g1 | club_domain | 98b2c7eab8c4998f | no | 1f221c4b4dc62d3a |
| g2 | club_domain | 98b2c7eab8c4998f | no | 1f221c4b4dc62d3a |
| g1 | events_domain | 3fa50d1aef1526f0 | no | b2f49c4187def2be |
| g2 | events_domain | 3fa50d1aef1526f0 | no | b2f49c4187def2be |
| g1 | messaging_domain | be79f222274fbc06 | no | 9e9615571592ef4a |
| g2 | messaging_domain | be79f222274fbc06 | no | 9e9615571592ef4a |
| g1 | vault_domain | 8e53acb5bbbe68da | yes | b59f445402d6e24e |
| g2 | vault_domain | 8e53acb5bbbe68da | yes | b59f445402d6e24e |
| g1 | competition_domain | c5fb94d89fe17407 | yes | 41e10d017032b3dd |
| g2 | competition_domain | c5fb94d89fe17407 | yes | 41e10d017032b3dd |
| g1 | club_points_domain | c743d1a8eb0bffb9 | yes | 11fa663dd6bed16f |
| g2 | club_points_domain | c743d1a8eb0bffb9 | yes | 11fa663dd6bed16f |
| g1 | mini_league_domain | 7c8dc5712146ad6c | yes | a5acdbee3a8b295b |
| g2 | mini_league_domain | 7c8dc5712146ad6c | yes | a5acdbee3a8b295b |
| g1 | media_metadata | 0296231d1a160236 | yes | eb63087a89444dd0 |
| g2 | media_metadata | 0296231d1a160236 | yes | eb63087a89444dd0 |
| g1 | insights_domain | 643c426eef6ae0be | yes | f884196e84c28165 |
| g2 | insights_domain | 643c426eef6ae0be | yes | f884196e84c28165 |
| g1 | notification_queue | 100b0197578278a0 | yes | 8b8b42941e89a638 |
| g2 | notification_queue | 100b0197578278a0 | yes | 8b8b42941e89a638 |
| g1 | pii_access_control | 39ab666f2d5c4563 | no | 05d6510ad84c37a3 |
| g2 | pii_access_control | 39ab666f2d5c4563 | no | 05d6510ad84c37a3 |
| g1 | timer_jobs | 70d631b37e367b3b | yes | cb0db67ecbd06e3f |
| g2 | timer_jobs | 70d631b37e367b3b | yes | cb0db67ecbd06e3f |
| g1 | media_blob_store | 8fe9fc10f1f58a9d | yes | 30bc666943015be7 |
| g2 | media_blob_store | 8fe9fc10f1f58a9d | yes | 30bc666943015be7 |
| shared | shard_router | 1b8faa490cebe49c | yes | 7f86c1425f759802 |
