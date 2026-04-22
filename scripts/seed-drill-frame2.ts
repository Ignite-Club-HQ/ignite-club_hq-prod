#!/usr/bin/env -S npx tsx
/**
 * Adds a second animation frame to every official drill that currently
 * only has one frame. The second frame moves players/ball along the
 * intended motion (derived from the first frame's arrows) so the
 * drill actually animates when "Play" is pressed.
 *
 * Run with:
 *   SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/seed-drill-frame2.ts
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ?? "https://yabcfiuntwqjwvschnji.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhYmNmaXVudHdxand2c2NobmppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3MzI0MjcsImV4cCI6MjA4MzMwODQyN30.ew6qjjYM3BR3S1rYupohNEQmQ_3MeHFFn8zDXhLM4as";

if (!SERVICE_KEY) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY env var.");
  process.exit(2);
}

type Obj = {
  id: string;
  type: string;
  x: number;
  y: number;
  rotation?: number;
  label?: string;
  color?: string;
  size?: number;
};

/**
 * For each drill, define how objects should move in frame 2.
 * Key = drill name (matching db). Value = function that takes frame-1 objects
 * and returns frame-2 objects (arrays). Annotations are kept identical.
 */
const motions: Record<string, (objs: Obj[]) => Obj[]> = {
  "1v1 attack with feint": (o) =>
    o.map((p) => {
      if (p.label === "A") return { ...p, x: 62, y: 40 }; // attacker beats defender
      if (p.id === "o8" && p.type === "ball") return { ...p, x: 64, y: 40 };
      if (p.label === "D") return { ...p, x: 45, y: 50 }; // defender drops sideways
      return p;
    }),
  "1v1 defending channel": (o) =>
    o.map((p) => {
      if (p.label === "A") return { ...p, x: 50, y: 50 }; // attacker drives forward
      if (p.id === "o8" && p.type === "ball") return { ...p, x: 52, y: 50 };
      if (p.label === "D") return { ...p, x: 50, y: 42 }; // defender retreats
      return p;
    }),
  "1v1 to end-zone": (o) =>
    o.map((p) => {
      if (p.label === "A") return { ...p, x: 40, y: 40 };
      if (p.type === "ball") return { ...p, x: 42, y: 40 };
      if (p.label === "D") return { ...p, x: 48, y: 40 };
      return p;
    }),
  "1v1 to mini-goals": (o) =>
    o.map((p) => {
      if (p.label === "A") return { ...p, x: 50, y: 50 };
      if (p.type === "ball") return { ...p, x: 50, y: 52 };
      if (p.label === "D") return { ...p, x: 50, y: 55 };
      return p;
    }),
  "1v1 with overlap option": (o) =>
    o.map((p) => {
      if (p.label === "A") return { ...p, x: 48, y: 55 };
      if (p.label === "B") return { ...p, x: 35, y: 50 }; // overlap run
      if (p.type === "ball") return { ...p, x: 50, y: 55 };
      if (p.label === "D") return { ...p, x: 48, y: 45 };
      return p;
    }),
  "4v4 small-sided game": (o) =>
    o.map((p) => {
      // Blue attack: shift forward (lower y)
      if (p.color === "#0ea5e9") return { ...p, y: Math.max(15, p.y - 12) };
      // Red defense: shift back to defend
      if (p.color === "#ef4444") return { ...p, y: Math.max(20, p.y - 8) };
      if (p.type === "ball") return { ...p, x: 45, y: 38 };
      return p;
    }),
  "Check-away to receive": (o) =>
    o.map((p) => {
      if (p.label === "R") return { ...p, x: 35, y: 40 }; // checks away then in
      if (p.label === "S") return { ...p, x: 50, y: 80 };
      if (p.type === "ball") return { ...p, x: 37, y: 42 };
      return p;
    }),
  "Close-control dribble box": (o) =>
    o.map((p) => {
      // Players shuffle inside the box
      if (p.id === "p1") return { ...p, x: 55, y: 35 };
      if (p.id === "p2") return { ...p, x: 65, y: 50 };
      if (p.id === "p3") return { ...p, x: 50, y: 65 };
      if (p.id === "p4") return { ...p, x: 35, y: 55 };
      if (p.id === "p5") return { ...p, x: 45, y: 45 };
      if (p.id === "p6") return { ...p, x: 50, y: 38 };
      return p;
    }),
  "Cone slalom dribble": (o) =>
    o.map((p) => {
      if (p.label === "1") return { ...p, x: 42, y: 49 }; // halfway through slalom
      if (p.type === "ball") return { ...p, x: 44, y: 49 };
      return p;
    }),
  "Cool-down circle": (o) =>
    o.map((p) => {
      // Rotate the circle by ~30° around (50,50)
      const cx = 50, cy = 50;
      const ang = (Math.PI / 180) * 30;
      const cos = Math.cos(ang), sin = Math.sin(ang);
      if (p.type !== "player") return p;
      const dx = p.x - cx, dy = p.y - cy;
      return {
        ...p,
        x: Math.round((cx + dx * cos - dy * sin) * 10) / 10,
        y: Math.round((cy + dx * sin + dy * cos) * 10) / 10,
      };
    }),
  "Defensive shape walk-through": (o) =>
    o.map((p) => {
      // Whole back four shifts right toward the ball-side
      if (p.color === "#0ea5e9") return { ...p, x: Math.min(85, p.x + 12) };
      if (p.label === "A") return { ...p, x: 78, y: 45 }; // attacker advances
      if (p.type === "ball") return { ...p, x: 78, y: 46 };
      return p;
    }),
  "Dribble gates": (o) =>
    o.map((p) => {
      if (p.id === "o13") return { ...p, x: 30, y: 25 }; // passes through gate 1
      if (p.id === "o14") return { ...p, x: 65, y: 30 };
      if (p.id === "o15") return { ...p, x: 32, y: 25 };
      if (p.id === "o16") return { ...p, x: 67, y: 30 };
      return p;
    }),
  "Dribble warm-up": (o) =>
    o.map((p) => {
      if (p.id === "o5") return { ...p, x: 25, y: 25 };
      if (p.id === "o6") return { ...p, x: 75, y: 30 };
      if (p.id === "o7") return { ...p, x: 65, y: 75 };
      if (p.id === "o8") return { ...p, x: 27, y: 27 };
      if (p.id === "o9") return { ...p, x: 77, y: 32 };
      if (p.id === "o10") return { ...p, x: 67, y: 77 };
      return p;
    }),
  "Driven shot from pass U9-U12": (o) =>
    o.map((p) => {
      if (p.label === "F") return { ...p, x: 50, y: 40 }; // finisher meets pass
      if (p.label === "S") return { ...p, x: 60, y: 70 };
      if (p.type === "ball") return { ...p, x: 50, y: 18 }; // shot toward goal
      return p;
    }),
  "Figure-8 dribble": (o) =>
    o.map((p) => {
      if (p.label === "1") return { ...p, x: 58, y: 45 };
      if (p.type === "ball") return { ...p, x: 60, y: 45 };
      return p;
    }),
  "Goalkeeper handling basics": (o) =>
    o.map((p) => {
      if (p.label === "C") return { ...p, x: 50, y: 70 };
      if (p.type === "ball") return { ...p, x: 52, y: 35 }; // ball travels to GK
      return p;
    }),
  "Line shooting U6-U8": (o) =>
    o.map((p) => {
      if (p.label === "1") return { ...p, x: 50, y: 50 };
      if (p.id === "o7" && p.type === "ball") return { ...p, x: 50, y: 30 }; // shot
      return p;
    }),
  "Outside-foot slalom": (o) =>
    o.map((p) => {
      if (p.label === "A") return { ...p, x: 55, y: 63 };
      if (p.type === "ball") return { ...p, x: 53, y: 63 };
      return p;
    }),
  "Passing squares": (o) =>
    o.map((p) => {
      // Ball travels around the square 25,25 → 75,25
      if (p.id === "o9" && p.type === "ball") return { ...p, x: 73, y: 25 };
      return p;
    }),
  "Pressure and cover": (o) =>
    o.map((p) => {
      if (p.label === "A") return { ...p, x: 50, y: 60 }; // attacker advances
      if (p.label === "D1") return { ...p, x: 50, y: 65 }; // presses ball
      if (p.label === "D2") return { ...p, x: 45, y: 48 }; // covers diagonally
      if (p.type === "ball") return { ...p, x: 52, y: 60 };
      return p;
    }),
  "Rebound finishing": (o) =>
    o.map((p) => {
      if (p.label === "A") return { ...p, x: 30, y: 50 }; // moves to receive rebound
      if (p.label === "C") return { ...p, x: 80, y: 60 };
      if (p.type === "ball") return { ...p, x: 50, y: 18 }; // shot at goal
      return p;
    }),
  "Receive on the half-turn": (o) =>
    o.map((p) => {
      if (p.label === "B") return { ...p, x: 50, y: 45 }; // opens up
      if (p.type === "ball") return { ...p, x: 78, y: 50 }; // pass arrives at C
      return p;
    }),
  "Receive under pressure": (o) =>
    o.map((p) => {
      if (p.label === "A") return { ...p, x: 50, y: 70 };
      if (p.label === "B") return { ...p, x: 55, y: 45 }; // checks toward A
      if (p.type === "ball") return { ...p, x: 55, y: 47 };
      if (p.label === "X") return { ...p, x: 58, y: 48 };
      return p;
    }),
  "Rondo 4v1": (o) =>
    o.map((p) => {
      // Ball moves A → B
      if (p.type === "ball") return { ...p, x: 70, y: 35 };
      if (p.label === "X") return { ...p, x: 55, y: 45 }; // defender shifts to ball
      return p;
    }),
  "Shooting circuit": (o) =>
    o.map((p) => {
      if (p.label === "S") return { ...p, x: 50, y: 35 };
      if (p.id === "o4" && p.label === "1") return { ...p, x: 40, y: 65 };
      if (p.type === "ball") return { ...p, x: 50, y: 18 }; // shot
      return p;
    }),
  "Side-channel finishing": (o) =>
    o.map((p) => {
      if (p.label === "F") return { ...p, x: 42, y: 25 };
      if (p.label === "S") return { ...p, x: 75, y: 50 };
      if (p.type === "ball") return { ...p, x: 42, y: 14 }; // shot
      return p;
    }),
  "Strike from a moving ball U9-U12": (o) =>
    o.map((p) => {
      if (p.label === "S") return { ...p, x: 35, y: 55 };
      if (p.label === "A") return { ...p, x: 50, y: 50 }; // strikes the ball
      if (p.type === "ball") return { ...p, x: 50, y: 18 };
      return p;
    }),
  "Through-ball pattern": (o) =>
    o.map((p) => {
      if (p.label === "M") return { ...p, x: 50, y: 60 };
      if (p.label === "F") return { ...p, x: 55, y: 40 };
      if (p.label === "R") return { ...p, x: 72, y: 35 }; // makes the run
      if (p.type === "ball") return { ...p, x: 72, y: 32 };
      return p;
    }),
  "Triangle passing": (o) =>
    o.map((p) => {
      if (p.type === "ball") return { ...p, x: 27, y: 73 }; // ball travels to player 2
      return p;
    }),
  "Two-cone shooting gates": (o) =>
    o.map((p) => {
      if (p.id === "p1" && p.label === "1") return { ...p, x: 40, y: 50 };
      if (p.type === "ball") return { ...p, x: 50, y: 18 }; // shot
      return p;
    }),
  "Volley finish from cross": (o) =>
    o.map((p) => {
      // Default mover: anything reasonable. Cross arrives in box.
      if (p.type === "ball") return { ...p, x: 55, y: 22 };
      // Striker meets cross
      const lower = (p.label ?? "").toLowerCase();
      if (p.type === "player" && (lower === "f" || lower === "a" || lower === "1"))
        return { ...p, x: 55, y: 25 };
      return p;
    }),
};

