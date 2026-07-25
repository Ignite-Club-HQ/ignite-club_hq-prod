import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const ALLOW_MARKER = /--\s*promote-guard:\s*allow/i;

const PROTECTED_TABLES = [
  "photos",
  "vault_files",
  "vault_folders",
  "vault_drive_links",
  "group_messages",
  "club_messages",
  "team_messages",
  "direct_messages",
  "match_messages",
  "gallery_chat_cards",
  "chat_groups",
  "profiles",
  "clubs",
  "teams",
  "user_roles",
  "events",
  "rsvps",
  "children",
  "club_subscriptions",
  "team_subscriptions",
  "member_subscription_payments",
  "iap_transactions",
  "notifications",
  "fcm_tokens",
  "push_subscriptions",
].join("|");

export const DESTRUCTIVE_PATTERN = new RegExp(
  [
    String.raw`\b(?:UPDATE|DELETE\s+FROM|TRUNCATE)\s+(?:ONLY\s+)?(?:public\.)?(?:${PROTECTED_TABLES})\b`,
    String.raw`\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?(?:${PROTECTED_TABLES})\b`,
    String.raw`\bDROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?(?:image_url|file_url|hero_image_url|avatar_url|logo_url)\b`,
  ].join("|"),
  "gi",
);

export function scanMigrationSql(sql) {
  if (ALLOW_MARKER.test(sql)) {
    return { allowed: true, findings: [] };
  }

  const findings = [];
  for (const match of sql.matchAll(DESTRUCTIVE_PATTERN)) {
    const before = sql.slice(0, match.index);
    findings.push({
      line: before.split(/\r?\n/).length,
      statement: match[0].replace(/\s+/g, " ").trim(),
    });
  }
  return { allowed: false, findings };
}

export function changedMigrationFiles(base, head = "HEAD") {
  const output = execFileSync(
    "git",
    [
      "diff",
      "--name-only",
      "--diff-filter=AM",
      base,
      head,
      "--",
      "supabase/migrations/",
    ],
    { encoding: "utf8" },
  );
  return output.split(/\r?\n/).filter(Boolean);
}

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function run() {
  const base = argument("base");
  const head = argument("head") ?? "HEAD";
  if (!base) {
    console.error("Usage: node scripts/destructive-migration-guard.mjs --base=<git-ref> [--head=<git-ref>]");
    process.exit(2);
  }

  const files = changedMigrationFiles(base, head);
  if (files.length === 0) {
    console.log("PASS: no new or modified migration files require scanning.");
    return;
  }

  console.log(`Scanning ${files.length} new or modified migration file(s).`);
  let failed = false;
  for (const file of files) {
    const result = scanMigrationSql(readFileSync(file, "utf8"));
    if (result.allowed) {
      console.log(`REVIEWED: ${file} contains a promote-guard allow marker.`);
      continue;
    }
    for (const finding of result.findings) {
      console.error(
        `::error file=${file},line=${finding.line}::Potentially destructive migration statement: ${finding.statement}`,
      );
      failed = true;
    }
  }

  if (failed) {
    console.error(
      "FAIL: migration could destroy production data. Remove the statement or add '-- promote-guard: allow' only after explicit human review.",
    );
    process.exit(1);
  }
  console.log("PASS: destructive migration guard found no protected statements.");
}

if (process.argv[1]?.endsWith("destructive-migration-guard.mjs")) {
  run();
}
