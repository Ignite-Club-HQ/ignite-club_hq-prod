import { createClient } from "@supabase/supabase-js";
import { validateDrill } from "../src/components/pitch/training/drillValidator";
async function main() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
  const { data: drills } = await sb.from("drills").select("id,name").eq("is_official", true).order("name");
  const flagged: string[] = [];
  for (const d of drills ?? []) {
    const { data: rows } = await sb.from("drill_frames").select("position,duration_ms,notes,objects,annotations").eq("drill_id", d.id).order("position");
    const frames = (rows ?? []).map((r: any) => ({
      id: String(r.position), position: r.position, durationMs: r.duration_ms ?? 1500,
      objects: Array.isArray(r.objects) ? r.objects : [], annotations: Array.isArray(r.annotations) ? r.annotations : [],
    }));
    const result = validateDrill({ id: d.id, name: d.name, frames });
    if (result.issues.some((i) => i.rule === "contest-fairness")) flagged.push(`${d.name}\t${d.id}`);
  }
  console.log("FLAGGED:\n" + flagged.join("\n"));
  console.log("TOTAL=" + flagged.length);
}
main().catch((e) => { console.error(e); process.exit(1); });
