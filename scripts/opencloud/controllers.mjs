/**
 * OpenCloud DEV controller requests. Builds and decodes management-canister
 * Candid with the official ICP SDK only (no custom encoder). Offline: never signs or sends.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(ROOT, 'frontend/package.json'));
const { IDL } = require('@icp-sdk/core/candid');
const { Principal } = require('@icp-sdk/core/principal');
export const MAX_CONTROLLERS = 10;

const p = text => Principal.fromText(text).toText();
export function loadDev(file = path.join(ROOT, 'deploy/opencloud/dev.json')) { return JSON.parse(readFileSync(file, 'utf8')); }

/** Exact 32 targets with the controllers each must end up with (in addition to existing ones). */
export function targets(config) {
  const c = config.controllers;
  const frontend = p(config.shared.frontend);
  const ids = [...Object.values(config.shared), ...config.groups.flatMap(g => Object.values(g.canisterIds))].map(p);
  if (ids.length !== 32 || new Set(ids).size !== 32) throw Error('Exactly 32 distinct DEV targets required');
  const retain = [p(config.operatorId), p(c.connectedIdentity)];
  return ids.map(id => ({ id, role: id === frontend ? 'frontend' : 'backend', retain,
    add: id === frontend ? [p(c.owner), p(c.frontendPublisher)] : [p(c.owner), p(c.governor)],
    forbid: id === frontend ? [p(c.governor)] : [p(c.frontendPublisher)] }));
}

const StatusArg = IDL.Record({ canister_id: IDL.Principal });
const Settings = IDL.Record({
  controllers: IDL.Opt(IDL.Vec(IDL.Principal)), compute_allocation: IDL.Opt(IDL.Nat),
  memory_allocation: IDL.Opt(IDL.Nat), freezing_threshold: IDL.Opt(IDL.Nat),
  reserved_cycles_limit: IDL.Opt(IDL.Nat), wasm_memory_limit: IDL.Opt(IDL.Nat),
  wasm_memory_threshold: IDL.Opt(IDL.Nat),
});
const UpdateArg = IDL.Record({ canister_id: IDL.Principal, settings: Settings });
// Minimal reply type: Candid decoding skips any extra fields the engine returns.
const StatusReply = IDL.Record({
  status: IDL.Variant({ running: IDL.Null, stopping: IDL.Null, stopped: IDL.Null }),
  settings: IDL.Record({ controllers: IDL.Vec(IDL.Principal), compute_allocation: IDL.Nat,
    memory_allocation: IDL.Nat, freezing_threshold: IDL.Nat }),
  module_hash: IDL.Opt(IDL.Vec(IDL.Nat8)),
});
const hex = bytes => Buffer.from(bytes).toString('hex');

export function statusRequest(id) {
  return { method: 'canister_status', candid: `(record { canister_id = principal "${p(id)}" })`,
    hex: hex(IDL.encode([StatusArg], [{ canister_id: Principal.fromText(id) }])) };
}

/** Accepts hex or base64 of the raw Candid reply bytes. */
export function decodeStatus(encoded) {
  const t = String(encoded).trim().replace(/^0x/, '');
  const bytes = /^[0-9a-fA-F]+$/.test(t) && t.length % 2 === 0 ? Buffer.from(t, 'hex') : Buffer.from(t, 'base64');
  if (bytes.subarray(0, 4).toString('latin1') !== 'DIDL') throw Error('Not a Candid reply (missing DIDL header)');
  const [r] = IDL.decode([StatusReply], new Uint8Array(bytes));
  return { status: Object.keys(r.status)[0], controllers: r.settings.controllers.map(x => x.toText()),
    moduleHash: r.module_hash.length ? hex(r.module_hash[0]) : null,
    computeAllocation: r.settings.compute_allocation.toString(), memoryAllocation: r.settings.memory_allocation.toString(),
    freezingThreshold: r.settings.freezing_threshold.toString() };
}

/** Union of existing and required controllers; every other setting is left null (= unchanged). */
export function updateRequest(target, existing) {
  const current = existing.map(p);
  if (new Set(current).size !== current.length) throw Error('Duplicate controllers in status reply');
  for (const r of target.retain) if (!current.includes(r)) throw Error(`${target.id}: required existing controller ${r} missing; stop and report`);
  for (const f of target.forbid) if (current.includes(f)) throw Error(`${target.id}: ${f} must not control this canister`);
  const next = [...current, ...target.add.filter(a => !current.includes(a))];
  if (next.length > MAX_CONTROLLERS) throw Error(`${target.id}: more than ${MAX_CONTROLLERS} controllers`);
  const unchanged = next.length === current.length;
  const value = { canister_id: Principal.fromText(target.id), settings: {
    controllers: [next.map(x => Principal.fromText(x))], compute_allocation: [], memory_allocation: [],
    freezing_threshold: [], reserved_cycles_limit: [], wasm_memory_limit: [], wasm_memory_threshold: [] } };
  return { id: target.id, unchanged, before: current, after: next, method: 'update_settings',
    candid: `(record { canister_id = principal "${target.id}"; settings = record { controllers = opt vec { ${next.map(x => `principal "${x}"`).join('; ')} } } })`,
    hex: hex(IDL.encode([UpdateArg], [value])) };
}

/** Post-update check: nothing removed, everything required present, other settings and module unchanged. */
export function verifyAfter(target, before, after) {
  const errors = [];
  for (const c of before.controllers) if (!after.controllers.includes(c)) errors.push(`removed ${c}`);
  for (const c of [...target.retain, ...target.add]) if (!after.controllers.includes(c)) errors.push(`missing ${c}`);
  for (const c of target.forbid) if (after.controllers.includes(c)) errors.push(`forbidden ${c}`);
  for (const k of ['moduleHash', 'computeAllocation', 'memoryAllocation', 'freezingThreshold', 'status'])
    if (before[k] !== after[k]) errors.push(`${k} changed`);
  return { id: target.id, ok: errors.length === 0, errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [cmd, ...a] = process.argv.slice(2);
  const all = targets(loadDev());
  const pick = id => all.find(t => t.id === id) ?? (() => { throw Error(`Not a DEV target: ${id}`); })();
  const out = v => console.log(JSON.stringify(v, null, 2));
  if (cmd === 'status') out((a[0] === 'all' ? all : [pick(a[0] ?? all.find(t => t.role === 'frontend').id)]).map(t => ({ ...statusRequest(t.id), role: t.role })));
  else if (cmd === 'decode') out(decodeStatus(a[0]));
  else if (cmd === 'update') out(updateRequest(pick(a[0]), decodeStatus(a[1]).controllers));
  else if (cmd === 'update-from-list') out(updateRequest(pick(a[0]), a[1].split(',').map(s => s.trim()).filter(Boolean)));
  else if (cmd === 'verify') { const r = verifyAfter(pick(a[0]), decodeStatus(a[1]), decodeStatus(a[2])); out(r); if (!r.ok) process.exit(1); }
  else if (cmd === 'plan') out(all.map(t => ({ id: t.id, role: t.role, retain: t.retain, add: t.add, forbid: t.forbid })));
  else { console.error('Usage: status <id|all> | decode <reply> | update <id> <status-reply> | update-from-list <id> <a,b,...> | verify <id> <before-reply> <after-reply> | plan'); process.exit(2); }
}
