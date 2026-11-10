# Email sign-out warning investigation

Paul clarified that the screenshots appeared after signing out of email mode, not after Internet Identity login. The panel listed child team assignments, RSVPs, club subscriptions and events as blocked Supabase requests on `/auth`.

## Confirmed defect

Explicit email logout awaited native push removal and Supabase sign-out before retiring page children or cancelling queries. Existing event/subscription/attendance observers could remain alive while email credentials disappeared and routing picked ICP. The strict transport correctly refused subsequent Supabase reads. A refusal on `/auth` does not prove that the corresponding ICP feature is unimplemented: it may be an old page's unfinished read.

A mounted regression starts a pending email events query, begins an unresolved logout, and checks observer retirement plus abort. Before repair the protected page stayed mounted; after repair it unmounts and its read is cancelled before session removal.

## DEV repair

- Explicit logout immediately retires protected children and navigates to `/auth` with replacement.
- Pending React Query work is cancelled before native unregister and email session removal.
- Auth callbacks arriving during explicit logout cannot repopulate the old account's state.
- User-scoped caches and registered channels are cleared during explicit cleanup, rather than relying on the delayed auth callback.
- Native push unregister remains on the same email branch before sign-out; delivery, registrations, Firebase and phone configuration were not changed.

## Limits

A fresh public ICP login at 411×770 produced zero blocked fallback events and zero page errors over 18 seconds. This was not a hosted email logout: this project uses external unmanaged authentication and no authorized browser session was available. Fourteen focused mocked logout/routing/diagnostic tests passed and the preview build was OK. No PROD deployment occurred. Exact screenshot request stacks and physical Android acceptance remain unverified.