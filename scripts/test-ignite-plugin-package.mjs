import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const status=spawnSync(process.execPath,["--test","integrations/chatgpt-plugin/test/package.test.mjs"],{cwd:root,stdio:"inherit"});
process.exit(status.status??1);
