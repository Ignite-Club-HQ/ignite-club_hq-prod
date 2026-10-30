import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { requireReminderAuth } from "./reminder-auth.ts";
const cors = { "Access-Control-Allow-Origin": "*" };
const key = "synthetic-service-key";
const request = (headers = {}, query = "") => new Request(`https://example.invalid/job${query}`, { headers });
Deno.test('reminder jobs reject public and ordinary user credentials and fail closed without secrets', () => {
  const previous = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  try {
    Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
    assertEquals(requireReminderAuth(request(), cors)?.status, 403);
    Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', key);
    for (const headers of [{}, { authorization: 'Bearer anon' }, { authorization: 'Bearer user-jwt' }, { authorization: 'Basic synthetic-service-key' }, { 'x-cron-secret': 'wrong' }]) {
      const denied = requireReminderAuth(request(headers), cors, 'synthetic-cron');
      assertEquals(denied?.status, 403);
      assertEquals(denied?.headers.get('Access-Control-Allow-Origin'), '*');
    }
    assertEquals(requireReminderAuth(request({ authorization: `Bearer ${key}` }), cors), null);
    assertEquals(requireReminderAuth(request({ 'x-cron-secret': 'synthetic-cron' }), cors, 'synthetic-cron'), null);
    assertEquals(requireReminderAuth(request({}, '?secret=synthetic-cron'), cors, 'synthetic-cron'), null);
    assertEquals(requireReminderAuth(request({}, '?secret=synthetic-cron'), cors)?.status, 403);
  } finally {
    if (previous === undefined) Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
    else Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', previous);
  }
});