import { requireCleanupGithubProtection, activateCleanupSettings } from './private-name-cleanup-release-policy.mjs';

export const SAVE_RELEASE = 'IGNITE_SECURE_ADULT_NAME_SAVE_RELEASE';
export const DISPLAY_RELEASE = 'IGNITE_PRIVATE_CLUB_NAME_DISPLAY_RELEASE';
// DEV-only original encrypted adult-name source. Browser routing is never
// permission; the exact original PII/Identity pair and current G1 public-key
// observation are checked again by server code at every exact-team request.
export const DEV_G1_TEAM_NAME_RELEASE = 'IGNITE_DEV_LEGACY_G1_TEAM_NAME_RELEASE';
export const DEV_G1_OBSERVED_KEY = 'IGNITE_DEV_LEGACY_G1_OBSERVED_KEY_SHA256';
export const VERIFIED_DEV_G1_OBSERVED_SHA256 = 'f80ed20bc0d8a244f40b31fdbd0024ff469d24254197dce9242dce669fa1f34d';
const EXACT_DEV_IDENTITY = 'mq2sj-fiaaa-aaaal-qxlqa-cai';
const EXACT_DEV_G1_PII = 'iui5p-aaaaa-aaaal-qxllq-cai';
export const isSecureNameScope = scope => ['secure_name_save','private_club_name_display'].includes(scope);
export const requireSecureNameGithubProtection = requireCleanupGithubProtection;
export const activateSecureNameSettings = activateCleanupSettings;
export function secureNameChangedSettings(scope, service) {
  if (!isSecureNameScope(scope) || !['identity_access','pii_access_control','club_domain'].includes(service) || (scope==='secure_name_save' && service==='club_domain')) throw Error('Exact secure-name target required');
  return scope==='secure_name_save'
    ? [SAVE_RELEASE,service==='identity_access'?'IGNITE_SECURE_ADULT_NAME_PII':'IGNITE_SECURE_ADULT_NAME_IDENTITY']
    : [DISPLAY_RELEASE,...(service==='pii_access_control'?['IGNITE_PRIVATE_PROFILE_IDENTITY']:[]),
       ...(service==='identity_access'?[DEV_G1_TEAM_NAME_RELEASE,DEV_G1_OBSERVED_KEY]:[])];
}
export function secureNameEnvironment(environment, service, scope, {identity, originalPii}) {
  const changed=secureNameChangedSettings(scope,service);
  if (!Array.isArray(environment) || !identity || !originalPii) throw Error('Pinned secure-name authority inventory required');
  const seen=new Set();
  for(const row of environment) {
    if(typeof row.name!=='string'||typeof row.value!=='string'||seen.has(row.name))throw Error('Invalid or duplicate secure-name setting');
    seen.add(row.name);
    // IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL is the live account admission
    // release switch (historical name), not a rehearsal; it stays as set.
    if(row.name.includes('REHEARSAL') && row.name!=='IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL' && row.value!=='0')throw Error(`Rehearsal must remain disabled: ${row.name}`);
    if([SAVE_RELEASE,DISPLAY_RELEASE].includes(row.name)&&!['0','1'].includes(row.value))throw Error('Unknown name release switch');
  }
  const exact=(name,value,required=false)=>{
    const row=environment.find(r=>r.name===name);
    if((required&&!row)||(row&&row.value!==value))throw Error(`Secure-name authority mismatch: ${name}; no rewiring`);
  };
  if(service==='identity_access')exact('IGNITE_SECURE_ADULT_NAME_PII',originalPii,scope==='private_club_name_display');
  if(service==='pii_access_control') {
    exact('VETKD_KEY_NAME','key_1',true);
    exact('IGNITE_SECURE_ADULT_NAME_IDENTITY',identity,scope==='private_club_name_display');
    // Secure saving already pins this same account authority. Display adds its
    // separate verifier binding if absent; it must never replace a foreign one.
    if(scope==='private_club_name_display')exact('IGNITE_PRIVATE_PROFILE_IDENTITY',identity);
  }
  if(scope==='private_club_name_display'&&service!=='club_domain')exact(SAVE_RELEASE,'1',true);
  const exactDevOriginal = identity===EXACT_DEV_IDENTITY && originalPii===EXACT_DEV_G1_PII;
  // Never carry DEV-only release settings onto a foreign/PROD Identity.
  if(!exactDevOriginal && environment.some(row=>[DEV_G1_TEAM_NAME_RELEASE,DEV_G1_OBSERVED_KEY].includes(row.name)))
    throw Error('DEV cross-group name settings belong to the original DEV Identity only');
  // This existing protected DEV-only scope already journals setting changes
  // before Identity and original PII upgrades. No new deployment workflow,
  // data migration, new grants or insecure broad name-read switch is needed.
  const additions=scope==='secure_name_save'
    ? [{name:SAVE_RELEASE,value:'1'},{name:changed[1],value:service==='identity_access'?originalPii:identity}]
    : [{name:DISPLAY_RELEASE,value:'1'},...(service==='pii_access_control'?[{name:'IGNITE_PRIVATE_PROFILE_IDENTITY',value:identity}]:[]),
       ...(scope==='private_club_name_display' && service==='identity_access' && exactDevOriginal
         ? [{name:DEV_G1_TEAM_NAME_RELEASE,value:'1'},
            {name:DEV_G1_OBSERVED_KEY,value:VERIFIED_DEV_G1_OBSERVED_SHA256}]
         : [])];
  return [...environment.filter(r=>!changed.includes(r.name)),...additions].sort((a,b)=>a.name.localeCompare(b.name));
}