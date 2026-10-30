import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Plus, Trash2, Sparkles, Square, Download, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { getActiveSupabaseTarget } from "@/live/targetRegistry";
import { resolveAuthBackend } from "@/live/authBackendMode";
import { useAuth } from "@/hooks/useAuth";
import { prepareScoreRecords, type ScoreReviewRecord } from "@/lib/scoreReviewInput";

const initialRecords: ScoreReviewRecord[] = [
  { source: "Score", orientation: "home-away", firstScore: "", secondScore: "" },
  { source: "History", orientation: "home-away", firstScore: "", secondScore: "" },
];
export default function ScoreHistoryReviewPage() {
  const { clubId } = useParams();
  const { user } = useAuth();
  const icp = resolveAuthBackend() === "icp";
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [anchors, setAnchors] = useState({ competitionId: "", matchId: "", homeTeamId: "", awayTeamId: "" });
  const [records, setRecords] = useState(initialRecords);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState("");
  const [complete, setComplete] = useState(false);
  const [comparison, setComparison] = useState("");
  const [submitted, setSubmitted] = useState<unknown>();
  const abort = useRef<AbortController>();
  useEffect(() => {
    let active = true;
    abort.current?.abort();
    setAnswer(""); setComparison(""); setSubmitted(undefined); setComplete(false); setConsent(false);
    setRecords(initialRecords); setAnchors({ competitionId: "", matchId: "", homeTeamId: "", awayTeamId: "" });
    setAllowed(null);
    if (icp || !clubId || !user) { setAllowed(false); return; }
    supabase.from("user_roles").select("id").eq("user_id", user.id).eq("club_id", clubId).eq("role", "club_admin").limit(1).then(({ data, error }) => {
      if (active) setAllowed(!error && Boolean(data?.length));
    });
    return () => { active = false; abort.current?.abort(); };
  }, [clubId, user?.id, icp]);
  const updateRecord = (index: number, patch: Partial<ScoreReviewRecord>) => setRecords(prev => prev.map((r, i) => i === index ? { ...r, ...patch } : r));
  async function review() {
    if (busy) return;
    setError(""); setAnswer(""); setComplete(false); setComparison("");
    try {
      if (!clubId || !allowed || !consent) return;
      if (Object.values(anchors).some(v => !v.trim() || v.trim().length > 128)) throw new Error("Provide all four identifiers, each up to 128 characters.");
      if (anchors.homeTeamId.trim() === anchors.awayTeamId.trim()) throw new Error("Home and away team identifiers must differ.");
      const body = { clubId, ...Object.fromEntries(Object.entries(anchors).map(([k,v]) => [k,v.trim()])), consent, records: prepareScoreRecords(records) };
      setBusy(true);
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) throw new Error("Sign in again to review scores.");
      setSubmitted(body);
      const controller = new AbortController(); abort.current = controller;
      const target = getActiveSupabaseTarget();
      const response = await fetch(`${target.url}/functions/v1/score-history-review`, { method: "POST", headers: { Authorization: `Bearer ${session.session.access_token}`, apikey: target.anonKey, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        throw new Error(failure.error || "Score review is unavailable. Your records have not been changed.");
      }
      if (!response.body) throw new Error("No review response was received.");
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let doneReceived = false;
      try {
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          const events = buffer.split("\n\n"); buffer = events.pop() || "";
          for (const event of events) {
            if (!event.startsWith("data: ")) continue;
            const data = JSON.parse(event.slice(6));
            if (data.type === "error") throw new Error(data.message);
            if (data.type === "comparison") setComparison(data.comparison.action);
            if (data.type === "text") setAnswer(prev => prev + data.text);
            if (data.type === "done") { doneReceived = true; setComplete(true); }
          }
        }
        if (!doneReceived) throw new Error("The review was interrupted. Any partial explanation is not a completed recommendation.");
      } finally { await reader.cancel(); }
    } catch (e) {
      setComplete(false);
      abort.current?.abort();
      setError(e instanceof Error && e.name === "AbortError" ? "Review stopped. No scores changed." : e instanceof Error ? e.message : "Review failed.");
    } finally { setBusy(false); abort.current = undefined; }
  }
  function download() {
    const blob = new Blob([JSON.stringify({ input: submitted, comparison, explanation: answer, advisoryOnly: true, scoresChanged: false, deploymentAuthorized: false }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "score-history-review.json"; link.click(); URL.revokeObjectURL(url);
  }
  return <div className="mx-auto max-w-3xl space-y-6 py-6">
    <Button variant="ghost" asChild><Link to={`/clubs/${clubId}`}><ArrowLeft className="mr-2 h-4 w-4" />Back to club</Link></Button>
    <header className="space-y-2"><h1 className="text-2xl font-bold">Score &amp; History review</h1><p className="flex items-center gap-2 text-muted-foreground"><ShieldCheck className="h-4 w-4 shrink-0" />Advisory only · No scores or History records changed</p></header>
    {allowed === null ? <p role="status">Checking administrator access…</p> : !allowed ? <p role="alert">{icp ? "Score review is not yet available with secure sign-in. Club administrator verification is required." : "Only this club’s administrators can review scores."}</p> : <>
      <fieldset disabled={busy} className="space-y-6 min-w-0">
        <div className="grid gap-4 sm:grid-cols-2">{([['competitionId','Competition identifier'],['matchId','Match identifier'],['homeTeamId','Home team identifier'],['awayTeamId','Away team identifier']] as const).map(([key,label]) => <div key={key} className="space-y-2"><Label htmlFor={key}>{label}</Label><Input id={key} maxLength={128} value={anchors[key]} onChange={e => setAnchors({ ...anchors, [key]: e.target.value })} /></div>)}</div>
        <section className="space-y-4"><h2 className="text-lg font-semibold">Record copies</h2>{records.map((record, index) => <div key={index} className="space-y-3 rounded-md border border-border p-4">
          <div className="flex items-center justify-between"><h3 className="font-medium">Record {index + 1}</h3><Button type="button" variant="ghost" size="icon" disabled={records.length <= 2} aria-label={`Remove record ${index + 1}`} onClick={() => setRecords(records.filter((_,i) => i !== index))}><Trash2 className="h-4 w-4" /></Button></div>
          <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Source</Label><Select value={record.source} onValueChange={v => updateRecord(index, { source: v as ScoreReviewRecord['source'] })}><SelectTrigger aria-label={`Record ${index+1} source`}><SelectValue /></SelectTrigger><SelectContent>{["Score", "History", "Official record"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Score order</Label><Select value={record.orientation} onValueChange={v => updateRecord(index, { orientation: v as ScoreReviewRecord['orientation'] })}><SelectTrigger aria-label={`Record ${index+1} score order`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="home-away">Home → Away</SelectItem><SelectItem value="away-home">Away → Home</SelectItem><SelectItem value="unknown">Unknown</SelectItem></SelectContent></Select></div>
          {(['firstScore','secondScore'] as const).map((key,i) => <div key={key} className="space-y-2"><Label htmlFor={`record-${index}-${key}`}>{i === 0 ? "First" : "Second"} score</Label><Input id={`record-${index}-${key}`} inputMode="numeric" maxLength={6} placeholder="Missing" value={record[key]} onChange={e => updateRecord(index, { [key]: e.target.value })} /></div>)}</div>
        </div>)}<Button variant="outline" disabled={records.length >= 20} onClick={() => setRecords([...records, { source: "History", orientation: "unknown", firstScore: "", secondScore: "" }])}><Plus className="mr-2 h-4 w-4" />Add record</Button></section>
        <div className="flex items-start gap-3"><Checkbox id="review-consent" checked={consent} onCheckedChange={v => setConsent(v === true)} /><Label htmlFor="review-consent" className="leading-relaxed">I agree to send these score copies to Lovable AI. I have excluded personal details. AI usage uses workspace credits.</Label></div>
      </fieldset>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-3"><Button disabled={!consent || busy} onClick={review}><Sparkles className="mr-2 h-4 w-4" />{busy ? "Reviewing…" : "Review discrepancies"}</Button>{busy && <Button variant="outline" onClick={() => abort.current?.abort()}><Square className="mr-2 h-4 w-4" />Stop</Button>}</div>
      {(busy || answer || comparison) && <section aria-label="Review recommendation" className="space-y-3 border-t border-border pt-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{comparison || "Review in progress"}</h2>{complete && <Button variant="outline" onClick={download}><Download className="mr-2 h-4 w-4" />Download review</Button>}</div><p role="status" className="text-sm text-muted-foreground">{complete ? "Completed · Human verification required" : busy ? "AI review in progress…" : "Incomplete review · Do not act on partial output"}</p><div className="whitespace-pre-wrap break-words leading-relaxed">{answer}</div></section>}
    </>}
  </div>;
}