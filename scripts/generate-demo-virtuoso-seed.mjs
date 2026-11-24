#!/usr/bin/env node
/**
 * Read-only generator for a tightly scoped Virtuoso chat seed plan.
 * Does NOT contact ICP or write messages. Execute only through an authenticated
 * approved client after validating conversation ownership on the live canister.
 */
import fs from 'node:fs';
const CLUB='9c5fa204-6cbe-49d5-a3d2-26b98b0419de';
const threads=[
 ['Coaches',`default-club-chat:${CLUB}:coaches`],
 ['Club Committee',`default-club-chat:${CLUB}:club_committee`],
 ['Team Admins',`default-club-chat:${CLUB}:team_admins`],
 ['Fundraising',`chat-${CLUB}-13`],
 ['Club chat',CLUB],
 ['U8 Rockets','b13954cf-a9f8-4b51-9cb1-0f7ec6a31820'],
 ['U10 Strikers','d4f22f68-26a0-4868-a0aa-2b28dcd01933'],
 ['U12 United','e813df04-63bd-4dcb-bdf9-bccfa8c57d21'],
 ['U14 Warriors','f04f188b-8cb4-475e-9f31-0cf0f83ab20c']
];
const count=Number(process.env.TARGET_MESSAGES||150);
if(!Number.isInteger(count)||count<1||count>300)throw Error('TARGET_MESSAGES must be 1..300');
const templates=[
 'Training is confirmed for Saturday. Please arrive early with boots and water.',
 'Can anyone bring spare cones and bibs?',
 'Great effort at the last game! ⚽',
 'Please update availability before Thursday evening.',
 'We will rotate the goalkeeper and substitutes this weekend.',
 'The pitch looks good after the rain.',
 'Long message for variable-height scrolling: We will start with passing drills, then move into small-sided games. Coaches will rotate players across several positions so everyone gets a chance to practise. Please check the fixture details and tell the team if you are running late.',
 'Thanks to everyone helping with the junior soccer equipment.',
 'Can the volunteers confirm who is setting up the goals?',
 'Reminder to label drink bottles and jackets.'
];
const output={purpose:'VIRTUOSO_TEST_ONLY',club_id:CLUB,canister_id:'ttcqg-raaaa-aaaai-ayeoq-cai',target_per_thread:count,requires_live_club_ownership_verification:true,write_enabled:false,threads:threads.map(([name,conversation_id],j)=>({name,conversation_id,club_id:CLUB,messages:Array.from({length:count},(_,i)=>({body:`[DEMO TEST DATA] ${name} · ${String(i+1).padStart(3,'0')}: ${templates[(i*3+j)%templates.length]}`,idempotency_key:`virtuoso-seed-v1-${j}-${i+1}`}))}))};
const path=process.argv[2]||'/tmp/ignite-demo-virtuoso-seed.json';
fs.writeFileSync(path,JSON.stringify(output,null,2));
console.log(`Generated ${threads.length*count} demo messages for exactly ${threads.length} allowlisted conversations in club ${CLUB}; no messages sent. Output: ${path}`);
