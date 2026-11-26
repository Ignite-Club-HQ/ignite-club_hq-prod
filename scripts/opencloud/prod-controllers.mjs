// Offline PROD-only controller request generator. No signing or network calls.
import {readFileSync} from 'node:fs';
import {statusRequest,decodeStatus,updateRequest,verifyAfter} from './controllers.mjs';
const config=JSON.parse(readFileSync(new URL('../../deploy/opencloud/prod.json',import.meta.url),'utf8'));
const dev=JSON.parse(readFileSync(new URL('../../deploy/opencloud/dev.json',import.meta.url),'utf8'));
const ids=c=>[...Object.values(c.shared),...c.groups.flatMap(g=>Object.values(g.canisterIds))];
const all=ids(config);
const operator='s53an-5aaaa-aaac5-aaaaa-cai';
if(config.environment!=='opencloud-prod'||config.applicationKey!=='ignite_prod_v2'||config.branch!=='prod'||config.operatorId!==operator||all.length!==32||new Set(all).size!==32||all.some(id=>ids(dev).includes(id)||!/-aaac5-aae[a-z2-7]+-cai$/.test(id)))throw Error('PROD inventory guard failed');
const retain=[operator,'tuhjl-zg657-opcmu-4fct6-uxbzv-4j725-r6k7s-yxj4h-4el4q-og5ow-jqe'];
const add=['4sf7q-x5j7l-a3cwp-dt7rd-evzpu-gextt-cmqum-fmzsg-avqpp-wk7ga-sae','kydv5-mptl2-ip3ie-5zwd3-gc5en-4opnd-mytmr-gza6m-xh5t4-jz662-7ae'];
const forbid=[dev.controllers.governor,dev.controllers.frontendPublisher];
const [cmd,id,before,after]=process.argv.slice(2);
const target=x=>{if(!all.includes(x))throw Error('Not a PROD target');return {id:x,retain,add,forbid};};
let result;
if(cmd==='status')result=(id==='all'?all:[target(id).id]).map(statusRequest);
else if(cmd==='decode')result=decodeStatus(id);
else if(cmd==='update')result=updateRequest(target(id),decodeStatus(before).controllers);
else if(cmd==='verify'){result=verifyAfter(target(id),decodeStatus(before),decodeStatus(after));if(!result.ok)process.exitCode=1;}
else if(cmd==='batch')result=all.filter(x=>x!==config.shared.frontend).map(x=>({id:x,status:statusRequest(x),update:updateRequest(target(x),retain)}));
else if(cmd==='plan')result=all.map(target);
else throw Error('Unknown command');
console.log(JSON.stringify(result,null,2));
