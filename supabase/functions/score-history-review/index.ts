import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { ReviewSchema, compareRecords, isClubAdministrator, REVIEW_INSTRUCTIONS } from "./policy.ts";
import { createResponsesCall } from "./responses.ts";
import { getLovableAiGatewayResponseHeaders } from "./run-id.ts";

const json = (error: string, status: number) => new Response(JSON.stringify({ error }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
function gatewayError(error: unknown) {
  const e = error as { statusCode?: number; responseBody?: string; message?: string };
  let message = "AI review failed. Your records have not been changed.";
  let errorType = "";
  try {
    const body = JSON.parse(e.responseBody || "{}");
    message = body.error?.message || body.message || message;
    errorType = body.error?.type || body.type || "";
  } catch { /* Never expose SDK request details or credentials. */ }
  return { status: e.statusCode || 502, message, errorType };
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (request.method !== "POST") return json("Method not allowed", 405);
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!url || !anon || !service || !key) return json("Score review is not configured.", 503);
  const token = request.headers.get("Authorization")?.replace(/^Bearer /, "");
  if (!token) return json("Sign in to review scores.", 401);
  const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: authError } = await auth.auth.getUser(token);
  if (authError || !userData.user) return json("Sign in to review scores.", 401);
  const raw = await request.text();
  if (raw.length > 16000) return json("Review input is too large.", 400);
  let input;
  try {
    const parsed = ReviewSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return json("Provide distinct team identifiers and 2–20 valid records. Scores must be non-negative whole numbers or missing.", 400);
    input = parsed.data;
  } catch { return json("Invalid review input.", 400); }
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: roles, error: roleError } = await admin.from("user_roles").select("role, club_id").eq("user_id", userData.user.id).eq("role", "club_admin").eq("club_id", input.clubId);
  if (roleError) return json("Administrator access could not be checked.", 503);
  if (!isClubAdministrator(roles || [], input.clubId)) return json("Only this club’s administrators can review scores.", 403);
  const { data: access, error: accessError } = await admin.from("score_review_ai_access").select("blocked,status,message").eq("id", "gateway").maybeSingle();
  if (accessError) return json("AI access status could not be checked.", 503);
  if (access?.blocked) return json(access.message || "AI review is paused until access is restored.", access.status || 403);
  const comparison = compareRecords(input);
  // Identifiers stay local to authorization/UI: only numbered score copies go to AI.
  const { result, runIdFetch } = createResponsesCall(request, {
    baseURL: "https://ai.gateway.lovable.dev/v1", apiKey: key, model: "openai/gpt-6-astra",
  }, [{ role: "user", content: JSON.stringify(comparison) }], REVIEW_INSTRUCTIONS);
  const iterator = result.fullStream[Symbol.asyncIterator]();
  const encoder = new TextEncoder();
  const event = (value: unknown) => encoder.encode(`data: ${JSON.stringify(value)}\n\n`);
  const failure = async (error: unknown) => {
    const safe = gatewayError(error);
    if (safe.status === 402 || safe.status === 403) {
      const { error: persistError } = await admin.from("score_review_ai_access").upsert({ id: "gateway", blocked: true, status: safe.status, message: safe.message, updated_at: new Date().toISOString() });
      if (persistError) return { ...safe, message: "AI access is blocked; its access status could not be saved. Contact an administrator before requesting another review." };
    }
    return safe;
  };
  try {
    const first = await iterator.next();
    if (!first.done && first.value.type === "error") {
      const safe = await failure(first.value.error);
      return json(safe.message, safe.status);
    }
    const headers = getLovableAiGatewayResponseHeaders(undefined, { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    const runId = runIdFetch.getRunId();
    if (runId) { headers.set("X-Lovable-AIG-Run-ID", runId); headers.set("Access-Control-Expose-Headers", "X-Lovable-AIG-Run-ID"); }
    const body = new ReadableStream({
      async start(controller) {
        controller.enqueue(event({ type: "comparison", comparison }));
        let text = "";
        try {
          let part = first;
          while (!part.done) {
            if (part.value.type === "error") {
              const safe = await failure(part.value.error);
              controller.enqueue(event({ type: "error", ...safe }));
              controller.close(); return;
            }
            if (part.value.type === "text-delta") {
              text += part.value.text;
              controller.enqueue(event({ type: "text", text: part.value.text }));
            }
            part = await iterator.next();
          }
          controller.enqueue(event(text.trim() ? { type: "done" } : { type: "error", message: "The model returned no explanation. No records were changed." }));
          controller.close();
        } catch (error) {
          if (!request.signal.aborted) controller.enqueue(event({ type: "error", ...await failure(error) }));
          controller.close();
        }
      },
      async cancel() { await iterator.return?.(); },
    });
    return new Response(body, { headers });
  } catch (error) {
    if (request.signal.aborted) return json("Review stopped.", 499);
    const safe = await failure(error);
    return json(safe.message, safe.status);
  }
});