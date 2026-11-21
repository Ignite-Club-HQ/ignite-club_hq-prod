import { readFileSync } from 'node:fs';
export const ENGINE_FRONTEND = '7pfcq-raaaa-aaac5-aabia-cai';
export function assertEngineFrontendContext({ branch, frontend, database, ids }) {
  if (branch !== 'main') throw new Error('DEV engine frontend updates require main');
  if (frontend !== ENGINE_FRONTEND) throw new Error('Unexpected engine frontend target');
  if (database !== 'https://ecsdwrarzfexssxtrymj.supabase.co') throw new Error('DEV database required');
  const expected = JSON.parse(readFileSync(new URL('../deploy/frontend-engine/target.json', import.meta.url))).canisterIds;
  if (Object.keys(ids).length !== 18 || Object.entries(expected).some(([name, id]) => ids[name] !== id)) throw new Error('Exact eighteen DEV services required');
  return true;
}