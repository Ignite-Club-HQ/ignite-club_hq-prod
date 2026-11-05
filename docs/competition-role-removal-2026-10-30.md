# Competition role self-removal — DEV status

## Implemented and checked
- Actual application lives in `frontend/`; Competition Settings mounts CompetitionAdminsCard and CompetitionOfficialsCard. Neither previously offered a labelled Leave action; the admin list explicitly excluded self-removal.
- Added explicit Leave on own non-owner admin/official rows, confirmation, exact row/competition/user/role binding and rejection of unconfirmed results. Owner has no Leave action.
- DEV SQL endpoint uses SECURITY INVOKER and existing RLS, with own-row read/delete policies. Existing manager policies and chat/owner synchronization triggers remain installed. Direct owner deletion is rejected; competition cascading deletion remains separate.
- ICP source preserves team scope, rejects owner removal, rejects missing exact grants and permits own non-owner removal while retaining manager authorization for others. No canister deployed.
- Removed browser-side official-chat member deletion: it ignored remaining roles and silently swallowed failures. Supabase remains synchronized by existing triggers.
- 11 focused frontend tests pass, including confirmation, exact request, denial and unchanged failure UI. Production actor compiles under pinned Motoko 1.16.1. DEV catalog confirms invoker execution, anonymous denial, own-role policies and owner guard. Preview build OK.

## Not yet verified / release hold
- No authenticated end-to-end DEV acceptance: Supabase is externally managed, and no non-owner browser session is available. Multi-role and organiser-club-admin flows, actual chat membership and transactional database permission tests remain required.
- Real local ICP actor test is retained at `frontend/scripts/test-competition-role-removal-replica.mjs`; PocketIC timed out during setup, so no successful real-canister execution is claimed.
- ICP has no verified authoritative role-to-chat removal synchronization in this path. Secure self-leave controls remain disabled until entitlement-preserving chat synchronization is implemented and tested; never substitute blind browser chat deletion.
- Existing DEV owner-enforcement function can replace a candidate's multiple roles during ownership repair. It was not rewritten; exact-role preservation during that exceptional trigger path needs separate closure before release.
- Officials without management authority cannot open the current settings page. A safe own-roles-only settings view is still needed for those accounts.
- Native apps bundle frontend assets: installed Android/iOS apps need a new bundled app update to display these controls. Website updates alone do not update installed native screens. No native build or publication was run.
- PROD data/settings/services unchanged. DEV-only migrations deliberately reject non-DEV execution and require governed release review; do not promote them blindly.
- Database reports 778 pre-existing advisor findings; this work leaves no newly introduced advisor finding. Those existing issues are outside this task.