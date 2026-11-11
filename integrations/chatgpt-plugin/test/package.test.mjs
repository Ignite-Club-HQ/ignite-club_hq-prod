import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const plugin=JSON.parse(read("plugin.json"));
const mcp=JSON.parse(read("mcp.json"));
const skill=read("skills/ignite-onboarding/SKILL.md");
const readme=read("README.md");

test("Ignite-branded portable package uses DFINITY's existing remote connector",()=>{
 assert.equal(plugin.name,"ignite-club-hq");
 assert.equal(plugin.extensions["com.openai"].interface.displayName,"Ignite Club HQ");
 assert.equal(plugin.extensions["com.openai"].onboardingSkill,"./skills/ignite-onboarding/SKILL.md");
 assert.deepEqual(Object.keys(mcp.mcpServers),["internet_computer"]);
 const server=mcp.mcpServers.internet_computer;
 assert.equal(server.type,"streamable-http");
 assert.equal(server.url,"https://mcp.internetcomputer.org/mcp");
 assert.equal(server.extensions["com.openai"].auth.type,"oauth");
 assert.equal(server.extensions["com.openai"].auth.client.mode,"cimd");
});

test("user consent and publication conditions remain explicit",()=>{
 assert.match(skill,/explicitly approve/);
 assert.match(skill,/PR #1456/);
 assert.match(skill,/do not require a separate install/i);
 assert.match(readme,/domain verification/i);
 assert.match(readme,/not installed or published/);
 assert.match(read("DFINITY-approval-request.md"),/not sent/);
 assert.doesNotMatch(read("mcp.json"),/clientSecret|Bearer |stripe.com|mcp.igniteclubhq.com/);
});

test("customer URLs are branded and never Lovable or Stripe destinations",()=>{
 for(const url of ["https://igniteclubhq.com/register","https://igniteclubhq.app","https://igniteclubhq.app/get/ios","https://igniteclubhq.app/get/android"]){
  assert.ok(skill.includes(url));
 }
 assert.ok(!skill.includes("https://ignite-club-launchpad.lovable.app"), "Do not show Lovable project URL");
});
