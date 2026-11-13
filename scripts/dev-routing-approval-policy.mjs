// The DEV-only approval publisher calls this on the fresh, governor-signed
// read-only report BEFORE enabling any on-chain routing. Not an approval itself.
import { createHash } from 'node:crypto';

const ROUTER = 'jcdfe-vqaaa-aaaal-qxloq-cai';
const ALIAS = 'mainnet';
const GROUP = 'g2';
const HEX = /^[a-f0-9]{64}$/;

export function validateDevRoutingEvidence(report, expectedRevision) {
  if (!/^(0|[1-9][0-9]*)$/.test(String(expectedRevision ?? ''))) {
    throw new Error('Operator must supply the exact DEV configuration revision');
  }
  if (!report || report.approved !== true || report.routerCanisterId !== ROUTER ||
      report.targetAlias !== ALIAS || report.host !== 'https://icp-api.io') {
    throw new Error('Signed routing report is not from the pinned DEV router');
  }
  if (String(report.configurationRevision) !== String(expectedRevision) ||
      !/^(0|[1-9][0-9]*)$/.test(String(report.registryRevision ?? ''))) {
    throw new Error('Verified DEV routing revision is not the operator-approved revision');
  }
  if (!Array.isArray(report.groups) || report.groups.length !== 1 ||
      report.groups[0]?.id !== GROUP || !Array.isArray(report.groups[0]?.domains) ||
      report.groups[0].domains.length !== 13 ||
      new Set(report.groups[0].domains.map(d => d.domain)).size !== 13 ||
      !Object.values(report.groups[0].moduleHashes ?? {}).every(value => HEX.test(value))) {
    throw new Error('DEV routing report has an incomplete or unexpected group inventory');
  }
  if (!report.removalWiring || !Array.isArray(report.removalWiring.groupIds) ||
      report.removalWiring.groupIds.length !== 1 || report.removalWiring.groupIds[0] !== GROUP ||
      String(report.removalWiring.revision) !== String(expectedRevision) ||
      !Number.isFinite(report.removalWiring.checkedAtMs)) {
    throw new Error('DEV routing removal wiring evidence is absent or mismatched');
  }
  if (typeof report.approvedConfiguration !== 'string') {
    throw new Error('DEV canonical approval configuration missing');
  }
  let groups;
  try { groups = JSON.parse(report.approvedConfiguration); } catch {
    throw new Error('DEV canonical approval configuration is invalid JSON');
  }
  if (!Array.isArray(groups) || groups.length !== 1 || groups[0]?.id !== GROUP ||
      groups[0]?.targetAlias !== ALIAS || groups[0]?.accepting !== true ||
      !Array.isArray(groups[0]?.domains) || groups[0].domains.length !== 13 ||
      !Array.isArray(groups[0]?.placement?.domains) || groups[0].placement.domains.length !== 13) {
    throw new Error('DEV approved group configuration is incomplete or unexpectedly changed');
  }
  if (!HEX.test(report.evidenceSha256)) {
    throw new Error('DEV routing evidence hash missing');
  }
  return {
    configurationRevision: String(report.configurationRevision),
    approvedConfigurationSha256: createHash('sha256').update(report.approvedConfiguration).digest('hex'),
    evidenceSha256: report.evidenceSha256,
    groupIds: report.groups.map(g => g.id),
    routerCanisterId: ROUTER,
  };
}
