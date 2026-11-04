import { HttpAgent, Certificate } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { readFileSync } from 'node:fs';

const enc = new TextEncoder();
const agent = new HttpAgent({ host: 'https://icp-api.io' });

async function moduleHash(id) {
  const pid = Principal.fromText(id);
  const certBytes = await agent.readState(pid, { paths: [[enc.encode('module_hash')]] });
  const cert = await Certificate.create({
    certificate: certBytes,
    rootKey: agent.rootKey,
    canisterId: pid,
  });
  const v = cert.lookup_path([enc.encode('canister'), pid.toUint8Array(), enc.encode('module_hash')]);
  if (!v) return null;
  return Buffer.from(v).toString('hex');
}

const devBase = JSON.parse(readFileSync('/dev-server/deploy/mainnet/.icp/data/mappings/ic.ids.json', 'utf8'));
const devG2prov = JSON.parse(readFileSync('/dev-server/deploy/groups/g2/provision.json', 'utf8'));
const devG2 = { ...devG2prov.canisters, media_blob_store: 'ycx6b-aaaaa-aaaal-qxpya-cai' };

const prodBase = {
  club_domain: 'tbeh7-5qaaa-aaaai-ayenq-cai', club_points_domain: 'wg2b7-maaaa-aaaai-ayeqq-cai',
  competition_domain: 'scioz-jiaaa-aaaai-ayela-cai', events_domain: 'sfjin-eqaaa-aaaai-ayelq-cai',
  identity_access: 'wb3hl-byaaa-aaaai-ayeqa-cai', insights_domain: 'wiymx-xqaaa-aaaai-ayerq-cai',
  media_blob_store: 'w5752-wyaaa-aaaai-ayesa-cai', media_metadata: 'wt5qs-niaaa-aaaai-ayeta-cai',
  messaging_domain: 'ttcqg-raaaa-aaaai-ayeoq-cai', migration_coordinator: 'sllff-7aaaa-aaaai-ayekq-cai',
  mini_league_domain: 'wpzkd-2iaaa-aaaai-ayera-cai', notification_queue: 'w263o-3aaaa-aaaai-ayesq-cai',
  pii_access_control: 'tihmd-lyaaa-aaaai-ayema-cai', placement_registry: 't5a5o-kqaaa-aaaai-ayepq-cai',
  secret_workload_identity: 't2b32-hiaaa-aaaai-ayepa-cai', shard_router: 'tgfbl-qiaaa-aaaai-ayena-cai',
  timer_jobs: 'tpgkx-gaaaa-aaaai-ayemq-cai', vault_domain: 'tudws-4yaaa-aaaai-ayeoa-cai',
};
const prodG2 = {
  club_domain: 'xqrzu-zqaaa-aaaai-ayevq-cai', events_domain: 'xfwiz-yyaaa-aaaai-ayewa-cai',
  messaging_domain: 'xcxon-vaaaa-aaaai-ayewq-cai', vault_domain: 'xlufr-diaaa-aaaai-ayexa-cai',
  competition_domain: 'xmvdf-oqaaa-aaaai-ayexq-cai', club_points_domain: 'vrinn-5yaaa-aaaai-ayeya-cai',
  mini_league_domain: 'vwjlz-qaaaa-aaaai-ayeyq-cai', media_metadata: 'v7kaf-giaaa-aaaai-ayeza-cai',
  insights_domain: 'vylgr-lqaaa-aaaai-ayezq-cai', notification_queue: 'vnmx4-kyaaa-aaaai-aye2a-cai',
  pii_access_control: 'vknri-haaaa-aaaai-aye2q-cai', timer_jobs: 'vdo2u-riaaa-aaaai-aye3a-cai',
  media_blob_store: 'vep4a-4qaaa-aaaai-aye3q-cai',
};

const sets = { 'DEV base': devBase, 'DEV g2': devG2, 'PROD base': prodBase, 'PROD g2': prodG2 };
const hashes = {};
for (const [label, map] of Object.entries(sets)) {
  hashes[label] = {};
  for (const [name, id] of Object.entries(map)) {
    try {
      hashes[label][name] = await moduleHash(id);
    } catch (e) {
      hashes[label][name] = 'ERROR: ' + String(e.message || e).slice(0, 80);
    }
  }
}

const names = [...new Set(Object.values(sets).flatMap(m => Object.keys(m)))].sort();
console.log('service'.padEnd(26), 'DEV-base == PROD-base', ' DEV-g2 == PROD-g2');
let mismatches = 0;
for (const n of names) {
  const db = hashes['DEV base'][n], pb = hashes['PROD base'][n];
  const dg = hashes['DEV g2'][n], pg = hashes['PROD g2'][n];
  const base = db && pb ? (db === pb ? 'MATCH' : 'DIFFER') : 'n/a';
  const g2 = dg && pg ? (dg === pg ? 'MATCH' : 'DIFFER') : 'n/a';
  if (base === 'DIFFER' || g2 === 'DIFFER') mismatches++;
  console.log(n.padEnd(26), base.padEnd(19), g2);
}
console.log('\n--- detail (first 16 hex chars) ---');
for (const n of names) {
  console.log(n.padEnd(26),
    String(hashes['DEV base'][n] || '-').slice(0, 16).padEnd(17),
    String(hashes['PROD base'][n] || '-').slice(0, 16).padEnd(17),
    String(hashes['DEV g2'][n] || '-').slice(0, 16).padEnd(17),
    String(hashes['PROD g2'][n] || '-').slice(0, 16));
}
console.log('\nmismatches:', mismatches);
