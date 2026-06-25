// Test endpoint that calls DFINITY's hosted LLM canister on the Internet Computer.
// Canister: w36hm-eqaaa-aaaal-qr76a-cai (free, anonymous, no Internet Identity needed)
// Docs: https://github.com/dfinity/llm
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { HttpAgent, Actor } from "npm:@dfinity/agent@2.1.3";
import { Principal } from "npm:@dfinity/principal@2.1.3";

const LLM_CANISTER_ID = "w36hm-eqaaa-aaaal-qr76a-cai";
const IC_HOST = "https://icp-api.io";

// Minimal Candid IDL for the v1 chat interface
const idlFactory = ({ IDL }: any) => {
  const ChatMessageV1 = IDL.Record({
    role: IDL.Variant({ user: IDL.Null, assistant: IDL.Null, system: IDL.Null }),
    content: IDL.Text,
  });
  const ChatRequestV1 = IDL.Record({
    model: IDL.Text,
    messages: IDL.Vec(ChatMessageV1),
  });
  return IDL.Service({
    v0_chat: IDL.Func([ChatRequestV1], [IDL.Text], []),
  });
};

type Role = "user" | "assistant" | "system";
interface Msg { role: Role; content: string }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const prompt: string = (body.prompt ?? "").toString().trim();
    const model: string = (body.model ?? "llama3.1:8b").toString();
    const system: string | undefined = body.system?.toString();

    if (!prompt) {
      return new Response(JSON.stringify({ error: "missing_prompt" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const messages: Msg[] = [];
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: prompt });

    const candidMessages = messages.map((m) => ({
      role: { [m.role]: null } as any,
      content: m.content,
    }));

    const agent = await HttpAgent.create({ host: IC_HOST });
    const actor: any = Actor.createActor(idlFactory, {
      agent,
      canisterId: Principal.fromText(LLM_CANISTER_ID),
    });

    const started = Date.now();
    const response: string = await actor.v0_chat({ model, messages: candidMessages });
    const elapsedMs = Date.now() - started;

    return new Response(JSON.stringify({ response, model, elapsedMs }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[icp-llm-test] error", err);
    return new Response(JSON.stringify({
      error: "icp_call_failed",
      detail: err instanceof Error ? err.message : String(err),
    }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
