import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Conservative source-name inventory, not a SQL parser or release authorization. */
export function collectPublicObjectNames(files) {
  const names = new Set(['handle_new_user', 'auto_claim_eois_by_email', 'app_settings',
    'direct_conversations', 'direct_messages']);
  for (const sql of Object.values(files)) {
    if (typeof sql !== 'string') throw new Error('SQL source text required');
    for (const match of sql.matchAll(/\bpublic\s*\.\s*"?([a-z_][a-z0-9_]*)"?/gi)) names.add(match[1].toLowerCase());
    for (const match of sql.matchAll(/\b(?:FUNCTION|EXECUTE\s+FUNCTION)\s+(?:public\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi)) names.add(match[1].toLowerCase());
  }
  return [...names].sort();
}

export function buildObjectEvidenceSql(names, { includeTransitionChecks = false } = {}) {
  if (!Array.isArray(names) || !names.length || names.length > 300
      || names.some(name => typeof name !== 'string' || !/^[a-z_][a-z0-9_]*$/.test(name))
      || new Set(names).size !== names.length) throw new Error('Bounded unique public object names required');
  const literals = names.map(name => `'${name}'`).join(',\n    ');
  if (typeof includeTransitionChecks !== 'boolean') throw new Error('Transition checks require a boolean option');
  const extraReports = includeTransitionChecks ? `
  UNION ALL
  SELECT 'bucket privacy', jsonb_build_object('id', b.id, 'public', b.public)
  FROM storage.buckets b
  WHERE b.id IN ('competition-vault', 'competition-documents', 'photos', 'chat-attachments')
  UNION ALL
  SELECT 'effective function execution', jsonb_build_object(
    'signature', p.oid::regprocedure::text, 'role', r.rolname,
    'can_execute', has_function_privilege(r.oid, p.oid, 'EXECUTE'))
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN pg_roles r
  WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
    AND r.rolname IN ('anon', 'authenticated', 'service_role')
    AND (p.proname IN (SELECT name FROM requested) OR p.oid IN (
      SELECT t.tgfoid FROM pg_trigger t WHERE NOT t.tgisinternal
        AND (t.tgrelid IN (SELECT oid FROM relations) OR t.tgrelid = 'auth.users'::regclass)
    ))
  UNION ALL
  SELECT 'scoped default privileges', jsonb_build_object(
    'owner', pg_get_userbyid(d.defaclrole), 'schema', COALESCE(n.nspname, '(global)'),
    'object_type', d.defaclobjtype,
    'grantee', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
    'privilege', a.privilege_type, 'grantable', a.is_grantable)
  FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
  CROSS JOIN LATERAL aclexplode(d.defaclacl) a
  WHERE (n.nspname = 'public' OR d.defaclnamespace = 0)
    AND d.defaclobjtype IN ('r', 'f')
    AND d.defaclrole IN (
      SELECT c.relowner FROM pg_class c WHERE c.oid IN (SELECT oid FROM relations)
      UNION SELECT p.proowner FROM pg_proc p JOIN pg_namespace pn ON pn.oid = p.pronamespace
      WHERE pn.nspname = 'public' AND p.proname IN (SELECT name FROM requested)
    )
    AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated', 'service_role'))
  UNION ALL
  SELECT 'named reminder schedules', jsonb_build_object(
    'jobname', j.jobname, 'schedule', j.schedule, 'active', j.active)
  FROM cron.job j
  WHERE j.jobname IN ('process-scheduled-event-reminders', 'auto-rsvp-push-cron', 'chat-photo-gallery-reminders-hourly')
` : '';
  return `-- READ ONLY: run in the approved PROD SQL Editor, export the single result.
-- No application records, routing values, auth accounts or scheduler commands.
-- Function definitions/default expressions can contain embedded secrets: review before sharing.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';
WITH requested(name) AS (SELECT unnest(ARRAY[
    ${literals}
]::text[])),
relations AS (
  SELECT c.oid, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname IN (SELECT name FROM requested)
),
report(section, item) AS (
  SELECT 'requested objects', to_jsonb(r) FROM requested r
  UNION ALL
  SELECT 'types', jsonb_build_object('name', t.typname, 'kind', t.typtype,
    'enum_labels', (SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)
      FROM pg_enum e WHERE e.enumtypid = t.oid))
  FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public' AND t.typname IN (SELECT name FROM requested)
  UNION ALL
  SELECT 'relations and RLS state', to_jsonb(r) FROM relations r
  UNION ALL
  SELECT 'columns', jsonb_build_object('table', r.relname, 'column', a.attname,
    'type', format_type(a.atttypid, a.atttypmod), 'not_null', a.attnotnull,
    'default', pg_get_expr(d.adbin, d.adrelid))
  FROM relations r JOIN pg_attribute a ON a.attrelid = r.oid
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attnum > 0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'constraints', jsonb_build_object('table', r.relname, 'name', c.conname,
    'definition', pg_get_constraintdef(c.oid))
  FROM relations r JOIN pg_constraint c ON c.conrelid = r.oid
  UNION ALL
  SELECT 'indexes', jsonb_build_object('table', r.relname,
    'definition', pg_get_indexdef(i.indexrelid))
  FROM relations r JOIN pg_index i ON i.indrelid = r.oid
  UNION ALL
  SELECT 'policies', to_jsonb(p) FROM pg_policies p
  WHERE p.schemaname = 'public' AND p.tablename IN (SELECT relname FROM relations)
  UNION ALL
  SELECT 'storage policies', to_jsonb(p) FROM pg_policies p
  WHERE p.schemaname = 'storage' AND p.tablename IN ('objects', 'buckets')
  UNION ALL
  SELECT 'table grants', to_jsonb(g) FROM information_schema.role_table_grants g
  WHERE g.table_schema = 'public' AND g.table_name IN (SELECT relname FROM relations)
    AND g.grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')
  UNION ALL
  SELECT 'triggers', jsonb_build_object('schema', n.nspname, 'table', c.relname,
    'name', t.tgname, 'enabled', t.tgenabled, 'definition', pg_get_triggerdef(t.oid))
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE NOT t.tgisinternal AND (c.oid IN (SELECT oid FROM relations)
    OR (n.nspname = 'auth' AND c.relname = 'users'))
  UNION ALL
  SELECT 'functions', jsonb_build_object('signature', p.oid::regprocedure::text,
    'definition', pg_get_functiondef(p.oid), 'security_definer', p.prosecdef,
    'settings', p.proconfig, 'privileges', p.proacl)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
    AND (p.proname IN (SELECT name FROM requested) OR p.oid IN (
      SELECT t.tgfoid FROM pg_trigger t WHERE NOT t.tgisinternal
        AND (t.tgrelid IN (SELECT oid FROM relations) OR t.tgrelid = 'auth.users'::regclass)
    ))${extraReports}
)
SELECT section, count(*) AS object_count, jsonb_agg(item ORDER BY item::text) AS results
FROM report GROUP BY section ORDER BY section;
ROLLBACK;
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const files = Object.fromEntries(readdirSync(dir).filter(f => f.endsWith('.sql'))
    .map(f => [f, readFileSync(new URL(f, dir), 'utf8')]));
  console.log(buildObjectEvidenceSql(collectPublicObjectNames(files)));
}