async function main() {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: drills, error: dErr } = await supabase
    .from("drills")
    .select("id, name")
    .eq("is_official", true)
    .order("name");
  if (dErr) throw dErr;
  if (!drills?.length) {
    console.log("No official drills found.");
    return;
  }

  let added = 0;
  let skipped = 0;
  let missing: string[] = [];

  for (const d of drills) {
    const { data: existing, error: eErr } = await supabase
      .from("drill_frames")
      .select("id, position, objects, annotations, duration_ms")
      .eq("drill_id", d.id)
      .order("position");
    if (eErr) {
      console.warn(`load frames failed for ${d.name}: ${eErr.message}`);
      continue;
    }
    if (!existing?.length) {
      console.warn(`no frames at all for ${d.name} — skipping`);
      continue;
    }
    if (existing.length > 1) {
      skipped++;
      continue;
    }

    const motion = motions[d.name];
    if (!motion) {
      missing.push(d.name);
      continue;
    }

    const f1 = existing[0];
    const f1Objects = (Array.isArray(f1.objects) ? f1.objects : []) as Obj[];
    const f2Objects = motion(f1Objects);

    const { error: insErr } = await supabase.from("drill_frames").insert({
      drill_id: d.id,
      position: 1,
      duration_ms: f1.duration_ms ?? 1500,
      notes: null,
      objects: f2Objects,
      // Keep arrows on frame 2 so coaches still see the intended path
      annotations: f1.annotations ?? [],
    });
    if (insErr) {
      console.warn(`insert failed for ${d.name}: ${insErr.message}`);
      continue;
    }
    added++;
    console.log(`✓ added frame 2 for "${d.name}"`);
  }

  console.log(
    `\nDone. added=${added}  already-multiframe=${skipped}  missing-motion=${missing.length}`
  );
  if (missing.length) {
    console.log("Missing motion definitions for:");
    for (const n of missing) console.log("  - " + n);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
