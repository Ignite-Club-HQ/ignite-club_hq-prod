import { appendFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { LOCAL_CONTAINERS } from "./local-baseline-safety.mjs";

const outputPath = resolve(process.argv[2] ?? "");
if (!process.argv[2] || !outputPath.includes(`${resolve("test-results", "local-load")}/`)) {
  throw new Error("Resource samples must remain inside test-results/local-load");
}

mkdirSync(dirname(outputPath), { recursive: true });
let stopped = false;

function number(value) {
  const parsed = Number.parseFloat(String(value).replace("%", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function sample() {
  try {
    const output = execFileSync("docker", [
      "stats",
      "--no-stream",
      "--format", "{{json .}}",
      ...LOCAL_CONTAINERS,
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const containers = output.trim().split("\n").filter(Boolean).map((line) => {
      const item = JSON.parse(line);
      return {
        name: item.Name,
        cpuPercent: number(item.CPUPerc),
        memoryPercent: number(item.MemPerc),
        memoryUsage: item.MemUsage,
        networkIO: item.NetIO,
        blockIO: item.BlockIO,
        pids: Number.parseInt(item.PIDs, 10) || null,
      };
    });
    appendFileSync(outputPath, `${JSON.stringify({
      recordedAt: new Date().toISOString(),
      containers,
    })}\n`, "utf8");
  } catch {
    // The lifecycle may remove containers between the final sample and shutdown.
  }
}

function stop() {
  if (stopped) return;
  stopped = true;
  clearInterval(timer);
  sample();
  process.exit(0);
}

sample();
const timer = setInterval(sample, 5_000);
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
