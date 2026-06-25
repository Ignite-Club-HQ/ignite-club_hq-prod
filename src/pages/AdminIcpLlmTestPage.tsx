import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const MODELS = [
  { value: "llama3.1:8b", label: "Llama 3.1 8B" },
  { value: "llama4-scout", label: "Llama 4 Scout" },
  { value: "qwen3:32b", label: "Qwen 3 32B" },
];

export default function AdminIcpLlmTestPage() {
  const navigate = useNavigate();
  const [model, setModel] = useState("llama3.1:8b");
  const [system, setSystem] = useState("You are a concise assistant.");
  const [prompt, setPrompt] = useState("In one sentence, what is the Internet Computer?");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ response: string; elapsedMs: number } | null>(null);

  const run = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("icp-llm-test", {
        body: { prompt, system: system || undefined, model },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).detail || (data as any).error);
      setResult({ response: (data as any).response, elapsedMs: (data as any).elapsedMs });
    } catch (e: any) {
      toast.error(e?.message ?? "ICP LLM call failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background pt-safe">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur-sm">
        <div className="container flex h-14 items-center gap-2 px-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-semibold">ICP LLM Test</h1>
        </div>
      </header>

      <main className="container max-w-2xl space-y-4 px-4 py-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4" />
              DFINITY hosted LLM canister
            </CardTitle>
            <CardDescription>
              Calls canister <code className="text-xs">w36hm-eqaaa-aaaal-qr76a-cai</code> on
              mainnet via anonymous identity. No cycles, no auth.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Model</Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>System prompt</Label>
              <Input value={system} onChange={(e) => setSystem(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Prompt</Label>
              <Textarea
                rows={5}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Ask the ICP LLM something…"
              />
            </div>
            <Button onClick={run} disabled={loading || !prompt.trim()} className="w-full">
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {loading ? "Calling canister…" : "Run"}
            </Button>
          </CardContent>
        </Card>

        {result && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Response</CardTitle>
              <CardDescription>Round-trip: {result.elapsedMs} ms</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap text-sm leading-relaxed">{result.response}</pre>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
