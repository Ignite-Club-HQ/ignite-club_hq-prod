import { sha256 } from './prod-release-review.mjs';

const text = value => typeof value === 'string' && value.trim() === value && value.length > 0;
const score = value => value === null || (Number.isSafeInteger(value) && value >= 0);
const key = (competition, match) => JSON.stringify([competition, match]);

/** Offline synthetic/input-only reconciliation. No preference by timestamp/source.
 * Partial scores are preserved, never filled from unrelated/partial rows.
 * A conflict or missing anchor holds the entire review, not just that row.
 */
export function reconcileScoreHistory({ matches, sources }) {
  if (!Array.isArray(matches) || !Array.isArray(sources)) throw new Error('Explicit complete input arrays required');
  const inventory = new Map();
  const externalKeys = new Set();
  for (const match of matches) {
    if (!text(match?.competitionId) || !text(match?.matchId)) throw new Error('Competition-bound match identity required');
    const identity = key(match.competitionId, match.matchId);
    if (inventory.has(identity)) throw new Error('Duplicate match identity');
    if (match.externalId != null) {
      if (!text(match.tenantId) || !text(match.source) || !text(match.externalId)) throw new Error('External fixtures require explicit tenant/source identity');
      const external = JSON.stringify([match.tenantId, match.source, match.externalId]);
      if (externalKeys.has(external)) throw new Error('Duplicate tenant-scoped external fixture');
      externalKeys.add(external);
    }
    inventory.set(identity, []);
  }
  const ids = new Set();
  const issues = [];
  const ordered = [...sources].sort((a,b) => String(a?.sourceId).localeCompare(String(b?.sourceId), 'en'));
  for (const row of ordered) {
    if (!text(row?.sourceId) || ids.has(row.sourceId)) throw new Error('Unique source identity required');
    ids.add(row.sourceId);
    if (!['match','event','history'].includes(row.kind) || !score(row.homeScore) || !score(row.awayScore)) throw new Error('Explicit nonnegative integer or NULL scores required');
    if (!text(row.competitionId) || !text(row.matchId)) {
      issues.push({ sourceId: row.sourceId, reason: 'missing-history-anchor' }); continue;
    }
    const bucket = inventory.get(key(row.competitionId,row.matchId));
    if (!bucket) { issues.push({ sourceId: row.sourceId, reason: 'unknown-competition-match' }); continue; }
    if ((row.kind === 'match' && row.side !== 'home') || !['home','away'].includes(row.side)) {
      issues.push({ sourceId: row.sourceId, reason: 'unknown-score-orientation' }); continue;
    }
    bucket.push({ ...row, canonicalHome: row.side === 'away' ? row.awayScore : row.homeScore,
      canonicalAway: row.side === 'away' ? row.homeScore : row.awayScore });
  }
  const results = [...inventory].sort(([a],[b])=>a.localeCompare(b,'en')).map(([identity,rows]) => {
    const [competitionId,matchId]=JSON.parse(identity);
    const populated=rows.filter(row=>row.canonicalHome!==null || row.canonicalAway!==null);
    const pairs = new Map(populated.map(row => [JSON.stringify([row.canonicalHome,row.canonicalAway]),row]));
    const status=pairs.size>1 ? 'conflict' : populated.length===0 ? 'empty' :
      populated[0].canonicalHome===null || populated[0].canonicalAway===null ? 'partial' : 'consistent';
    if(status==='conflict') issues.push({ competitionId,matchId,reason:'divergent-score-sources' });
    return { competitionId,matchId,status,
      homeScore: pairs.size===1 ? populated[0].canonicalHome : null,
      awayScore: pairs.size===1 ? populated[0].canonicalAway : null,
      // Full before-images retained in memory/report; no losing conflict row selected.
      sources:rows };
  });
  return { schemaVersion:1, reviewOnly:true, deploymentAuthorized:false, dataClearingAuthorized:false,
    inputSha256:sha256(JSON.stringify({matches:[...matches].sort((a,b)=>key(a.competitionId,a.matchId).localeCompare(key(b.competitionId,b.matchId),'en')),sources:ordered})),
    sourceCount:sources.length, accountedSourceCount:results.reduce((n,r)=>n+r.sources.length,0)+issues.filter(i=>i.sourceId).length,
    requiresReview:issues.length>0, issues, results };
}