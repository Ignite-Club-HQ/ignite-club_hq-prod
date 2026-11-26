import { Flame } from "lucide-react";

export function AuthBrand({ compact = false }: { compact?: boolean }) {
  return <header className="text-center">
    <div className="flex items-center justify-center gap-3" aria-label="Ignite">
      <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary">
        <Flame className="h-7 w-7 text-primary-foreground" aria-hidden="true" />
      </span>
      <h1 className="text-3xl font-semibold text-foreground">Ignite</h1>
    </div>
    <p className={`${compact ? "mt-2" : "mt-3"} text-sm leading-relaxed text-muted-foreground`}>Manage your club, all in one place.</p>
  </header>;
}