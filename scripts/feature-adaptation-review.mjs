import { readFileSync, readdirSync } from 'node:fs';
import { sha256 } from './prod-release-review.mjs';

const substitutions = {
  invitations: ['SELECT _user_id IS NOT NULL AND _team_id IS NOT NULL AND (',
    'SELECT auth.uid() IS NOT NULL AND _user_id = auth.uid() AND _team_id IS NOT NULL AND ('],
  notifications: ["  author := COALESCE(n.author_id, '00000000-0000-0000-0000-000000000000'::uuid);",
    "  IF n.is_published IS NOT TRUE OR n.published_at IS NULL OR n.published_at > now() THEN RETURN 0; END IF;\n  author := COALESCE(n.author_id, '00000000-0000-0000-0000-000000000000'::uuid);"],
};

export function adaptVerifiedDefinition(definition, expectedSha256, kind) {
  if (sha256(definition) !== expectedSha256) throw new Error('Production definition fingerprint mismatch');
  const substitution = substitutions[kind];
  if (!substitution || definition.split(substitution[0]).length !== 2) throw new Error('Exact single source-bound adaptation required');
  return definition.replace(substitution[0], substitution[1]);
}

/** Review compilation only. Held privacy design is never staged as completed SQL. */
export function compileFeatureAdaptations(root) {
  const record = JSON.parse(readFileSync(`${root}/docs/release-review/adaptation-definitions.json`, 'utf8'));
  const evidence = JSON.parse(readFileSync(`${root}/docs/release-review/prod-transition-evidence-2026-10-30.json`, 'utf8'));
  if (record.sourceEvidenceSha256 !== evidence.evidenceSha256 || record.deploymentAuthorized !== false) throw new Error('Source evidence binding required');
  const folder = `${root}/docs/release-review/adaptations`;
  const names = readdirSync(folder).filter(f => f.endsWith('.sql')).sort();
  if (names.length !== 9) throw new Error('Exactly nine adaptation drafts required');
  const drafts = names.map(file => ({ file, sql: readFileSync(`${folder}/${file}`, 'utf8') }));
  const definitions = record.definitions;
  const notifier = adaptVerifiedDefinition(definitions.notifications.sql, definitions.notifications.sha256, 'notifications');
  const invitations = adaptVerifiedDefinition(definitions.invitations.sql, definitions.invitations.sha256, 'invitations');
  const sql = drafts.filter(d => !d.file.startsWith('09-')).map(d =>
    (d.file.startsWith('05-') ? notifier + ';\n' : d.file.startsWith('07-') ? invitations + ';\n' : '') + d.sql).join('\n');
  return {
    reviewOnly: true, deploymentAuthorized: false, sourceEvidenceSha256: record.sourceEvidenceSha256,
    drafts: drafts.map(d => ({ file: d.file, sha256: sha256(d.sql),
      status: d.file.startsWith('09-') ? 'held-data-transition-design' : 'review-draft' })),
    sql, sha256: sha256(sql),
  };
}