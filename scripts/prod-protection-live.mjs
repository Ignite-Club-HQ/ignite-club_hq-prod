// Held production composition root. Tests invoke the same orchestration with
// explicit isolated adapters; there is no flag or workflow input to bypass this.
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {requireProtectionExecutionReady} from './prod-protection-policy.mjs';
export async function main(){
  requireProtectionExecutionReady();
  const [{createProductionRuntime},{runProtectionCommissioning}]=await Promise.all([
    import('./prod-protection-runner-runtime.mjs'),import('./prod-protection-runner.mjs'),
  ]);
  return runProtectionCommissioning(createProductionRuntime(process.env));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{
  const text='Protection commissioning stopped safely. Inspect the retained receipt; do not replay an unresolved intent. No opening authorized.';
  console.error(text);if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,text+'\n');process.exitCode=1;
});