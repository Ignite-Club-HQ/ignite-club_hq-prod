import { Flame } from "lucide-react";

export function AuthBrand({ compact = false }: { compact?: boolean }) {
  return <header className="text-center">
    <div className="mb-6 flex items-center justify-center gap-2.5" aria-label="Ignite">
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
        <Flame className="h-6 w-6 text-primary-foreground" aria-hidden="true" />
      </span>
      <span className="text-xl font-semibold text-foreground">Ignite</span>
    </div>
    {!compact && <>
      <h1 className="text-3xl font-semibold leading-tight text-foreground">Welcome to Ignite</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Your club. Your team. All in one place.</p>
    </>}
  </header>;
}