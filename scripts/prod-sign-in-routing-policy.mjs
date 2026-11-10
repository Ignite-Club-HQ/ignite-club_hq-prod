export const ROUTING_KEY = 'backend_routing_config';
export const ROUTING_CANISTER = 'tbeh7-5qaaa-aaaai-ayenq-cai';
export const PROPOSED_ROUTING = Object.freeze({
  defaultBackend: 'supabase', countryRules: {}, targets: [], countryTargets: {}, clubBackendOverrides: {},
  emailAuthClubs: [
    {id:'966bdaec-ebf1-46da-b2b3-cc53bf05c422',name:'Bridgewater Soccer Club'},
    {id:'493ee2e3-c834-487d-93be-d1c8a0dbc4a8',name:'Basket Range Cricket Club'},
  ],
});
const canonical = value => JSON.stringify(value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(v=>JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))]))
  : value);
export function matchesRouting(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const {savedAtMs, ...routing} = value;
  return canonical(routing) === canonical(PROPOSED_ROUTING);
}
export async function applyRouting({read,write,confirmation}) {
  if (confirmation !== 'APPLY PROD SIGN IN ROUTING') throw Error('Exact owner confirmation required');
  const before = await read();
  if (before !== null) {
    if (!matchesRouting(JSON.parse(before))) throw Error('Existing PROD routing differs; stopped without overwrite');
    return {status:'already-matching',changed:false};
  }
  // Recheck absence immediately before the single attempt. Unknown writes never retry.
  if (await read() !== null) throw Error('PROD routing changed; stop');
  const result = await write(ROUTING_KEY,JSON.stringify(PROPOSED_ROUTING));
  if (!result || !('Ok' in result)) throw Error('PROD refused routing save');
  const after = await read();
  if (after === null || !matchesRouting(JSON.parse(after))) throw Error('PROD routing readback mismatch; do not replay');
  return {status:'applied-and-read-back',changed:true};
}