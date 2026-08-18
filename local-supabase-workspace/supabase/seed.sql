-- Synthetic marker only. Test users and business fixtures are created through
-- the local Auth API by tests and removed afterwards. No real club/user data.
insert into local_test.environment_marker (id, purpose)
values ('00000000-0000-4000-8000-000000000001', 'ignite-club-local-security-tests')
on conflict (id) do update set purpose = excluded.purpose;
